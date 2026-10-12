import {
  CAMPAIGN_DRIVE_FOLDER_KEYS,
  type ActorContext,
  type CampaignDriveFileItem,
  type CampaignDriveFilePage,
  type CampaignDriveFileStatus,
  type CampaignDriveFolderKey,
  type CampaignDriveUploadResult,
  type CampaignDriveWorkspaceView,
  type CampaignSummary,
} from '@cpms/domain';
import { CLOUD_DRIVE_PORT, type CloudDriveItem, type CloudDrivePort } from '@cpms/integrations';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignDriveGoogleAccessService } from './campaign-drive-google-access.service';
import { CampaignDriveAuthorizationService } from './campaign-drive-authorization.service';
import {
  CAMPAIGN_DRIVE_REPOSITORY,
  type CampaignDriveRepository,
  type CampaignDriveWorkspaceRecord,
} from './campaign-drive.repository';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const FULL_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TEMPLATE_VERSION = 1;
const FOLDER_LABELS: Record<CampaignDriveFolderKey, string> = {
  BASE_DOCUMENTS: 'Văn bản cơ sở',
  MEDIA_ASSETS: 'Tư liệu QCTT',
  OTHER_DOCUMENTS: 'Tài liệu khác',
};

interface UploadInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface WorkspaceFileContext {
  file: CloudDriveItem;
  folderKind: CampaignDriveFolderKey;
  folderId: string;
  folderLabel: string;
}

export interface ExistingFolderPreview {
  folderId: string;
  folderUrl: string;
  currentName: string;
  expectedName: string;
  willRename: boolean;
}

