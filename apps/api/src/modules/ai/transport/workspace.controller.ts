import { Body, Controller, Get, Header, Inject, Param, Post } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { AiWorkspaceApplicationService } from '../application/workspace.application-service';
@Controller('ai/workspace')
export class AiWorkspaceController {
  constructor(@Inject(AiWorkspaceApplicationService) private readonly service: AiWorkspaceApplicationService) {}
  @Get('settings') @Header('Cache-Control','no-store')
  settings(@CurrentActor() actor: ActorContext) { return this.service.settings(actor); }
  @Post('settings/draft') @Header('Cache-Control','no-store')
  draft(@CurrentActor() actor: ActorContext, @Body() raw: unknown) { return this.service.saveDraft(actor,raw); }
  @Post('settings/publish') @Header('Cache-Control','no-store')
  publish(@CurrentActor() actor: ActorContext, @Body() raw: unknown) { return this.service.publish(actor,raw); }
  @Post('library/sync') @Header('Cache-Control','no-store')
  sync(@CurrentActor() actor: ActorContext) { return this.service.sync(actor); }
  @Post('library/test') @Header('Cache-Control','no-store')
  test(@CurrentActor() actor: ActorContext, @Body() raw: unknown) { return this.service.testLibrary(actor,raw); }
  @Get('proposals/:id') @Header('Cache-Control','no-store')
  proposal(@CurrentActor() actor: ActorContext, @Param('id') id: string) { return this.service.proposal(actor,id); }
  @Post('proposals/:id/confirm') @Header('Cache-Control','no-store')
  confirm(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() raw: unknown) { return this.service.confirm(actor,id,raw); }
  @Post('proposals/:id/revise') @Header('Cache-Control','no-store')
  revise(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() raw: unknown) { return this.service.revise(actor,id,raw); }
}
