import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { CampaignWorkflowApplicationService } from '../application/campaign-workflow.application-service';

@Controller('campaign-workflow')
export class CampaignWorkflowController {
  constructor(@Inject(CampaignWorkflowApplicationService) private readonly service: CampaignWorkflowApplicationService) {}
  @Get('configuration') configuration(@CurrentActor() actor: ActorContext) { return this.service.configuration(actor); }
  @Get('inbox') inbox(@CurrentActor() actor: ActorContext) { return this.service.inbox(actor); }
  @Post('batch') batch(@CurrentActor() actor: ActorContext, @Body() input: unknown) { return this.service.batch(actor, input); }
  @Post('initialize') initialize(@CurrentActor() actor: ActorContext, @Body() input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['commDepartmentId','demo'].includes(key))) throw new BadRequestException('Cấu hình khởi tạo không hợp lệ.');
    const value = input as { commDepartmentId?: unknown; demo?: unknown };
    if (typeof value.commDepartmentId !== 'string' || typeof value.demo !== 'boolean') throw new BadRequestException('Cần Ban tiếp nhận và chế độ khởi tạo.');
    return this.service.initialize(actor, value.commDepartmentId, value.demo);
  }
  @Post('policy/preview') previewPolicy(@CurrentActor() actor: ActorContext, @Body() input: unknown) { return this.service.policy(actor, input, false); }
  @Post('policy/save') savePolicy(@CurrentActor() actor: ActorContext, @Body() input: unknown) { return this.service.policy(actor, input, true); }
  @Get(':campaignId') read(@CurrentActor() actor: ActorContext, @Param('campaignId') campaignId: string) { return this.service.read(actor, campaignId); }
  @Post(':campaignId/preview') preview(@CurrentActor() actor: ActorContext, @Param('campaignId') campaignId: string, @Body() input: unknown) { return this.service.command(actor, campaignId, input, true); }
  @Post(':campaignId/commands') command(@CurrentActor() actor: ActorContext, @Param('campaignId') campaignId: string, @Body() input: unknown) { return this.service.command(actor, campaignId, input); }
}