@Injectable()
export class CampaignDriveApplicationService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CampaignDriveGoogleAccessService) private readonly google: CampaignDriveGoogleAccessService,
    @Inject(CLOUD_DRIVE_PORT) private readonly drive: CloudDrivePort,
    @Inject(CAMPAIGN_DRIVE_REPOSITORY) private readonly repository: CampaignDriveRepository,
    @Inject(CampaignDriveAuthorizationService) private readonly authorization: CampaignDriveAuthorizationService,
  ) {}

  async getWorkspace(campaignId: string, actor: ActorContext): Promise<CampaignDriveWorkspaceView> {
    this.authorization.requireView(actor);
    const campaign = await this.campaigns.get(campaignId);
    const workspace = await this.repository.get(campaignId);
    return this.toView(campaign, workspace, actor);
  }

  async ensure(campaignId: string, actor: ActorContext): Promise<CampaignDriveWorkspaceView> {
    this.authorization.requireManage(actor);
    const campaign = await this.campaigns.get(campaignId);
    if (campaign.isDeleted) throw new ConflictException('Hãy phục hồi Chiến dịch trước khi tạo hoặc đồng bộ thư mục Google Drive.');
    const configuration = this.driveConfiguration();
    if (!configuration) return this.toView(campaign, null, actor, 'Google Drive Workspace chưa được cấu hình phía server.');
    const existingWorkspace = await this.repository.get(campaignId);
    let workspace: CampaignDriveWorkspaceRecord = existingWorkspace
      ?? await this.repository.save(this.blankWorkspace(campaignId, configuration, campaign));
    workspace = await this.repository.save({ ...workspace, syncStatus: 'CREATING', lastErrorCode: null, lastErrorMessage: null });

    const googleStatus = await this.google.status(actor);
    if (!googleStatus.connected || !googleStatus.grantedScopes.includes(FULL_DRIVE_SCOPE)) {
      workspace = await this.repository.save({
        ...workspace,
        syncStatus: 'PERMISSION_SETUP_REQUIRED',
        lastCheckedAt: new Date(),
        lastErrorCode: googleStatus.connected ? 'GOOGLE_RECONSENT_REQUIRED' : 'GOOGLE_NOT_CONNECTED',
        lastErrorMessage: googleStatus.connected ? 'Cần kết nối lại Google để cấp quyền quản lý Drive.' : 'Cần kết nối tài khoản Google.',
      });
      return this.toView(campaign, workspace, actor);
    }

    try {
      workspace = await this.google.withAccessToken(actor, async (accessToken) => {
        const current = await this.resolveCampaignFolder(accessToken, campaign, workspace);
        const children = await this.ensureChildren(accessToken, campaign, current.folder);
        const sharing = await this.ensureSharing(accessToken, current.folder, workspace.sharingMode);
        const saved = await this.repository.save({
          ...workspace,
          campaignFolderId: current.folder.id,
          campaignFolderLink: this.folderLink(current.folder.id),
          lastKnownFolderName: current.folder.name,
          baseDocumentsFolderId: children.BASE_DOCUMENTS.id,
          mediaAssetsFolderId: children.MEDIA_ASSETS.id,
          otherDocumentsFolderId: children.OTHER_DOCUMENTS.id,
          syncStatus: current.folder.name === this.expectedFolderName(campaign) ? 'READY' : 'NEEDS_SYNC',
          lifecycleStatus: 'ACTIVE',
          lastCheckedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          googlePermissionId: sharing.permissionId,
          desiredRole: ['LINK_WRITER', 'PARENT_INHERITED'].includes(workspace.sharingMode) ? 'writer' : null,
          permissionSyncStatus: sharing.status,
        });
        const accountEmail = googleStatus.account?.email ?? null;
        await this.repository.recordAudit(actor, campaign.id, current.created ? 'campaign.drive_workspace_created' : 'campaign.drive_workspace_recognized', {
          campaignCode: campaign.code,
          folderId: current.folder.id,
          sharedDriveId: configuration.sharedDriveId,
          googleAccount: accountEmail,
          result: 'SUCCESS',
        });
        if (children.createdNames.length) await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_child_folders_created', {
          campaignCode: campaign.code,
          folderId: current.folder.id,
          childFolderIds: children.createdIds,
          childFolderNames: children.createdNames,
          googleAccount: accountEmail,
          result: 'SUCCESS',
        });
        if (sharing.created) await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_sharing_updated', {
          campaignCode: campaign.code,
          folderId: current.folder.id,
          permissionId: sharing.permissionId,
          sharingMode: workspace.sharingMode,
          googleAccount: accountEmail,
          result: 'SUCCESS',
        });
        return saved;
      });
    } catch (error) {
      workspace = await this.persistFailure(workspace, error, actor, campaign);
    }
    return this.toView(campaign, workspace, actor);
  }

  async verify(campaignId: string, actor: ActorContext) { return this.ensure(campaignId, actor); }

  async previewExistingFolder(campaignId: string, folderUrl: string, actor: ActorContext): Promise<ExistingFolderPreview> {
    this.authorization.requireManage(actor);
    const campaign = await this.campaigns.get(campaignId);
    if (campaign.isDeleted) throw new ConflictException('Hãy phục hồi Chiến dịch trước khi liên kết thư mục Google Drive.');
    const configuration = this.requireDriveConfiguration();
    const folderId = this.folderIdFromUrl(folderUrl);
    const workspace = await this.repository.get(campaignId);
    if (workspace?.campaignFolderId && workspace.campaignFolderId !== folderId) {
      throw new ConflictException('Chiến dịch đã liên kết với một thư mục khác. Không thể thay thế âm thầm.');
    }
    const assigned = await this.repository.findByFolderId(folderId);
    if (assigned && assigned.campaignId !== campaignId) throw new ConflictException('Thư mục này đã thuộc Chiến dịch khác trong CPMS.');
    const folder = await this.google.withAccessToken(actor, (accessToken) => this.drive.getItem(accessToken, folderId));
    this.validateCampaignFolder(folder, configuration.sharedDriveId, configuration.parentFolderId);
    if (!folder.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google dùng chung không có quyền đổi tên thư mục này.');
    const expectedName = this.expectedFolderName(campaign);
    return { folderId, folderUrl: this.folderLink(folderId), currentName: folder.name, expectedName, willRename: folder.name !== expectedName };
  }

  async adoptExistingFolder(campaignId: string, folderUrl: string, expectedCurrentName: string, confirmRename: boolean, actor: ActorContext) {
    if (confirmRename !== true) throw new BadRequestException('Cần xác nhận CPMS sẽ đổi tên folder cho khớp mã và tên Chiến dịch.');
    const preview = await this.previewExistingFolder(campaignId, folderUrl, actor);
    if (preview.currentName !== expectedCurrentName) throw new ConflictException('Tên thư mục trên Google Drive đã thay đổi. Hãy xem lại và xác nhận lần nữa.');
    const campaign = await this.campaigns.get(campaignId);
    const configuration = this.requireDriveConfiguration();
    const workspace = await this.repository.get(campaignId);
    if (workspace?.campaignFolderId !== preview.folderId) {
      await this.repository.save({
        ...(workspace ?? this.blankWorkspace(campaignId, configuration, campaign)),
        campaignFolderId: preview.folderId,
        campaignFolderLink: preview.folderUrl,
        lastKnownFolderName: preview.currentName,
        syncStatus: 'NEEDS_SYNC',
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_existing_folder_adopted', {
        folderId: preview.folderId, oldName: preview.currentName, expectedName: preview.expectedName,
        sharedDriveId: configuration.sharedDriveId, parentFolderId: configuration.parentFolderId,
        googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
      });
    }
    // The selected folder is recorded before provider mutations, so failed setup remains retriable.
    const ensured = await this.ensure(campaignId, actor);
    if (!['READY', 'NEEDS_SYNC'].includes(ensured.syncStatus)) return ensured;
    return preview.willRename ? this.syncName(campaignId, actor) : ensured;
  }

  async syncName(campaignId: string, actor: ActorContext): Promise<CampaignDriveWorkspaceView> {
    this.authorization.requireManage(actor);
    const campaign = await this.campaigns.get(campaignId);
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId) throw new ConflictException('Chiến dịch chưa có thư mục Google Drive.');
    const expectedName = this.expectedFolderName(campaign);
    try {
      const renamed = await this.google.withAccessToken(actor, (accessToken) => this.drive.renameItem({ accessToken, fileId: workspace.campaignFolderId!, name: expectedName }));
      const saved = await this.repository.save({ ...workspace, lastKnownFolderName: renamed.name, syncStatus: 'READY', lastCheckedAt: new Date(), lastErrorCode: null, lastErrorMessage: null });
      await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_renamed', {
        campaignCode: campaign.code,
        folderId: renamed.id,
        oldName: workspace.lastKnownFolderName,
        newName: renamed.name,
        googleAccount: (await this.google.status(actor)).account?.email ?? null,
        result: 'SUCCESS',
      });
      return this.toView(campaign, saved, actor);
    } catch (error) {
      const saved = await this.persistFailure(workspace, error, actor, campaign);
      return this.toView(campaign, saved, actor);
    }
  }

  async listFiles(campaignId: string, folderKey: CampaignDriveFolderKey, status: CampaignDriveFileStatus, pageToken: string | undefined, actor: ActorContext): Promise<CampaignDriveFilePage> {
    this.authorization.requireView(actor);
    if (pageToken && (!/^[A-Za-z0-9._~-]{1,1000}$/.test(pageToken))) throw new BadRequestException('Page token Google Drive không hợp lệ.');
    const workspace = await this.requireWorkspace(campaignId);
    const configuration = this.requireDriveConfiguration();
    const folderId = this.folderId(workspace, folderKey);
    if (!folderId) throw new ConflictException('Folder con chưa sẵn sàng. Hãy kiểm tra/đồng bộ workspace.');
    const page = await this.google.withAccessToken(actor, (accessToken) => this.drive.listFiles({
      accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: folderId, trashed: status === 'TRASHED', pageSize: 50, ...(pageToken ? { pageToken } : {}),
    }));
    for (const item of page.items) {
      if (item.driveId !== configuration.sharedDriveId || !item.parents.includes(folderId) || item.trashed !== (status === 'TRASHED')) {
        throw new ConflictException('Google Drive trả về file ngoài phạm vi thư mục hoặc trạng thái được yêu cầu.');
      }
    }
    return { items: page.items.map((item) => this.toFileItem(item, folderKey)), nextPageToken: page.nextPageToken };
  }

  async upload(campaignId: string, folderKey: CampaignDriveFolderKey, file: UploadInput | undefined, actor: ActorContext): Promise<CampaignDriveUploadResult> {
    this.authorization.requireManage(actor);
    if (!file) throw new BadRequestException('Hãy chọn file cần tải lên.');
    const name = this.validateFilename(file.originalname);
    const mimeType = this.validateMimeType(file.mimetype);
    const configuration = this.requireDriveConfiguration();
    if (file.size <= 0 || file.buffer.byteLength !== file.size) throw new BadRequestException('File tải lên rỗng hoặc không đầy đủ.');
    if (file.size > configuration.uploadMaxBytes) throw new BadRequestException(`File vượt quá giới hạn ${Math.floor(configuration.uploadMaxBytes / 1_048_576)} MB.`);
    const workspace = await this.requireWorkspace(campaignId);
    const folderId = this.folderId(workspace, folderKey);
    if (!folderId) throw new ConflictException('Folder con chưa sẵn sàng. Hãy kiểm tra/đồng bộ workspace.');
    const uploaded = await this.google.withAccessToken(actor, (accessToken) => this.drive.upload({
      accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: folderId, name, mimeType, content: file.buffer,
      resumableThresholdBytes: configuration.resumableThresholdBytes,
    }));
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_file_uploaded', {
      folderKey, fileId: uploaded.item.id, fileName: uploaded.item.name, mimeType, size: file.size, uploadMode: uploaded.mode,
      googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
    });
    return { file: this.toFileItem(uploaded.item, folderKey), uploadMode: uploaded.mode };
  }

  async renameFile(campaignId: string, fileId: string, name: string, actor: ActorContext): Promise<CampaignDriveFileItem> {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const safeId = this.validateDriveId(fileId);
    const context = await this.requireWorkspaceFile(actor, workspace, safeId);
    if (context.file.trashed) throw new ConflictException('Hãy phục hồi file trước khi đổi tên.');
    if (!context.file.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google không có quyền đổi tên file này.');
    const renamed = await this.google.withAccessToken(actor, (accessToken) => this.drive.renameItem({ accessToken, fileId: safeId, name: this.validateFilename(name) }));
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_file_renamed', {
      fileId: safeId, oldName: context.file.name, newName: renamed.name, folderKind: context.folderKind,
      googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
    });
    return this.toFileItem(renamed, context.folderKind);
  }

  async trashFile(campaignId: string, fileId: string, actor: ActorContext): Promise<CampaignDriveFileItem> {
    this.authorization.requireManage(actor);
    const campaign = await this.campaigns.get(campaignId);
    const workspace = await this.requireWorkspace(campaignId);
    const safeId = this.validateDriveId(fileId);
    let context: WorkspaceFileContext | undefined;
    try {
      context = await this.requireWorkspaceFile(actor, workspace, safeId);
      if (context.file.trashed) return this.toFileItem(context.file, context.folderKind);
      if (!context.file.capabilities.canTrash) throw new ForbiddenException('Tài khoản Google không có quyền đưa file này vào Thùng rác.');
      const trashed = await this.google.withAccessToken(actor, (accessToken) => this.drive.setTrashed({ accessToken, fileId: safeId, trashed: true }));
      this.validateMutatedFile(trashed, context, true);
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_file_trashed', {
        campaignCode: campaign.code, fileId: safeId, fileName: context.file.name, folderKind: context.folderKind,
        folderId: context.folderId, action: 'TRASH', occurredAt: trashed.trashedTime ?? new Date().toISOString(),
        googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
      });
      return this.toFileItem(trashed, context.folderKind);
    } catch (error) {
      await this.recordFileFailure(actor, campaign, safeId, 'TRASH', error, context);
      throw error;
    }
  }

  async restoreFile(campaignId: string, fileId: string, actor: ActorContext): Promise<CampaignDriveFileItem> {
    this.authorization.requireManage(actor);
    const campaign = await this.campaigns.get(campaignId);
    const workspace = await this.requireWorkspace(campaignId);
    const safeId = this.validateDriveId(fileId);
    let context: WorkspaceFileContext | undefined;
    try {
      context = await this.requireWorkspaceFile(actor, workspace, safeId);
      if (!context.file.trashed) return this.toFileItem(context.file, context.folderKind);
      if (!context.file.capabilities.canUntrash) throw new ForbiddenException('Tài khoản Google không có quyền phục hồi file này.');
      let restored = await this.google.withAccessToken(actor, (accessToken) => this.drive.setTrashed({ accessToken, fileId: safeId, trashed: false }));
      if (restored.id !== context.file.id || restored.name !== context.file.name || restored.trashed) {
        throw new ConflictException('Google Drive không xác nhận file đã được phục hồi nguyên vẹn.');
      }
      if (!restored.parents.includes(context.folderId)) {
        if (!restored.capabilities.canMoveItemWithinDrive) {
          throw new ConflictException('File đã được phục hồi nhưng không thể đưa về đúng thư mục. Hãy liên hệ quản trị viên.');
        }
        try {
          restored = await this.google.withAccessToken(actor, (accessToken) => this.drive.moveItem({
            accessToken, fileId: safeId, fromParentIds: restored.parents, toParentId: context!.folderId,
          }));
        } catch {
          throw new ConflictException('File đã được phục hồi nhưng không thể đưa về đúng thư mục. Hãy liên hệ quản trị viên.');
        }
      }
      this.validateMutatedFile(restored, context, false);
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_file_restored', {
        campaignCode: campaign.code, fileId: safeId, fileName: context.file.name, folderKind: context.folderKind,
        folderId: context.folderId, action: 'RESTORE', occurredAt: new Date().toISOString(),
        googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
      });
      return this.toFileItem(restored, context.folderKind);
    } catch (error) {
      await this.recordFileFailure(actor, campaign, safeId, 'RESTORE', error, context);
      throw error;
    }
  }

  async markNameMismatch(campaign: CampaignSummary, actor: ActorContext) {
    const workspace = await this.repository.get(campaign.id);
    if (!workspace?.campaignFolderId) return;
    const status = await this.google.status(actor);
    if (!status.connected || !status.grantedScopes.includes(FULL_DRIVE_SCOPE)) return;
    try {
      const item = await this.google.withAccessToken(actor, (accessToken) => this.drive.getItem(accessToken, workspace.campaignFolderId!));
      await this.repository.save({ ...workspace, lastKnownFolderName: item.name, syncStatus: item.name === this.expectedFolderName(campaign) ? 'READY' : 'NEEDS_SYNC', lastCheckedAt: new Date(), lastErrorCode: null, lastErrorMessage: null });
    } catch (error) {
      await this.persistFailure(workspace, error, actor, campaign);
    }
  }

  async trashCampaignFolder(campaign: CampaignSummary, actor: ActorContext) {
    const workspace = await this.repository.get(campaign.id);
    if (!workspace?.campaignFolderId) return;
    try {
      const item = await this.google.withAccessToken(actor, (accessToken) => this.drive.setTrashed({ accessToken, fileId: workspace.campaignFolderId!, trashed: true }));
      await this.repository.save({ ...workspace, lifecycleStatus: 'TRASHED', syncStatus: 'READY', lastCheckedAt: new Date(), lastErrorCode: null, lastErrorMessage: null });
      await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_trashed', { campaignCode: campaign.code, folderId: item.id, result: 'SUCCESS' });
    } catch (error) {
      await this.repository.save({ ...workspace, lifecycleStatus: 'TRASH_FAILED', syncStatus: 'OUT_OF_SYNC', lastCheckedAt: new Date(), lastErrorCode: this.errorCode(error), lastErrorMessage: this.errorMessage(error) });
      await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_trash_failed', { campaignCode: campaign.code, folderId: workspace.campaignFolderId, errorCode: this.errorCode(error), result: 'FAILED' });
    }
  }

  async restoreCampaignFolder(campaign: CampaignSummary, actor: ActorContext) {
    const workspace = await this.repository.get(campaign.id);
    if (!workspace?.campaignFolderId) return;
    try {
      const item = await this.google.withAccessToken(actor, (accessToken) => this.drive.setTrashed({ accessToken, fileId: workspace.campaignFolderId!, trashed: false }));
      const configuration = this.requireDriveConfiguration();
      if (item.driveId !== configuration.sharedDriveId || !item.parents.includes(configuration.parentFolderId)) throw new ConflictException('Thư mục được phục hồi nhưng không còn nằm đúng parent folder đã cấu hình.');
      const children = await this.google.withAccessToken(actor, (accessToken) => this.restoreChildren(accessToken, campaign, workspace, item));
      await this.repository.save({
        ...workspace,
        lifecycleStatus: 'ACTIVE',
        syncStatus: item.name === this.expectedFolderName(campaign) ? 'READY' : 'NEEDS_SYNC',
        lastKnownFolderName: item.name,
        baseDocumentsFolderId: children.BASE_DOCUMENTS.id,
        mediaAssetsFolderId: children.MEDIA_ASSETS.id,
        otherDocumentsFolderId: children.OTHER_DOCUMENTS.id,
        lastCheckedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_restored', { campaignCode: campaign.code, folderId: item.id, result: 'SUCCESS' });
    } catch (error) {
      await this.repository.save({ ...workspace, lifecycleStatus: 'RESTORE_FAILED', syncStatus: 'OUT_OF_SYNC', lastCheckedAt: new Date(), lastErrorCode: this.errorCode(error), lastErrorMessage: this.errorMessage(error) });
      await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_restore_failed', { campaignCode: campaign.code, folderId: workspace.campaignFolderId, errorCode: this.errorCode(error), result: 'FAILED' });
    }
  }

  async ensureFolderTrashedBeforePermanentDelete(campaign: CampaignSummary, actor: ActorContext) {
    const workspace = await this.repository.get(campaign.id);
    if (!workspace?.campaignFolderId) return;
    const item = await this.google.withAccessToken(actor, (accessToken) => this.drive.getItem(accessToken, workspace.campaignFolderId!));
    if (!item.trashed) await this.google.withAccessToken(actor, (accessToken) => this.drive.setTrashed({ accessToken, fileId: workspace.campaignFolderId!, trashed: true }));
    await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_folder_trash_verified_before_permanent_delete', { campaignCode: campaign.code, folderId: workspace.campaignFolderId, result: 'SUCCESS' });
  }

  private async resolveCampaignFolder(accessToken: string, campaign: CampaignSummary, workspace: CampaignDriveWorkspaceRecord) {
    const configuration = this.requireDriveConfiguration();
    const legacyId = typeof campaign.fieldValues.campaign_folder_id === 'string' ? campaign.fieldValues.campaign_folder_id.trim() : '';
    const knownId = workspace.campaignFolderId ?? (legacyId || null);
    if (knownId) {
      const folder = await this.drive.getItem(accessToken, this.validateDriveId(knownId));
      this.validateCampaignFolder(folder, configuration.sharedDriveId, configuration.parentFolderId);
      return { folder, created: false };
    }
    const matches = (await this.drive.findFolders({
      accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: configuration.parentFolderId, nameContains: campaign.code,
    })).filter((folder) => folder.name === campaign.code || folder.name.startsWith(`${campaign.code} `));
    if (matches.length > 1) throw new ConflictException(`Có nhiều thư mục cùng mã ${campaign.code}; cần quản trị viên xử lý.`);
    if (matches[0]) {
      this.validateCampaignFolder(matches[0], configuration.sharedDriveId, configuration.parentFolderId);
      return { folder: matches[0], created: false };
    }
    const folder = await this.drive.createFolder({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: configuration.parentFolderId, name: this.expectedFolderName(campaign) });
    this.validateCampaignFolder(folder, configuration.sharedDriveId, configuration.parentFolderId);
    return { folder, created: true };
  }

  private async ensureChildren(accessToken: string, campaign: CampaignSummary, campaignFolder: CloudDriveItem) {
    const configuration = this.requireDriveConfiguration();
    const children = {} as Record<CampaignDriveFolderKey, CloudDriveItem> & { createdNames: string[]; createdIds: string[] };
    const createdNames: string[] = [];
    const createdIds: string[] = [];
    for (const key of CAMPAIGN_DRIVE_FOLDER_KEYS) {
      const name = `${campaign.code} ${FOLDER_LABELS[key]}`;
      const matches = await this.drive.findFolders({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: campaignFolder.id, exactName: name });
      if (matches.length > 1) throw new ConflictException(`Có nhiều folder con trùng tên “${name}”.`);
      const folder = matches[0] ?? await this.drive.createFolder({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: campaignFolder.id, name });
      if (!matches[0]) { createdNames.push(name); createdIds.push(folder.id); }
      this.validateChildFolder(folder, configuration.sharedDriveId, campaignFolder.id);
      children[key] = folder;
    }
    return Object.assign(children, { createdNames, createdIds });
  }

  private async restoreChildren(accessToken: string, campaign: CampaignSummary, workspace: CampaignDriveWorkspaceRecord, campaignFolder: CloudDriveItem) {
    const configuration = this.requireDriveConfiguration();
    const children = {} as Record<CampaignDriveFolderKey, CloudDriveItem> & { createdNames: string[]; createdIds: string[] };
    const createdNames: string[] = [];
    const createdIds: string[] = [];
    for (const key of CAMPAIGN_DRIVE_FOLDER_KEYS) {
      const expectedName = `${campaign.code} ${FOLDER_LABELS[key]}`;
      const knownId = this.folderId(workspace, key);
      let folder: CloudDriveItem;
      if (knownId) {
        folder = await this.drive.getItem(accessToken, knownId);
        if (folder.trashed) folder = await this.drive.setTrashed({ accessToken, fileId: knownId, trashed: false });
        this.validateChildFolder(folder, configuration.sharedDriveId, campaignFolder.id);
        if (folder.name !== expectedName) throw new ConflictException(`Folder con “${folder.name}” không đúng tên chuẩn “${expectedName}”.`);
      } else {
        const matches = await this.drive.findFolders({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: campaignFolder.id, exactName: expectedName });
        if (matches.length > 1) throw new ConflictException(`Có nhiều folder con trùng tên “${expectedName}”.`);
        folder = matches[0] ?? await this.drive.createFolder({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: campaignFolder.id, name: expectedName });
        if (!matches[0]) { createdNames.push(expectedName); createdIds.push(folder.id); }
        this.validateChildFolder(folder, configuration.sharedDriveId, campaignFolder.id);
      }
      children[key] = folder;
    }
    return Object.assign(children, { createdNames, createdIds });
  }

  private async ensureSharing(accessToken: string, folder: CloudDriveItem, sharingMode: CampaignDriveWorkspaceRecord['sharingMode']) {
    if (sharingMode === 'DRIVE_ACL') return { status: 'NOT_APPLICABLE', permissionId: null, created: false };
    const permissions = await this.drive.listPermissions(accessToken, folder.id);
    const inherited = permissions.find((permission) => permission.inherited && permission.type === 'anyone' && ['writer', 'fileOrganizer', 'organizer'].includes(permission.role));
    const direct = permissions.find((permission) => !permission.inherited && permission.type === 'anyone' && ['writer', 'fileOrganizer', 'organizer'].includes(permission.role));
    if (direct) return { status: 'DIRECT_PUBLIC_PERMISSION_REVIEW_REQUIRED', permissionId: direct.id, created: false };
    if (inherited) return { status: 'SATISFIED_BY_INHERITED_POLICY', permissionId: inherited.id, created: false };
    return { status: 'PARENT_PERMISSION_MISSING', permissionId: null, created: false };
  }

  private validateCampaignFolder(folder: CloudDriveItem, sharedDriveId: string, parentFolderId: string) {
    if (folder.mimeType !== FOLDER_MIME_TYPE) throw new BadRequestException('campaign_folder_id không trỏ tới một Google Drive folder.');
    if (folder.trashed) throw new ConflictException('Thư mục Chiến dịch đang nằm trong Google Drive Trash.');
    if (folder.driveId !== sharedDriveId) throw new ConflictException('Thư mục Chiến dịch không thuộc đúng Shared Drive.');
    if (!folder.parents.includes(parentFolderId)) throw new ConflictException('Thư mục Chiến dịch không nằm dưới đúng parent folder.');
  }

  private validateChildFolder(folder: CloudDriveItem, sharedDriveId: string, parentFolderId: string) {
    if (folder.mimeType !== FOLDER_MIME_TYPE || folder.trashed || folder.driveId !== sharedDriveId || !folder.parents.includes(parentFolderId)) {
      throw new ConflictException(`Folder con “${folder.name}” không đúng cấu trúc Campaign Workspace.`);
    }
  }

  private async requireWorkspaceFile(actor: ActorContext, workspace: CampaignDriveWorkspaceRecord, fileId: string): Promise<WorkspaceFileContext> {
    const configuration = this.requireDriveConfiguration();
    const folders = CAMPAIGN_DRIVE_FOLDER_KEYS.flatMap((folderKind) => {
      const folderId = this.folderId(workspace, folderKind);
      return folderId ? [{ folderKind, folderId, folderLabel: FOLDER_LABELS[folderKind] }] : [];
    });
    const systemIds = new Set([workspace.campaignFolderId, ...folders.map((folder) => folder.folderId)].filter((id): id is string => Boolean(id)));
    if (systemIds.has(fileId)) throw new ForbiddenException('Không thể thao tác file trên thư mục hệ thống của Campaign Workspace.');
    const file = await this.google.withAccessToken(actor, (accessToken) => this.drive.getItem(accessToken, fileId));
    const matchingFolders = folders.filter((folder) => file.parents.includes(folder.folderId));
    if (file.driveId !== configuration.sharedDriveId || matchingFolders.length !== 1) {
      throw new ForbiddenException('File không thuộc một folder con của Campaign Workspace này.');
    }
    return { file, ...matchingFolders[0]! };
  }

  private validateMutatedFile(item: CloudDriveItem, context: { file: CloudDriveItem; folderId: string }, trashed: boolean) {
    const configuration = this.requireDriveConfiguration();
    if (item.id !== context.file.id || item.name !== context.file.name || item.driveId !== configuration.sharedDriveId
      || !item.parents.includes(context.folderId) || item.trashed !== trashed) {
      throw new ConflictException('Google Drive trả về trạng thái file không đúng Campaign Workspace.');
    }
  }

  private async recordFileFailure(actor: ActorContext, campaign: CampaignSummary, fileId: string, action: 'TRASH' | 'RESTORE', error: unknown, context?: WorkspaceFileContext) {
    await this.repository.recordAudit(actor, campaign.id, action === 'TRASH' ? 'campaign.drive_file_trash_failed' : 'campaign.drive_file_restore_failed', {
      campaignCode: campaign.code, fileId, fileName: context?.file.name ?? null, folderKind: context?.folderKind ?? null,
      folderId: context?.folderId ?? null, action, errorCode: this.errorCode(error), occurredAt: new Date().toISOString(),
      googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'FAILED',
    });
  }

  private async persistFailure(workspace: CampaignDriveWorkspaceRecord, error: unknown, actor: ActorContext, campaign: CampaignSummary) {
    const code = this.errorCode(error);
    const syncStatus = error instanceof ConflictException ? 'CONFLICT' : error instanceof ForbiddenException || error instanceof UnauthorizedException ? 'PERMISSION_SETUP_REQUIRED' : 'ERROR';
    const saved = await this.repository.save({ ...workspace, syncStatus, lastCheckedAt: new Date(), lastErrorCode: code, lastErrorMessage: this.errorMessage(error) });
    await this.repository.recordAudit(actor, campaign.id, syncStatus === 'CONFLICT' ? 'campaign.drive_workspace_conflict' : 'campaign.drive_workspace_sync_failed', {
      campaignCode: campaign.code, folderId: workspace.campaignFolderId, errorCode: code, result: 'FAILED',
    });
    return saved;
  }

  private async toView(campaign: CampaignSummary, workspace: CampaignDriveWorkspaceRecord | null, actor: ActorContext, configurationError?: string): Promise<CampaignDriveWorkspaceView> {
    const configuration = this.driveConfiguration();
    const googleStatus = await this.google.status(actor);
    const canView = this.authorization.canView(actor);
    const expectedFolderName = this.expectedFolderName(campaign);
    return {
      canViewDriveWorkspace: canView,
      canManageDriveWorkspace: this.authorization.canManage(actor),
      configured: Boolean(configuration),
      googleConnected: googleStatus.connected,
      googleAccountEmail: googleStatus.account?.email ?? null,
      needsReconsent: googleStatus.connected && !googleStatus.grantedScopes.includes(FULL_DRIVE_SCOPE),
      syncStatus: workspace?.syncStatus ?? 'NOT_CREATED',
      lifecycleStatus: workspace?.lifecycleStatus ?? 'ACTIVE',
      accessMode: workspace?.accessMode ?? configuration?.accessMode ?? 'CPMS_VISIBILITY_ONLY',
      sharingMode: workspace?.sharingMode ?? configuration?.sharingMode ?? 'PARENT_INHERITED',
      campaignFolderName: canView ? workspace?.lastKnownFolderName ?? null : null,
      expectedFolderName,
      campaignFolderLink: canView ? workspace?.campaignFolderLink ?? null : null,
      nameMismatch: Boolean(workspace?.lastKnownFolderName && workspace.lastKnownFolderName !== expectedFolderName),
      lastCheckedAt: workspace?.lastCheckedAt?.toISOString() ?? null,
      lastErrorCode: workspace?.lastErrorCode ?? (configurationError ? 'NOT_CONFIGURED' : null),
      lastErrorMessage: workspace?.lastErrorMessage ?? configurationError ?? null,
      folders: CAMPAIGN_DRIVE_FOLDER_KEYS.map((key) => ({ key, label: FOLDER_LABELS[key], available: Boolean(workspace && this.folderId(workspace, key)) })),
    };
  }

  private blankWorkspace(campaignId: string, configuration: NonNullable<ReturnType<CampaignDriveApplicationService['driveConfiguration']>>, campaign: CampaignSummary): Omit<CampaignDriveWorkspaceRecord, 'createdAt' | 'updatedAt'> {
    const legacyId = typeof campaign.fieldValues.campaign_folder_id === 'string' ? campaign.fieldValues.campaign_folder_id.trim() || null : null;
    const legacyLink = typeof campaign.fieldValues.campaign_folder_link === 'string' ? campaign.fieldValues.campaign_folder_link.trim() || null : null;
    return {
      campaignId,
      sharedDriveId: configuration.sharedDriveId,
      parentFolderId: configuration.parentFolderId,
      campaignFolderId: legacyId,
      campaignFolderLink: legacyLink,
      lastKnownFolderName: null,
      baseDocumentsFolderId: null,
      mediaAssetsFolderId: null,
      otherDocumentsFolderId: null,
      templateVersion: TEMPLATE_VERSION,
      accessMode: configuration.accessMode,
      sharingMode: configuration.sharingMode,
      syncStatus: 'NOT_CREATED',
      lifecycleStatus: campaign.isDeleted ? 'TRASHED' : 'ACTIVE',
      lastCheckedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      googlePermissionId: null,
      desiredRole: ['LINK_WRITER', 'PARENT_INHERITED'].includes(configuration.sharingMode) ? 'writer' : null,
      permissionSyncStatus: null,
    };
  }

  private driveConfiguration() {
    const sharedDriveId = this.config.get('GOOGLE_DRIVE_SHARED_DRIVE_ID', { infer: true });
    const parentFolderId = this.config.get('GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID', { infer: true });
    if (!sharedDriveId || !parentFolderId) return null;
    return {
      sharedDriveId,
      parentFolderId,
      accessMode: this.config.get('GOOGLE_DRIVE_ACCESS_MODE', { infer: true }),
      sharingMode: this.config.get('GOOGLE_DRIVE_SHARING_MODE', { infer: true }),
      uploadMaxBytes: this.config.get('GOOGLE_DRIVE_UPLOAD_MAX_BYTES', { infer: true }),
      resumableThresholdBytes: this.config.get('GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES', { infer: true }),
    };
  }

  private requireDriveConfiguration() {
    const configuration = this.driveConfiguration();
    if (!configuration) throw new ConflictException('Google Drive Workspace chưa được cấu hình phía server.');
    return configuration;
  }

  private async requireWorkspace(campaignId: string) {
    const workspace = await this.repository.get(campaignId);
    if (!workspace) throw new NotFoundException('Chiến dịch chưa có Google Drive Workspace.');
    return workspace;
  }

  private folderId(workspace: CampaignDriveWorkspaceRecord, key: CampaignDriveFolderKey) {
    if (key === 'BASE_DOCUMENTS') return workspace.baseDocumentsFolderId;
    if (key === 'MEDIA_ASSETS') return workspace.mediaAssetsFolderId;
    return workspace.otherDocumentsFolderId;
  }

  private expectedFolderName(campaign: Pick<CampaignSummary, 'code' | 'name'>) { return `${campaign.code} ${campaign.name.trim()}`; }
  private folderLink(id: string) { return `https://drive.google.com/drive/folders/${id}`; }
  private folderIdFromUrl(value: string) {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new BadRequestException('Link thư mục Google Drive không hợp lệ.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.hash) {
      throw new BadRequestException('Chỉ chấp nhận link https://drive.google.com/drive/folders/…');
    }
    const match = /^\/drive\/folders\/([A-Za-z0-9_-]{10,200})\/?$/.exec(url.pathname);
    if (!match) throw new BadRequestException('Link phải trỏ trực tiếp tới một thư mục Google Drive.');
    return this.validateDriveId(match[1]!);
  }
  private validateDriveId(value: string) { if (!/^[A-Za-z0-9_-]{10,200}$/.test(value)) throw new BadRequestException('Google Drive file ID không hợp lệ.'); return value; }
  private validateFilename(value: string) {
    const name = value.trim().normalize('NFC');
    const hasUnsafeCharacter = [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || character === '/' || character === '\\';
    });
    if (!name || name.length > 255 || hasUnsafeCharacter || name === '.' || name === '..') throw new BadRequestException('Tên file không hợp lệ.');
    return name;
  }
  private validateMimeType(value: string) { const mime = value.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) throw new BadRequestException('MIME type không hợp lệ.'); return mime; }
  private toFileItem(item: CloudDriveItem, folderKind: CampaignDriveFolderKey): CampaignDriveFileItem { return {
    id: item.id, name: item.name, folderKind, folderLabel: FOLDER_LABELS[folderKind], status: item.trashed ? 'TRASHED' : 'ACTIVE',
    mimeType: item.mimeType, size: item.size, modifiedTime: item.modifiedTime, lastModifiedBy: item.lastModifiedBy,
    trashedAt: item.trashedTime, trashedBy: item.trashedBy, webViewLink: item.webViewLink, webContentLink: item.webContentLink,
    canEdit: item.capabilities.canEdit, canTrash: item.capabilities.canTrash, canUntrash: item.capabilities.canUntrash, canDownload: item.capabilities.canDownload,
  }; }
  private errorCode(error: unknown) { if (error instanceof ConflictException) return 'CONFLICT'; if (error instanceof ForbiddenException) return 'FORBIDDEN'; if (error instanceof UnauthorizedException) return 'AUTH_REQUIRED'; if (error instanceof HttpException) return `HTTP_${error.getStatus()}`; return 'GOOGLE_DRIVE_ERROR'; }
  private errorMessage(error: unknown) { return error instanceof HttpException || error instanceof Error ? error.message : 'Không thể đồng bộ Google Drive Workspace.'; }
}
