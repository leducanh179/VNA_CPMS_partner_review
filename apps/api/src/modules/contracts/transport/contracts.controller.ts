import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SupplySourceSnapshot } from '@cpms/domain';
import { ContractsApplicationService } from '../application/contracts.application-service';
import { ContractsExchangeApplicationService } from '../application/contracts-exchange.application-service';
import { ContractManagementApplicationService } from '../application/contract-management.application-service';

/** Every route enters the same Application Service access fence as CLI/import callers. */
@ApiTags('contracts-v1')
@Controller('contracts')
export class ContractsController {
  constructor(@Inject(ContractsApplicationService) private readonly contracts: ContractsApplicationService,@Inject(ContractsExchangeApplicationService) private readonly exchange:ContractsExchangeApplicationService,@Inject(ContractManagementApplicationService) private readonly management:ContractManagementApplicationService) {}
  @Get() list(@Query() query: Record<string, string>) { return this.contracts.list(query); }
  @Get('catalogs') catalogs() { return this.contracts.catalogs(); }
  @Get('channel-map') channelMap() { return this.management.channelMap(); }
  @Post('channel-map/import') @HttpCode(200) importChannelMap(@Body() body:unknown) { return this.management.importChannelMap(body); }
  @Get('owned') ownedChannels() { return this.management.ownedChannels(); }
  @Post() create(@Body() body: unknown) { return this.management.create(body); }
  @Get('management/catalogs') managementCatalogs() { return this.management.catalogs(); }
  @Get('management/inbox') inbox() { return this.management.inbox(); }
  @Get('management/policy') policy() { return this.management.policy(); }
  @Post('management/policy') @HttpCode(200) configurePolicy(@Body() body:unknown) { return this.management.configurePolicy(body); }
  @Post('management/adopt') @HttpCode(200) adopt(@Body() body:unknown) { return this.management.adopt(body); }
  @Get(':id/management') managementWorkspace(@Param('id') id:string) { return this.management.workspace(id); }
  @Get(':id/items') items(@Param('id') id:string,@Query('periodId') periodId:string,@Query('phase') phase:string){return this.management.items(id,periodId,phase);}
  @Get(':id/revisions/:revisionId') revision(@Param('id') id:string,@Param('revisionId') revisionId:string) { return this.management.revision(id,revisionId); }
  @Post(':id/changes') @HttpCode(200) change(@Param('id') id:string,@Body() body:unknown) { return this.management.change(id,body); }
  @Post(':id/changes/:requestId/decision') @HttpCode(200) decide(@Param('id') id:string,@Param('requestId') requestId:string,@Body() body:unknown) { return this.management.decide(id,requestId,body); }
  @Post(':id/purge') @HttpCode(200) purge(@Param('id') id:string,@Body() body:unknown) { return this.management.purge(id,body); }
  @Post('import/preview') previewImport(@Body() body: SupplySourceSnapshot) { return this.exchange.previewJson(body); }
  @Post('import/file-preview') previewFile(@Body() body:{fileName:string;contentBase64:string;sourceId:string;locale?:string}) {return this.exchange.previewFile(body);}
  @Post('import/:id/apply') applyImport(@Param('id') id:string,@Body() body:unknown) { return this.contracts.importApply(id,body); }
  @Get(':id') detail(@Param('id') id:string) { return this.contracts.detail(id); }
  @Get(':id/workspace') workspace(@Param('id') id:string,@Query() query:{period?:string;phase?:string}) { return this.contracts.workspace(id,query); }
  /** Version 1 read projection; POST carries bounded calendar selections, with no business mutation. */
  @Post(':id/analytics/query') @HttpCode(200) analytics(@Param('id') id:string,@Body() body:unknown) { return this.contracts.analytics(id,body); }
  @Post(':id/pivot/query') @HttpCode(200) pivot(@Param('id') id:string,@Body() body:unknown) { return this.contracts.pivot(id,body); }
  @Get(':id/pivot/views') pivotViews(@Param('id') id:string) { return this.contracts.pivotViews(id); }
  @Post(':id/pivot/views') @HttpCode(200) savePivotView(@Param('id') id:string,@Body() body:unknown) { return this.contracts.savePivotView(id,body); }
  @Post(':id/pivot/views/:viewId/delete') @HttpCode(200) deletePivotView(@Param('id') id:string,@Param('viewId') viewId:string,@Body() body:unknown) { return this.contracts.deletePivotView(id,viewId,body); }
  @Patch(':id') update(@Param('id') id:string,@Body() body:unknown) { return this.management.change(id,body); }
  @Get(':id/inventory') inventory(@Param('id') id:string,@Query() query:{periodId?:string;unit?:string;slotId?:string;asOf?:string}) { return this.contracts.inventory(id,query); }
  @Post(':id/slots') slot(@Param('id') id:string,@Body() body:unknown) { return this.contracts.saveSlot(id,body); }
  @Post(':id/allocations') allocation(@Param('id') id:string,@Body() body:unknown) { return this.contracts.saveAllocation(id,body); }
  @Post(':id/allocations/preview') allocationPreview(@Param('id') id:string,@Body() body:unknown) { return this.contracts.allocationPreview(id,body); }
  @Post(':id/allocations/split-free') splitFree(@Param('id') id:string,@Body() body:unknown) { return this.contracts.splitFreeEntitlement(id,body); }
  @Post(':id/allocations/:allocationId/transition') allocationTransition(@Param('id') id:string,@Param('allocationId') allocationId:string,@Body() body:unknown) { return this.contracts.transition(id,'allocation',allocationId,body); }
  @Post(':id/adjustments') adjustment(@Param('id') id:string,@Body() body:unknown) { return this.contracts.saveAdjustment(id,body); }
  @Post(':id/adjustments/preview') adjustmentPreview(@Param('id') id:string,@Body() body:unknown) { return this.contracts.adjustmentPreview(id,body); }
  @Post(':id/adjustments/:groupId/transition') adjustmentTransition(@Param('id') id:string,@Param('groupId') groupId:string,@Body() body:unknown) { return this.contracts.transition(id,'adjustment',groupId,body); }
  @Get(':id/export') export(@Param('id') id:string) { return this.exchange.exportBundle(id); }
  @Get(':id/export/xlsx') exportXlsx(@Param('id') id:string) { return this.exchange.exportFile(id); }
}
