import {
  CAMPAIGN_DRIVE_FOLDER_KEYS,
  type ActorContext,
  type CampaignDriveFileItem,
  type CampaignDriveFilePage,
  type CampaignDriveEntryItem,
  type CampaignDriveFolderPage,
  type CampaignDriveShortcutTargetStatus,
  type CampaignDriveFileStatus,
  type CampaignDriveFolderKey,
  type CampaignDriveUploadResult,
  type CampaignDriveWorkspaceView,
  type CampaignSummary,
} from '@cpms/domain';
import { CLOUD_DRIVE_PORT, type CloudDriveItem, type CloudDrivePort } from '@cpms/integrations';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import type { Environment } from '../../../config/environment';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignDriveGoogleAccessService } from './campaign-drive-google-access.service';
import { CampaignDriveAuthorizationService } from './campaign-drive-authorization.service';
import {
  CAMPAIGN_DRIVE_REPOSITORY,
  type CampaignDriveRepository,
  type CampaignDriveWorkspaceRecord,
} from './campaign-drive.repository';
import { folderChainToRoot, validDriveId, GOOGLE_FOLDER_MIME_TYPE } from './campaign-drive-folder-scope';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const FULL_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TEMPLATE_VERSION = 1;
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_MAX_ITEMS = 100;
const DOWNLOAD_MAX_SELECTION = 25;
const DOWNLOAD_MAX_DEPTH = 10;
const GENERAL_ROLE_RANK: Record<'reader' | 'commenter' | 'writer', number> = { reader: 1, commenter: 2, writer: 3 };
type DriveSortBy = 'NAME' | 'UPDATED' | 'SIZE';
type DriveSortDirection = 'ASC' | 'DESC';
const DRIVE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx' },
  'application/vnd.google-apps.drawing': { mimeType: 'application/pdf', extension: '.pdf' },
};
function safeArchiveName(name: string) {
  const invalid = new Set(['/', '\\', '<', '>', ':', '"', '|', '?', '*']);
  const safe = [...name].map((character) => invalid.has(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('').trim().replace(/[. ]+$/, '');
  return safe === '.' || safe === '..' || !safe ? 'Khong co ten' : safe.slice(0, 180);
}
function uniqueArchiveName(name: string, used: Set<string>) {
  let candidate = name;
  for (let index = 2; used.has(candidate.toLocaleLowerCase('vi')); index += 1) {
    const dot = name.lastIndexOf('.');
    candidate = dot > 0 ? `${name.slice(0, dot)} (${index})${name.slice(dot)}` : `${name} (${index})`;
  }
  used.add(candidate.toLocaleLowerCase('vi'));
  return candidate;
}
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
  replacingFolderId: string | null;
  replacingFolderName: string | null;
  childFolderRenames: Array<{ folderId: string; currentName: string; expectedName: string }>;
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
        const children = workspace.templateVersion >= 2 ? null : await this.ensureChildren(accessToken, campaign, current.folder);
        const sharing = await this.ensureSharing(accessToken, current.folder, workspace.sharingMode);
        const saved = await this.repository.save({
          ...workspace,
          campaignFolderId: current.folder.id,
          campaignFolderLink: this.folderLink(current.folder.id),
          lastKnownFolderName: current.folder.name,
          baseDocumentsFolderId: children?.BASE_DOCUMENTS.id ?? null,
          mediaAssetsFolderId: children?.MEDIA_ASSETS.id ?? null,
          otherDocumentsFolderId: children?.OTHER_DOCUMENTS.id ?? null,
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
        if (children?.createdNames.length) await this.repository.recordAudit(actor, campaign.id, 'campaign.drive_child_folders_created', {
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
    const assigned = await this.repository.findByFolderId(folderId);
    if (assigned && assigned.campaignId !== campaignId) throw new ConflictException('Thư mục này đã thuộc Chiến dịch khác trong CPMS.');
    return this.google.withAccessToken(actor, async (accessToken) => {
      const folder = await this.drive.getItem(accessToken, folderId);
      this.validateCampaignFolder(folder, configuration.sharedDriveId, configuration.parentFolderId);
      if (!folder.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google dùng chung không có quyền đổi tên thư mục này.');
      const replacing = workspace?.campaignFolderId && workspace.campaignFolderId !== folderId
        ? await this.requireEmptyLinkedFolder(accessToken, campaign, workspace)
        : null;
      const expectedName = this.expectedFolderName(campaign);
      const childFolderRenames = await this.legacyChildFolderRenames(accessToken, campaign, folderId);
      return {
        folderId, folderUrl: this.folderLink(folderId), currentName: folder.name, expectedName,
        willRename: folder.name !== expectedName,
        replacingFolderId: replacing?.id ?? null,
        replacingFolderName: replacing?.name ?? null,
        childFolderRenames,
      };
    });
  }

  async adoptExistingFolder(campaignId: string, folderUrl: string, expectedCurrentName: string, confirmRename: boolean, actor: ActorContext, expectedPreviousFolderId?: string) {
    if (confirmRename !== true) throw new BadRequestException('Cần xác nhận CPMS sẽ đổi tên folder cho khớp mã và tên Chiến dịch.');
    const preview = await this.previewExistingFolder(campaignId, folderUrl, actor);
    if (preview.currentName !== expectedCurrentName) throw new ConflictException('Tên thư mục trên Google Drive đã thay đổi. Hãy xem lại và xác nhận lần nữa.');
    if ((expectedPreviousFolderId ?? null) !== preview.replacingFolderId) throw new ConflictException('Liên kết Google Drive hiện tại đã thay đổi. Hãy kiểm tra lại trước khi xác nhận.');
    const campaign = await this.campaigns.get(campaignId);
    const configuration = this.requireDriveConfiguration();
    const workspace = await this.repository.get(campaignId);
    await this.google.withAccessToken(actor, async (accessToken) => {
      for (const rename of preview.childFolderRenames) {
        const current = await this.drive.getItem(accessToken, rename.folderId);
        this.validateChildFolder(current, configuration.sharedDriveId, preview.folderId);
        if (current.name !== rename.currentName) throw new ConflictException('Tên thư mục con đã thay đổi. Hãy kiểm tra lại link trước khi xác nhận.');
        await this.drive.renameItem({ accessToken, fileId: current.id, name: rename.expectedName });
      }
    });
    if (workspace?.campaignFolderId !== preview.folderId) {
      await this.repository.save({
        ...(workspace ?? this.blankWorkspace(campaignId, configuration, campaign)),
        campaignFolderId: preview.folderId,
        campaignFolderLink: preview.folderUrl,
        lastKnownFolderName: preview.currentName,
        baseDocumentsFolderId: null,
        mediaAssetsFolderId: null,
        otherDocumentsFolderId: null,
        syncStatus: 'NEEDS_SYNC',
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_existing_folder_adopted', {
        folderId: preview.folderId, oldName: preview.currentName, expectedName: preview.expectedName,
        previousFolderId: preview.replacingFolderId, childFolderRenames: preview.childFolderRenames,
        sharedDriveId: configuration.sharedDriveId, parentFolderId: configuration.parentFolderId,
        googleAccount: (await this.google.status(actor)).account?.email ?? null, result: 'SUCCESS',
      });
    }
    // Record the selected folder before workspace setup so a failed ensure remains retriable.
    const ensured = await this.ensure(campaignId, actor);
    if (!['READY', 'NEEDS_SYNC'].includes(ensured.syncStatus)) return ensured;
    const result = preview.willRename ? await this.syncName(campaignId, actor) : ensured;
    let cleanupWarning: string | null = null;
    if (preview.replacingFolderId && result.syncStatus === 'READY' && workspace) {
      // The old CPMS-created template is recoverable from Drive Trash. Recheck it immediately before cleanup.
      try {
        await this.google.withAccessToken(actor, async (accessToken) => {
          await this.requireEmptyLinkedFolder(accessToken, campaign, workspace);
          const trashed = await this.drive.setTrashed({ accessToken, fileId: preview.replacingFolderId!, trashed: true });
          if (trashed.id !== preview.replacingFolderId || !trashed.trashed) throw new ConflictException('Google Drive chưa xác nhận folder cũ đã vào Thùng rác.');
        });
        await this.repository.recordAudit(actor, campaignId, 'campaign.drive_replaced_empty_folder_trashed', {
          folderId: preview.replacingFolderId, replacementFolderId: preview.folderId, result: 'SUCCESS',
        });
      } catch (error) {
        cleanupWarning = 'Đã chuyển liên kết, nhưng chưa thể đưa folder trống cũ vào Thùng rác. Hãy kiểm tra lại trên Google Drive.';
        await this.repository.recordAudit(actor, campaignId, 'campaign.drive_replaced_empty_folder_cleanup_failed', {
          folderId: preview.replacingFolderId, replacementFolderId: preview.folderId, errorCode: this.errorCode(error), result: 'FAILED',
        });
      }
    }
    return cleanupWarning ? { ...result, lastErrorMessage: cleanupWarning } : result;
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

  async listFolder(campaignId: string, selectedFolderId: string | undefined, status: CampaignDriveFileStatus,
    pageToken: string | undefined, actor: ActorContext, sortBy: DriveSortBy = 'NAME', direction: DriveSortDirection = 'ASC'): Promise<CampaignDriveFolderPage> {
    this.authorization.requireView(actor);
    if (pageToken && !/^[A-Za-z0-9._~-]{1,1000}$/.test(pageToken)) throw new BadRequestException('Page token Google Drive không hợp lệ.');
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Google Drive của Chiến dịch chưa sẵn sàng.');
    const folderId = selectedFolderId ? validDriveId(selectedFolderId) : workspace.campaignFolderId;
    const configuration = this.requireDriveConfiguration();
    return this.google.withAccessToken(actor, async (token) => {
      const chain = await folderChainToRoot(this.drive, token, folderId, workspace.campaignFolderId!, configuration.sharedDriveId);
      const orderKey = sortBy === 'UPDATED' ? 'modifiedTime' : sortBy === 'SIZE' ? 'quotaBytesUsed' : 'name_natural';
      const page = await this.drive.listFiles({ accessToken: token, sharedDriveId: configuration.sharedDriveId,
        parentFolderId: folderId, trashed: status === 'TRASHED', pageSize: 50,
        orderBy: `folder,${orderKey}${direction === 'DESC' ? ' desc' : ''}${orderKey === 'name_natural' ? '' : ',name_natural'}`, ...(pageToken ? { pageToken } : {}) });
      for (const item of page.items) {
        if (item.driveId !== configuration.sharedDriveId || !item.parents.includes(folderId) || item.trashed !== (status === 'TRASHED')) {
          throw new ConflictException('Google Drive trả về mục ngoài phạm vi thư mục đang mở.');
        }
      }
      return { folder: { id: folderId, name: chain[0]!.name },
        breadcrumbs: chain.reverse().map((folder) => ({ id: folder.id, name: folder.name })),
        items: page.items.map((item) => this.toEntryItem(item, folderId)), nextPageToken: page.nextPageToken };
    });
  }

  async shortcutTargetStatus(campaignId: string, rawItemId: string, actor: ActorContext): Promise<{ status: CampaignDriveShortcutTargetStatus }> {
    this.authorization.requireView(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed || item.mimeType !== SHORTCUT_MIME_TYPE || !item.shortcutDetails?.targetId) {
      throw new BadRequestException('Mục này không phải lối tắt đang sử dụng của Chiến dịch.');
    }
    try {
      const target = await this.google.withAccessToken(actor, (token) => this.drive.getItem(token,
        item.shortcutDetails!.targetId, item.shortcutDetails!.targetResourceKey ?? undefined));
      return { status: target.trashed ? 'TRASHED' : 'ACTIVE' };
    } catch (error) {
      // Drive can return either 403 or 404 for a target that the shared account can no longer see.
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  async downloadEntries(campaignId: string, rawFolderId: string, rawItemIds: string[], actor: ActorContext) {
    this.authorization.requireView(actor);
    if (!Array.isArray(rawItemIds) || rawItemIds.length < 1 || rawItemIds.length > DOWNLOAD_MAX_SELECTION) {
      throw new BadRequestException(`Chọn từ 1 đến ${DOWNLOAD_MAX_SELECTION} mục để tải xuống.`);
    }
    const itemIds = rawItemIds.map(validDriveId);
    if (new Set(itemIds).size !== itemIds.length) throw new BadRequestException('Danh sách tải xuống có mục trùng lặp.');
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Google Drive của Chiến dịch chưa sẵn sàng.');
    const folderId = validDriveId(rawFolderId);
    const configuration = this.requireDriveConfiguration();
    const campaign = await this.campaigns.get(campaignId);
    return this.google.withAccessToken(actor, async (token) => {
      await folderChainToRoot(this.drive, token, folderId, workspace.campaignFolderId!, configuration.sharedDriveId);
      const roots: CloudDriveItem[] = [];
      for (const itemId of itemIds) {
        const item = await this.drive.getItem(token, itemId);
        if (item.trashed || item.driveId !== configuration.sharedDriveId || item.parents.length !== 1 || item.parents[0] !== folderId) {
          throw new ForbiddenException('Chỉ được tải mục đang sử dụng trong thư mục Chiến dịch đang mở.');
        }
        roots.push(item);
      }
      const files: Array<{ item: CloudDriveItem; path: string; exportMimeType?: string; mimeType: string }> = [];
      const folders: string[] = [];
      const seen = new Set<string>();
      const archivePaths = new Set<string>();
      let knownBytes = 0;
      const scan = async (item: CloudDriveItem, path: string, depth: number): Promise<void> => {
        if (seen.has(item.id)) throw new ConflictException('Thư mục Google Drive có mục lặp.');
        seen.add(item.id);
        if (seen.size > DOWNLOAD_MAX_ITEMS || depth > DOWNLOAD_MAX_DEPTH) throw new BadRequestException(`Mỗi lượt tải tối đa ${DOWNLOAD_MAX_ITEMS} mục và ${DOWNLOAD_MAX_DEPTH} cấp thư mục.`);
        if (item.mimeType === SHORTCUT_MIME_TYPE) throw new BadRequestException(`Không thể tải lối tắt “${item.name}”. Hãy mở mục gốc trên Google Drive.`);
        if (item.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
          const folderPath = uniqueArchiveName(path, archivePaths);
          folders.push(`${folderPath}/`);
          let pageToken: string | undefined;
          const names = new Set<string>();
          do {
            const page = await this.drive.listFiles({ accessToken: token, sharedDriveId: configuration.sharedDriveId,
              parentFolderId: item.id, trashed: false, pageSize: 100, ...(pageToken ? { pageToken } : {}) });
            for (const child of page.items) {
              if (child.driveId !== configuration.sharedDriveId || child.parents.length !== 1 || child.parents[0] !== item.id || child.trashed) {
                throw new ConflictException('Google Drive trả về mục ngoài thư mục đang tải.');
              }
              const childName = uniqueArchiveName(safeArchiveName(child.name), names);
              await scan(child, `${folderPath}/${childName}`, depth + 1);
            }
            pageToken = page.nextPageToken ?? undefined;
          } while (pageToken);
          return;
        }
        if (!item.capabilities.canDownload) throw new ForbiddenException(`Không có quyền tải tệp “${item.name}”.`);
        const exportSpec = DRIVE_EXPORTS[item.mimeType];
        if (item.mimeType.startsWith('application/vnd.google-apps.') && !exportSpec) {
          throw new BadRequestException(`Chưa hỗ trợ tải định dạng Google của “${item.name}”.`);
        }
        knownBytes += item.size ?? 0;
        if (knownBytes > DOWNLOAD_MAX_BYTES) throw new BadRequestException('Dữ liệu chọn vượt giới hạn tải xuống 50 MB. Hãy chọn ít mục hơn.');
        const filePath = exportSpec && !path.toLowerCase().endsWith(exportSpec.extension) ? `${path}${exportSpec.extension}` : path;
        files.push({ item, path: uniqueArchiveName(filePath, archivePaths),
          ...(exportSpec ? { exportMimeType: exportSpec.mimeType } : {}), mimeType: exportSpec?.mimeType ?? item.mimeType });
      };
      const rootNames = new Set<string>();
      for (const root of roots) await scan(root, uniqueArchiveName(safeArchiveName(root.name), rootNames), 0);
      let downloadedBytes = 0;
      const downloaded: Array<{ path: string; content: Buffer; mimeType: string }> = [];
      for (const file of files) {
        const remaining = DOWNLOAD_MAX_BYTES - downloadedBytes;
        if (remaining <= 0) throw new BadRequestException('Dữ liệu chọn vượt giới hạn tải xuống 50 MB.');
        const bytes = await this.drive.downloadFile({ accessToken: token, fileId: file.item.id, maxBytes: remaining,
          ...(file.exportMimeType ? { exportMimeType: file.exportMimeType } : {}) });
        downloadedBytes += bytes.byteLength;
        if (downloadedBytes > DOWNLOAD_MAX_BYTES) throw new BadRequestException('Dữ liệu chọn vượt giới hạn tải xuống 50 MB.');
        downloaded.push({ path: file.path, content: Buffer.from(bytes), mimeType: file.mimeType });
      }
      if (roots.length === 1 && roots[0]!.mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
        return { filename: downloaded[0]!.path, mimeType: downloaded[0]!.mimeType, content: downloaded[0]!.content };
      }
      const zip = new JSZip();
      folders.forEach((path) => zip.folder(path));
      downloaded.forEach((file) => zip.file(file.path, file.content));
      const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      if (content.byteLength > DOWNLOAD_MAX_BYTES + 1_048_576) throw new BadRequestException('Gói ZIP vượt giới hạn tải xuống.');
      return { filename: `${safeArchiveName(campaign.code)}-tai-lieu.zip`, mimeType: 'application/zip', content };
    });
  }

  async uploadStatus(campaignId: string, selectedFolderId: string, uploadId: string, actor: ActorContext) {
    this.authorization.requireView(actor);
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Chiến dịch chưa sẵn sàng.');
    const configuration = this.requireDriveConfiguration();
    const folderId = validDriveId(selectedFolderId);
    return this.google.withAccessToken(actor, async (token) => {
      await folderChainToRoot(this.drive, token, folderId, workspace.campaignFolderId!, configuration.sharedDriveId);
      const item = await this.findUpload(token, configuration.sharedDriveId, folderId, uploadId);
      return { completed: Boolean(item), file: item ? this.toEntryItem(item, folderId) : null };
    });
  }

  private async findUpload(token: string, sharedDriveId: string, folderId: string, uploadId: string) {
    const page = await this.drive.listFiles({ accessToken: token, sharedDriveId, parentFolderId: folderId,
      trashed: false, pageSize: 2, uploadId });
    const item = page.items.find((candidate) => candidate.uploadId === uploadId && candidate.driveId === sharedDriveId &&
      candidate.parents.includes(folderId) && !candidate.trashed);
    if (page.items.length > 1) throw new ConflictException('Mã tải lên có nhiều kết quả trên Google Drive; cần kiểm tra thủ công.');
    return item ?? null;
  }

  async uploadToFolder(campaignId: string, selectedFolderId: string, file: UploadInput | undefined, actor: ActorContext, uploadId?: string) {
    this.authorization.requireManage(actor);
    if (!file) throw new BadRequestException('Hãy chọn file cần tải lên.');
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Chiến dịch chưa sẵn sàng.');
    const name = this.validateFilename(file.originalname);
    const mimeType = this.validateMimeType(file.mimetype);
    const configuration = this.requireDriveConfiguration();
    if (file.size <= 0 || file.buffer.byteLength !== file.size) throw new BadRequestException('File tải lên rỗng hoặc không đầy đủ.');
    if (file.size > configuration.uploadMaxBytes) throw new BadRequestException(`File vượt quá giới hạn ${Math.floor(configuration.uploadMaxBytes / 1_048_576)} MB.`);
    const folderId = validDriveId(selectedFolderId);
    const uploaded = await this.google.withAccessToken(actor, async (token) => {
      const chain = await folderChainToRoot(this.drive, token, folderId, workspace.campaignFolderId!, configuration.sharedDriveId);
      if (!chain[0]!.capabilities.canAddChildren) throw new ForbiddenException('Tài khoản Google không có quyền tải tệp vào thư mục này.');
      if (uploadId) {
        const existing = await this.findUpload(token, configuration.sharedDriveId, folderId, uploadId);
        if (existing) {
          if (existing.name !== name || existing.size !== file.size) throw new ConflictException('Mã tải lên đã được dùng cho tệp khác.');
          return { item: existing, mode: 'RECOVERED' as const };
        }
      }
      return this.drive.upload({ accessToken: token, sharedDriveId: configuration.sharedDriveId, parentFolderId: folderId,
        name, mimeType, content: file.buffer, resumableThresholdBytes: configuration.resumableThresholdBytes, ...(uploadId ? { uploadId } : {}) });
    });
    if (uploaded.mode !== 'RECOVERED') await this.repository.recordAudit(actor, campaignId, 'campaign.drive_file_uploaded', {
      folderId, fileId: uploaded.item.id, fileName: uploaded.item.name, mimeType, size: file.size, uploadMode: uploaded.mode, uploadId: uploadId ?? null, result: 'SUCCESS',
    });
    return { file: this.toEntryItem(uploaded.item, folderId), uploadMode: uploaded.mode };
  }

  async createSubfolder(campaignId: string, selectedFolderId: string, name: string, actor: ActorContext): Promise<CampaignDriveEntryItem> {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Chiến dịch chưa sẵn sàng.');
    const configuration = this.requireDriveConfiguration();
    const folderId = validDriveId(selectedFolderId);
    const safeName = this.validateFilename(name);
    const created = await this.google.withAccessToken(actor, async (token) => {
      const chain = await folderChainToRoot(this.drive, token, folderId, workspace.campaignFolderId!, configuration.sharedDriveId);
      if (!chain[0]!.capabilities.canAddChildren) throw new ForbiddenException('Tài khoản Google không có quyền tạo thư mục tại đây.');
      return this.drive.createFolder({ accessToken: token, sharedDriveId: configuration.sharedDriveId, parentFolderId: folderId, name: safeName });
    });
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_created', { folderId: created.id, parentFolderId: folderId, name: created.name, result: 'SUCCESS' });
    return this.toEntryItem(created, folderId);
  }

  private async requireEntry(actor: ActorContext, workspace: CampaignDriveWorkspaceRecord, itemId: string) {
    if (!workspace.campaignFolderId || workspace.lifecycleStatus !== 'ACTIVE') throw new ConflictException('Thư mục Chiến dịch chưa sẵn sàng.');
    if (itemId === workspace.campaignFolderId) throw new ForbiddenException('Không thể sửa hoặc xóa thư mục gốc của Chiến dịch tại đây.');
    const configuration = this.requireDriveConfiguration();
    return this.google.withAccessToken(actor, async (token) => {
      const item = await this.drive.getItem(token, itemId);
      if (item.driveId !== configuration.sharedDriveId || item.parents.length !== 1) throw new ForbiddenException('Mục không thuộc Shared Drive Chiến dịch.');
      const parentId = item.parents[0]!;
      await folderChainToRoot(this.drive, token, parentId, workspace.campaignFolderId!, configuration.sharedDriveId);
      return { item, parentId };
    });
  }

  async renameEntry(campaignId: string, rawItemId: string, name: string, actor: ActorContext): Promise<CampaignDriveEntryItem> {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item, parentId } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed) throw new ConflictException('Hãy phục hồi mục này trước khi đổi tên.');
    if (!item.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google không có quyền đổi tên mục này.');
    const renamed = await this.google.withAccessToken(actor, (token) => this.drive.renameItem({ accessToken: token, fileId: itemId, name: this.validateFilename(name) }));
    if (renamed.id !== itemId || !renamed.parents.includes(parentId)) throw new ConflictException('Google Drive trả về mục ngoài thư mục đang thao tác.');
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_entry_renamed', { itemId, parentId, oldName: item.name, newName: renamed.name, result: 'SUCCESS' });
    return this.toEntryItem(renamed, parentId);
  }

  async getFolderSharing(campaignId: string, rawItemId: string, actor: ActorContext) {
    return this.readFolderSharing(campaignId, rawItemId, actor);
  }

  private async readFolderSharing(campaignId: string, rawItemId: string, actor: ActorContext) {
    this.authorization.requireView(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed || item.mimeType !== FOLDER_MIME_TYPE) throw new BadRequestException('Chỉ chia sẻ thư mục đang sử dụng.');
    const permissions = await this.google.withAccessToken(actor, (token) => this.drive.listPermissions(token, itemId));
    return { folderId: itemId, folderName: item.name,
      link: item.webViewLink ?? `https://drive.google.com/drive/folders/${encodeURIComponent(itemId)}`,
      googleCanShare: item.capabilities.canShare,
      limitedAccess: Boolean(item.inheritedPermissionsDisabled),
      canLimitAccess: Boolean(item.capabilities.canDisableInheritedPermissions), permissions };
  }

  async setFolderGeneralAccess(campaignId: string, rawItemId: string,
    access: 'RESTRICTED' | 'ANYONE', role: 'reader' | 'commenter' | 'writer' | undefined,
    confirmLimitInheritedAccess: boolean, actor: ActorContext) {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed || item.mimeType !== FOLDER_MIME_TYPE || !item.capabilities.canShare) {
      throw new ForbiddenException('Tài khoản Google không có quyền chia sẻ thư mục này.');
    }
    if (access === 'ANYONE' && !role) throw new BadRequestException('Hãy chọn quyền Người xem, Người nhận xét hoặc Người chỉnh sửa.');
    const permissions = await this.google.withAccessToken(actor, (token) => this.drive.listPermissions(token, itemId));
    const direct = permissions.find((permission) => permission.type === 'anyone' && (permission.directRole || !permission.inherited));
    const inherited = item.inheritedPermissionsDisabled ? [] : permissions.filter((permission) => permission.type === 'anyone' && permission.inheritedRole);
    const inheritedRank = Math.max(0, ...inherited.map((permission) => GENERAL_ROLE_RANK[permission.inheritedRole as keyof typeof GENERAL_ROLE_RANK] ?? 3));
    const mustLimit = !item.inheritedPermissionsDisabled && inheritedRank > (access === 'RESTRICTED' ? 0 : GENERAL_ROLE_RANK[role!]);
    if (mustLimit) {
      if (!item.capabilities.canDisableInheritedPermissions) {
        throw new ForbiddenException('Quyền link đang kế thừa từ thư mục cha. Cần quyền Manager của Shared Drive để bật quyền truy cập giới hạn cho riêng thư mục này.');
      }
      if (!confirmLimitInheritedAccess) {
        throw new BadRequestException('Cần xác nhận việc giới hạn quyền kế thừa; người có quyền từ thư mục cha có thể mất quyền mở thư mục này.');
      }
      const limited = await this.google.withAccessToken(actor, (token) =>
        this.drive.setInheritedPermissionsDisabled({ accessToken: token, fileId: itemId, disabled: true }));
      if (limited.id !== itemId || !limited.inheritedPermissionsDisabled) throw new ConflictException('Google Drive chưa xác nhận quyền truy cập giới hạn.');
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_inheritance_limited',
        { folderId: itemId, result: 'SUCCESS' });
    }
    if (access === 'RESTRICTED') {
      if (direct) {
        await this.google.withAccessToken(actor, (token) => this.drive.deletePermission({ accessToken: token, fileId: itemId, permissionId: direct.id }));
        await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_general_access_restricted',
          { folderId: itemId, permissionId: direct.id, oldRole: direct.directRole ?? direct.role, result: 'SUCCESS' });
      }
    } else if (direct && direct.directRole !== role) {
      await this.google.withAccessToken(actor, (token) => this.drive.updatePermission({ accessToken: token, fileId: itemId, permissionId: direct.id, role: role! }));
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_general_access_updated',
        { folderId: itemId, permissionId: direct.id, oldRole: direct.directRole ?? direct.role, newRole: role, result: 'SUCCESS' });
    } else if (!direct && (mustLimit || inheritedRank !== GENERAL_ROLE_RANK[role!])) {
      const created = await this.google.withAccessToken(actor, (token) => this.drive.createPermission({ accessToken: token, fileId: itemId,
        type: 'anyone', role: role! }));
      await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_general_access_created',
        { folderId: itemId, permissionId: created.id, role, result: 'SUCCESS' });
    }
    return this.readFolderSharing(campaignId, itemId, actor);
  }

  async createFolderPermission(campaignId: string, rawItemId: string, type: 'user' | 'anyone',
    role: 'reader' | 'commenter' | 'writer', emailAddress: string | undefined, actor: ActorContext) {
    this.authorization.requireManage(actor);
    if (type === 'anyone') throw new ForbiddenException('Quyền truy cập bằng link được quản lý tại thư mục cha trên Google Drive; CPMS không mở quyền công khai riêng cho thư mục Chiến dịch.');
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed || item.mimeType !== FOLDER_MIME_TYPE || !item.capabilities.canShare) throw new ForbiddenException('Tài khoản Google không có quyền chia sẻ thư mục này.');
    const normalizedEmail = emailAddress?.trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new BadRequestException('Email chia sẻ không hợp lệ.');
    const existing = await this.google.withAccessToken(actor, (token) => this.drive.listPermissions(token, itemId));
    if (existing.some((permission) => !permission.inherited && permission.type === 'user' &&
      permission.emailAddress?.toLowerCase() === normalizedEmail)) {
      throw new ConflictException('Quyền này đã có. Hãy cập nhật quyền hiện tại nếu được phép.');
    }
    const created = await this.google.withAccessToken(actor, (token) => this.drive.createPermission({ accessToken: token, fileId: itemId,
      type, role, emailAddress: normalizedEmail }));
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_folder_permission_created', { folderId: itemId,
      permissionId: created.id, type, role, emailAddress: normalizedEmail, result: 'SUCCESS' });
    return this.readFolderSharing(campaignId, itemId, actor);
  }

  async changeFolderPermission(campaignId: string, rawItemId: string, rawPermissionId: string,
    role: 'reader' | 'commenter' | 'writer' | null, actor: ActorContext) {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const permissionId = validDriveId(rawPermissionId);
    const { item } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed || item.mimeType !== FOLDER_MIME_TYPE || !item.capabilities.canShare) throw new ForbiddenException('Tài khoản Google không có quyền chia sẻ thư mục này.');
    const existing = await this.google.withAccessToken(actor, (token) => this.drive.listPermissions(token, itemId));
    const permission = existing.find((candidate) => candidate.id === permissionId);
    if (!permission || permission.inherited || permission.type !== 'user' ||
      !['reader', 'commenter', 'writer'].includes(permission.role)) {
      throw new ForbiddenException('Chỉ thay đổi quyền trực tiếp do thư mục này cấp. Quyền kế thừa cần sửa ở thư mục cha trên Google Drive.');
    }
    if (role) await this.google.withAccessToken(actor, (token) => this.drive.updatePermission({ accessToken: token, fileId: itemId, permissionId, role }));
    else await this.google.withAccessToken(actor, (token) => this.drive.deletePermission({ accessToken: token, fileId: itemId, permissionId }));
    await this.repository.recordAudit(actor, campaignId, role ? 'campaign.drive_folder_permission_updated' : 'campaign.drive_folder_permission_removed',
      { folderId: itemId, permissionId, type: permission.type, emailAddress: permission.emailAddress, oldRole: permission.role, newRole: role, result: 'SUCCESS' });
    return this.readFolderSharing(campaignId, itemId, actor);
  }

  async trashEntry(campaignId: string, rawItemId: string, actor: ActorContext): Promise<CampaignDriveEntryItem> {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item, parentId } = await this.requireEntry(actor, workspace, itemId);
    if (item.trashed) return this.toEntryItem(item, parentId);
    if (!item.capabilities.canTrash) throw new ForbiddenException('Tài khoản Google không có quyền đưa mục này vào Thùng rác.');
    const trashed = await this.google.withAccessToken(actor, (token) => this.drive.setTrashed({ accessToken: token, fileId: itemId, trashed: true }));
    if (trashed.id !== itemId || !trashed.trashed || !trashed.parents.includes(parentId)) throw new ConflictException('Google Drive chưa xác nhận mục đã vào Thùng rác.');
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_entry_trashed', { itemId, parentId, name: item.name,
      isFolder: item.mimeType === GOOGLE_FOLDER_MIME_TYPE, isShortcut: item.mimeType === SHORTCUT_MIME_TYPE, result: 'SUCCESS' });
    return this.toEntryItem(trashed, parentId);
  }

  async restoreEntry(campaignId: string, rawItemId: string, actor: ActorContext): Promise<CampaignDriveEntryItem> {
    this.authorization.requireManage(actor);
    const workspace = await this.requireWorkspace(campaignId);
    const itemId = validDriveId(rawItemId);
    const { item, parentId } = await this.requireEntry(actor, workspace, itemId);
    if (!item.trashed) return this.toEntryItem(item, parentId);
    if (!item.capabilities.canUntrash) throw new ForbiddenException('Tài khoản Google không có quyền phục hồi mục này.');
    let restored = await this.google.withAccessToken(actor, (token) => this.drive.setTrashed({ accessToken: token, fileId: itemId, trashed: false }));
    if (restored.id !== itemId || restored.trashed) throw new ConflictException('Google Drive chưa xác nhận mục đã được phục hồi.');
    if (!restored.parents.includes(parentId)) {
      if (!restored.capabilities.canMoveItemWithinDrive) throw new ConflictException('Mục đã phục hồi nhưng không thể đưa về thư mục cũ.');
      restored = await this.google.withAccessToken(actor, (token) => this.drive.moveItem({ accessToken: token, fileId: itemId, fromParentIds: restored.parents, toParentId: parentId }));
    }
    if (!restored.parents.includes(parentId)) throw new ConflictException('Mục đã phục hồi nhưng không nằm trong thư mục cũ.');
    await this.repository.recordAudit(actor, campaignId, 'campaign.drive_entry_restored', { itemId, parentId, name: item.name, result: 'SUCCESS' });
    return this.toEntryItem(restored, parentId);
  }

  private toEntryItem(item: CloudDriveItem, folderId: string): CampaignDriveEntryItem {
    return { id: item.id, name: item.name, folderId, isFolder: item.mimeType === GOOGLE_FOLDER_MIME_TYPE,
      isShortcut: item.mimeType === SHORTCUT_MIME_TYPE, shortcutTargetMimeType: item.shortcutDetails?.targetMimeType ?? null,
      status: item.trashed ? 'TRASHED' : 'ACTIVE', mimeType: item.mimeType, size: item.size,
      modifiedTime: item.modifiedTime, lastModifiedBy: item.lastModifiedBy, trashedAt: item.trashedTime,
      trashedBy: item.trashedBy, webViewLink: item.webViewLink, webContentLink: item.webContentLink,
      canEdit: item.capabilities.canEdit, canTrash: item.capabilities.canTrash,
      canUntrash: item.capabilities.canUntrash, canDownload: item.capabilities.canDownload };
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
       await this.google.withAccessToken(actor, (accessToken) => folderChainToRoot(this.drive, accessToken, item.id, configuration.parentFolderId, configuration.sharedDriveId, false));
       const children = workspace.templateVersion >= 2 ? null : await this.google.withAccessToken(actor, (accessToken) => this.restoreChildren(accessToken, campaign, workspace, item));
      await this.repository.save({
        ...workspace,
        lifecycleStatus: 'ACTIVE',
        syncStatus: item.name === this.expectedFolderName(campaign) ? 'READY' : 'NEEDS_SYNC',
        lastKnownFolderName: item.name,
         baseDocumentsFolderId: children?.BASE_DOCUMENTS.id ?? null,
         mediaAssetsFolderId: children?.MEDIA_ASSETS.id ?? null,
         otherDocumentsFolderId: children?.OTHER_DOCUMENTS.id ?? null,
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
      if (workspace.templateVersion >= 2) await folderChainToRoot(this.drive, accessToken, folder.id, configuration.parentFolderId, configuration.sharedDriveId, false);
      else this.validateCampaignFolder(folder, configuration.sharedDriveId, configuration.parentFolderId);
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

  private async requireEmptyLinkedFolder(accessToken: string, campaign: CampaignSummary, workspace: CampaignDriveWorkspaceRecord) {
    const configuration = this.requireDriveConfiguration();
    if (!workspace.campaignFolderId || workspace.sharedDriveId !== configuration.sharedDriveId || workspace.parentFolderId !== configuration.parentFolderId) {
      throw new ConflictException('Liên kết Drive hiện tại không thuộc cấu hình Chiến dịch đang dùng.');
    }
    const childIds = [workspace.baseDocumentsFolderId, workspace.mediaAssetsFolderId, workspace.otherDocumentsFolderId];
    if (childIds.some((id) => !id) || new Set(childIds).size !== CAMPAIGN_DRIVE_FOLDER_KEYS.length) {
      throw new ConflictException('Chỉ có thể thay thế folder do CPMS đã tạo đủ ba thư mục con và còn trống.');
    }
    const root = await this.drive.getItem(accessToken, workspace.campaignFolderId);
    this.validateCampaignFolder(root, configuration.sharedDriveId, configuration.parentFolderId);
    if (root.name !== this.expectedFolderName(campaign) || !root.capabilities.canTrash) {
      throw new ConflictException('Folder Drive đang liên kết đã thay đổi tên hoặc không thể chuyển vào Thùng rác.');
    }
    for (const trashed of [false, true]) {
      const page = await this.drive.listFiles({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: root.id, trashed, pageSize: 100 });
      if (page.nextPageToken || page.items.some((item) => trashed || !childIds.includes(item.id))) {
        throw new ConflictException('Folder Drive hiện tại có dữ liệu; không thể tự động thay thế.');
      }
    }
    for (const [index, key] of CAMPAIGN_DRIVE_FOLDER_KEYS.entries()) {
      const childId = childIds[index]!;
      const child = await this.drive.getItem(accessToken, childId);
      this.validateChildFolder(child, configuration.sharedDriveId, root.id);
      if (child.name !== `${campaign.code} ${FOLDER_LABELS[key]}`) {
        throw new ConflictException('Cấu trúc folder Drive hiện tại đã thay đổi; không thể tự động thay thế.');
      }
      for (const trashed of [false, true]) {
        const page = await this.drive.listFiles({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: childId, trashed, pageSize: 1 });
        if (page.items.length || page.nextPageToken) throw new ConflictException('Folder Drive hiện tại có dữ liệu; không thể tự động thay thế.');
      }
    }
    return root;
  }

  private async legacyChildFolderRenames(accessToken: string, campaign: CampaignSummary, folderId: string) {
    const configuration = this.requireDriveConfiguration();
    const page = await this.drive.listFiles({ accessToken, sharedDriveId: configuration.sharedDriveId, parentFolderId: folderId, trashed: false, pageSize: 100 });
    if (page.nextPageToken) throw new ConflictException('Folder nguồn có quá nhiều mục để kiểm tra cấu trúc an toàn.');
    const campaignPrefix = campaign.code.slice(0, -4);
    const renames: ExistingFolderPreview['childFolderRenames'] = [];
    for (const key of CAMPAIGN_DRIVE_FOLDER_KEYS) {
      const labels = key === 'OTHER_DOCUMENTS' ? [FOLDER_LABELS[key], 'Chứng từ khác'] : [FOLDER_LABELS[key]];
      const expectedName = `${campaign.code} ${FOLDER_LABELS[key]}`;
      const candidates = page.items.filter((item) => item.mimeType === FOLDER_MIME_TYPE && labels.some((label) =>
        item.name === expectedName || (item.name.startsWith(campaignPrefix) && /^[A-Z0-9]{4}$/.test(item.name.slice(campaignPrefix.length, -label.length - 1)) && item.name.endsWith(` ${label}`))));
      if (candidates.length > 1) throw new ConflictException(`Có nhiều thư mục con cho “${FOLDER_LABELS[key]}”; hãy xử lý trên Drive trước.`);
      if (!candidates[0]) continue;
      this.validateChildFolder(candidates[0], configuration.sharedDriveId, folderId);
      if (candidates[0].name !== expectedName) {
        if (!candidates[0].capabilities.canEdit) throw new ForbiddenException(`Không có quyền đổi tên thư mục con “${candidates[0].name}”.`);
        renames.push({ folderId: candidates[0].id, currentName: candidates[0].name, expectedName });
      }
    }
    return renames;
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
      campaignFolderId: canView ? workspace?.campaignFolderId ?? null : null,
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
