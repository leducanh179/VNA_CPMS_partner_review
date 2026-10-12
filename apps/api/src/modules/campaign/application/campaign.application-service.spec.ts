import { DEMO_ACTOR, isCampaignCodeCompliant, type ActorContext, type CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import { CampaignApplicationService } from './campaign.application-service';
import type { CampaignFields, CampaignRepository, PersistCampaignInput } from './campaign.repository';
import type { CatalogApplicationService } from '../../catalog/application/catalog.application-service';

const catalogs = {
  findCampaignLevel: async (code: string) => ({ code }),
  findCampaignObjective: async (code: string) => ({ code }),
  findPersonnel: async (employeeCode: string) => ({ employeeCode }),
  resolveMarketSelection: async (codes: string[] = [], origin = 'CUSTOM') => ({ marketCodes: codes, origin, selectionCode: null }),
  requireOrganizationUnits: async () => [],
  requireProvinces: async (codes: string[]) => codes,
} as unknown as CatalogApplicationService;

const serviceFor = (repository: CampaignRepository) => new CampaignApplicationService(repository, catalogs);

class RecordingRepository implements CampaignRepository {
  recordedActor: ActorContext | null = null;
  campaign: CampaignSummary | null = null;
  lastCreateInput: PersistCampaignInput | null = null;
  lastUpdateInput: CampaignFields | null = null;
  updateCount = 0;

  async list(_trash: boolean): Promise<CampaignSummary[]> {
    return this.campaign ? [this.campaign] : [];
  }

  async findById(): Promise<CampaignSummary | null> {
    return this.campaign;
  }

  async findByCode(code: string): Promise<CampaignSummary | null> {
    return this.campaign?.code === code ? this.campaign : null;
  }

  async findSimilarCandidates(): Promise<CampaignSummary[]> {
    return this.campaign ? [this.campaign] : [];
  }

  async createWithAudit(input: PersistCampaignInput, actor: ActorContext): Promise<CampaignSummary> {
    this.recordedActor = actor;
    this.lastCreateInput = input;
    this.campaign = {
      id: '10000000-0000-4000-8000-000000000099',
      code: input.code,
      name: input.name,
      requestingUnit: input.requestingUnit ?? '',
      lifecycleState: input.lifecycleState,
      startDate: input.startDate?.toISOString() ?? null,
      endDate: input.endDate?.toISOString() ?? null,
      effectiveStartDate: input.effectiveStartDate?.toISOString() ?? null,
      effectiveEndDate: input.effectiveEndDate?.toISOString() ?? null,
      levelCode: input.levelCode,
      levelLabel: null,
      levelRuleDescription: null,
      requestingEmployeeCode: input.requestingEmployeeCode,
      requestingEmployeeName: null,
      manualRequesterEmail: input.manualRequesterEmail,
      primaryObjectiveCode: input.primaryObjectiveCode,
      primaryObjectiveLabel: null,
      primaryObjectiveOther: input.primaryObjectiveOther,
      kpiText: input.kpiText,
      descriptionRichText: input.descriptionRichText,
      additionalInformation: input.additionalInformation,
      dataSchemaVersion: input.dataSchemaVersion,
      normalizationStatus: input.normalizationStatus,
      normalizationWarnings: [],
      markets: [],
      provinces: input.provinces.map((provinceCode) => ({ provinceCode, provinceName: provinceCode })),
      requestingUnits: [],
      fieldValues: input.fieldValues,
      recordVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedByActorId: null,
      updatedAt: new Date(0).toISOString(),
    };
    return this.campaign;
  }

  async updateWithAudit(_id: string, input: CampaignFields, actor: ActorContext): Promise<CampaignSummary> {
    this.updateCount += 1;
    this.recordedActor = actor;
    this.lastUpdateInput = input;
    if (!this.campaign) throw new Error('Campaign fixture is missing.');
    this.campaign = {
      ...this.campaign,
      ...input,
      ...(input.provinces ? { provinces: input.provinces.map((provinceCode) => ({ provinceCode, provinceName: provinceCode })) } : {}),
      startDate: input.startDate?.toISOString() ?? null,
      endDate: input.endDate?.toISOString() ?? null,
      effectiveStartDate: input.effectiveStartDate?.toISOString() ?? null,
      effectiveEndDate: input.effectiveEndDate?.toISOString() ?? null,
      requestingUnit: input.requestingUnit ?? '',
      fieldValues: input.fieldValues,
      recordVersion: this.campaign.recordVersion + 1,
      updatedAt: new Date(1).toISOString(),
    };
    return this.campaign;
  }

  async regenerateCodeWithAudit(_id: string, oldCode: string, nextCode: string, expectedVersion: number, actor: ActorContext): Promise<CampaignSummary> {
    if (!this.campaign || this.campaign.code !== oldCode || this.campaign.recordVersion !== expectedVersion) throw new Error('Version conflict');
    this.recordedActor = actor;
    this.campaign = { ...this.campaign, code: nextCode, fieldValues: { ...this.campaign.fieldValues, campaign_code: nextCode }, recordVersion: expectedVersion + 1 };
    return this.campaign;
  }

  async moveToTrashWithAudit(_id: string, actor: ActorContext): Promise<CampaignSummary> {
    if (!this.campaign) throw new Error('Campaign fixture is missing.');
    this.recordedActor = actor;
    this.campaign = { ...this.campaign, isDeleted: true, deletedAt: new Date(2).toISOString(), deletedByActorId: actor.id, recordVersion: this.campaign.recordVersion + 1 };
    return this.campaign;
  }

  async restoreWithAudit(_id: string, actor: ActorContext): Promise<CampaignSummary> {
    if (!this.campaign) throw new Error('Campaign fixture is missing.');
    this.recordedActor = actor;
    this.campaign = { ...this.campaign, isDeleted: false, deletedAt: null, deletedByActorId: null, recordVersion: this.campaign.recordVersion + 1 };
    return this.campaign;
  }

  async deletePermanentlyWithAudit(_id: string, actor: ActorContext): Promise<{ id: string; code: string }> {
    if (!this.campaign) throw new Error('Campaign fixture is missing.');
    this.recordedActor = actor;
    const deleted = { id: this.campaign.id, code: this.campaign.code };
    this.campaign = null;
    return deleted;
  }
}

describe('CampaignApplicationService', () => {
  it('sends persistence through the repository with the resolved audit actor', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);

    const campaign = await service.create(
      { name: '  Demo campaign  ', requestingUnit: ' Ban TT ', levelCode: 'CLV_01' },
      DEMO_ACTOR,
    );

    expect(campaign.code).toMatch(/^CPG-\d{6}-(?:[A-Z]\d[A-Z]\d|\d[A-Z]\d[A-Z])$/);
    expect(campaign.name).toBe('Demo campaign');
    expect(repository.recordedActor?.key).toBe('demo-superuser');
  });

  it('regenerates a legacy suffix without changing the Campaign identity or month', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Campaign', levelCode: 'CLV_01' }, DEMO_ACTOR);
    repository.campaign = { ...created, code: 'CPG-202610-8188', fieldValues: { ...created.fieldValues, campaign_code: 'CPG-202610-8188' } };
    const corrected = await service.regenerateCode(created.id, created.recordVersion, DEMO_ACTOR);
    expect(corrected.id).toBe(created.id);
    expect(corrected.code).toMatch(/^CPG-202610-/);
    expect(isCampaignCodeCompliant(corrected.code)).toBe(true);
    expect(corrected.fieldValues.campaign_code).toBe(corrected.code);
    expect(corrected.recordVersion).toBe(created.recordVersion + 1);
    expect(repository.recordedActor?.id).toBe(DEMO_ACTOR.id);
  });

  it('updates through the repository and keeps the resolved audit actor', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Campaign', requestingUnit: 'Ban TT', levelCode: 'CLV_01' }, DEMO_ACTOR);

    const updated = await service.update(
      created.id,
      { name: 'Campaign updated', requestingUnit: 'Ban TTBSP', lifecycleState: 'PLANNING', expectedVersion: created.recordVersion },
      DEMO_ACTOR,
    );

    expect(updated).toMatchObject({ name: 'Campaign updated', lifecycleState: 'PLANNING' });
    expect(repository.recordedActor?.key).toBe('demo-superuser');
  });

  it('rejects an invalid date range before persistence', async () => {
    const service = serviceFor(new RecordingRepository());
    await expect(service.create({
      name: 'Campaign',
      requestingUnit: 'Ban TT',
      levelCode: 'CLV_01',
      startDate: '2026-10-02',
      endDate: '2026-10-01',
    }, DEMO_ACTOR)).rejects.toThrow('ngày bắt đầu không được sau ngày kết thúc');
  });

  it('creates and updates historical effective/QCTT dates without losing the audit boundary', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name:'Chiến dịch lịch sử', levelCode:'CLV_01', startDate:'2000-01-01', endDate:'2000-02-01', effectiveStartDate:'2000-01-31', effectiveEndDate:'2000-02-01' }, DEMO_ACTOR);
    expect(created.startDate).toContain('2000-01-01');
    const updated = await service.update(created.id, { expectedVersion:created.recordVersion, startDate:'1999-12-31', effectiveStartDate:'2000-01-30' }, DEMO_ACTOR);
    expect(updated.startDate).toContain('1999-12-31');
    expect(repository.recordedActor?.key).toBe('demo-superuser');
  });

  it('returns one result per row when a batch is only partially valid', async () => {
    const service = serviceFor(new RecordingRepository());
    const result = await service.batchSave([
      {
        clientKey: 'row-valid',
        name: 'Campaign hợp lệ',
        requestingUnit: 'Ban TT',
        lifecycleState: 'DRAFT',
        levelCode: 'CLV_01',
        startDate: '2026-10-01',
        endDate: '2026-10-30',
      },
      {
        clientKey: 'row-invalid',
        name: 'Campaign sai ngày',
        requestingUnit: 'Ban TT',
        lifecycleState: 'DRAFT',
        levelCode: 'CLV_01',
        startDate: '2026-11-02',
        endDate: '2026-11-01',
      },
    ], DEMO_ACTOR);

    expect(result).toMatchObject({ ok: false, total: 2, succeeded: 1, failed: 1 });
    expect(result.items[0]).toMatchObject({ clientKey: 'row-valid', ok: true });
    expect(result.items[1]).toMatchObject({ clientKey: 'row-invalid', ok: false });
  });

  it('applies one audited lifecycle state to a selected Campaign batch', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Campaign', requestingUnit: 'Ban TT', levelCode: 'CLV_01' }, DEMO_ACTOR);

    const result = await service.bulkTransition([created.id], 'CM_ACCEPTED', DEMO_ACTOR);

    expect(result).toMatchObject({ ok: true, total: 1, succeeded: 1, failed: 0 });
    expect(result.items[0]?.campaign?.lifecycleState).toBe('CM_ACCEPTED');
    expect(repository.recordedActor?.key).toBe('demo-superuser');
  });

  it('rejects stale inline edits and supports recoverable trash before permanent deletion', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Chiến dịch', requestingUnit: '', levelCode: 'CLV_01' }, DEMO_ACTOR);

    await expect(service.update(created.id, {
      name: created.name,
      requestingUnit: created.requestingUnit,
      lifecycleState: created.lifecycleState,
      expectedVersion: created.recordVersion + 1,
    }, DEMO_ACTOR)).rejects.toThrow('đã được cập nhật ở nơi khác');

    const trashed = await service.moveToTrash(created.id, DEMO_ACTOR);
    expect(trashed).toMatchObject({ isDeleted: true, deletedByActorId: DEMO_ACTOR.id });
    const restored = await service.restore(created.id, DEMO_ACTOR);
    expect(restored.isDeleted).toBe(false);
    await service.moveToTrash(created.id, DEMO_ACTOR);
    await expect(service.deletePermanently(created.id, DEMO_ACTOR)).resolves.toMatchObject({ permanentlyDeleted: true });
  });

  it('requires only name and level for a new draft and leaves requesting unit empty', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);

    await expect(service.create({ name: 'Tối giản', levelCode: 'CLV_02' }, DEMO_ACTOR)).resolves.toMatchObject({
      name: 'Tối giản', requestingUnit: '', levelCode: 'CLV_02', lifecycleState: 'DRAFT',
    });
    await expect(service.create({ name: 'Thiếu cấp' }, DEMO_ACTOR)).rejects.toThrow('Cấp độ chiến dịch là bắt buộc');
    await expect(service.create({ name: '   ', levelCode: 'CLV_01' }, DEMO_ACTOR)).rejects.toThrow('Tên chiến dịch là bắt buộc');
  });

  it('performs a true partial patch and preserves unknown compatibility JSON keys', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({
      name: 'Bản gốc', levelCode: 'CLV_01',
      fieldValues: { unknown_legacy_key: { nested: ['A', 2, true] } },
    }, DEMO_ACTOR);

    const updated = await service.update(created.id, { name: 'Đổi tên', expectedVersion: 1 }, DEMO_ACTOR);

    expect(updated.fieldValues.unknown_legacy_key).toEqual({ nested: ['A', 2, true] });
    expect(repository.lastUpdateInput?.requestingUnit).toBeNull();
    expect(repository.lastUpdateInput?.startDate).toBeNull();
  });

  it('does not persist or emit another audit event for a no-op patch', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Không đổi', levelCode: 'CLV_01' }, DEMO_ACTOR);
    const result = await service.update(created.id, { name: created.name, expectedVersion: created.recordVersion }, DEMO_ACTOR, 'FORM');
    expect(result.recordVersion).toBe(created.recordVersion);
    expect(repository.updateCount).toBe(0);
  });

  it('keeps a legacy campaign editable without inventing a missing level', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    const created = await service.create({ name: 'Legacy seed', levelCode: 'CLV_01' }, DEMO_ACTOR);
    repository.campaign = {
      ...created,
      levelCode: null,
      normalizationStatus: 'NEEDS_NORMALIZATION',
      normalizationWarnings: [{ code: 'MISSING_LEVEL', fieldKey: 'campaign_level_code', message: 'Thiếu cấp.' }],
    };

    const updated = await service.update(created.id, { name: 'Legacy vẫn sửa được', expectedVersion: 1 }, DEMO_ACTOR);

    expect(updated.levelCode).toBeNull();
    expect(repository.lastUpdateInput?.normalizationStatus).toBe('NEEDS_NORMALIZATION');
  });

  it('validates objective OTHER, additional information and rich-text URL safety', async () => {
    const service = serviceFor(new RecordingRepository());
    await expect(service.create({ name: 'Objective', levelCode: 'CLV_01', primaryObjectiveCode: 'OTHER' }, DEMO_ACTOR))
      .rejects.toThrow('Cần nhập nội dung mục tiêu khác');
    await expect(service.create({
      name: 'Nhiều mục', levelCode: 'CLV_01',
      additionalInformation: Array.from({ length: 11 }, (_, index) => ({ id: String(index), label: 'Mục', value: '', order: index })),
    }, DEMO_ACTOR)).rejects.toThrow('không được vượt quá 10');
    await expect(service.create({
      name: 'Ảnh không an toàn', levelCode: 'CLV_01',
      descriptionRichText: { schemaVersion: 1, type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,abc' } }] },
    }, DEMO_ACTOR)).rejects.toThrow('chỉ chấp nhận URL HTTPS');
  });

  it('keeps multi-select values structured and KPI as free text', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    await service.create({
      name: 'Dữ liệu có cấu trúc',
      levelCode: 'CLV_03',
      kpiText: 'Tăng 12% mức độ nhận biết',
      marketCodes: ['M01', 'M02'],
      requestingUnits: [{ customName: 'Đơn vị phối hợp ngoài catalog' }],
    }, DEMO_ACTOR);

    expect(repository.lastCreateInput?.kpiText).toBe('Tăng 12% mức độ nhận biết');
    expect(repository.lastCreateInput?.markets).toEqual([
      { marketCode: 'M01', selectionOrigin: 'CUSTOM', selectionCode: null },
      { marketCode: 'M02', selectionOrigin: 'CUSTOM', selectionCode: null },
    ]);
    expect(repository.lastCreateInput?.requestingUnits).toEqual([
      { unitCode: null, customName: 'Đơn vị phối hợp ngoài catalog', displayOrder: 0 },
    ]);
    expect(typeof repository.lastCreateInput?.markets).not.toBe('string');
  });

  it('persists province codes only with Vietnam in the market snapshot', async () => {
    const repository = new RecordingRepository();
    const service = serviceFor(repository);
    await service.create({ name: 'Phạm vi kép', levelCode: 'CLV_01', marketCodes: ['VN', 'JP'], provinceCodes: ['01', '79'] }, DEMO_ACTOR);
    expect(repository.lastCreateInput?.provinces).toEqual(['01', '79']);
    await expect(service.create({ name: 'Thiếu Việt Nam', levelCode: 'CLV_01', marketCodes: ['JP'], provinceCodes: ['01'] }, DEMO_ACTOR)).rejects.toThrow('Chọn Việt Nam');
  });
});
