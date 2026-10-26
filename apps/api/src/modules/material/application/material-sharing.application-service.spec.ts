import { describe, expect, it, vi } from 'vitest';
import { DEMO_ACTOR, type AccessDecision, type MaterialSummary, type MaterialSharing, type AccessIdentity, type CampaignSummary } from '@cpms/domain';
import { ForbiddenException } from '@nestjs/common';
import { MaterialSharingApplicationService } from './material-sharing.application-service';
import { ScopedMaterialApplicationService } from './scoped-material.application-service';
import type { MaterialRepository, PersistMaterialRecord } from './material.repository';
import type { MaterialSharingRepository } from './material-sharing.repository';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import type { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';

const uuid = '10000000-0000-4000-8000-000000000001', campaignId = '10000000-0000-4000-8000-000000000002';
function fixture(campaignRows: CampaignSummary[] = []) {
  const identity: AccessIdentity = { effectiveActorId: DEMO_ACTOR.id, originalActorId: DEMO_ACTOR.id, sessionValid: true, effectiveActive: true, originalActive: true, profileComplete: true, effectiveSuperadmin: false, mode: 'DIRECT', orgIds: [] };
  const allow: AccessDecision = { allowed: true, reason: 'ALLOW', tier: 'MODULE', ruleIds: [] };
  const missing: AccessDecision = { ...allow, allowed: false, reason: 'DEFAULT_DENY', tier: null };
  const rows = new Map<string, MaterialSummary>();
  let campaigns: string[] = [campaignId];
  const access = {
    run: (_actor: unknown, fn: () => Promise<unknown>) => fn(), snapshot: () => ({ identity }), requireAtCommit: vi.fn(),
    check: (p: string) => p === 'material.manage' || p === 'system.manage' ? missing : allow,
    require: vi.fn(), visibleCampaignIds: async () => campaigns,
    campaign: async (id: string) => ({ id }), capabilities: () => ({ permissions: { 'campaign.update': false } }),
  } as unknown as AccessApplicationService;
  const repo: MaterialRepository = {
    list: async () => [...rows.values()], findByMaterialIds: async ids => ids.flatMap(id => rows.get(id) || []), listReferences: async () => [],
    purge: vi.fn(), saveBatch: vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(r => {
      const next = { ...rows.get(r.materialId), ...r, id: uuid, updatedAt: 'now' }; rows.set(r.materialId, next); return next;
    })),
  };
  const sharingRepo = { activeOrganizationIds: async (ids: string[]) => ids, validTargets: vi.fn(async () => true), directory: vi.fn(async () => ({ accounts: [], organizations: [] })),
    save: vi.fn(async (id: string, version: number, sharing: MaterialSharing) => {
      const old = rows.get(id)!; if (old.recordVersion !== version) throw Error('Version changed');
      const next = { ...old, sharing, recordVersion: version + 1 }; rows.set(id, next); return next;
    }),
  } as unknown as MaterialSharingRepository;
  const sharing = new MaterialSharingApplicationService(repo, sharingRepo, access);
  const service = new ScopedMaterialApplicationService(repo, { list: async () => campaignRows } as unknown as ScopedCampaignApplicationService, access, sharing);
  const row: MaterialSummary = { id: uuid, materialId: 'MTR-QA', recordVersion: 1, isDeleted: false, updatedAt: 'now',
    fields: { material_name: 'Example', material_type: 'Key Visual', material_link: 'https://example.test/material', campaign_refs: '[]' },
    sharing: { mode: 'RESTRICTED', ownerActorId: uuid, campaignIds: [], grants: [{ kind: 'ACCOUNT', id: DEMO_ACTOR.id, permission: 'VIEW' }] } };
  rows.set(row.materialId, row);
  return { identity, rows, row, repo, sharingRepo, sharing, service, access, campaigns: (ids: string[]) => { campaigns = ids; } };
}

