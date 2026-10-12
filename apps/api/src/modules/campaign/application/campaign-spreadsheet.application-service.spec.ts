import {
  DEMO_ACTOR,
  type ActorContext,
  type CampaignFieldValues,
  type CampaignSummary,
} from '@cpms/domain';
import type { SpreadsheetDocumentPort, TabularWorkbookData } from '@cpms/integrations';
import { describe, expect, it } from 'vitest';
import type { CatalogApplicationService } from '../../catalog/application/catalog.application-service';
import { CampaignApplicationService } from './campaign.application-service';
import { CampaignSpreadsheetApplicationService } from './campaign-spreadsheet.application-service';
import type { CampaignFields, CampaignRepository, PersistCampaignInput } from './campaign.repository';

class JsonDocumentAdapter implements SpreadsheetDocumentPort {
  async read(input: { content: Uint8Array }) { return JSON.parse(new TextDecoder().decode(input.content)) as TabularWorkbookData; }
  async write(input: TabularWorkbookData) { return new TextEncoder().encode(JSON.stringify(input)); }
}

function summary(code: string, name = 'Chiến dịch hiện tại', fieldValues: CampaignFieldValues = {}): CampaignSummary {
  return {
    id: `10000000-0000-4000-8000-${code.slice(-12).padStart(12, '0').replace(/[^A-Z0-9]/gi, '1')}`.slice(0, 36),
    code, name, requestingUnit: '', lifecycleState: 'DRAFT', startDate: null, endDate: null,
    effectiveStartDate: null, effectiveEndDate: null, levelCode: 'CLV_01', levelLabel: 'Cấp 1', levelRuleDescription: null,
    requestingEmployeeCode: null, requestingEmployeeName: null, manualRequesterEmail: null,
    primaryObjectiveCode: null, primaryObjectiveLabel: null, primaryObjectiveOther: null, kpiText: null,
    descriptionRichText: null, additionalInformation: [], dataSchemaVersion: 2, normalizationStatus: 'CURRENT', normalizationWarnings: [],
    markets: [], provinces: [], requestingUnits: [], fieldValues: { campaign_code: code, campaign_name: name, ...fieldValues },
    recordVersion: 1, isDeleted: false, deletedAt: null, deletedByActorId: null, updatedAt: new Date(0).toISOString(),
  };
}

