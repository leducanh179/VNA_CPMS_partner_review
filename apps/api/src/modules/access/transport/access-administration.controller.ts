import type { ActorContext } from '@cpms/domain';
import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { AccessApplicationService } from '../application/access.application-service';
import { AccessAdministrationApplicationService } from '../application/access-administration.application-service';

@ApiTags('access')
@Controller('access')
export class AccessAdministrationController {
  constructor(@Inject(AccessAdministrationApplicationService) private readonly management: AccessAdministrationApplicationService,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}
  @Get()
  read(@CurrentActor() actor: ActorContext, @Query('actorId') actorId?: string, @Query('campaignId') campaignId?: string) {
    for (const id of [actorId, campaignId]) if (id !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new BadRequestException('ID phạm vi không hợp lệ.');
    return this.management.read(actor, { ...(actorId ? { actorId } : {}), ...(campaignId ? { campaignId } : {}) });
  }
  @Post('preview')
  preview(@CurrentActor() actor: ActorContext, @Body() input: unknown) { return this.management.preview(actor, input); }
  @Post('save')
  save(@CurrentActor() actor: ActorContext, @Body() input: unknown) { return this.management.save(actor, input); }
  @Post('catalog/initialize')
  initialize(@CurrentActor() actor: ActorContext) { return this.access.initializeCatalog(actor); }
  @Get('explain')
  explain(@CurrentActor() actor: ActorContext, @Query('actorId') actorId: string, @Query('campaignId') campaignId?: string) {
    for (const id of [actorId, ...(campaignId === undefined ? [] : [campaignId])]) if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new BadRequestException('ID giải thích quyền không hợp lệ.');
    return this.management.explain(actor, actorId, campaignId);
  }
  @Get('capabilities')
  capabilities(@CurrentActor() actor: ActorContext) { return this.access.currentCapabilities(actor); }
}
