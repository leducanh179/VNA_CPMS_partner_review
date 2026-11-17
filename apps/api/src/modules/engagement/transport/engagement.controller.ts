import { Body, Controller, Get, Header, Inject, Post, Put } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { EngagementApplicationService } from '../application/engagement.application-service';
@Controller('engagement')
export class EngagementController {
  constructor(@Inject(EngagementApplicationService) private readonly service: EngagementApplicationService) {}
  @Get() @Header('Cache-Control','no-store') state(@CurrentActor() actor: ActorContext) { return this.service.state(actor); }
  @Get('settings') @Header('Cache-Control','no-store') settings(@CurrentActor() actor: ActorContext) { return this.service.settings(actor); }
  @Put('settings') configure(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.configure(actor, body); }
  @Post('start') start(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.start(actor, body); }
  @Post('demo-draft') draft(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.demoDraft(actor, body); }
  @Post('demo-submit') submit(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.demoSubmit(actor, body); }
  @Post('reconcile') reconcile(@CurrentActor() actor: ActorContext) { return this.service.reconcile(actor); }
  @Post('acknowledge') acknowledge(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.acknowledge(actor, body); }
}