describe('Sharing Application Service entrypoints', () => {
  it('projects all four validity dates only from campaigns visible through the scoped service', async () => {
    const visible = { id: campaignId, code: 'QA', name: 'Visible QA', markets: [], effectiveStartDate: '2026-10-01', effectiveEndDate: '2026-10-31', departureStartDate: '2026-11-01', departureEndDate: '2027-02-01' } as unknown as CampaignSummary;
    const f = fixture([visible]);
    expect((await f.service.bootstrap()).campaigns).toEqual([{ campaign_id: campaignId, campaign_code: 'QA', campaign_name: 'Visible QA', market_codes: [], effectiveStartDate: '2026-10-01', effectiveEndDate: '2026-10-31', departureStartDate: '2026-11-01', departureEndDate: '2027-02-01' }]);
    expect((await fixture().service.bootstrap()).campaigns).toEqual([]);
  });
  it('M01: all creation paths default SHARED with server-owned author identity', async () => {
    const f = fixture();
    const result = await f.service.batchSave([{ clientKey: 'new', fields: { material_name: 'New', material_link: 'https://example.test/new' } }], DEMO_ACTOR);
    expect(result.succeeded).toBe(1);
    expect(result.items[0]?.material?.sharing).toEqual({ mode: 'SHARED', ownerActorId: DEMO_ACTOR.id, campaignIds: [], grants: [] });
  });
  it('M10/M13: restricted VIEW-only cannot edit, bulk-delete or manage sharing despite pilot update presets', async () => {
    const f = fixture();
    expect((await f.service.batchSave([{ clientKey: 'edit', materialId: f.row.materialId, fields: { material_name: 'attack' } }], DEMO_ACTOR)).failed).toBe(1);
    expect((await f.service.bulkAction([{ materialId: f.row.materialId, expectedVersion: 1 }], 'SOFT_DELETE', DEMO_ACTOR)).failed).toBe(1);
    await expect(f.sharing.change(f.row.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: 1 }, DEMO_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.repo.saveBatch).not.toHaveBeenCalled(); expect(f.sharingRepo.save).not.toHaveBeenCalled();
  });
  it('M10: an editor cannot smuggle sharing/author fields through content or the separate sharing command', async () => {
    const f = fixture(); f.row.sharing!.grants[0]!.permission = 'EDIT';
    for (const fields of [{ ownerActorId: DEMO_ACTOR.id }, { sharing_mode: 'SHARED' }, { created_by: DEMO_ACTOR.key }, { visibility: 'PUBLIC' }, { record_version: '999' }, { capabilities: '{"edit":true}' }]) {
      const result = await f.service.batchSave([{ clientKey: 'attack', materialId: f.row.materialId, fields }], DEMO_ACTOR);
      expect(result.failed).toBe(1);
    }
    expect((await f.service.batchSave([{ clientKey: 'attack', materialId: f.row.materialId, fields: {}, sharing: { mode: 'SHARED', campaignIds: [], grants: [] } }], DEMO_ACTOR)).failed).toBe(1);
    await expect(f.sharing.directory('', f.row.materialId)).rejects.toThrow();
    expect(f.repo.saveBatch).not.toHaveBeenCalled();
  });
  it('M05/M09/M12: revoke removes list, detail, directory and replayed creation access on next request', async () => {
    const f = fixture(); expect((await f.service.list()).length).toBe(1);
    f.row.sharing!.grants = [];
    expect(await f.service.list()).toEqual([]);
    await expect(f.sharing.detail(f.row.materialId)).rejects.toMatchObject({ status: 404 });
    await expect(f.sharing.directory('', f.row.materialId)).rejects.toMatchObject({ status: 404 });
    f.repo.findCreationReceipts = async () => [{ clientKey: 'retry', material: f.row }];
    const result = await f.service.batchSave([{ clientKey: 'retry', fields: {} }], DEMO_ACTOR);
    expect(result.failed).toBe(1); expect(result.items[0]?.material).toBeUndefined();
    expect((await f.service.bootstrap()).options.materialTypes).toEqual([]);
  });
  it('M15: manages sharing with optimistic version; validation rejects temporary campaigns and author/version smuggling', async () => {
    const f = fixture(); f.row.sharing!.ownerActorId = DEMO_ACTOR.id;
    for (const input of [
      { mode: 'CAMPAIGN', campaignIds: [], grants: [], expectedVersion: 1 },
      { mode: 'CAMPAIGN', campaignIds: ['temp:other'], grants: [], expectedVersion: 1 },
      { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: 1, ownerActorId: uuid },
    ]) await expect(f.sharing.change(f.row.materialId, input, DEMO_ACTOR)).rejects.toThrow();
    await f.sharing.change(f.row.materialId, { mode: 'CAMPAIGN', campaignIds: [campaignId], grants: [], expectedVersion: 1 }, DEMO_ACTOR);
    await expect(f.sharing.change(f.row.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: 1 }, DEMO_ACTOR)).rejects.toThrow('Version');
    expect(f.rows.get(f.row.materialId)?.sharing?.mode).toBe('CAMPAIGN');
  });
  it('M09: delegated sharing manager may remove own access without receiving hidden content', async () => {
    const f = fixture(); f.row.sharing!.grants[0]!.permission = 'MANAGE_SHARING';
    const result = await f.sharing.change(f.row.materialId, { mode: 'RESTRICTED', campaignIds: [], grants: [], expectedVersion: 1 }, DEMO_ACTOR);
    expect(result.capabilities?.view).toBe(false); expect(result.fields).toEqual({});
    expect(await f.service.list()).toEqual([]);
  });
  it('M14: a successful delete returns a content-free removal marker when the editor cannot read Trash', async () => {
    const f = fixture(); f.row.sharing!.grants[0]!.permission = 'EDIT';
    const result = await f.service.bulkAction([{ materialId: f.row.materialId, expectedVersion: 1 }], 'SOFT_DELETE', DEMO_ACTOR);
    expect(result.succeeded).toBe(1);
    expect(result.items[0]?.material).toMatchObject({ materialId: f.row.materialId, fields: {}, capabilities: { view: false } });
    expect(await f.service.list()).toEqual([]);
  });
});
