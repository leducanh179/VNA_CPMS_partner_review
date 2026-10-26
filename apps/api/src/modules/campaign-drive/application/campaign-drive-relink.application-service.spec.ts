import { DEMO_ACTOR, type CampaignSummary } from '@cpms/domain';
import type { CloudDriveItem, CloudDrivePort } from '@cpms/integrations';
import { describe, expect, it } from 'vitest';
import { CampaignDriveRelinkApplicationService } from './campaign-drive-relink.application-service';
import type { CampaignDriveRelinkRecord } from './campaign-drive-relink.repository';
import type { CampaignDriveWorkspaceRecord } from './campaign-drive.repository';

const sharedDriveId = 'example-shared-drive-id';
const databaseId = 'example-parent-folder-id';
const sourceId = 'source-folder-123456';
const targetId = 'target-folder-123456';
const campaignId = '10000000-0000-4000-8000-000000000001';
const campaign = { id: campaignId, code: 'CPG-202610-9T1H', name: 'Chiến dịch thử nghiệm', isDeleted: false } as CampaignSummary;

function folder(id: string, name: string, parent: string): CloudDriveItem {
  return { id, name, parents: [parent], driveId: sharedDriveId, mimeType: 'application/vnd.google-apps.folder',
    trashed: false, size: null, modifiedTime: null, lastModifiedBy: null, trashedTime: null, trashedBy: null,
    webViewLink: `https://drive.google.com/drive/folders/${id}`, webContentLink: null,
    capabilities: { canEdit: true, canTrash: true, canUntrash: true, canMoveItemWithinDrive: true,
      canDownload: true, canAddChildren: true, canShare: true } };
}

function fixture() {
  const source = folder(sourceId, `${campaign.code} ${campaign.name}`, databaseId);
  const target = folder(targetId, 'Folder có sẵn', 'nested-parent-123456');
  const items = new Map<string, CloudDriveItem>([
    [databaseId, folder(databaseId, 'DATABASE_CAMPAIGNS', sharedDriveId)],
    [sourceId, source], [targetId, target],
    ['nested-parent-123456', folder('nested-parent-123456', 'Nhóm thư mục', databaseId)],
  ]);
  const renamed: Array<{ id: string; name: string }> = [];
  let failOldRename = false;
  const drive = {
    getItem: async (_token: string, id: string) => { const item = items.get(id); if (!item) throw new Error('missing'); return structuredClone(item); },
    renameItem: async ({ fileId, name }: { fileId: string; name: string }) => {
      if (failOldRename && fileId === sourceId) throw new Error('Google Drive tạm thời không đổi tên được');
      const item = items.get(fileId)!; items.set(fileId, { ...item, name }); renamed.push({ id: fileId, name });
      return structuredClone(items.get(fileId)!);
    },
  } as CloudDrivePort;
  const workspace = { campaignId, sharedDriveId, parentFolderId: databaseId, campaignFolderId: sourceId,
    campaignFolderLink: `https://drive.google.com/drive/folders/${sourceId}`, lastKnownFolderName: source.name,
    baseDocumentsFolderId: 'base-123456789', mediaAssetsFolderId: 'media-123456789', otherDocumentsFolderId: 'other-123456789',
    templateVersion: 1, accessMode: 'CPMS_VISIBILITY_ONLY', sharingMode: 'PARENT_INHERITED', permissionPolicyVersion: 1,
    syncStatus: 'READY', lifecycleStatus: 'ACTIVE', lastCheckedAt: null, lastErrorCode: null, lastErrorMessage: null,
    googlePermissionId: null, desiredRole: null, permissionSyncStatus: null, createdAt: new Date(), updatedAt: new Date() } as CampaignDriveWorkspaceRecord;
  const audits: string[] = [];
  const workspaces = {
    get: async () => structuredClone(workspace),
    findByFolderId: async (id: string) => id === workspace.campaignFolderId ? structuredClone(workspace) : null,
    recordAudit: async (_actor: unknown, _id: string, action: string) => { audits.push(action); },
  };
  const rows: CampaignDriveRelinkRecord[] = [];
  const requests = {
    listPending: async (ids: string[]) => structuredClone(rows.filter((row) => ids.includes(row.campaignId) && row.status === 'PENDING')),
    list: async () => structuredClone(rows),
    get: async (id: string) => structuredClone(rows.find((row) => row.id === id) ?? null),
    create: async (input: Record<string, unknown>) => {
      const row = { ...input, id: '20000000-0000-4000-8000-000000000001', status: 'PENDING', requestedAt: new Date(),
        decidedByActorId: null, decisionReason: null, decidedAt: null, appliedAt: null, lastError: null,
        recordVersion: 1 } as CampaignDriveRelinkRecord;
      rows.push(row); return structuredClone(row);
    },
    transition: async (id: string, from: string, version: number, to: CampaignDriveRelinkRecord['status'], update: Record<string, unknown>) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.status !== from || row.recordVersion !== version) return false;
      Object.assign(row, update, { status: to, recordVersion: row.recordVersion + 1 }); return true;
    },
    finish: async (request: CampaignDriveRelinkRecord) => {
      const row = rows.find((candidate) => candidate.id === request.id);
      if (!row || row.recordVersion !== request.recordVersion || workspace.campaignFolderId !== sourceId) return false;
      Object.assign(workspace, { campaignFolderId: targetId, campaignFolderLink: request.targetFolderLink,
        lastKnownFolderName: request.expectedFolderName, baseDocumentsFolderId: null,
        mediaAssetsFolderId: null, otherDocumentsFolderId: null, templateVersion: 2 });
      Object.assign(row, { status: 'APPLIED', recordVersion: row.recordVersion + 1, appliedAt: new Date() });
      return true;
    },
    findOtherCampaignHistory: async () => false,
  };
  const access = {
    run: (_actor: unknown, operation: () => unknown) => operation(),
    visibleCampaignIds: async () => [campaignId],
    campaign: async () => ({}), require: () => undefined, check: () => ({ allowed: true }),
    snapshot: () => ({ identity: { mode: 'DIRECT', effectiveSuperadmin: true, originalActorId: DEMO_ACTOR.id, effectiveActorId: DEMO_ACTOR.id } }),
  };
  const service = new CampaignDriveRelinkApplicationService(
    { get: (key: string) => key === 'GOOGLE_DRIVE_SHARED_DRIVE_ID' ? sharedDriveId : databaseId } as never,
    { get: async () => campaign } as never, { requireLeadDivisionLeader: async () => true } as never,
    { withAccessToken: async (_actor: unknown, operation: (token: string) => Promise<unknown>) => operation('test-token') } as never,
    drive, workspaces as never, requests as never,
    { execute: (_permission: string, _resource: unknown, operation: () => unknown) => operation() } as never, access as never,
  );
  return { service, items, rows, renamed, audits, get workspace() { return workspace; }, setFailOldRename(value: boolean) { failOldRename = value; } };
}

