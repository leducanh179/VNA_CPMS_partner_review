import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignDriveApplicationService } from '../application/campaign-drive.application-service';
import { CampaignDriveRelinkApplicationService } from '../application/campaign-drive-relink.application-service';
import { CampaignDriveBrowseDto, CampaignDriveCreateFolderDto, CampaignDriveCreatePermissionDto, CampaignDriveDownloadDto, CampaignDriveFileListQueryDto, CampaignDriveFolderQueryDto, CampaignDriveGeneralAccessDto, CampaignDriveTargetFolderDto, CampaignDriveUpdatePermissionDto, CampaignDriveUploadDto, DecideCampaignDriveRelinkDto, ExistingCampaignDriveFolderDto, RenameCampaignDriveFileDto, RequestCampaignDriveRelinkDto } from './campaign-drive.dto';

const driveDtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });
type UploadedDriveFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };
export const CAMPAIGN_DRIVE_UPLOAD_OPTIONS = {
  limits: { files: 1, fileSize: 52_428_800 },
  defParamCharset: 'utf8',
};

@ApiTags('campaign-drive-workspace')
@Controller('campaigns/:campaignId/drive-workspace')
export class CampaignDriveController {
  constructor(@Inject(CampaignDriveApplicationService) private readonly drive: CampaignDriveApplicationService,
    @Inject(CampaignDriveRelinkApplicationService) private readonly relinks: CampaignDriveRelinkApplicationService) {}

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

