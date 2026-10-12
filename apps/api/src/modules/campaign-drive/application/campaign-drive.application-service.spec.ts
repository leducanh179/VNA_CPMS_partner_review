import { DEMO_ACTOR, type ActorContext, type CampaignDriveSyncStatus, type CampaignSummary } from '@cpms/domain';
import type { CloudDriveItem, CloudDrivePermission, CloudDrivePort } from '@cpms/integrations';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../../config/environment';
import type { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import type { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';
import { CampaignDriveAuthorizationService } from './campaign-drive-authorization.service';
import { CampaignDriveApplicationService } from './campaign-drive.application-service';
import type { CampaignDriveRepository, CampaignDriveWorkspaceRecord } from './campaign-drive.repository';

const SHARED_DRIVE_ID = 'example-shared-drive-id';
const PARENT_FOLDER_ID = 'example-parent-folder-id';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

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
  createdNames: string[] = [];
  permissions = new Map<string, CloudDrivePermission[]>();
  trashCalls: Array<{ id: string; trashed: boolean }> = [];
  moveCalls: Array<{ id: string; fromParentIds: string[]; toParentId: string }> = [];
  restoreToWrongParentId: string | null = null;
  uploadParents: string[] = [];
  uploadNames: string[] = [];
  renameNames: string[] = [];
  nextId = 1;

  async getItem(_accessToken: string, fileId: string) {
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
  async listFiles(input: { parentFolderId: string; trashed: boolean; pageToken?: string }) {
    const all = [...this.items.values()].filter((item) => item.mimeType !== FOLDER_MIME_TYPE && item.trashed === input.trashed && item.parents.includes(input.parentFolderId));
    const start = input.pageToken ? Number(input.pageToken) : 0;
    return { items: all.slice(start, start + 1).map((item) => structuredClone(item)), nextPageToken: start + 1 < all.length ? String(start + 1) : null };
  }
  async listPermissions(_accessToken: string, fileId: string) { return structuredClone(this.permissions.get(fileId) ?? []); }
  async createLinkWriterPermission(_accessToken: string, fileId: string) {
    const permission: CloudDrivePermission = { id: `permission-${fileId}`, type: 'anyone', role: 'writer', allowFileDiscovery: false, inherited: false };
    this.permissions.set(fileId, [permission]);
    return permission;
  }
  async upload(input: { parentFolderId: string; name: string; mimeType: string; content: Uint8Array; resumableThresholdBytes: number }) {
    this.uploadParents.push(input.parentFolderId);
    this.uploadNames.push(input.name);
    const item = driveItem(`drive-file-${this.nextId++}`, input.name, input.parentFolderId, { mimeType: input.mimeType, size: input.content.byteLength });
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
});
