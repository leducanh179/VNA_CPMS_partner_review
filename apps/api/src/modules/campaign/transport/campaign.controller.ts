import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignApplicationService } from '../application/campaign.application-service';
import { CampaignSpreadsheetApplicationService } from '../application/campaign-spreadsheet.application-service';
import { CampaignDriveOrchestrationService } from '../../campaign-drive/application/campaign-drive-orchestration.service';
import { BatchSaveCampaignsDto } from './batch-save-campaigns.dto';
import { BulkTransitionCampaignsDto } from './bulk-transition-campaigns.dto';
import { CreateCampaignDto } from './create-campaign.dto';
import { UpdateCampaignDto } from './update-campaign.dto';
import { CampaignSpreadsheetExportDto, CampaignSpreadsheetFileDto, CampaignSpreadsheetImportDto, CampaignSpreadsheetPreviewDto } from './campaign-spreadsheet.dto';
import { RegenerateCampaignCodeDto } from './regenerate-campaign-code.dto';

const campaignDtoPipe = (expectedType: new () => object) => new ValidationPipe({
  expectedType,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignController {
  constructor(
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CampaignSpreadsheetApplicationService) private readonly spreadsheets: CampaignSpreadsheetApplicationService,
    @Inject(CampaignDriveOrchestrationService) private readonly driveOrchestration: CampaignDriveOrchestrationService,
  ) {}

  @Get()
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List recent campaigns' })
  list(@Query('trash') trash?: string) {
    return this.campaigns.list(trash === 'true');
  }

  @Get('similar')
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'Find deterministic similar-campaign suggestions by code and name' })
  findSimilar(@Query('query') query = '', @Query('excludeId') excludeId?: string) {
    return this.campaigns.findSimilar(query, excludeId);
  }

  @Post('spreadsheet/export')
  @RequirePermission('campaign.read')
  @ApiBody({ type: CampaignSpreadsheetExportDto })
  @ApiOperation({ summary: 'Export Campaign data or a blank CPMS XLSX template' })
  exportSpreadsheet(@Body(campaignDtoPipe(CampaignSpreadsheetExportDto)) input: CampaignSpreadsheetExportDto) {
    return this.spreadsheets.export(input);
  }

  @Post('spreadsheet/inspect')
  @RequirePermission('campaign.read')
  @ApiBody({ type: CampaignSpreadsheetFileDto })
  @ApiOperation({ summary: 'Inspect XLSX/CSV sheets without mutating Campaign data' })
  inspectSpreadsheet(@Body(campaignDtoPipe(CampaignSpreadsheetFileDto)) input: CampaignSpreadsheetFileDto) {
    return this.spreadsheets.inspect(input);
  }

  @Post('spreadsheet/preview')
  @RequirePermission('campaign.read')
  @ApiBody({ type: CampaignSpreadsheetPreviewDto })
  @ApiOperation({ summary: 'Map, validate and diff spreadsheet rows without mutation' })
  previewSpreadsheet(@Body(campaignDtoPipe(CampaignSpreadsheetPreviewDto)) input: CampaignSpreadsheetPreviewDto) {
    return this.spreadsheets.preview(input);
  }

  @Post('spreadsheet/import')
  @RequirePermission('campaign.update')
  @ApiBody({ type: CampaignSpreadsheetImportDto })
  @ApiOperation({ summary: 'Confirm selected spreadsheet creates and optimistic-lock updates' })
  importSpreadsheet(@Body(campaignDtoPipe(CampaignSpreadsheetImportDto)) input: CampaignSpreadsheetImportDto, @CurrentActor() actor: ActorContext) {
    return this.spreadsheets.import(input, actor);
  }

  @Get(':id')
  @RequirePermission('campaign.read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get one campaign from the canonical campaign store' })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.campaigns.get(id);
  }

  @Post(':id/regenerate-code')
  @RequirePermission('campaign.update')
  @ApiBody({ type: RegenerateCampaignCodeDto })
  @ApiOperation({ summary: 'Regenerate a legacy Campaign suffix for a direct superadmin; audited and version-checked' })
  regenerateCode(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(campaignDtoPipe(RegenerateCampaignCodeDto)) input: RegenerateCampaignCodeDto, @CurrentActor() actor: ActorContext) {
    return this.campaigns.regenerateCode(id, input.expectedVersion, actor);
  }

  @Post()
  @RequirePermission('campaign.create')
  @ApiBody({ type: CreateCampaignDto })
  @ApiOperation({ summary: 'Create a draft campaign through the Application Service' })
  create(@Body(campaignDtoPipe(CreateCampaignDto)) input: CreateCampaignDto, @CurrentActor() actor: ActorContext) {
    return this.driveOrchestration.create(input, actor);
  }

  @Post(':id/trash')
  @RequirePermission('campaign.delete')
  @ApiOperation({ summary: 'Move one campaign to the recoverable trash' })
  moveToTrash(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentActor() actor: ActorContext) {
    return this.driveOrchestration.moveToTrash(id, actor);
  }

  @Post(':id/restore')
  @RequirePermission('campaign.restore')
  @ApiOperation({ summary: 'Restore one campaign from trash' })
  restore(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentActor() actor: ActorContext) {
    return this.driveOrchestration.restore(id, actor);
  }

  @Delete(':id')
  @RequirePermission('campaign.delete')
  @ApiOperation({ summary: 'Permanently delete one campaign that is already in trash' })
  deletePermanently(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentActor() actor: ActorContext) {
    return this.driveOrchestration.deletePermanently(id, actor);
  }

  @Post('batch-save')
  @RequirePermission('campaign.update')
  @ApiBody({ type: BatchSaveCampaignsDto })
  @ApiOperation({ summary: 'Create or update up to 50 Campaign rows and return one result per row' })
  batchSave(@Body(campaignDtoPipe(BatchSaveCampaignsDto)) input: BatchSaveCampaignsDto, @CurrentActor() actor: ActorContext) {
    return this.campaigns.batchSave(input.items, actor);
  }

  @Post('bulk-transition')
  @RequirePermission('campaign.approve')
  @ApiBody({ type: BulkTransitionCampaignsDto })
  @ApiOperation({ summary: 'Apply one audited lifecycle transition to up to 50 Campaigns' })
  bulkTransition(@Body(campaignDtoPipe(BulkTransitionCampaignsDto)) input: BulkTransitionCampaignsDto, @CurrentActor() actor: ActorContext) {
    return this.campaigns.bulkTransition(input.ids, input.lifecycleState, actor);
  }

  @Patch(':id')
  @RequirePermission('campaign.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateCampaignDto })
  @ApiOperation({ summary: 'Update a campaign through the Application Service with audit' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(campaignDtoPipe(UpdateCampaignDto)) input: UpdateCampaignDto,
    @CurrentActor() actor: ActorContext,
  ) {
    return this.driveOrchestration.update(id, input, actor);
  }
}