describe('CampaignDriveRelinkApplicationService', () => {
  it('places only an eligible pending request in the approver inbox', async () => {
    const state = fixture();
    const preview = await state.service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR);
    const request = await state.service.request(campaignId, { folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName,
      expectedPreviousFolderId: sourceId, reason: 'Dùng thư mục hồ sơ', confirmRename: true }, DEMO_ACTOR);
    expect((await state.service.inbox(DEMO_ACTOR)).items.map((item) => item.requestId)).toEqual([request.id]);
    await state.service.decide(campaignId, request.id, { approve: false, reason: 'Chưa phù hợp', expectedVersion: 1 }, DEMO_ACTOR);
    expect((await state.service.inbox(DEMO_ACTOR)).items).toEqual([]);
  });

  it('rejects a folder outside DATABASE_CAMPAIGNS and never changes the current link', async () => {
    const state = fixture();
    state.items.set(targetId, folder(targetId, 'Ngoài phạm vi', 'different-parent-123456'));
    await expect(state.service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR)).rejects.toThrow();
    expect(state.workspace.campaignFolderId).toBe(sourceId);
    expect(state.renamed).toHaveLength(0);
  });

  it('requires explicit consent before a relink request is stored', async () => {
    const state = fixture();
    const preview = await state.service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR);
    await expect(state.service.request(campaignId, { folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName,
      expectedPreviousFolderId: sourceId, reason: 'Đổi thư mục', confirmRename: false }, DEMO_ACTOR)).rejects.toThrow('chấp nhận');
    expect(state.rows).toHaveLength(0);
  });

  it('keeps the current link until approval, then renames both folders and records the replaced link', async () => {
    const { service, items, rows, renamed, workspace } = fixture();
    const preview = await service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR);
    expect(preview.expectedName).toBe(`${campaign.code} ${campaign.name}`);
    const request = await service.request(campaignId, { folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName,
      expectedPreviousFolderId: sourceId, reason: 'Chuyển sang hồ sơ đã có', confirmRename: true }, DEMO_ACTOR);
    expect(workspace.campaignFolderId).toBe(sourceId);
    expect(renamed).toHaveLength(0);
    const result = await service.decide(campaignId, request.id, { approve: true, reason: '', expectedVersion: 1 }, DEMO_ACTOR);
    expect(result?.status).toBe('APPLIED');
    expect(rows[0]?.sourceFolderLink).toBe(`https://drive.google.com/drive/folders/${sourceId}`);
    expect(items.get(sourceId)?.name).toBe(`[Hết hiệu lực] ${campaign.code} ${campaign.name}`);
    expect(items.get(targetId)?.name).toBe(`${campaign.code} ${campaign.name}`);
    expect((await service.read(campaignId, DEMO_ACTOR)).requests[0]?.status).toBe('APPLIED');
  });

  it('does not switch the link on a partial Google failure and retries without doubling the expired prefix', async () => {
    const state = fixture();
    const preview = await state.service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR);
    const request = await state.service.request(campaignId, { folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName,
      expectedPreviousFolderId: sourceId, reason: 'Đổi thư mục', confirmRename: true }, DEMO_ACTOR);
    state.setFailOldRename(true);
    await expect(state.service.decide(campaignId, request.id, { approve: true, reason: '', expectedVersion: 1 }, DEMO_ACTOR)).rejects.toThrow('tạm thời');
    expect(state.workspace.campaignFolderId).toBe(sourceId);
    expect(state.rows[0]?.status).toBe('FAILED');
    state.setFailOldRename(false);
    expect((await state.service.retry(campaignId, request.id, DEMO_ACTOR))?.status).toBe('APPLIED');
    expect(state.renamed.filter((item) => item.id === sourceId)).toHaveLength(1);
  });

  it('can resume a stale applying request after interruption', async () => {
    const state = fixture();
    const preview = await state.service.preview(campaignId, `https://drive.google.com/drive/folders/${targetId}`, DEMO_ACTOR);
    const request = await state.service.request(campaignId, { folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName,
      expectedPreviousFolderId: sourceId, reason: 'Đổi thư mục', confirmRename: true }, DEMO_ACTOR);
    Object.assign(state.rows[0]!, { status: 'APPLYING', decidedByActorId: DEMO_ACTOR.id,
      decidedAt: new Date(Date.now() - 16 * 60_000), recordVersion: 2 });
    expect((await state.service.retry(campaignId, request.id, DEMO_ACTOR))?.status).toBe('APPLIED');
    expect(state.workspace.campaignFolderId).toBe(targetId);
  });
});
