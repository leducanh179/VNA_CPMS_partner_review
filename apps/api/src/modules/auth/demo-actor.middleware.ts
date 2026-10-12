import { DEMO_ACTOR } from '@cpms/domain';
import { Inject, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Response } from 'express';
import type { Environment } from '../../config/environment';
import type { RequestWithActor } from './request-with-actor';
import { IdentityApplicationService, LOCAL_SESSION_COOKIE } from '../identity/application/identity.application-service';
import { isCookieMutationTrusted } from '../identity/application/local-auth-security';
import { AccessApplicationService } from '../access/application/access.application-service';

@Injectable()
export class DemoActorMiddleware {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(IdentityApplicationService) private readonly identity: IdentityApplicationService,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}

  async use(request: RequestWithActor, response: Response, next: NextFunction) {
    const authMode = this.config.get('AUTH_MODE', { infer: true });
    if (authMode === 'LOCAL_SESSION') {
      response.setHeader('Cache-Control', 'no-store');
      const route = request.originalUrl.split('?')[0];
      const configuredOrigin = this.config.get('WEB_ORIGIN', { infer: true });
      if (route === '/api/auth/login' && request.method === 'POST') {
        if (!isCookieMutationTrusted({ kind: 'LOGIN', method: request.method, origin: request.get('origin'), configuredOrigin })) throw new ForbiddenException('Origin không hợp lệ.');
        next(); return;
      }
      const cookie = request.headers.cookie?.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${LOCAL_SESSION_COOKIE}=`))?.slice(LOCAL_SESSION_COOKIE.length + 1);
      const session = await this.identity.authenticate(cookie);
      if (!session) throw new UnauthorizedException('Hãy đăng nhập CPMS.');
      if (!isCookieMutationTrusted({ kind: 'SESSION', method: request.method, origin: request.get('origin'), configuredOrigin,
        csrfToken: request.get('x-cpms-csrf'), sessionCsrfHash: session.csrfHash })) throw new ForbiddenException('Phiên bảo vệ CSRF không hợp lệ. Hãy tải lại trang.');
      if (session.original.credential?.mustChangePassword && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(route ?? '')) throw new ForbiddenException('Hãy đổi mật khẩu CPMS trước khi tiếp tục.');
      request.localSession = session;
      request.actor = this.identity.actor(session);
      this.access.withRequestActor(request.actor, next); return;
    }
    if (authMode !== 'OPEN_DEMO' || this.config.get('ALLOW_OPEN_DEMO', { infer: true }) !== 'true' || this.config.get('NODE_ENV', { infer: true }) === 'production') throw new UnauthorizedException('Chế độ xác thực không hợp lệ.');
    request.actor = {
      ...DEMO_ACTOR,
      id: this.config.get('DEMO_ACTOR_ID', { infer: true }),
      roles: [...DEMO_ACTOR.roles],
    };
    this.access.withRequestActor(request.actor, next);
  }
}
