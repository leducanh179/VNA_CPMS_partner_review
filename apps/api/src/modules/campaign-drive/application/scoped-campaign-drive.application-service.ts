import type { AccessResource, ActorContext, CampaignDriveEntryItem, CampaignDriveFileItem, CampaignDriveFileStatus, CampaignDriveFolderKey, CampaignDriveWorkspaceView, CampaignSummary } from '@cpms/domain';
import { CLOUD_DRIVE_PORT, type CloudDrivePort } from '@cpms/integrations';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CampaignDriveGoogleAccessService } from './campaign-drive-google-access.service';
import { ProviderOperationAccessService } from '../../google-integration/application/provider-operation-access.service';
import { CampaignDriveApplicationService } from './campaign-drive.application-service';
import { CAMPAIGN_DRIVE_REPOSITORY, type CampaignDriveRepository } from './campaign-drive.repository';
import { ScopedDriveAuthorizationService } from './scoped-drive-authorization.service';
import { folderChainToRoot } from './campaign-drive-folder-scope';

@Injectable()
export class ScopedCampaignDriveApplicationService extends CampaignDriveApplicationService {
  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(ScopedCampaignApplicationService) private readonly scopedCampaigns: ScopedCampaignApplicationService,
    @Inject(CampaignDriveGoogleAccessService) private readonly scopedGoogle: CampaignDriveGoogleAccessService,
    @Inject(CLOUD_DRIVE_PORT) private readonly guardedDrive: CloudDrivePort,
    @Inject(CAMPAIGN_DRIVE_REPOSITORY) private readonly scopedRepository: CampaignDriveRepository,
    @Inject(ScopedDriveAuthorizationService) authorization: ScopedDriveAuthorizationService,
    @Inject(ProviderOperationAccessService) readonly providerAccess: ProviderOperationAccessService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(config, scopedCampaigns, scopedGoogle, guardedDrive, scopedRepository, authorization); }
  @AccessBoundary(1)
  override async getWorkspace(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id); this.access.require('campaign.drive.read', resource);
    return this.scopedView(await super.getWorkspace(id, actor), resource);
  }
  @AccessBoundary(1)
  override async ensure(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const view = await this.providerAccess.execute('campaign.drive.ensure', resource, () => super.ensure(id, actor));
    return this.scopedView(view, resource);
  }
  @AccessBoundary(1)
  async ensureCreatedCampaign(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    if (resource.createdByActorId !== actor.id) throw new ForbiddenException('Chỉ áp dụng tự tạo folder cho Chiến dịch vừa tạo bởi người thực hiện.');
    return this.scopedView(await this.providerAccess.execute('campaign.create', resource, () => super.ensure(id, actor)), resource);
  }
  @AccessBoundary(1)
  override async verify(id: string, actor: ActorContext) { return this.ensure(id, actor); }
  @AccessBoundary(2)
  override async previewExistingFolder(id: string, folderUrl: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.providerAccess.execute('campaign.drive.ensure', resource, () => super.previewExistingFolder(id, folderUrl, actor));
  }
  @AccessBoundary(4)
  override async adoptExistingFolder(id: string, folderUrl: string, expectedCurrentName: string, confirmRename: boolean, actor: ActorContext, expectedPreviousFolderId?: string) {
    const resource = await this.access.campaign(id);
    return this.scopedView(await this.providerAccess.execute('campaign.drive.ensure', resource,
      () => super.adoptExistingFolder(id, folderUrl, expectedCurrentName, confirmRename, actor, expectedPreviousFolderId)), resource);
  }
  @AccessBoundary(1)
  override async syncName(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.scopedView(await this.providerAccess.execute('campaign.drive.rename', resource, () => super.syncName(id, actor)), resource);
  }
  @AccessBoundary(4)
  override async listFiles(id: string, key: CampaignDriveFolderKey, status: CampaignDriveFileStatus, pageToken: string | undefined, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.read', resource, () => super.listFiles(id, key, status, pageToken, actor));
    return { ...result, items: result.items.map((item) => this.fileView(item, resource)) };
  }
  @AccessBoundary(4)
  override async listFolder(id: string, folderId: string | undefined, status: CampaignDriveFileStatus, pageToken: string | undefined, actor: ActorContext,
    sortBy: 'NAME' | 'UPDATED' | 'SIZE' = 'NAME', direction: 'ASC' | 'DESC' = 'ASC') {
    const resource = await this.access.campaign(id);
    const page = await this.providerAccess.execute('campaign.drive.read', resource, () => super.listFolder(id, folderId, status, pageToken, actor, sortBy, direction));
    return { ...page, items: page.items.map((item) => this.entryView(item, resource)) };
  }
  @AccessBoundary(2)
  override async shortcutTargetStatus(id: string, itemId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.providerAccess.execute('campaign.drive.read', resource, () => super.shortcutTargetStatus(id, itemId, actor));
  }
  @AccessBoundary(3)
  override async downloadEntries(id: string, folderId: string, itemIds: string[], actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.providerAccess.execute('campaign.drive.read', resource, () => super.downloadEntries(id, folderId, itemIds, actor));
  }
  @AccessBoundary(3)
  override async uploadToFolder(id: string, folderId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, actor: ActorContext, uploadId?: string) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.upload', resource, () => super.uploadToFolder(id, folderId, file, actor, uploadId));
    return { ...result, file: this.entryView(result.file, resource) };
  }
  @AccessBoundary(2)
  override async uploadStatus(id: string, folderId: string, uploadId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.read', resource, () => super.uploadStatus(id, folderId, uploadId, actor));
    return { ...result, file: result.file ? this.entryView(result.file, resource) : null };
  }
  @AccessBoundary(3)
  override async createSubfolder(id: string, folderId: string, name: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.entryView(await this.providerAccess.execute('campaign.drive.ensure', resource, () => super.createSubfolder(id, folderId, name, actor)), resource);
  }
  @AccessBoundary(3)
  override async renameEntry(id: string, itemId: string, name: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.entryView(await this.providerAccess.execute('campaign.drive.rename', resource, () => super.renameEntry(id, itemId, name, actor)), resource);
  }
  @AccessBoundary(3)
  override async getFolderSharing(id: string, itemId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.read', resource, () => super.getFolderSharing(id, itemId, actor));
    return { ...result, canManage: result.googleCanShare && this.providerAccess.driveWritesEnabled() &&
      this.access.check('campaign.drive.ensure', resource).allowed &&
      this.access.check('campaign.update', resource).allowed };
  }
  @AccessBoundary(3)
  override async createFolderPermission(id: string, itemId: string, type: 'user' | 'anyone',
    role: 'reader' | 'commenter' | 'writer', emailAddress: string | undefined, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.ensure', resource,
      () => super.createFolderPermission(id, itemId, type, role, emailAddress, actor));
    return { ...result, canManage: result.googleCanShare };
  }
  @AccessBoundary(3)
  override async changeFolderPermission(id: string, itemId: string, permissionId: string,
    role: 'reader' | 'commenter' | 'writer' | null, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.ensure', resource,
      () => super.changeFolderPermission(id, itemId, permissionId, role, actor));
    return { ...result, canManage: result.googleCanShare };
  }
  @AccessBoundary(3)
  override async setFolderGeneralAccess(id: string, itemId: string, access: 'RESTRICTED' | 'ANYONE',
    role: 'reader' | 'commenter' | 'writer' | undefined, confirmLimitInheritedAccess: boolean, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.ensure', resource,
      () => super.setFolderGeneralAccess(id, itemId, access, role, confirmLimitInheritedAccess, actor));
    return { ...result, canManage: result.googleCanShare };
  }
  @AccessBoundary(2)
  override async trashEntry(id: string, itemId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.entryView(await this.providerAccess.execute('campaign.drive.trash', resource, () => super.trashEntry(id, itemId, actor)), resource);
  }
  @AccessBoundary(2)
  override async restoreEntry(id: string, itemId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.entryView(await this.providerAccess.execute('campaign.drive.restore', resource, () => super.restoreEntry(id, itemId, actor)), resource);
  }
  @AccessBoundary(3)
  override async upload(id: string, key: CampaignDriveFolderKey, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    const result = await this.providerAccess.execute('campaign.drive.upload', resource, () => super.upload(id, key, file, actor));
    return { ...result, file: this.fileView(result.file, resource) };
  }
  @AccessBoundary(3)
  override async renameFile(id: string, fileId: string, name: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.fileView(await this.providerAccess.execute('campaign.drive.rename', resource, () => super.renameFile(id, fileId, name, actor)), resource);
  }
  @AccessBoundary(2)
  override async trashFile(id: string, fileId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.fileView(await this.providerAccess.execute('campaign.drive.trash', resource, () => super.trashFile(id, fileId, actor)), resource);
  }
  @AccessBoundary(2)
  override async restoreFile(id: string, fileId: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    return this.fileView(await this.providerAccess.execute('campaign.drive.restore', resource, () => super.restoreFile(id, fileId, actor)), resource);
  }
  @AccessBoundary(1)
  override async markNameMismatch(campaign: CampaignSummary, actor: ActorContext) {
    // Derive metadata from the current saved Campaign; a passed summary never establishes authority or names.
    const current = await this.scopedCampaigns.get(campaign.id);
    const workspace = await this.scopedRepository.get(current.id);
    if (!workspace?.campaignFolderId || !workspace.lastKnownFolderName) return;
    const mismatch = workspace.lastKnownFolderName !== `${current.code} ${current.name.trim()}`;
    if (mismatch && workspace.syncStatus === 'READY') {
      await this.scopedRepository.save({ ...workspace, syncStatus: 'NEEDS_SYNC' });
      await this.scopedRepository.recordAudit(actor, current.id, 'campaign.drive_name_sync_required', { result: 'PENDING_CONFIRMATION' });
    }
  }
  @AccessBoundary(1)
  override async trashCampaignFolder(campaign: CampaignSummary, actor: ActorContext) {
    const current = await this.scopedCampaigns.get(campaign.id); const resource = await this.access.campaign(current.id);
    const permission = this.access.check('campaign.approve', resource).allowed ? 'campaign.approve' : 'campaign.delete';
    return this.providerAccess.execute(permission, resource, () => super.trashCampaignFolder(current, actor));
  }
  @AccessBoundary(1)
  override async restoreCampaignFolder(campaign: CampaignSummary, actor: ActorContext) {
    const current = await this.scopedCampaigns.get(campaign.id); const resource = await this.access.campaign(current.id);
    const permission = this.access.check('campaign.approve', resource).allowed ? 'campaign.approve' : 'campaign.restore';
    return this.providerAccess.execute(permission, resource, () => super.restoreCampaignFolder(current, actor));
  }
  @AccessBoundary(1)
  override async ensureFolderTrashedBeforePermanentDelete(campaign: CampaignSummary, actor: ActorContext) {
    const resource = await this.access.campaign(campaign.id); this.access.require('campaign.purge', resource);
    const workspace = await this.scopedRepository.get(campaign.id);
    if (!workspace?.campaignFolderId) {
      const current = await this.scopedCampaigns.get(campaign.id);
      if (current.fieldValues.campaign_folder_id || current.fieldValues.campaign_folder_link) throw new ConflictException('Cần đối soát thư mục legacy trước khi xóa vĩnh viễn.');
      await this.access.recordPurgeVerification(campaign.id); return;
    }
    // Purge verifies the existing provider state; it does not silently perform a provider mutation.
    const item = await this.providerAccess.execute('campaign.purge', resource, () => this.scopedGoogle.withAccessToken(actor,
      async (token) => {
        const folder = await this.guardedDrive.getItem(token, workspace.campaignFolderId!);
        // A trashed folder retains its ancestry; validate it without assuming a direct child.
        if (folder.parents.length !== 1 || folder.driveId !== workspace.sharedDriveId) throw new ConflictException('Không xác định được vị trí thư mục Drive.');
        await folderChainToRoot(this.guardedDrive, token, folder.parents[0]!, workspace.parentFolderId, workspace.sharedDriveId);
        return folder;
      }));
    if (item.id !== workspace.campaignFolderId || item.driveId !== workspace.sharedDriveId || !item.trashed) {
      throw new ConflictException('Cần xác nhận đúng thư mục Campaign đã ở trong Thùng rác Google trước khi xóa vĩnh viễn.');
    }
    await this.scopedRepository.recordAudit(actor, campaign.id, 'campaign.drive_folder_trash_verified_before_permanent_delete', { folderId: item.id, result: 'SUCCESS' });
    await this.access.recordPurgeVerification(campaign.id);
  }
  private scopedView(view: CampaignDriveWorkspaceView, resource: AccessResource) {
    const capabilities = Object.fromEntries((['read','ensure','upload','rename','trash','restore'] as const).map((action) => [action,
      (action === 'read' || this.providerAccess.driveWritesEnabled()) && this.access.check(`campaign.drive.${action}`, resource).allowed]));
    return { ...view, canViewDriveWorkspace: Boolean(capabilities.read), canManageDriveWorkspace: ['ensure','upload','rename','trash','restore'].some((key) => capabilities[key]), capabilities,
      providerWritesEnabled: this.providerAccess.driveWritesEnabled(), canConnectGoogle: false,
      ...(!view.googleConnected ? { lastErrorCode: 'SHARED_GOOGLE_NOT_CONNECTED', lastErrorMessage: 'Quản trị viên cần kết nối tài khoản Google Drive dùng chung cho CPMS.' } : {}) };
  }
  private fileView(item: CampaignDriveFileItem, resource: AccessResource): CampaignDriveFileItem {
    return { ...item, canEdit: item.canEdit && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.rename', resource).allowed,
      canTrash: item.canTrash && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.trash', resource).allowed,
      canUntrash: item.canUntrash && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.restore', resource).allowed };
  }
  private entryView(item: CampaignDriveEntryItem, resource: AccessResource): CampaignDriveEntryItem {
    return { ...item, canEdit: item.canEdit && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.rename', resource).allowed,
      canTrash: item.canTrash && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.trash', resource).allowed,
      canUntrash: item.canUntrash && this.providerAccess.driveWritesEnabled() && this.access.check('campaign.drive.restore', resource).allowed };
  }
}
