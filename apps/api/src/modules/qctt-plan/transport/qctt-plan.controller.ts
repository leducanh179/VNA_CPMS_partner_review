import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QcttPlanApplicationService } from '../application/qctt-plan.application-service';
@ApiTags('qctt-plan-v1')
@Controller('campaigns/:campaignId/qctt-plan')
export class QcttPlanController {
  constructor(@Inject(QcttPlanApplicationService) private readonly service: QcttPlanApplicationService) {}
  @Get() read(@Param('campaignId') id: string) { return this.service.read(id); }
  @Post('commands') command(@Param('campaignId') id: string, @Body() body: unknown) { return this.service.command(id, body); }
  @Get('items/:itemId/history') history(@Param('campaignId') id: string, @Param('itemId') itemId: string) { return this.service.history(id, itemId); }
}
@ApiTags('qctt-plan-v1')
@Controller('qctt-plans')
export class QcttPlanListController {
  constructor(@Inject(QcttPlanApplicationService) private readonly service: QcttPlanApplicationService) {}
  @Get('campaigns') campaigns() { return this.service.list(); }
}
