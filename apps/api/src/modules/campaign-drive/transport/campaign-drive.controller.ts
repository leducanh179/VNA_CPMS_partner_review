import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignDriveApplicationService } from '../application/campaign-drive.application-service';
import { AdoptCampaignDriveFolderDto, CampaignDriveFileListQueryDto, CampaignDriveFolderQueryDto, ExistingCampaignDriveFolderDto, RenameCampaignDriveFileDto } from './campaign-drive.dto';

const driveDtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });
type UploadedDriveFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };
export const CAMPAIGN_DRIVE_UPLOAD_OPTIONS = {
  limits: { files: 1, fileSize: 52_428_800 },
  defParamCharset: 'utf8',
};

@ApiTags('campaign-drive-workspace')
@Controller('campaigns/:campaignId/drive-workspace')
export class CampaignDriveController {
  constructor(@Inject(CampaignDriveApplicationService) private readonly drive: CampaignDriveApplicationService) {}

  @Get()
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'Read the authorized Google Drive workspace state without exposing OAuth tokens' })
  getWorkspace(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string, @CurrentActor() actor: ActorContext) { return this.drive.getWorkspace(campaignId, actor); }

  @Post('ensure')
  @RequirePermission('campaign.update')
  @ApiOperation({ summary: 'Idempotently create or recognize the configured Campaign Drive workspace' })
  ensure(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string, @CurrentActor() actor: ActorContext) { return this.drive.ensure(campaignId, actor); }

  @Post('verify')
  @RequirePermission('campaign.update')
  verify(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string, @CurrentActor() actor: ActorContext) { return this.drive.verify(campaignId, actor); }

  @Post('sync-name')
  @RequirePermission('campaign.update')
  syncName(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string, @CurrentActor() actor: ActorContext) { return this.drive.syncName(campaignId, actor); }

  @Post('existing-folder/preview')
  @RequirePermission('campaign.update')
  previewExistingFolder(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(ExistingCampaignDriveFolderDto)) input: ExistingCampaignDriveFolderDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.previewExistingFolder(campaignId, input.folderUrl, actor); }

  @Post('existing-folder/adopt')
  @RequirePermission('campaign.update')
  adoptExistingFolder(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(AdoptCampaignDriveFolderDto)) input: AdoptCampaignDriveFolderDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.adoptExistingFolder(campaignId, input.folderUrl, input.expectedCurrentName, input.confirmRename, actor); }

  @Get('files')
  @RequirePermission('campaign.read')
  listFiles(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Query(driveDtoPipe(CampaignDriveFileListQueryDto)) query: CampaignDriveFileListQueryDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.listFiles(campaignId, query.folderKind, query.status, query.pageToken, actor); }

  @Post('uploads')
  @RequirePermission('campaign.update')
  @UseInterceptors(FileInterceptor('file', CAMPAIGN_DRIVE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'folderKey'], properties: { folderKey: { type: 'string', enum: ['BASE_DOCUMENTS', 'MEDIA_ASSETS', 'OTHER_DOCUMENTS'] }, file: { type: 'string', format: 'binary' } } } })
  upload(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(CampaignDriveFolderQueryDto)) input: CampaignDriveFolderQueryDto,
    @UploadedFile() file: UploadedDriveFile | undefined,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.upload(campaignId, input.folderKey, file, actor); }

  @Patch('files/:fileId')
  @RequirePermission('campaign.update')
  @ApiParam({ name: 'fileId' })
  renameFile(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('fileId') fileId: string,
    @Body(driveDtoPipe(RenameCampaignDriveFileDto)) input: RenameCampaignDriveFileDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.renameFile(campaignId, fileId, input.name, actor); }

  @Post('files/:fileId/trash')
  @RequirePermission('campaign.update')
  trashFile(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('fileId') fileId: string,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.trashFile(campaignId, fileId, actor); }

  @Post('files/:fileId/restore')
  @RequirePermission('campaign.update')
  restoreFile(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('fileId') fileId: string,
    @CurrentActor() actor: ActorContext,
  ) { return this.drive.restoreFile(campaignId, fileId, actor); }
}