  @Post('relink-requests/preview')
  @RequirePermission('campaign.update')
  previewExistingFolder(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(ExistingCampaignDriveFolderDto)) input: ExistingCampaignDriveFolderDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.relinks.preview(campaignId, input.folderUrl, actor); }

  @Post('relink-requests')
  @RequirePermission('campaign.update')
  requestRelink(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(RequestCampaignDriveRelinkDto)) input: RequestCampaignDriveRelinkDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.relinks.request(campaignId, input, actor); }

  @Get('relink-requests')
  @RequirePermission('campaign.read')
  relinkHistory(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string, @CurrentActor() actor: ActorContext) {
    return this.relinks.read(campaignId, actor);
  }

  @Post('relink-requests/:requestId/decision')
  @RequirePermission('campaign.approve')
  decideRelink(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body(driveDtoPipe(DecideCampaignDriveRelinkDto)) input: DecideCampaignDriveRelinkDto,
    @CurrentActor() actor: ActorContext) { return this.relinks.decide(campaignId, requestId, input, actor); }

  @Post('relink-requests/:requestId/retry')
  @RequirePermission('campaign.approve')
  retryRelink(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string, @CurrentActor() actor: ActorContext) {
    return this.relinks.retry(campaignId, requestId, actor);
  }

  @Post('relink-requests/:requestId/withdraw')
  @RequirePermission('campaign.read')
  withdrawRelink(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string, @CurrentActor() actor: ActorContext) {
    return this.relinks.withdraw(campaignId, requestId, actor);
  }

  @Get('entries')
  @RequirePermission('campaign.read')
  browseFolder(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Query(driveDtoPipe(CampaignDriveBrowseDto)) input: CampaignDriveBrowseDto, @CurrentActor() actor: ActorContext) {
    return this.drive.listFolder(campaignId, input.folderId, input.status, input.pageToken, actor, input.sortBy, input.direction);
  }

  @Get('entries/:itemId/shortcut-target')
  @RequirePermission('campaign.read')
  @Header('Cache-Control', 'no-store')
  shortcutTargetStatus(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @CurrentActor() actor: ActorContext) {
    return this.drive.shortcutTargetStatus(campaignId, itemId, actor);
  }

  @Post('entries/download')
  @RequirePermission('campaign.read')
  @Header('Cache-Control', 'no-store')
  async downloadEntries(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(CampaignDriveDownloadDto)) input: CampaignDriveDownloadDto, @CurrentActor() actor: ActorContext) {
    const result = await this.drive.downloadEntries(campaignId, input.folderId, input.itemIds, actor);
    const encodedName = encodeURIComponent(result.filename);
    return new StreamableFile(result.content, { type: result.mimeType,
      disposition: `attachment; filename="download${result.mimeType === 'application/zip' ? '.zip' : ''}"; filename*=UTF-8''${encodedName}` });
  }

  @Post('entries/folders')
  @RequirePermission('campaign.update')
  createFolder(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(CampaignDriveCreateFolderDto)) input: CampaignDriveCreateFolderDto, @CurrentActor() actor: ActorContext) {
    return this.drive.createSubfolder(campaignId, input.folderId, input.name, actor);
  }

  @Post('entries/uploads')
  @RequirePermission('campaign.update')
  @UseInterceptors(FileInterceptor('file', CAMPAIGN_DRIVE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'folderId'], properties: { folderId: { type: 'string' }, uploadId: { type: 'string', format: 'uuid' }, file: { type: 'string', format: 'binary' } } } })
  uploadToFolder(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(driveDtoPipe(CampaignDriveUploadDto)) input: CampaignDriveUploadDto,
    @UploadedFile() file: UploadedDriveFile | undefined, @CurrentActor() actor: ActorContext) {
    return this.drive.uploadToFolder(campaignId, input.folderId, file, actor, input.uploadId);
  }

  @Get('entries/uploads/:uploadId/status')
  @RequirePermission('campaign.read')
  @Header('Cache-Control', 'no-store')
  uploadStatus(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('uploadId', new ParseUUIDPipe({ version: '4' })) uploadId: string,
    @Query(driveDtoPipe(CampaignDriveTargetFolderDto)) input: CampaignDriveTargetFolderDto, @CurrentActor() actor: ActorContext) {
    return this.drive.uploadStatus(campaignId, input.folderId, uploadId, actor);
  }

  @Patch('entries/:itemId')
  @RequirePermission('campaign.update')
  renameEntry(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @Body(driveDtoPipe(RenameCampaignDriveFileDto)) input: RenameCampaignDriveFileDto,
    @CurrentActor() actor: ActorContext) { return this.drive.renameEntry(campaignId, itemId, input.name, actor); }

  @Get('entries/:itemId/permissions')
  @RequirePermission('campaign.read')
  @Header('Cache-Control', 'no-store')
  folderSharing(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @CurrentActor() actor: ActorContext) {
    return this.drive.getFolderSharing(campaignId, itemId, actor);
  }

  @Put('entries/:itemId/permissions/general')
  @RequirePermission('campaign.update')
  updateFolderGeneralAccess(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @Body(driveDtoPipe(CampaignDriveGeneralAccessDto)) input: CampaignDriveGeneralAccessDto,
    @CurrentActor() actor: ActorContext) {
    return this.drive.setFolderGeneralAccess(campaignId, itemId, input.access, input.role, input.confirmLimitInheritedAccess, actor);
  }

  @Post('entries/:itemId/permissions')
  @RequirePermission('campaign.update')
  addFolderPermission(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @Body(driveDtoPipe(CampaignDriveCreatePermissionDto)) input: CampaignDriveCreatePermissionDto,
    @CurrentActor() actor: ActorContext) {
    return this.drive.createFolderPermission(campaignId, itemId, input.type, input.role, input.emailAddress, actor);
  }

  @Patch('entries/:itemId/permissions/:permissionId')
  @RequirePermission('campaign.update')
  changeFolderPermission(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @Param('permissionId') permissionId: string,
    @Body(driveDtoPipe(CampaignDriveUpdatePermissionDto)) input: CampaignDriveUpdatePermissionDto, @CurrentActor() actor: ActorContext) {
    return this.drive.changeFolderPermission(campaignId, itemId, permissionId, input.role, actor);
  }

  @Delete('entries/:itemId/permissions/:permissionId')
  @RequirePermission('campaign.update')
  removeFolderPermission(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @Param('permissionId') permissionId: string, @CurrentActor() actor: ActorContext) {
    return this.drive.changeFolderPermission(campaignId, itemId, permissionId, null, actor);
  }

  @Post('entries/:itemId/trash')
  @RequirePermission('campaign.update')
  trashEntry(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @CurrentActor() actor: ActorContext) { return this.drive.trashEntry(campaignId, itemId, actor); }

  @Post('entries/:itemId/restore')
  @RequirePermission('campaign.update')
  restoreEntry(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('itemId') itemId: string, @CurrentActor() actor: ActorContext) { return this.drive.restoreEntry(campaignId, itemId, actor); }

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

@ApiTags('campaign-drive-workspace')
@Controller('campaign-drive')
export class CampaignDriveInboxController {
  constructor(@Inject(CampaignDriveRelinkApplicationService) private readonly relinks: CampaignDriveRelinkApplicationService) {}

  @Get('relink-inbox')
  @RequirePermission('campaign.read')
  inbox(@CurrentActor() actor: ActorContext) { return this.relinks.inbox(actor); }
}
