import { DEMO_ACTOR, type MaterialSummary } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import { MaterialApplicationService } from './material.application-service';
import type { MaterialRepository, PersistMaterialRecord } from './material.repository';

function summary(record: PersistMaterialRecord): MaterialSummary {
  return {
    id: record.materialId,
    materialId: record.materialId,
    fields: record.fields,
    recordVersion: record.recordVersion,
    isDeleted: record.isDeleted,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('MaterialApplicationService', () => {
  it('keeps temporary campaign names local and inherits markets from the selected campaign with most markets', async () => {
    const stored = new Map<string, MaterialSummary>();
    const repository: MaterialRepository = {
      list: vi.fn(async () => [...stored.values()]),
      findByMaterialIds: vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => stored.get(id) || [])),
      saveBatch: vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map((record) => { const value = summary(record); stored.set(record.materialId, value); return value; })),
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    class TestService extends MaterialApplicationService {
      protected override async selectableCampaigns() { return [
        { id: 'c1', code: 'C1', name: 'Chiến dịch 1', marketCodes: ['VN'] },
        { id: 'c2', code: 'C2', name: 'Chiến dịch 2', marketCodes: ['JP', 'KR'] },
      ]; }
    }
    const service = new TestService(repository);
    const refs = JSON.stringify([{ kind: 'SYSTEM', id: 'c1', name: 'Old' }, { kind: 'SYSTEM', id: 'c2', name: 'Old' }, { kind: 'TEMPORARY', id: 'temp:1', name: 'Chiến dịch tạm' }]);
    const created = await service.batchSave([{ clientKey: 'first', fields: { campaign_refs: refs, material_group: 'Hình ảnh', material_type: 'Key Visual', material_name: 'Ảnh A', material_link: 'https://example.com/a', market_codes: 'VN' } }], DEMO_ACTOR);
    expect(created.succeeded).toBe(1);
    const first = created.items[0]!.material!;
    expect(first.fields.market_codes).toBe('JP,KR');
    expect(first.fields.market_source_campaign_id).toBe('c2');
    expect(first.fields.campaign).toContain('Chiến dịch tạm');
    const changed = await service.batchSave([{ clientKey: 'second', materialId: first.materialId, expectedVersion: first.recordVersion, baselineFields: first.fields, fields: { campaign_refs: JSON.stringify([{ kind: 'TEMPORARY', id: 'temp:1', name: 'Chiến dịch tạm' }]), market_codes: 'VN', material_name: 'Ảnh A' } }], DEMO_ACTOR);
    expect(changed.items[0]!.material?.fields.market_codes).toBe('VN');
    expect(changed.items[0]!.material?.fields.market_source_campaign_id).toBeNull();
  });

  it('publishes without approval and supports a paused publication state', async () => {
    const stored = new Map<string, MaterialSummary>();
    const repository: MaterialRepository = {
      list: vi.fn(async () => [...stored.values()]),
      findByMaterialIds: vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => stored.get(id) || [])),
      saveBatch: vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map((record) => { const value = summary(record); stored.set(record.materialId, value); return value; })),
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const draft = (await service.batchSave([{ clientKey: 'one', fields: { material_name: 'Bản TVC', material_link: 'https://example.com/tvc' } }], DEMO_ACTOR)).items[0]!.material!;
    const act = async (action: 'PUBLISH' | 'PAUSE_PUBLISH' | 'UNPUBLISH') => {
      const current = stored.get(draft.materialId)!;
      return (await service.bulkAction([{ materialId: current.materialId, expectedVersion: current.recordVersion }], action, DEMO_ACTOR)).items[0]!;
    };
    expect((await act('PUBLISH')).material?.fields.publish_status).toBe('PUBLISHED');
    expect((await act('PAUSE_PUBLISH')).material?.fields.publish_status).toBe('PAUSED');
    expect((await act('UNPUBLISH')).material?.fields.publish_status).toBe('NOT_PUBLISHED');
  });

  it('defaults the editable update date on creation, accepts a past date, and edits without approval', async () => {
    const stored = new Map<string, MaterialSummary>();
    const repository: MaterialRepository = {
      list: vi.fn(async () => [...stored.values()]),
      findByMaterialIds: vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => stored.get(id) || [])),
      saveBatch: vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map((record) => { const value = summary(record); stored.set(record.materialId, value); return value; })),
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const created = (await service.batchSave([{ clientKey: 'new', fields: { material_name: 'Bản TVC', material_link: 'https://example.com/tvc' } }], DEMO_ACTOR)).items[0]!.material!;
    expect(created.fields.material_update_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const updated = (await service.batchSave([{ clientKey: 'past', materialId: created.materialId, expectedVersion: created.recordVersion,
      baselineFields: created.fields, fields: { material_update_date: '2024-01-02' } }], DEMO_ACTOR)).items[0]!.material!;
    expect(updated.fields.material_update_date).toBe('2024-01-02');
    const corrected = (await service.batchSave([{ clientKey: 'corrected', materialId: updated.materialId, expectedVersion: updated.recordVersion,
      baselineFields: updated.fields, fields: { material_name: 'Bản TVC đã sửa' } }], DEMO_ACTOR)).items[0]!.material!;
    expect(corrected.fields.material_name).toBe('Bản TVC đã sửa');
  });
  it('persists multiple new rows through one repository batch call', async () => {
    const saveBatch = vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(summary));
    const repository: MaterialRepository = {
      list: vi.fn(async () => []),
      findByMaterialIds: vi.fn(async () => []),
      saveBatch,
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const result = await service.batchSave(Array.from({ length: 4 }, (_, index) => ({
      clientKey: `new-${index}`,
      fields: { material_name: `Tư liệu ${index + 1}`, material_type: 'Key visual', material_link: `https://example.com/${index + 1}` },
    })), DEMO_ACTOR);

    expect(result).toMatchObject({ total: 4, succeeded: 4, failed: 0 });
    expect(saveBatch).toHaveBeenCalledTimes(1);
    expect(saveBatch.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it('keeps a conflicting row out of the persistence batch', async () => {
    const existing: MaterialSummary = {
      id: '1', materialId: 'MAT-1', recordVersion: 3, isDeleted: false, updatedAt: '2026-09-01T00:00:00.000Z',
      fields: { material_id: 'MAT-1', material_name: 'Bản trên server', approval_status: 'BOOKED' },
    };
    const saveBatch = vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(summary));
    const repository: MaterialRepository = {
      list: vi.fn(async () => []),
      findByMaterialIds: vi.fn(async () => [existing]),
      saveBatch,
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const result = await service.batchSave([{
      clientKey: 'row-1', materialId: 'MAT-1', expectedVersion: 2,
      baselineFields: { material_name: 'Bản ban đầu' },
      fields: { material_name: 'Bản local' },
    }], DEMO_ACTOR);

    expect(result.items[0]).toMatchObject({ ok: false, code: 'CONFLICT', conflictingFields: ['material_name'] });
    expect(saveBatch).not.toHaveBeenCalled();
  });

  it('requires one primary link, rejects newly added supplementary links, and preserves unchanged historical links', async () => {
    const historical: MaterialSummary = {
      id: 'legacy', materialId: 'MTR-LEGACY', recordVersion: 1, isDeleted: false, updatedAt: '2026-10-03T00:00:00.000Z',
      fields: { material_name: 'Tư liệu cũ', material_link: 'https://example.com/main', supplementary_links: JSON.stringify([{ label: 'Resize', url: 'https://example.com/resize' }]) },
    };
    const saveBatch = vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(summary));
    const repository: MaterialRepository = {
      list: vi.fn(async () => []),
      findByMaterialIds: vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => id === historical.materialId ? [historical] : [])),
      saveBatch,
      purge: vi.fn(async () => {}),
      listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const missing = await service.batchSave([{ clientKey: 'missing', fields: { material_name: 'Thiếu link' } }], DEMO_ACTOR);
    expect(missing.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    const extra = await service.batchSave([{ clientKey: 'extra', fields: { material_name: 'Dư link', material_link: 'https://example.com/main', supplementary_links: '[{"label":"Resize","url":"https://example.com/resize"}]' } }], DEMO_ACTOR);
    expect(extra.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    const hidden = await service.batchSave([{ clientKey: 'hidden', fields: { material_name: 'Dư link', material_link: 'https://example.com/main', supplementary_link_1: 'https://example.com/resize' } }], DEMO_ACTOR);
    expect(hidden.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    const edited = await service.batchSave([{ clientKey: 'edit', materialId: historical.materialId, expectedVersion: historical.recordVersion,
      baselineFields: historical.fields, fields: { material_name: 'Tư liệu cũ đã sửa', supplementary_links: historical.fields.supplementary_links } }], DEMO_ACTOR);
    expect(edited.items[0]).toMatchObject({ ok: true });
    expect(edited.items[0]?.material?.fields.supplementary_links).toBe(historical.fields.supplementary_links);
    const changedExtra = await service.batchSave([{ clientKey: 'changed-extra', materialId: historical.materialId, expectedVersion: historical.recordVersion,
      baselineFields: historical.fields, fields: { material_name: 'Tư liệu cũ đã sửa', supplementary_links: '[{"label":"Thêm","url":"https://example.com/new"}]' } }], DEMO_ACTOR);
    expect(changedExtra.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(saveBatch).toHaveBeenCalledTimes(1);
  });

  it('accepts Landing Page in Trang web with multiple listed languages and rejects invalid language values', async () => {
    const saveBatch = vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(summary));
    const repository: MaterialRepository = {
      list: vi.fn(async () => []), findByMaterialIds: vi.fn(async () => []), saveBatch,
      purge: vi.fn(async () => {}), listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const fields = { material_name: 'Landing Page', material_link: 'https://example.com/landing', material_group: 'Trang web',
      material_type: 'Landing Page', material_languages: JSON.stringify(['Tiếng Việt', 'Tiếng Anh']) };
    const valid = await service.batchSave([{ clientKey: 'valid', fields }], DEMO_ACTOR);
    expect(valid.items[0]).toMatchObject({ ok: true });
    expect(valid.items[0]?.material?.fields.material_languages).toBe('["Tiếng Việt","Tiếng Anh"]');
    const invalid = await service.batchSave([{ clientKey: 'invalid', fields: { ...fields, material_languages: '["Tiếng Việt","Tiếng Tây Ban Nha"]' } }], DEMO_ACTOR);
    expect(invalid.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    const duplicated = await service.batchSave([{ clientKey: 'duplicate', fields: { ...fields, material_languages: '["Tiếng Anh","Tiếng Anh"]' } }], DEMO_ACTOR);
    expect(duplicated.items[0]).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(saveBatch).toHaveBeenCalledTimes(1);
  });

  it('does not accept new Material contract values while preserving a historical value on unrelated edits', async () => {
    const historical: MaterialSummary = {
      id: 'legacy', materialId: 'MTR-LEGACY', recordVersion: 1, isDeleted: false, updatedAt: '2026-10-03T00:00:00.000Z',
      fields: { material_name: 'Tư liệu cũ', material_link: 'https://example.com/old', contract_ids: 'CON-OLD' },
    };
    const repository: MaterialRepository = {
      list: vi.fn(async () => []),
      findByMaterialIds: vi.fn(async (ids: readonly string[]) => ids.includes(historical.materialId) ? [historical] : []),
      saveBatch: vi.fn(async (records: readonly PersistMaterialRecord[]) => records.map(summary)),
      purge: vi.fn(async () => {}), listReferences: vi.fn(async () => []),
    };
    const service = new MaterialApplicationService(repository);
    const created = await service.batchSave([{ clientKey: 'new', fields: { material_name: 'Tư liệu mới', material_link: 'https://example.com/new', contract_ids: 'CON-NEW' } }], DEMO_ACTOR);
    expect(created.items[0]?.material?.fields.contract_ids).toBeUndefined();
    const edited = await service.batchSave([{ clientKey: 'edit', materialId: historical.materialId, expectedVersion: historical.recordVersion,
      baselineFields: historical.fields, fields: { material_name: 'Tư liệu cũ đã sửa', contract_ids: 'CON-CHANGED' } }], DEMO_ACTOR);
    expect(edited.items[0]?.material?.fields.contract_ids).toBe('CON-OLD');
  });
});