class MemoryRepository implements CampaignRepository {
  async regenerateCodeWithAudit(): Promise<CampaignSummary> { throw new Error('Not supported by spreadsheet fixture.'); }
  records = new Map<string, CampaignSummary>();
  actors: ActorContext[] = [];
  constructor(...records: CampaignSummary[]) { records.forEach((record) => this.records.set(record.id, record)); }
  async list(trash: boolean) { return [...this.records.values()].filter((record) => record.isDeleted === trash); }
  async findById(id: string) { return this.records.get(id) ?? null; }
  async findByCode(code: string) { return [...this.records.values()].find((record) => record.code === code) ?? null; }
  async findSimilarCandidates() { return [...this.records.values()]; }
  async createWithAudit(input: PersistCampaignInput, actor: ActorContext) {
    const created = summary(input.code, input.name, input.fieldValues);
    created.id = crypto.randomUUID(); created.requestingUnit = input.requestingUnit ?? ''; created.lifecycleState = input.lifecycleState;
    created.levelCode = input.levelCode; created.startDate = input.startDate?.toISOString().slice(0, 10) ?? null; created.endDate = input.endDate?.toISOString().slice(0, 10) ?? null;
    created.effectiveStartDate = input.effectiveStartDate?.toISOString().slice(0, 10) ?? null; created.effectiveEndDate = input.effectiveEndDate?.toISOString().slice(0, 10) ?? null;
    created.primaryObjectiveCode = input.primaryObjectiveCode; created.primaryObjectiveOther = input.primaryObjectiveOther; created.kpiText = input.kpiText;
    created.descriptionRichText = input.descriptionRichText; created.additionalInformation = input.additionalInformation;
    created.requestingEmployeeCode = input.requestingEmployeeCode; created.manualRequesterEmail = input.manualRequesterEmail;
    created.markets = (input.markets ?? []).map((market) => ({ marketCode: market.marketCode, marketName: market.marketCode, regionCode: 'TEST', selectionOrigin: market.selectionOrigin, selectionCode: market.selectionCode }));
    created.provinces = (input.provinces ?? []).map((provinceCode) => ({ provinceCode, provinceName: provinceCode }));
    created.requestingUnits = (input.requestingUnits ?? []).map((unit, index) => ({ id: String(index), unitCode: unit.unitCode, displayName: unit.unitCode ?? unit.customName ?? '', customName: unit.customName, category: unit.unitCode ? 'QUICK_SELECT' : 'CUSTOM', order: index }));
    this.records.set(created.id, created); this.actors.push(actor); return created;
  }
  async updateWithAudit(id: string, input: CampaignFields, actor: ActorContext) {
    const current = this.records.get(id)!;
    const next: CampaignSummary = { ...current, name: input.name, requestingUnit: input.requestingUnit ?? '', lifecycleState: input.lifecycleState,
      startDate: input.startDate?.toISOString().slice(0, 10) ?? null, endDate: input.endDate?.toISOString().slice(0, 10) ?? null,
      effectiveStartDate: input.effectiveStartDate?.toISOString().slice(0, 10) ?? null, effectiveEndDate: input.effectiveEndDate?.toISOString().slice(0, 10) ?? null,
      levelCode: input.levelCode, requestingEmployeeCode: input.requestingEmployeeCode, manualRequesterEmail: input.manualRequesterEmail,
      primaryObjectiveCode: input.primaryObjectiveCode, primaryObjectiveOther: input.primaryObjectiveOther, kpiText: input.kpiText,
      descriptionRichText: input.descriptionRichText, additionalInformation: input.additionalInformation, fieldValues: input.fieldValues,
      recordVersion: current.recordVersion + 1, updatedAt: new Date().toISOString() };
    if (input.markets) next.markets = input.markets.map((market) => ({ marketCode: market.marketCode, marketName: market.marketCode, regionCode: 'TEST', selectionOrigin: market.selectionOrigin, selectionCode: market.selectionCode }));
    if (input.provinces) next.provinces = input.provinces.map((provinceCode) => ({ provinceCode, provinceName: provinceCode }));
    if (input.requestingUnits) next.requestingUnits = input.requestingUnits.map((unit, index) => ({ id: String(index), unitCode: unit.unitCode, displayName: unit.unitCode ?? unit.customName ?? '', customName: unit.customName, category: unit.unitCode ? 'QUICK_SELECT' : 'CUSTOM', order: index }));
    this.records.set(id, next); this.actors.push(actor); return next;
  }
  async moveToTrashWithAudit() { throw new Error('not used'); }
  async restoreWithAudit() { throw new Error('not used'); }
  async deletePermanentlyWithAudit() { throw new Error('not used'); }
}

const catalogs = {
  findCampaignLevel: async (code: string) => ({ code }), findCampaignObjective: async (code: string) => ({ code }),
  findPersonnel: async (code: string) => code === 'DEMO001' ? ({ employeeCode: code }) : null,
  resolveMarketSelection: async (codes: string[] = [], origin = 'CUSTOM', selectionCode?: string | null) => ({ marketCodes: origin === 'GLOBAL' ? ['VN', 'US'] : codes, origin, selectionCode: selectionCode ?? null }),
  requireOrganizationUnits: async (codes: string[]) => codes.map((code) => ({ code })),
  requireProvinces: async (codes: string[]) => codes,
} as unknown as CatalogApplicationService;

function services(...records: CampaignSummary[]) {
  const repository = new MemoryRepository(...records); const documents = new JsonDocumentAdapter();
  const campaigns = new CampaignApplicationService(repository, catalogs);
  return { repository, documents, spreadsheets: new CampaignSpreadsheetApplicationService(documents, repository, campaigns, catalogs) };
}

