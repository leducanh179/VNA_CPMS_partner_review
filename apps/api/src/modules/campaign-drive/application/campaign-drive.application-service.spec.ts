import { DEMO_ACTOR, type ActorContext, type CampaignDriveSyncStatus, type CampaignSummary } from '@cpms/domain';
import type { CloudDriveItem, CloudDrivePermission, CloudDrivePort } from '@cpms/integrations';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { Environment } from '../../../config/environment';
import type { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import type { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';
import { CampaignDriveAuthorizationService } from './campaign-drive-authorization.service';
import { CampaignDriveApplicationService } from './campaign-drive.application-service';
import type { CampaignDriveRepository, CampaignDriveWorkspaceRecord } from './campaign-drive.repository';

const SHARED_DRIVE_ID = 'example-shared-drive-id';
const PARENT_FOLDER_ID = 'example-parent-folder-id';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';

const campaign: CampaignSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  code: 'CPG-202609-QA01',
  name: 'Chiến dịch thử nghiệm Đà Nẵng',
  requestingUnit: '',
  lifecycleState: 'DRAFT',
  startDate: null,
  endDate: null,
  effectiveStartDate: null,
  effectiveEndDate: null,
  levelCode: 'CLV_01',
  levelLabel: 'Cấp 1',
  levelRuleDescription: null,
  requestingEmployeeCode: null,
  requestingEmployeeName: null,
  manualRequesterEmail: null,
  primaryObjectiveCode: null,
  primaryObjectiveLabel: null,
  primaryObjectiveOther: null,
  kpiText: null,
  descriptionRichText: null,
  additionalInformation: [],
  dataSchemaVersion: 2,
  normalizationStatus: 'NORMALIZED',
  normalizationWarnings: [],
  markets: [],
  requestingUnits: [],
  fieldValues: {},
  recordVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedByActorId: null,
  updatedAt: new Date(0).toISOString(),
};

function driveItem(id: string, name: string, parentId: string, overrides: Partial<CloudDriveItem> = {}): CloudDriveItem {
  return {
    id,
    name,
    mimeType: FOLDER_MIME_TYPE,
    driveId: SHARED_DRIVE_ID,
    parents: [parentId],
    trashed: false,
    trashedTime: null,
    trashedBy: null,
    size: null,
    modifiedTime: new Date(0).toISOString(),
    lastModifiedBy: 'QA Google',
    webViewLink: `https://drive.google.com/open?id=${id}`,
    webContentLink: null,
    shortcutDetails: null,
    capabilities: { canEdit: true, canTrash: true, canUntrash: true, canMoveItemWithinDrive: true, canDownload: true, canAddChildren: true, canShare: true },
    ...overrides,
  };
}

class FakeConfig {
  values: Partial<Environment> = {
    GOOGLE_DRIVE_SHARED_DRIVE_ID: SHARED_DRIVE_ID,
    GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID: PARENT_FOLDER_ID,
    GOOGLE_DRIVE_ACCESS_MODE: 'CPMS_VISIBILITY_ONLY',
    GOOGLE_DRIVE_SHARING_MODE: 'PARENT_INHERITED',
    GOOGLE_DRIVE_UPLOAD_MAX_BYTES: 50 * 1024 * 1024,
    GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES: 5 * 1024 * 1024,
  };
  get(key: keyof Environment) { return this.values[key]; }
}

class FakeGoogle {
  connected = true;
  scopes = ['https://www.googleapis.com/auth/drive'];
  async status() { return { configured: true, connected: this.connected, callbackUrl: null, account: { subject: 'google-sub', email: 'qa@example.com', name: 'QA' }, grantedScopes: this.scopes, message: null }; }
  async withAccessToken<T>(_actor: ActorContext, operation: (accessToken: string) => Promise<T>) { return operation('access-token-not-exposed'); }
}

class FakeDrive implements CloudDrivePort {
  items = new Map<string, CloudDriveItem>();
  constructor() { this.items.set(PARENT_FOLDER_ID, driveItem(PARENT_FOLDER_ID, 'DATABASE_CAMPAIGNS', SHARED_DRIVE_ID)); }
  createdNames: string[] = [];
  permissions = new Map<string, CloudDrivePermission[]>();
  limitedFolders: string[] = [];
  trashCalls: Array<{ id: string; trashed: boolean }> = [];
  moveCalls: Array<{ id: string; fromParentIds: string[]; toParentId: string }> = [];
  restoreToWrongParentId: string | null = null;
  uploadParents: string[] = [];
  uploadNames: string[] = [];
  renameNames: string[] = [];
  downloadCalls: string[] = [];
  resourceKeyReads: Array<{ fileId: string; resourceKey?: string }> = [];
  orderByCalls: string[] = [];
  content = new Map<string, Uint8Array>();
  nextId = 1;

  async getItem(_accessToken: string, fileId: string, resourceKey?: string) {
    this.resourceKeyReads.push({ fileId, resourceKey });
    const item = this.items.get(fileId);
    if (!item) throw new Error('missing');
    return structuredClone(item);
  }
  async findFolders(input: { parentFolderId: string; nameContains?: string; exactName?: string }) {
    return [...this.items.values()].filter((item) => item.mimeType === FOLDER_MIME_TYPE && !item.trashed && item.parents.includes(input.parentFolderId) && (input.exactName ? item.name === input.exactName : input.nameContains ? item.name.includes(input.nameContains) : true)).map((item) => structuredClone(item));
  }
  async createFolder(input: { parentFolderId: string; name: string }) {
    const item = driveItem(`drive-folder-${this.nextId++}`, input.name, input.parentFolderId);
    this.items.set(item.id, item);
    this.createdNames.push(input.name);
    return structuredClone(item);
  }
  async renameItem(input: { fileId: string; name: string }) {
    this.renameNames.push(input.name);
    const item = await this.getItem('', input.fileId);
    const renamed = { ...item, name: input.name };
    this.items.set(item.id, renamed);
    return structuredClone(renamed);
  }
  async setTrashed(input: { fileId: string; trashed: boolean }) {
    const item = await this.getItem('', input.fileId);
    const changed = {
      ...item,
      trashed: input.trashed,
      parents: !input.trashed && this.restoreToWrongParentId ? [this.restoreToWrongParentId] : item.parents,
      trashedTime: input.trashed ? new Date('2026-09-03T00:00:00.000Z').toISOString() : null,
      trashedBy: input.trashed ? 'QA Google' : null,
    };
    this.items.set(item.id, changed);
    this.trashCalls.push({ id: item.id, trashed: input.trashed });
    return structuredClone(changed);
  }
  async moveItem(input: { fileId: string; fromParentIds: string[]; toParentId: string }) {
    const item = await this.getItem('', input.fileId);
    const moved = { ...item, parents: [input.toParentId] };
    this.items.set(item.id, moved);
    this.moveCalls.push({ id: item.id, fromParentIds: input.fromParentIds, toParentId: input.toParentId });
    return structuredClone(moved);
  }
  async listFiles(input: { parentFolderId: string; trashed: boolean; pageToken?: string; pageSize: number; orderBy?: string; uploadId?: string }) {
    if (input.orderBy) this.orderByCalls.push(input.orderBy);
    const all = [...this.items.values()].filter((item) => item.trashed === input.trashed && item.parents.includes(input.parentFolderId) &&
      (!input.uploadId || item.uploadId === input.uploadId));
    const start = input.pageToken ? Number(input.pageToken) : 0;
    return { items: all.slice(start, start + input.pageSize).map((item) => structuredClone(item)), nextPageToken: start + input.pageSize < all.length ? String(start + input.pageSize) : null };
  }
  async downloadFile(input: { fileId: string; maxBytes: number }) {
    this.downloadCalls.push(input.fileId);
    const bytes = this.content.get(input.fileId) ?? Buffer.from(input.fileId);
    if (bytes.byteLength > input.maxBytes) throw new Error('limit');
    return bytes;
  }
  async listPermissions(_accessToken: string, fileId: string) { return structuredClone(this.permissions.get(fileId) ?? []); }
  async setInheritedPermissionsDisabled(input: { fileId: string; disabled: boolean }) {
    const item = await this.getItem('', input.fileId);
    const updated = { ...item, inheritedPermissionsDisabled: input.disabled };
    this.items.set(input.fileId, updated);
    this.limitedFolders.push(input.fileId);
    return structuredClone(updated);
  }
  async createLinkWriterPermission(_accessToken: string, fileId: string) {
    const permission: CloudDrivePermission = { id: `permission-${fileId}`, type: 'anyone', role: 'writer', emailAddress: null, displayName: null,
      allowFileDiscovery: false, inherited: false };
    this.permissions.set(fileId, [permission]);
    return permission;
  }
  async createPermission(input: { fileId: string; type: 'user' | 'anyone'; role: 'reader' | 'commenter' | 'writer'; emailAddress?: string }) {
    const permission: CloudDrivePermission = { id: `permission-${this.nextId++}`, type: input.type, role: input.role,
      emailAddress: input.emailAddress ?? null, displayName: null, allowFileDiscovery: false, inherited: false };
    this.permissions.set(input.fileId, [...(this.permissions.get(input.fileId) ?? []), permission]);
    return permission;
  }
  async updatePermission(input: { fileId: string; permissionId: string; role: 'reader' | 'commenter' | 'writer' }) {
    const next = (this.permissions.get(input.fileId) ?? []).map((permission) => permission.id === input.permissionId ? { ...permission, role: input.role } : permission);
    this.permissions.set(input.fileId, next);
    return next.find((permission) => permission.id === input.permissionId)!;
  }
  async deletePermission(input: { fileId: string; permissionId: string }) {
    this.permissions.set(input.fileId, (this.permissions.get(input.fileId) ?? []).filter((permission) => permission.id !== input.permissionId));
  }
  async upload(input: { parentFolderId: string; name: string; mimeType: string; content: Uint8Array; resumableThresholdBytes: number; uploadId?: string }) {
    this.uploadParents.push(input.parentFolderId);
    this.uploadNames.push(input.name);
    const item = driveItem(`drive-file-${this.nextId++}`, input.name, input.parentFolderId, { mimeType: input.mimeType, size: input.content.byteLength,
      uploadId: input.uploadId ?? null });
    this.items.set(item.id, item);
    return { item, mode: input.content.byteLength >= input.resumableThresholdBytes ? 'RESUMABLE' as const : 'MULTIPART' as const };
  }
}

class FakeRepository implements CampaignDriveRepository {
  workspace: CampaignDriveWorkspaceRecord | null = null;
  audits: Array<{ actor: ActorContext; campaignId: string; action: string; payload: Record<string, unknown> }> = [];
  async get() { return this.workspace ? structuredClone(this.workspace) : null; }
  async findByFolderId(folderId: string) { return this.workspace?.campaignFolderId === folderId ? structuredClone(this.workspace) : null; }
  async save(record: Omit<CampaignDriveWorkspaceRecord, 'createdAt' | 'updatedAt'>) {
    const now = new Date();
    this.workspace = { ...record, createdAt: this.workspace?.createdAt ?? now, updatedAt: now };
    return structuredClone(this.workspace);
  }
  async recordAudit(actor: ActorContext, campaignId: string, action: string, payload: Record<string, unknown>) { this.audits.push({ actor, campaignId, action, payload }); }
}

function services(customCampaign: CampaignSummary = campaign) {
  const config = new FakeConfig();
  const google = new FakeGoogle();
  const drive = new FakeDrive();
  const repository = new FakeRepository();
  const campaigns = { get: async () => structuredClone(customCampaign) } as unknown as CampaignApplicationService;
  const service = new CampaignDriveApplicationService(config as never, campaigns, google as unknown as GoogleIntegrationApplicationService, drive, repository, new CampaignDriveAuthorizationService());
  return { config, google, drive, repository, service };
}

describe('CampaignDriveApplicationService', () => {
  it('identifies shortcuts, checks a target without exposing its ID, and trashes only the shortcut', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const target = driveItem('shortcut-target-file', 'Mục gốc.pdf', PARENT_FOLDER_ID, { mimeType: 'application/pdf' });
    const shortcut = driveItem('campaign-shortcut-01', 'Lối tắt mục gốc', rootId, {
      mimeType: SHORTCUT_MIME_TYPE,
      shortcutDetails: { targetId: target.id, targetMimeType: target.mimeType, targetResourceKey: 'resource-key' },
    });
    drive.items.set(target.id, target);
    drive.items.set(shortcut.id, shortcut);

    const listing = await service.listFolder(campaign.id, rootId, 'ACTIVE', undefined, DEMO_ACTOR);
    const entry = listing.items.find((item) => item.id === shortcut.id)!;
    expect(entry).toMatchObject({ isShortcut: true, isFolder: false, shortcutTargetMimeType: 'application/pdf' });
    expect(JSON.stringify(entry)).not.toContain(target.id);
    expect(JSON.stringify(entry)).not.toContain('resource-key');
    expect(await service.shortcutTargetStatus(campaign.id, shortcut.id, DEMO_ACTOR)).toEqual({ status: 'ACTIVE' });
    expect(drive.resourceKeyReads.at(-1)).toEqual({ fileId: target.id, resourceKey: 'resource-key' });
    await expect(service.downloadEntries(campaign.id, rootId, [shortcut.id], DEMO_ACTOR)).rejects.toThrow('Không thể tải lối tắt');
    expect(drive.downloadCalls).toHaveLength(0);

    await service.trashEntry(campaign.id, shortcut.id, DEMO_ACTOR);
    expect(drive.trashCalls.at(-1)).toEqual({ id: shortcut.id, trashed: true });
    expect(drive.items.get(target.id)?.trashed).toBe(false);
    expect(repository.audits.at(-1)?.payload).toMatchObject({ itemId: shortcut.id, isShortcut: true });
  });

  it('distinguishes a trashed shortcut target from an unavailable one and rejects out-of-scope probes', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const target = driveItem('shortcut-target-trashed', 'Đã bỏ.pdf', PARENT_FOLDER_ID, { mimeType: 'application/pdf', trashed: true });
    const shortcut = driveItem('campaign-shortcut-02', 'Lối tắt đã hỏng', rootId, {
      mimeType: SHORTCUT_MIME_TYPE,
      shortcutDetails: { targetId: target.id, targetMimeType: target.mimeType, targetResourceKey: null },
    });
    const outside = driveItem('outside-shortcut-01', 'Ngoài Chiến dịch', PARENT_FOLDER_ID, {
      mimeType: SHORTCUT_MIME_TYPE, shortcutDetails: shortcut.shortcutDetails,
    });
    for (const item of [target, shortcut, outside]) drive.items.set(item.id, item);
    expect(await service.shortcutTargetStatus(campaign.id, shortcut.id, DEMO_ACTOR)).toEqual({ status: 'TRASHED' });
    await expect(service.shortcutTargetStatus(campaign.id, outside.id, DEMO_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    drive.items.delete(target.id);
    drive.getItem = async (_token, fileId) => {
      const item = drive.items.get(fileId);
      if (!item) throw new NotFoundException('missing');
      return structuredClone(item);
    };
    expect(await service.shortcutTargetStatus(campaign.id, shortcut.id, DEMO_ACTOR)).toEqual({ status: 'UNAVAILABLE' });
  });

  it('downloads an original file or a complete ZIP of selected nested folders without mutating Drive', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const folder = driveItem('selected-folder-0001', 'Tư liệu thêm', rootId);
    const subfolder = driveItem('nested-folder-00001', 'Ảnh', folder.id);
    const nestedFile = driveItem('nested-file-000001', 'Ảnh.png', subfolder.id, { mimeType: 'image/png', size: 3 });
    const rootFile = driveItem('root-file-00000001', 'Thông báo.pdf', rootId, { mimeType: 'application/pdf', size: 3 });
    for (const item of [folder, subfolder, nestedFile, rootFile]) drive.items.set(item.id, item);
    drive.content.set(nestedFile.id, Buffer.from('PNG'));
    drive.content.set(rootFile.id, Buffer.from('PDF'));
    const single = await service.downloadEntries(campaign.id, rootId, [rootFile.id], DEMO_ACTOR);
    expect(single).toMatchObject({ filename: 'Thông báo.pdf', mimeType: 'application/pdf' });
    expect(single.content.toString()).toBe('PDF');
    const archive = await service.downloadEntries(campaign.id, rootId, [folder.id, rootFile.id], DEMO_ACTOR);
    const zip = await JSZip.loadAsync(archive.content);
    expect(archive.mimeType).toBe('application/zip');
    expect((await zip.file('Tư liệu thêm/Ảnh/Ảnh.png')!.async('string'))).toBe('PNG');
    expect((await zip.file('Thông báo.pdf')!.async('string'))).toBe('PDF');
    expect(drive.trashCalls).toHaveLength(0);
    expect(drive.downloadCalls).toEqual([rootFile.id, nestedFile.id, rootFile.id]);
  });

  it('rejects out-of-folder, trashed and non-downloadable selections before returning a ZIP', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const outside = driveItem('outside-file-000001', 'Ngoài.pdf', PARENT_FOLDER_ID, { mimeType: 'application/pdf' });
    const blocked = driveItem('blocked-file-00001', 'Không cho tải.pdf', rootId, { mimeType: 'application/pdf', capabilities: { ...outside.capabilities, canDownload: false } });
    const trashed = driveItem('trashed-file-00001', 'Đã xóa.pdf', rootId, { mimeType: 'application/pdf', trashed: true });
    for (const item of [outside, blocked, trashed]) drive.items.set(item.id, item);
    await expect(service.downloadEntries(campaign.id, rootId, [outside.id], DEMO_ACTOR)).rejects.toThrow('thư mục Chiến dịch đang mở');
    await expect(service.downloadEntries(campaign.id, rootId, [blocked.id], DEMO_ACTOR)).rejects.toThrow('Không có quyền tải');
    await expect(service.downloadEntries(campaign.id, rootId, [trashed.id], DEMO_ACTOR)).rejects.toThrow('đang sử dụng');
    expect(drive.downloadCalls).toHaveLength(0);
  });

  it('passes an allowlisted sort through the whole Drive folder listing', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    await service.listFolder(campaign.id, repository.workspace!.campaignFolderId, 'ACTIVE', undefined, DEMO_ACTOR, 'UPDATED', 'DESC');
    expect(drive.orderByCalls.at(-1)).toBe('folder,modifiedTime desc,name_natural');
  });

  it('browses and edits nested folders while denying items outside the linked campaign root', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const nested = await service.createSubfolder(campaign.id, rootId, 'Bài PR', DEMO_ACTOR);
    expect(nested.isFolder).toBe(true);
    const uploaded = await service.uploadToFolder(campaign.id, nested.id,
      { originalname: 'Bản tin.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('PDF') }, DEMO_ACTOR);
    const listing = await service.listFolder(campaign.id, nested.id, 'ACTIVE', undefined, DEMO_ACTOR);
    expect(drive.orderByCalls.at(-1)).toBe('folder,name_natural');
    expect(listing.breadcrumbs.map((part) => part.id)).toEqual([rootId, nested.id]);
    expect(listing.items.map((item) => item.id)).toEqual([uploaded.file.id]);
    await service.renameEntry(campaign.id, uploaded.file.id, 'Bản tin mới.pdf', DEMO_ACTOR);
    await service.trashEntry(campaign.id, uploaded.file.id, DEMO_ACTOR);
    expect((await service.listFolder(campaign.id, nested.id, 'TRASHED', undefined, DEMO_ACTOR)).items).toHaveLength(1);
    await service.restoreEntry(campaign.id, uploaded.file.id, DEMO_ACTOR);
    await expect(service.trashEntry(campaign.id, rootId, DEMO_ACTOR)).rejects.toThrow('thư mục gốc');
    const outside = driveItem('outside-folder-12345', 'Ngoài Chiến dịch', PARENT_FOLDER_ID);
    drive.items.set(outside.id, outside);
    await expect(service.listFolder(campaign.id, outside.id, 'ACTIVE', undefined, DEMO_ACTOR)).rejects.toThrow('ngoài phạm vi');
  });

  it('keeps adopted folder contents unchanged during later ensure calls', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const adopted = driveItem('adopted-folder-12345', `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID);
    drive.items.set(adopted.id, adopted);
    await repository.save({ ...repository.workspace!, campaignFolderId: adopted.id,
      campaignFolderLink: `https://drive.google.com/drive/folders/${adopted.id}`, templateVersion: 2,
      baseDocumentsFolderId: null, mediaAssetsFolderId: null, otherDocumentsFolderId: null });
    const countBefore = drive.createdNames.length;
    await service.ensure(campaign.id, DEMO_ACTOR);
    expect(drive.createdNames).toHaveLength(countBefore);
    expect(repository.workspace?.baseDocumentsFolderId).toBeNull();
    expect((await service.listFolder(campaign.id, adopted.id, 'ACTIVE', undefined, DEMO_ACTOR)).items).toHaveLength(0);
  });
  it('creates the exact Vietnamese folder template without adding a public permission and remains idempotent', async () => {
    const { service, drive, repository } = services();
    const first = await service.ensure(campaign.id, DEMO_ACTOR);
    expect(first.syncStatus).toBe('READY');
    expect(drive.createdNames).toEqual([
      `${campaign.code} ${campaign.name}`,
      `${campaign.code} Văn bản cơ sở`,
      `${campaign.code} Tư liệu QCTT`,
      `${campaign.code} Tài liệu khác`,
    ]);
    expect(drive.createdNames).toHaveLength(4);
    const folderId = repository.workspace?.campaignFolderId;
    expect(repository.workspace?.campaignFolderLink).toBe(`https://drive.google.com/drive/folders/${folderId}`);
    expect(folderId && drive.permissions.get(folderId)).toBeUndefined();

    await service.ensure(campaign.id, DEMO_ACTOR);
    expect(drive.createdNames).toHaveLength(4);
    expect(folderId && drive.permissions.get(folderId)).toBeUndefined();
  });

  it('previews a legacy folder name then adopts, renames and preserves existing files', async () => {
    const { service, drive, repository } = services();
    const root = driveItem('legacy-folder-123456', 'Folder chiến dịch cũ', PARENT_FOLDER_ID);
    const existingFile = driveItem('legacy-file-123456', 'Nội dung cũ.pdf', root.id, { mimeType: 'application/pdf' });
    drive.items.set(root.id, root);
    drive.items.set(existingFile.id, existingFile);
    const url = `https://drive.google.com/drive/folders/${root.id}`;
    const preview = await service.previewExistingFolder(campaign.id, url, DEMO_ACTOR);
    expect(preview).toMatchObject({ currentName: root.name, expectedName: `${campaign.code} ${campaign.name}`, willRename: true });
    expect(drive.renameNames).toEqual([]);
    const view = await service.adoptExistingFolder(campaign.id, url, preview.currentName, true, DEMO_ACTOR);
    expect(view.syncStatus).toBe('READY');
    expect(repository.workspace?.campaignFolderId).toBe(root.id);
    expect(drive.renameNames).toEqual([preview.expectedName]);
    expect(drive.items.get(existingFile.id)?.name).toBe('Nội dung cũ.pdf');
    expect(repository.audits.some((audit) => audit.action === 'campaign.drive_existing_folder_adopted')).toBe(true);
  });

  it('rejects legacy folders outside the parent and missing rename confirmation', async () => {
    const { service, drive } = services();
    const root = driveItem('legacy-folder-123456', 'Sai vị trí', 'different-parent-123456');
    drive.items.set(root.id, root);
    const url = `https://drive.google.com/drive/folders/${root.id}`;
    await expect(service.previewExistingFolder(campaign.id, url, DEMO_ACTOR)).rejects.toThrow('parent folder');
    await expect(service.adoptExistingFolder(campaign.id, url, root.name, false, DEMO_ACTOR)).rejects.toThrow('xác nhận');
  });

  it('relinks only an empty generated workspace, preserves legacy files and trashes the replaced template', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const previousId = repository.workspace!.campaignFolderId!;
    const source = driveItem('existing-source-folder', `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID);
    const base = driveItem('existing-source-base', `${campaign.code} Văn bản cơ sở`, source.id);
    const media = driveItem('existing-source-media', `${campaign.code} Tư liệu QCTT`, source.id);
    const other = driveItem('existing-source-other', `${campaign.code} Chứng từ khác`, source.id);
    const sourceFile = driveItem('existing-source-file', 'Tài liệu gốc.pdf', base.id, { mimeType: 'application/pdf' });
    for (const item of [source, base, media, other, sourceFile]) drive.items.set(item.id, item);
    const url = `https://drive.google.com/drive/folders/${source.id}`;
    const preview = await service.previewExistingFolder(campaign.id, url, DEMO_ACTOR);
    expect(preview.replacingFolderId).toBe(previousId);
    expect(preview.childFolderRenames).toEqual([{ folderId: other.id, currentName: other.name, expectedName: `${campaign.code} Tài liệu khác` }]);
    await expect(service.adoptExistingFolder(campaign.id, url, preview.currentName, true, DEMO_ACTOR)).rejects.toThrow('Liên kết Google Drive hiện tại');
    expect(repository.workspace?.campaignFolderId).toBe(previousId);

    const result = await service.adoptExistingFolder(campaign.id, url, preview.currentName, true, DEMO_ACTOR, previousId);
    expect(result.syncStatus).toBe('READY');
    expect(repository.workspace?.campaignFolderId).toBe(source.id);
    expect(repository.workspace?.baseDocumentsFolderId).toBe(base.id);
    expect(repository.workspace?.mediaAssetsFolderId).toBe(media.id);
    expect(repository.workspace?.otherDocumentsFolderId).toBe(other.id);
    expect(drive.items.get(sourceFile.id)?.name).toBe(sourceFile.name);
    expect(drive.items.get(previousId)?.trashed).toBe(true);
    expect(repository.audits.some((audit) => audit.action === 'campaign.drive_replaced_empty_folder_trashed')).toBe(true);
  });

  it('refuses to replace a linked workspace containing a file, including in a child folder', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const previousId = repository.workspace!.campaignFolderId!;
    const source = driveItem('existing-source-folder', `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID);
    drive.items.set(source.id, source);
    const file = driveItem('existing-user-file', 'Không được mất.pdf', repository.workspace!.mediaAssetsFolderId!, { mimeType: 'application/pdf' });
    drive.items.set(file.id, file);
    await expect(service.previewExistingFolder(campaign.id, `https://drive.google.com/drive/folders/${source.id}`, DEMO_ACTOR)).rejects.toThrow('có dữ liệu');
    expect(repository.workspace?.campaignFolderId).toBe(previousId);
    expect(drive.items.get(previousId)?.trashed).toBe(false);
  });

  it('recognizes exactly one folder by campaign code and creates only missing child folders', async () => {
    const { service, drive, repository } = services();
    const root = driveItem('existing-campaign-folder', `${campaign.code} Tên cũ`, PARENT_FOLDER_ID);
    const base = driveItem('existing-base-folder', `${campaign.code} Văn bản cơ sở`, root.id);
    drive.items.set(root.id, root);
    drive.items.set(base.id, base);
    const result = await service.ensure(campaign.id, DEMO_ACTOR);
    expect(result.syncStatus).toBe('NEEDS_SYNC');
    expect(repository.workspace?.campaignFolderId).toBe(root.id);
    expect(drive.createdNames).toEqual([`${campaign.code} Tư liệu QCTT`, `${campaign.code} Tài liệu khác`]);
  });

  it('accepts inherited Shared Drive Content manager access without creating duplicate permissions', async () => {
    const { service, drive, repository } = services();
    const root = driveItem('inherited-sharing-root', `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID);
    drive.items.set(root.id, root);
    drive.permissions.set(root.id, [{ id: 'anyoneWithLink', type: 'anyone', role: 'fileOrganizer', allowFileDiscovery: false, inherited: true }]);
    await service.ensure(campaign.id, DEMO_ACTOR);
    expect(repository.workspace?.permissionSyncStatus).toBe('SATISFIED_BY_INHERITED_POLICY');
    expect(repository.workspace?.googlePermissionId).toBe('anyoneWithLink');
    expect(drive.permissions.get(root.id)).toHaveLength(1);
  });

  it('marks multiple campaign folders and duplicated child folders as conflicts without choosing one', async () => {
    const duplicateCampaign = services();
    duplicateCampaign.drive.items.set('campaign-a', driveItem('campaign-a', `${campaign.code} A`, PARENT_FOLDER_ID));
    duplicateCampaign.drive.items.set('campaign-b', driveItem('campaign-b', `${campaign.code} B`, PARENT_FOLDER_ID));
    expect((await duplicateCampaign.service.ensure(campaign.id, DEMO_ACTOR)).syncStatus).toBe('CONFLICT');
    expect(duplicateCampaign.repository.workspace?.campaignFolderId).toBeNull();

    const duplicateChild = services();
    const root = driveItem('campaign-root', `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID);
    duplicateChild.drive.items.set(root.id, root);
    duplicateChild.drive.items.set('base-a', driveItem('base-a', `${campaign.code} Văn bản cơ sở`, root.id));
    duplicateChild.drive.items.set('base-b', driveItem('base-b', `${campaign.code} Văn bản cơ sở`, root.id));
    expect((await duplicateChild.service.ensure(campaign.id, DEMO_ACTOR)).syncStatus).toBe('CONFLICT');
  });

  it('validates stored folder type, trash state, Shared Drive and parent before reuse', async () => {
    const cases: Array<{ override: Partial<CloudDriveItem>; expected: CampaignDriveSyncStatus }> = [
      { override: { mimeType: 'application/pdf' }, expected: 'ERROR' },
      { override: { trashed: true }, expected: 'CONFLICT' },
      { override: { driveId: 'wrong-shared-drive' }, expected: 'CONFLICT' },
      { override: { parents: ['wrong-parent-folder'] }, expected: 'CONFLICT' },
    ];
    for (const [index, testCase] of cases.entries()) {
      const current = services({ ...campaign, fieldValues: { campaign_folder_id: `stored-drive-folder-${index}` } });
      const item = driveItem(`stored-drive-folder-${index}`, `${campaign.code} ${campaign.name}`, PARENT_FOLDER_ID, testCase.override);
      current.drive.items.set(item.id, item);
      expect((await current.service.ensure(campaign.id, DEMO_ACTOR)).syncStatus).toBe(testCase.expected);
      expect(current.drive.createdNames).toHaveLength(0);
    }
  });

  it('lists and uploads only through stored child IDs and rejects rename outside the workspace', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const target = repository.workspace!.baseDocumentsFolderId!;
    const existing = driveItem('drive-file-existing', 'Tệp thử.txt', target, { mimeType: 'text/plain', size: 12 });
    const outside = driveItem('drive-file-outside', 'Ngoài workspace.txt', PARENT_FOLDER_ID, { mimeType: 'text/plain', size: 2 });
    drive.items.set(existing.id, existing);
    drive.items.set(outside.id, outside);
    const page = await service.listFiles(campaign.id, 'BASE_DOCUMENTS', 'ACTIVE', undefined, DEMO_ACTOR);
    expect(page.items.map((item) => item.id)).toEqual([existing.id]);
    await service.upload(campaign.id, 'BASE_DOCUMENTS', { originalname: 'Tải lên.txt', mimetype: 'text/plain', size: 3, buffer: Buffer.from('abc') }, DEMO_ACTOR);
    expect(drive.uploadParents).toEqual([target]);
    await expect(service.renameFile(campaign.id, outside.id, 'Không được.txt', DEMO_ACTOR)).rejects.toThrow('không thuộc');
    await expect(service.renameFile(campaign.id, '../unsafe', 'X.txt', DEMO_ACTOR)).rejects.toThrow('ID không hợp lệ');
  });

  it('preserves Unicode filenames, normalizes decomposed text to NFC and never decodes a correct name twice', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const target = repository.workspace!.baseDocumentsFolderId!;
    const decomposed = 'Ta\u0300i lie\u0323\u0302u QCTT.docx';
    const filenames = [
      'Codex trả lời.docx',
      'Tài liệu QCTT – tháng 09.2026.xlsx',
      'Ảnh khai trương TP.HCM – Colombo 01.jpg',
      'Kế hoạch truyền thông (bản cuối).pdf',
      'campaign-request.txt',
      decomposed,
      'Chiến dịch ✈️.txt',
    ];

    for (const filename of filenames) {
      const result = await service.upload(campaign.id, 'BASE_DOCUMENTS', {
        originalname: filename,
        mimetype: 'application/octet-stream',
        size: 3,
        buffer: Buffer.from('abc'),
      }, DEMO_ACTOR);
      expect(result.file.name).toBe(filename.normalize('NFC'));
    }

    expect(drive.uploadParents).toEqual(filenames.map(() => target));
    expect(drive.uploadNames).toEqual(filenames.map((filename) => filename.normalize('NFC')));
    expect(drive.uploadNames).toContain('campaign-request.txt');
    expect(drive.uploadNames).toContain('Codex trả lời.docx');
    expect(drive.uploadNames.some((name) => /Ã|áº|á»/.test(name))).toBe(false);

    const renamed = await service.renameFile(campaign.id, 'drive-file-5', 'Bie\u0302n bản nghiệm thu – bản 02.docx', DEMO_ACTOR);
    expect(renamed.name).toBe('Biên bản nghiệm thu – bản 02.docx');
    expect(drive.renameNames.at(-1)).toBe('Biên bản nghiệm thu – bản 02.docx');
  });

  it('moves a Unicode file between active and trash views and restores the same Drive identity', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const parentId = repository.workspace!.baseDocumentsFolderId!;
    const original = driveItem('drive-file-recoverable', 'Tài liệu kiểm tra phục hồi tiếng Việt.docx', parentId, {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 123,
    });
    drive.items.set(original.id, original);

    const trashed = await service.trashFile(campaign.id, original.id, DEMO_ACTOR);
    expect(trashed).toMatchObject({ id: original.id, name: original.name, status: 'TRASHED', folderKind: 'BASE_DOCUMENTS', trashedBy: 'QA Google' });
    expect((await service.listFiles(campaign.id, 'BASE_DOCUMENTS', 'ACTIVE', undefined, DEMO_ACTOR)).items).toHaveLength(0);
    expect((await service.listFiles(campaign.id, 'BASE_DOCUMENTS', 'TRASHED', undefined, DEMO_ACTOR)).items.map((item) => item.id)).toEqual([original.id]);

    const restored = await service.restoreFile(campaign.id, original.id, DEMO_ACTOR);
    expect(restored).toMatchObject({ id: original.id, name: original.name, status: 'ACTIVE', folderKind: 'BASE_DOCUMENTS' });
    expect(drive.items.get(original.id)?.parents).toEqual([parentId]);
    expect(drive.trashCalls).toEqual([{ id: original.id, trashed: true }, { id: original.id, trashed: false }]);
    expect('deleteItem' in drive).toBe(false);

    const lifecycleAudits = repository.audits.filter((audit) => audit.action === 'campaign.drive_file_trashed' || audit.action === 'campaign.drive_file_restored');
    expect(lifecycleAudits.map((audit) => audit.action)).toEqual(['campaign.drive_file_trashed', 'campaign.drive_file_restored']);
    expect(lifecycleAudits.every((audit) => audit.actor.id === DEMO_ACTOR.id && audit.payload.fileId === original.id && audit.payload.folderKind === 'BASE_DOCUMENTS')).toBe(true);
  });

  it('keeps file trash and restore idempotent without duplicate Drive calls or audits', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const parentId = repository.workspace!.mediaAssetsFolderId!;
    const file = driveItem('drive-file-idempotent', 'Tư liệu QCTT.pdf', parentId, { mimeType: 'application/pdf' });
    drive.items.set(file.id, file);

    await service.trashFile(campaign.id, file.id, DEMO_ACTOR);
    await service.trashFile(campaign.id, file.id, DEMO_ACTOR);
    await service.restoreFile(campaign.id, file.id, DEMO_ACTOR);
    await service.restoreFile(campaign.id, file.id, DEMO_ACTOR);

    expect(drive.trashCalls).toEqual([{ id: file.id, trashed: true }, { id: file.id, trashed: false }]);
    expect(repository.audits.filter((audit) => audit.action === 'campaign.drive_file_trashed')).toHaveLength(1);
    expect(repository.audits.filter((audit) => audit.action === 'campaign.drive_file_restored')).toHaveLength(1);
  });

  it('rejects system folders, outside files and missing Google trash capabilities with failure audits', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const parentId = repository.workspace!.otherDocumentsFolderId!;
    const outside = driveItem('drive-file-outside-trash', 'Ngoài phạm vi.txt', PARENT_FOLDER_ID, { mimeType: 'text/plain' });
    const noTrash = driveItem('drive-file-no-trash', 'Không được xóa.txt', parentId, {
      mimeType: 'text/plain', capabilities: { ...driveItem('x', 'x', parentId).capabilities, canTrash: false },
    });
    const noRestore = driveItem('drive-file-no-restore', 'Không được phục hồi.txt', parentId, {
      mimeType: 'text/plain', trashed: true, capabilities: { ...driveItem('x', 'x', parentId).capabilities, canUntrash: false },
    });
    drive.items.set(outside.id, outside);
    drive.items.set(noTrash.id, noTrash);
    drive.items.set(noRestore.id, noRestore);

    await expect(service.trashFile(campaign.id, repository.workspace!.campaignFolderId!, DEMO_ACTOR)).rejects.toThrow('thư mục hệ thống');
    await expect(service.trashFile(campaign.id, outside.id, DEMO_ACTOR)).rejects.toThrow('không thuộc');
    await expect(service.trashFile(campaign.id, noTrash.id, DEMO_ACTOR)).rejects.toThrow('không có quyền');
    await expect(service.restoreFile(campaign.id, noRestore.id, DEMO_ACTOR)).rejects.toThrow('không có quyền');
    expect(repository.audits.filter((audit) => audit.action.endsWith('_failed'))).toHaveLength(4);
    expect(drive.trashCalls).toHaveLength(0);
  });

  it('moves a restored file back to its configured child folder when Google changes the parent', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const parentId = repository.workspace!.baseDocumentsFolderId!;
    const file = driveItem('drive-file-parent-repair', 'Biên bản nghiệm thu.docx', parentId, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', trashed: true });
    drive.items.set(file.id, file);
    drive.restoreToWrongParentId = 'wrong-parent-after-restore';

    const restored = await service.restoreFile(campaign.id, file.id, DEMO_ACTOR);
    expect(restored.status).toBe('ACTIVE');
    expect(drive.moveCalls).toEqual([{ id: file.id, fromParentIds: ['wrong-parent-after-restore'], toParentId: parentId }]);
    expect(drive.items.get(file.id)?.parents).toEqual([parentId]);
  });

  it('keeps Drive lifecycle reversible and permanent Campaign deletion never has a Drive delete operation', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const folderId = repository.workspace!.campaignFolderId!;
    await service.trashCampaignFolder(campaign, DEMO_ACTOR);
    expect(repository.workspace?.lifecycleStatus).toBe('TRASHED');
    await service.restoreCampaignFolder(campaign, DEMO_ACTOR);
    expect(repository.workspace?.lifecycleStatus).toBe('ACTIVE');
    expect(drive.createdNames).toHaveLength(4);
    await service.ensureFolderTrashedBeforePermanentDelete(campaign, DEMO_ACTOR);
    expect(drive.trashCalls).toEqual([
      { id: folderId, trashed: true },
      { id: folderId, trashed: false },
      { id: folderId, trashed: true },
    ]);
    expect('deleteItem' in drive).toBe(false);
  });

  it('does not expose workspace details to an actor without campaign.read', async () => {
    const { service } = services();
    const guest: ActorContext = { ...DEMO_ACTOR, roles: ['GUEST'] };
    await expect(service.getWorkspace(campaign.id, guest)).rejects.toThrow('không có quyền xem');
  });

  it('reconciles an upload by its Drive marker and reuses the same file on retry', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const rootId = repository.workspace!.campaignFolderId!;
    const folder = await service.createSubfolder(campaign.id, rootId, 'Nguồn', DEMO_ACTOR);
    const uploadId = '8f8d3e1a-25f4-4f26-bc68-a6142fa13e12';
    const input = { originalname: 'Brief.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('PDF') };
    const first = await service.uploadToFolder(campaign.id, folder.id, input, DEMO_ACTOR, uploadId);
    expect((await service.uploadStatus(campaign.id, folder.id, uploadId, DEMO_ACTOR)).file?.id).toBe(first.file.id);
    const again = await service.uploadToFolder(campaign.id, folder.id, input, DEMO_ACTOR, uploadId);
    expect(again.uploadMode).toBe('RECOVERED');
    expect(again.file.id).toBe(first.file.id);
    expect(drive.uploadNames).toEqual(['Brief.pdf']);
    expect(repository.audits.filter((audit) => audit.action === 'campaign.drive_file_uploaded')).toHaveLength(1);
  });

  it('changes only direct permissions on an in-scope folder and leaves inherited grants alone', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const folder = await service.createSubfolder(campaign.id, repository.workspace!.campaignFolderId!, 'Hình ảnh', DEMO_ACTOR);
    drive.permissions.set(folder.id, [{ id: 'permission-inherited-001', type: 'anyone', role: 'writer', emailAddress: null,
      displayName: null, allowFileDiscovery: false, inherited: true }]);
    await expect(service.changeFolderPermission(campaign.id, folder.id, 'permission-inherited-001', null, DEMO_ACTOR))
      .rejects.toThrow('Quyền kế thừa');
    await expect(service.createFolderPermission(campaign.id, folder.id, 'anyone', 'writer', undefined, DEMO_ACTOR))
      .rejects.toThrow('không mở quyền công khai');
    const added = await service.createFolderPermission(campaign.id, folder.id, 'user', 'reader', 'reviewer@example.test', DEMO_ACTOR);
    const direct = added.permissions.find((permission) => permission.emailAddress === 'reviewer@example.test')!;
    expect(direct.role).toBe('reader');
    expect((await service.changeFolderPermission(campaign.id, folder.id, direct.id, 'writer', DEMO_ACTOR)).permissions.find((permission) => permission.id === direct.id)?.role).toBe('writer');
    expect((await service.changeFolderPermission(campaign.id, folder.id, direct.id, null, DEMO_ACTOR)).permissions.find((permission) => permission.id === direct.id)).toBeUndefined();
    expect((await service.getFolderSharing(campaign.id, folder.id, DEMO_ACTOR)).permissions.find((permission) => permission.inherited)).toBeDefined();
    await expect(service.getFolderSharing(campaign.id, PARENT_FOLDER_ID, DEMO_ACTOR)).rejects.toThrow('ngoài phạm vi');
  });

  it('limits inherited link access only on the selected child folder before restricting it', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const folder = await service.createSubfolder(campaign.id, repository.workspace!.campaignFolderId!, 'Hình ảnh', DEMO_ACTOR);
    drive.items.set(folder.id, { ...drive.items.get(folder.id)!, capabilities: { ...drive.items.get(folder.id)!.capabilities,
      canDisableInheritedPermissions: true } });
    drive.permissions.set(folder.id, [{ id: 'inherited-public', type: 'anyone', role: 'commenter', inheritedRole: 'commenter',
      emailAddress: null, displayName: null, allowFileDiscovery: false, inherited: true }]);
    await expect(service.setFolderGeneralAccess(campaign.id, folder.id, 'RESTRICTED', undefined, false, DEMO_ACTOR))
      .rejects.toThrow('xác nhận');
    expect(drive.limitedFolders).toEqual([]);
    const restricted = await service.setFolderGeneralAccess(campaign.id, folder.id, 'RESTRICTED', undefined, true, DEMO_ACTOR);
    expect(restricted.limitedAccess).toBe(true);
    expect(drive.limitedFolders).toEqual([folder.id]);
    expect(drive.items.get(repository.workspace!.campaignFolderId!)!.inheritedPermissionsDisabled).toBeUndefined();
    await expect(service.setFolderGeneralAccess(campaign.id, folder.id, 'ANYONE', 'reader', false, DEMO_ACTOR)).resolves.toMatchObject({ limitedAccess: true });
    expect(drive.permissions.get(folder.id)?.some((permission) => permission.type === 'anyone' && !permission.inherited && permission.role === 'reader')).toBe(true);
    await expect(service.setFolderGeneralAccess(campaign.id, PARENT_FOLDER_ID, 'ANYONE', 'writer', false, DEMO_ACTOR))
      .rejects.toThrow('ngoài phạm vi');
  });

  it('rejects lowering inherited link access when Google did not grant folder Manager capability', async () => {
    const { service, drive, repository } = services();
    await service.ensure(campaign.id, DEMO_ACTOR);
    const folder = await service.createSubfolder(campaign.id, repository.workspace!.campaignFolderId!, 'Hình ảnh', DEMO_ACTOR);
    drive.permissions.set(folder.id, [{ id: 'inherited-public', type: 'anyone', role: 'commenter', inheritedRole: 'commenter',
      emailAddress: null, displayName: null, allowFileDiscovery: false, inherited: true }]);
    await expect(service.setFolderGeneralAccess(campaign.id, folder.id, 'ANYONE', 'reader', true, DEMO_ACTOR))
      .rejects.toThrow('Manager');
    expect(drive.limitedFolders).toEqual([]);
  });
});
