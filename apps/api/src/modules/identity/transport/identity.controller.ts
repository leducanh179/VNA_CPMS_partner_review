import { Body, Controller, ForbiddenException, Get, Inject, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { Environment } from '../../../config/environment';
import type { RequestWithActor } from '../../auth/request-with-actor';
import { IdentityApplicationService, LOCAL_SESSION_COOKIE } from '../application/identity.application-service';
import { localSessionCookieOptions } from '../application/local-auth-security';

export class LocalLoginDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(1024) password!: string;
}
export class ChangeLocalPasswordDto {
  @IsString() @MaxLength(1024) currentPassword!: string;
  @IsString() @MaxLength(1024) nextPassword!: string;
}
export class ResetLocalPasswordDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class LocalAccountStatusDto extends ResetLocalPasswordDto {
  @IsBoolean() isActive!: boolean;
}
export class StartDemoDto { @IsUUID() targetActorId!: string; }
export class StartAssistDto extends StartDemoDto { @IsString() @MinLength(1) @MaxLength(1000) reason!: string; }
const validated = (type: new () => object) => new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: type, validationError: { target: false, value: false } });

@Controller('auth')
export class IdentityController {
  constructor(@Inject(IdentityApplicationService) private readonly service: IdentityApplicationService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}
  private current(request: RequestWithActor) { if (!request.localSession) throw new UnauthorizedException('Hãy đăng nhập CPMS.'); return request.localSession; }
  private cookies(response: Response, token: string, csrfToken: string, expiresAt: Date) {
    const options = localSessionCookieOptions(this.config.get('WEB_ORIGIN', { infer: true }), Math.max(1, expiresAt.getTime() - Date.now()));
    response.cookie(LOCAL_SESSION_COOKIE, token, options);
    response.cookie('cpms_csrf', csrfToken, { ...options, httpOnly: false, path: '/' });
  }
  private clearCookies(response: Response) {
    response.clearCookie(LOCAL_SESSION_COOKIE, { path: '/api' }); response.clearCookie('cpms_csrf', { path: '/' });
  }
  @Post('login')
  async login(@Body(validated(LocalLoginDto)) body: LocalLoginDto, @Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    if (this.config.get('AUTH_MODE', { infer: true }) !== 'LOCAL_SESSION') throw new ForbiddenException('Đăng nhập local chưa bật.');
    const result = await this.service.login(body.email, body.password, request.ip ?? request.socket.remoteAddress ?? 'unknown');
    this.cookies(response, result.token, result.csrfToken, result.session.expiresAt); return result.me;
  }
  @Get('me') me(@Req() request: RequestWithActor) {
    return { ...this.service.me(this.current(request)), demoImpersonationEnabled: this.config.get('LOCAL_DEMO_IMPERSONATION', { infer: true }) === 'true' };
  }
  @Post('logout') async logout(@Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    await this.service.logout(this.current(request)); this.clearCookies(response); return { loggedOut: true };
  }
  @Post('change-password') async changePassword(@Body(validated(ChangeLocalPasswordDto)) body: ChangeLocalPasswordDto, @Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    await this.service.changePassword(this.current(request), body.currentPassword, body.nextPassword); this.clearCookies(response); return { loginRequired: true };
  }
  @Get('accounts') accounts(@Req() request: RequestWithActor) { return this.service.accounts(this.current(request)); }
  @Post('accounts/division-leaders') createDivisionLeader(@Body() body: unknown, @Req() request: RequestWithActor) {
    return this.service.createDivisionLeader(this.current(request), body);
  }
  @Post('accounts/communication-specialists') createCommunicationSpecialist(@Body() body: unknown, @Req() request: RequestWithActor) {
    return this.service.createCommunicationSpecialist(this.current(request), body);
  }
  @Post('accounts/pilot-admins') createPilotAdmin(@Body() body: unknown, @Req() request: RequestWithActor) {
    return this.service.createPilotAdmin(this.current(request), body);
  }
  @Post('accounts/:id/gmail') async updateGmail(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: RequestWithActor) {
    await this.service.updateGmail(this.current(request), id, body); return { updated: true };
  }
  @Post('accounts/:id/reset-password') reset(@Param('id', ParseUUIDPipe) id: string, @Body(validated(ResetLocalPasswordDto)) body: ResetLocalPasswordDto, @Req() request: RequestWithActor) {
    return this.service.resetPassword(this.current(request), id, body.expectedVersion, body.reason);
  }
  @Post('accounts/:id/status') async status(@Param('id', ParseUUIDPipe) id: string, @Body(validated(LocalAccountStatusDto)) body: LocalAccountStatusDto, @Req() request: RequestWithActor) {
    await this.service.status(this.current(request), id, body.expectedVersion, body.isActive, body.reason); return { updated: true };
  }
  @Post('demo/start') async startDemo(@Body(validated(StartDemoDto)) body: StartDemoDto, @Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    return this.demo(request, response, body.targetActorId);
  }
  @Post('demo/end') async endDemo(@Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) { return this.demo(request, response, null); }
  @Post('assist/start') async startAssist(@Body(validated(StartAssistDto)) body: StartAssistDto, @Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.switchAssist(this.current(request), body.targetActorId, body.reason);
    this.cookies(response, result.token, result.csrfToken, result.session.expiresAt); return result.me;
  }
  @Post('assist/end') async endAssist(@Req() request: RequestWithActor, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.switchAssist(this.current(request), null);
    this.cookies(response, result.token, result.csrfToken, result.session.expiresAt); return result.me;
  }
  private async demo(request: RequestWithActor, response: Response, target: string | null) {
    if (this.config.get('LOCAL_DEMO_IMPERSONATION', { infer: true }) !== 'true' || this.config.get('NODE_ENV', { infer: true }) === 'production') throw new ForbiddenException('Trình diễn chỉ được bật tường minh trong môi trường local.');
    const result = await this.service.switchDemo(this.current(request), target); this.cookies(response, result.token, result.csrfToken, result.session.expiresAt); return result.me;
  }
}