async function fileFor(documents: JsonDocumentAdapter, rows: TabularWorkbookData['sheets'][number]['rows']) {
  const content = await documents.write({ sheets: [{ name: 'Campaigns', rows }] });
  return { fileName: 'campaigns.xlsx', contentBase64: Buffer.from(content).toString('base64'), sheetName: 'Campaigns' };
}

describe('CampaignSpreadsheetApplicationService', () => {
  it('exports selected rows/visible fields and a canonical blank template', async () => {
    const first = summary('CPG-202609-ONE1'); const second = summary('CPG-202609-TWO2');
    const { spreadsheets, documents } = services(first, second);
    const selected = await spreadsheets.export({ mode: 'DATA', recordScope: 'SELECTED', campaignIds: [second.id], fieldScope: 'VISIBLE', fieldKeys: ['campaign_code', 'campaign_name'] });
    const decoded = await documents.read({ fileName: selected.fileName, content: Buffer.from(selected.contentBase64, 'base64') });
    expect(selected.rowCount).toBe(1); expect(decoded.sheets[1]?.rows[2]).toEqual([second.code, second.name]);
    const template = await spreadsheets.export({ mode: 'TEMPLATE', recordScope: 'ALL_CURRENT', fieldScope: 'CUSTOM', fieldKeys: ['campaign_name'] });
    const templateBook = await documents.read({ fileName: template.fileName, content: Buffer.from(template.contentBase64, 'base64') });
    expect(templateBook.sheets[1]?.rows[1]).toEqual(expect.arrayContaining(['campaign_code', 'campaign_name', 'campaign_level_code']));
    expect(template.rowCount).toBe(0);
  });

  it('previews CREATE/UPDATE/UNCHANGED/INVALID, round-trips arrays, audits mutations and preserves unknown legacy values', async () => {
    const existing = summary('CPG-202609-OLD1', 'Tên cũ', { unknown_legacy_key: 'keep-me' });
    const unchanged = summary('CPG-202609-SAME', 'Không đổi');
    const { spreadsheets, documents, repository } = services(existing, unchanged);
    const file = await fileFor(documents, [
      ['Mã', 'Tên', 'Cấp', 'Thị trường', 'Đơn vị'],
      ['campaign_code', 'campaign_name', 'campaign_level_code', 'market_codes', 'requesting_unit_codes'],
      ['CPG-202609-NEW1', 'Tạo mới có mã', 'CLV_02', '["VN","US"]', '["UNIT1"]'],
      ['', 'Tạo mới tự sinh mã', 'CLV_01', '["VN"]', '[]'],
      [existing.code, 'Tên đã cập nhật', 'CLV_01', '[]', '[]'],
      [unchanged.code, unchanged.name, 'CLV_01', '[]', '[]'],
      ['', 'Thiếu cấp', '', '[]', '[]'],
    ]);
    const preview = await spreadsheets.preview(file);
    expect(preview.rows.map((row) => row.status)).toEqual(['CREATE', 'CREATE', 'UPDATE', 'UNCHANGED', 'INVALID']);
    expect(preview.rows[2]?.diffs.some((diff) => diff.fieldKey === 'campaign_name')).toBe(true);
    const selected = preview.rows.filter((row) => ['CREATE', 'UPDATE'].includes(row.status));
    const keys = preview.mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []);
    const result = await spreadsheets.import({ ...file, mapping: preview.mapping, selectedRows: selected.map((row) => row.rowNumber), selectedFieldKeys: keys, decisions: preview.rows.map((row) => ({ rowNumber: row.rowNumber, action: row.status === 'CREATE' ? 'CREATE' : row.status === 'UPDATE' ? 'UPDATE' : 'SKIP', selectedFieldKeys: keys, ...(row.expectedVersion ? { expectedVersion: row.expectedVersion } : {}) })) }, DEMO_ACTOR);
    expect(result.succeeded).toBe(3); expect(repository.actors).toHaveLength(3); expect(repository.actors.every((actor) => actor.id === DEMO_ACTOR.id)).toBe(true);
    const updated = await repository.findByCode(existing.code); expect(updated?.fieldValues.unknown_legacy_key).toBe('keep-me'); expect(updated?.name).toBe('Tên đã cập nhật');
    const created = await repository.findByCode('CPG-202609-NEW1'); expect(created?.markets.map((market) => market.marketCode)).toEqual(['VN', 'US']); expect(created?.requestingUnits[0]?.unitCode).toBe('UNIT1');
    const auditCount = repository.actors.length;
    const secondPreview = await spreadsheets.preview(file); expect(secondPreview.rows[0]?.status).toBe('UNCHANGED');
    const second = await spreadsheets.import({ ...file, mapping: secondPreview.mapping, selectedRows: [3], selectedFieldKeys: keys, decisions: [{ rowNumber: 3, action: 'SKIP', selectedFieldKeys: keys }] }, DEMO_ACTOR);
    expect(second.processed).toBe(0); expect(repository.actors).toHaveLength(auditCount);
  });

  it('refuses stale expectedVersion and duplicate codes without creating duplicate campaigns', async () => {
    const existing = summary('CPG-202609-LOCK'); const { spreadsheets, documents, repository } = services(existing);
    const file = await fileFor(documents, [['Mã', 'Tên', 'Cấp'], ['campaign_code', 'campaign_name', 'campaign_level_code'], [existing.code, 'Tên mới', 'CLV_01']]);
    const preview = await spreadsheets.preview(file); existing.recordVersion += 1;
    const keys = preview.mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []);
    const result = await spreadsheets.import({ ...file, mapping: preview.mapping, selectedRows: [3], selectedFieldKeys: keys, decisions: [{ rowNumber: 3, action: 'UPDATE', selectedFieldKeys: keys, expectedVersion: 1 }] }, DEMO_ACTOR);
    expect(result.failed).toBe(1); expect(result.preview.rows[0]?.status).toBe('CONFLICT'); expect(repository.actors).toHaveLength(0);
    const duplicateFile = await fileFor(documents, [['Mã', 'Tên', 'Cấp'], ['campaign_code', 'campaign_name', 'campaign_level_code'], ['CPG-202609-DUP1', 'Một', 'CLV_01'], ['CPG-202609-DUP1', 'Hai', 'CLV_01']]);
    const duplicate = await spreadsheets.preview(duplicateFile); expect(duplicate.rows.every((row) => row.status === 'CONFLICT')).toBe(true);
  });

  it('compares Google-style tabular data as SAME, DIFFERENT, ONLY_IN_SHEET, ONLY_IN_CPMS and INVALID', async () => {
    const same = summary('CPG-202609-SAME', 'Giống nhau');
    const different = summary('CPG-202609-DIFF', 'Tên trong CPMS');
    const onlyCpms = summary('CPG-202609-CPMS', 'Chỉ có CPMS');
    const { spreadsheets } = services(same, different, onlyCpms);
    const workbook: TabularWorkbookData = { sheets: [{ name: 'Nguồn', rows: [
      ['Mã', 'Tên', 'Cấp'],
      ['campaign_code', 'campaign_name', 'campaign_level_code'],
      [same.code, same.name, 'CLV_01'],
      [different.code, 'Tên khác', 'CLV_01'],
      ['CPG-202609-SHEET', 'Chỉ có Sheet', 'CLV_02'],
      ['', 'Dòng lỗi', ''],
    ] }] };
    const result = await spreadsheets.compareWorkbook(workbook, {
      sheetName: 'Nguồn', selectedFieldKeys: ['campaign_code', 'campaign_name', 'campaign_level_code'],
      timeBasis: 'COMMUNICATION', includeOnlyOneSide: true,
    });
    expect(result.rows.map((row) => row.status).sort()).toEqual(['DIFFERENT', 'INVALID', 'ONLY_IN_CPMS', 'ONLY_IN_SHEET', 'SAME'].sort());
    expect(result.counts).toMatchObject({ SAME: 1, DIFFERENT: 1, ONLY_IN_SHEET: 1, ONLY_IN_CPMS: 1, INVALID: 1 });
  });
});
