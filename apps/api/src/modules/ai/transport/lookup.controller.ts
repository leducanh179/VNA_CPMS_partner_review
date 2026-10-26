import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ActorContext } from '@cpms/domain';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { LookupApplicationService } from '../application/lookup.application-service';

@Controller('ai/lookup')
export class LookupController {
  constructor(@Inject(LookupApplicationService) private readonly service: LookupApplicationService) {}
  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentActor() actor: ActorContext) { return this.service.status(actor); }
  @Get('conversations')
  @Header('Cache-Control', 'no-store')
  conversations(@CurrentActor() actor: ActorContext, @Query('cursor') cursor?: string) { return this.service.conversations(actor, cursor); }
  @Get('conversations/:id')
  @Header('Cache-Control', 'no-store')
  conversation(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Query('before') before?: string) { return this.service.conversation(actor, id, before); }
  @Patch('conversations/:id')
  @Header('Cache-Control', 'no-store')
  rename(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) { return this.service.rename(actor, id, body); }
  @Delete('conversations/:id')
  @Header('Cache-Control', 'no-store')
  delete(@CurrentActor() actor: ActorContext, @Param('id') id: string) { return this.service.deleteConversation(actor, id); }
  @Post('ask')
  @Header('Cache-Control', 'no-store')
  async ask(@CurrentActor() actor: ActorContext, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const controller = new AbortController();
    const close = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', close);
    try { return await this.service.ask(actor, body, controller.signal); }
    finally { response.removeListener('close', close); }
  }
  @Post('context')
  @Header('Cache-Control', 'no-store')
  context(@CurrentActor() actor: ActorContext, @Body() body: unknown) { return this.service.previewContext(actor, body); }
}
