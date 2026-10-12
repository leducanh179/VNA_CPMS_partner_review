import {
  CAMPAIGN_FIELD_DEFINITIONS,
  CAMPAIGN_LEVEL_CODES,
  CAMPAIGN_LIFECYCLE_STATES,
  CAMPAIGN_MARKET_SELECTION_ORIGINS,
  CAMPAIGN_OBJECTIVE_CODES,
  CAMPAIGN_SPREADSHEET_FIELDS,
  validateCampaignRichText,
  type ActorContext,
  type CampaignChangeSource,
  type CampaignAdditionalInformationItem,
  type CampaignRequestingUnitInput,
  type CampaignSpreadsheetExportRequest,
  type CampaignSpreadsheetExportResult,
  type CampaignSpreadsheetCompareRequest,
  type CampaignSpreadsheetComparisonResult,
  type CampaignSpreadsheetComparisonRow,
  type CampaignSpreadsheetComparisonStatus,
  type CampaignSpreadsheetFieldKey,
  type CampaignSpreadsheetImportRequest,
  type CampaignSpreadsheetImportResult,
  type CampaignSpreadsheetInspectResult,
  type CampaignSpreadsheetMapping,
  type CampaignSpreadsheetPreviewRequest,
  type CampaignSpreadsheetPreviewResult,
  type CampaignSpreadsheetPreviewRow,
  type CampaignSpreadsheetRowStatus,
  type CampaignSpreadsheetTypedRow,
  type CampaignSpreadsheetValue,
  type CampaignSummary,
  type CreateCampaignCommand,
  type UpdateCampaignCommand,
} from '@cpms/domain';
import { SPREADSHEET_DOCUMENT_PORT, type SpreadsheetDocumentPort, type TabularWorkbookData } from '@cpms/integrations';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CatalogApplicationService } from '../../catalog/application/catalog.application-service';
import { CampaignApplicationService } from './campaign.application-service';
import { CAMPAIGN_REPOSITORY, type CampaignRepository } from './campaign.repository';

const MAX_FILE_BYTES = 6_000_000;
const MAX_IMPORT_ROWS = 1_000;
const FIELD_BY_KEY = new Map(CAMPAIGN_SPREADSHEET_FIELDS.map((field) => [field.key, field]));
const FIELD_BY_LABEL = new Map(CAMPAIGN_SPREADSHEET_FIELDS.map((field) => [field.label.trim().toLocaleLowerCase('vi'), field]));
const GRID_TO_EXCHANGE: Readonly<Record<string, CampaignSpreadsheetFieldKey>> = {
  campaign_code: 'campaign_code', campaign_name: 'campaign_name', campaign_level_code: 'campaign_level_code',
  campaign_lifecycle_state: 'campaign_lifecycle_state', campaign_effect_start_date: 'campaign_effect_start_date',
  campaign_effect_end_date: 'campaign_effect_end_date', campaign_comm_start_date: 'campaign_comm_start_date',
  campaign_comm_end_date: 'campaign_comm_end_date', campaign_objective: 'primary_objective_code',
  kpi_primary: 'kpi_text', content_pillar_l1_code: 'content_pillar_l1_code', content_pillar_l2_code: 'content_pillar_l2_code',
  market: 'market_codes', requesting_unit: 'requesting_unit_codes', requesting_person: 'requesting_employee_code',
  additional_information: 'additional_information_json', request_campaign_description: 'description_rich_text_json',
};

function text(value: unknown) { return value === null || value === undefined ? '' : String(value).trim(); }
function nullableText(value: CampaignSpreadsheetValue | undefined) { const result = text(value); return result || null; }
function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function jsonArray(value: CampaignSpreadsheetValue | undefined, label: string): string[] {
  const source = text(value);
  if (!source) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error(`${label} phải là mảng JSON, ví dụ ["VN","US"].`); }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error(`${label} phải là mảng JSON gồm các chuỗi.`);
  return [...new Set(parsed.map((item) => item.trim()).filter(Boolean))];
}
function jsonObject<T>(value: CampaignSpreadsheetValue | undefined, label: string, fallback: T): T {
  const source = text(value);
  if (!source) return fallback;
  try { return JSON.parse(source) as T; } catch { throw new Error(`${label} phải là JSON hợp lệ.`); }
}
function richTextPlainText(campaign: CampaignSummary) {
  const chunks: string[] = [];
  const walk = (node: { text?: string; attrs?: { alt?: string }; content?: unknown[] }) => {
    if (node.text) chunks.push(node.text);
    if (node.attrs?.alt) chunks.push(node.attrs.alt);
    for (const child of node.content ?? []) if (child && typeof child === 'object') walk(child as typeof node);
  };
  if (campaign.descriptionRichText) walk(campaign.descriptionRichText);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class CampaignSpreadsheetApplicationService {
  constructor(
    @Inject(SPREADSHEET_DOCUMENT_PORT) private readonly documents: SpreadsheetDocumentPort,
    @Inject(CAMPAIGN_REPOSITORY) private readonly repository: CampaignRepository,
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CatalogApplicationService) private readonly catalogs: CatalogApplicationService,
  ) {}

  async inspect(file: { fileName: string; mimeType?: string; contentBase64: string }): Promise<CampaignSpreadsheetInspectResult> {
    const workbook = await this.read(file);
    return this.inspectWorkbook(workbook);
  }

  inspectWorkbook(workbook: TabularWorkbookData): CampaignSpreadsheetInspectResult {
    return {
      sheets: workbook.sheets.filter((sheet) => sheet.rows.some((row) => row.some((value) => text(value)))).map((sheet) => {
        const { headers, canonicalKeys, dataRows } = this.sheetShape(sheet.rows);
        return { name: sheet.name, rowCount: dataRows.length, headers, canonicalKeys };
      }),
      fields: CAMPAIGN_SPREADSHEET_FIELDS,
    };
  }

  async export(request: CampaignSpreadsheetExportRequest): Promise<CampaignSpreadsheetExportResult> {
    const prepared = await this.exportWorkbook(request);
    const content = await this.documents.write(prepared.workbook);
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return {
      fileName: request.mode === 'TEMPLATE' ? `CPMS_Campaign_Template_${stamp}.xlsx` : `CPMS_Campaign_Export_${stamp}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: Buffer.from(content).toString('base64'),
      rowCount: prepared.rowCount,
      fieldKeys: prepared.fieldKeys,
    };
  }

  async exportWorkbook(request: CampaignSpreadsheetExportRequest) {
    const campaigns = await this.exportableCampaigns(request);
    if (request.mode === 'DATA' && request.recordScope !== 'ALL_CURRENT' && !request.campaignIds?.length) {
      throw new BadRequestException('Phạm vi đã chọn không có chiến dịch để xuất.');
    }
    const selectedFields = this.exportFields(request);
    const legacyFields = request.includeLegacyReadOnly
      ? CAMPAIGN_FIELD_DEFINITIONS.filter((field) => field.status !== 'ACTIVE_V2').map((field) => ({ key: `legacy:${field.key}`, label: `${field.label} [chỉ đọc]` }))
      : [];
    const rows: Array<Array<string | number | boolean | null>> = [
      [...selectedFields.map((field) => field.label), ...legacyFields.map((field) => field.label)],
      [...selectedFields.map((field) => field.key), ...legacyFields.map((field) => field.key)],
      ...campaigns.map((campaign) => [
        ...selectedFields.map((field) => this.campaignValue(campaign, field.key)),
        ...legacyFields.map((field) => this.legacyValue(campaign, field.key.slice('legacy:'.length))),
      ]),
    ];
    const workbook: TabularWorkbookData = { sheets: [
      { name: 'Hướng dẫn', rows: [
        ['Campaign Spreadsheet Exchange', 'Hướng dẫn ngắn'],
        ['Định danh', 'Mã chiến dịch là khóa cập nhật; để trống mã chỉ khi tạo mới.'],
        ['Cột kỹ thuật', 'Dòng canonical key đang được ẩn trong sheet Campaigns; không xóa hoặc đổi dòng này.'],
        ['Ngày tháng', 'Dùng định dạng YYYY-MM-DD.'],
        ['Nhiều lựa chọn', 'Dùng mảng JSON theo mã chuẩn, ví dụ ["VN","US"]. Không dùng chuỗi ghép dấu chấm phẩy.'],
        ['Rich text', 'Giữ cột JSON chuẩn để round-trip; cột dễ đọc chỉ dùng để tham khảo. Ảnh/link chỉ chấp nhận HTTPS.'],
        ['An toàn', 'Nhập file luôn qua bước preview và xác nhận; không có ghi đè âm thầm.'],
      ] },
      { name: 'Campaigns', rows },
    ] };
    return { workbook, rowCount: campaigns.length, fieldKeys: [...selectedFields.map((field) => field.key), ...legacyFields.map((field) => field.key)] };
  }

  protected async exportableCampaigns(request: CampaignSpreadsheetExportRequest): Promise<CampaignSummary[]> {
    const all = request.mode === 'TEMPLATE' ? [] : await this.campaigns.list(false);
    const requestedIds = new Set(request.campaignIds ?? []);
    return request.recordScope === 'ALL_CURRENT' ? all : all.filter((campaign) => requestedIds.has(campaign.id));
  }

  async preview(request: CampaignSpreadsheetPreviewRequest): Promise<CampaignSpreadsheetPreviewResult> {
    const workbook = await this.read(request);
    return this.previewWorkbook(workbook, request);
  }

  async previewWorkbook(
    workbook: TabularWorkbookData,
    request: Pick<CampaignSpreadsheetPreviewRequest, 'sheetName' | 'mapping' | 'selectedRows' | 'selectedFieldKeys'>,
  ): Promise<CampaignSpreadsheetPreviewResult> {
    const sheet = workbook.sheets.find((candidate) => candidate.name === request.sheetName);
    if (!sheet) throw new BadRequestException('Không tìm thấy sheet đã chọn.');
    const { headers, canonicalKeys, dataRows, firstDataRow } = this.sheetShape(sheet.rows);
    const mapping = this.mapping(headers, canonicalKeys, request.mapping, request.selectedFieldKeys);
    const selectedRows = request.selectedRows ? new Set(request.selectedRows) : null;
    const rows: CampaignSpreadsheetPreviewRow[] = [];
    for (const [offset, raw] of dataRows.slice(0, MAX_IMPORT_ROWS).entries()) {
      const rowNumber = firstDataRow + offset + 1;
      if (!raw.some((value) => text(value))) continue;
      rows.push(await this.previewRow(rowNumber, raw, mapping, !selectedRows || selectedRows.has(rowNumber)));
    }
    const byCode = new Map<string, CampaignSpreadsheetPreviewRow[]>();
    for (const row of rows) if (row.code && row.status !== 'SKIP') byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);
    for (const duplicateRows of byCode.values()) if (duplicateRows.length > 1) {
      for (const row of duplicateRows) {
        row.status = 'CONFLICT';
        row.errors.push('Mã chiến dịch xuất hiện nhiều lần trong cùng file. Hãy chỉ giữ một dòng cho mỗi mã.');
      }
    }
    return { sheetName: sheet.name, mapping, rows, counts: this.counts(rows) };
  }

  async import(request: CampaignSpreadsheetImportRequest, actor: ActorContext, source: CampaignChangeSource = 'XLSX_CSV'): Promise<CampaignSpreadsheetImportResult> {
    const workbook = await this.read(request);
    return this.importWorkbook(workbook, request, actor, source);
  }

  async importWorkbook(
    workbook: TabularWorkbookData,
    request: Pick<CampaignSpreadsheetImportRequest, 'sheetName' | 'mapping' | 'selectedRows' | 'selectedFieldKeys' | 'decisions'>,
    actor: ActorContext,
    source: CampaignChangeSource = 'XLSX_CSV',
  ): Promise<CampaignSpreadsheetImportResult> {
    const selectedRows = request.decisions.filter((decision) => decision.action !== 'SKIP').map((decision) => decision.rowNumber);
    const preview = await this.previewWorkbook(workbook, { ...request, selectedRows });
    const rowByNumber = new Map(preview.rows.map((row) => [row.rowNumber, row]));
    const items: CampaignSpreadsheetImportResult['items'] = [];
    let processed = 0;
    for (const decision of request.decisions) {
      if (decision.action === 'SKIP') continue;
      processed += 1;
      const row = rowByNumber.get(decision.rowNumber);
      const clientKey = `spreadsheet-${decision.rowNumber}`;
      if (row && decision.expectedVersion !== undefined && row.expectedVersion !== decision.expectedVersion) {
        row.status = 'CONFLICT';
        row.errors.push('Chiến dịch đã thay đổi sau khi preview. Hãy tải lại dữ liệu.');
      }
      if (!row || row.status === 'INVALID' || row.status === 'CONFLICT' || row.status === 'SKIP') {
        items.push({ clientKey, ...(row?.campaignId ? { id: row.campaignId } : {}), ok: false, message: row?.errors.join(' ') || 'Dòng không thể nhập.' });
        continue;
      }
      try {
        items.push(await this.applyImportDecision(row, decision, actor, source));
      } catch (error) {
        items.push({ clientKey, ...(row?.campaignId ? { id: row.campaignId } : {}), ok: false, message: error instanceof Error ? error.message : 'Không thể nhập dòng.' });
      }
    }
    const succeeded = items.filter((item) => item.ok).length;
    preview.counts = this.counts(preview.rows);
    return { preview, processed, succeeded, failed: items.length - succeeded, items };
  }

  protected async applyImportDecision(row: CampaignSpreadsheetPreviewRow, decision: CampaignSpreadsheetImportRequest['decisions'][number], actor: ActorContext, source: CampaignChangeSource): Promise<CampaignSpreadsheetImportResult['items'][number]> {
    const clientKey = `spreadsheet-${decision.rowNumber}`; const selected = new Set(decision.selectedFieldKeys);
    if (decision.action === 'CREATE') {
      if (row.status !== 'CREATE') throw new Error('Dòng này không còn ở trạng thái CREATE. Hãy tải lại preview.');
      const campaign = await this.campaigns.create(this.toCreate(row, selected), actor, source);
      return { clientKey, id: campaign.id, ok: true, campaign };
    }
    if (!row.campaignId || !row.expectedVersion || !['UPDATE', 'UNCHANGED'].includes(row.status)) throw new Error('Dòng này không thể cập nhật. Hãy tải lại preview.');
    if (decision.expectedVersion === undefined || decision.expectedVersion !== row.expectedVersion) throw new Error('CONFLICT: chiến dịch đã thay đổi sau khi preview. Hãy tải lại dữ liệu.');
    if (row.status === 'UNCHANGED') return { clientKey, id: row.campaignId, ok: true };
    const campaign = await this.campaigns.update(row.campaignId, this.toUpdate(row, selected, decision.expectedVersion), actor, source);
    return { clientKey, id: campaign.id, ok: true, campaign };
  }

  async compareWorkbook(
    workbook: TabularWorkbookData,
    request: Omit<CampaignSpreadsheetCompareRequest, 'spreadsheetUrl'>,
  ): Promise<Omit<CampaignSpreadsheetComparisonResult, 'spreadsheet'>> {
    const preview = await this.previewWorkbook(workbook, request);
    const selectedFieldKeys = request.selectedFieldKeys?.length
      ? [...new Set(request.selectedFieldKeys)]
      : [...new Set(preview.mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []))];
    const fields = selectedFieldKeys.map((key) => FIELD_BY_KEY.get(key)).filter((field): field is NonNullable<typeof field> => Boolean(field));
    if (!fields.length) throw new BadRequestException('Hãy chọn ít nhất một trường để đối chiếu.');
    const allCampaigns = await this.campaigns.list(false);
    const campaigns = allCampaigns.filter((campaign) => this.campaignInTimeRange(campaign, request));
    const campaignByCode = new Map(campaigns.map((campaign) => [campaign.code, campaign]));
    const allCampaignByCode = new Map(allCampaigns.map((campaign) => [campaign.code, campaign]));
    const seenCodes = new Set<string>();
    const rows: CampaignSpreadsheetComparisonRow[] = [];

    for (const source of preview.rows) {
      if (source.status === 'SKIP') continue;
      const campaign = source.code ? campaignByCode.get(source.code) ?? null : null;
      if (source.code && allCampaignByCode.has(source.code) && !campaign) continue;
      if (campaign && source.code) seenCodes.add(source.code);
      if (!campaign && !this.sourceRowInTimeRange(source, request)) {
        if (source.status !== 'INVALID' && source.status !== 'CONFLICT') continue;
      }
      const invalid = source.status === 'INVALID' || source.status === 'CONFLICT';
      const status: CampaignSpreadsheetComparisonStatus = invalid ? 'INVALID' : campaign ? (fields.some((field) => !this.equalValue(this.campaignValue(campaign, field.key), source.values[field.key])) ? 'DIFFERENT' : 'SAME') : 'ONLY_IN_SHEET';
      if (!request.includeOnlyOneSide && status === 'ONLY_IN_SHEET') continue;
      rows.push({
        code: source.code,
        name: source.name ?? campaign?.name ?? null,
        sourceRowNumber: source.rowNumber,
        campaignId: campaign?.id ?? null,
        status,
        errors: [...source.errors],
        fields: fields.map((field) => {
          const sheetValue = source.values[field.key] ?? null;
          const cpmsValue = campaign ? this.campaignValue(campaign, field.key) : null;
          const fieldStatus: CampaignSpreadsheetComparisonStatus = invalid ? 'INVALID' : !campaign ? 'ONLY_IN_SHEET' : this.equalValue(cpmsValue, sheetValue) ? 'SAME' : 'DIFFERENT';
          return { fieldKey: field.key, label: field.label, sheetValue, cpmsValue, status: fieldStatus, note: invalid ? source.errors.join(' ') || 'Dữ liệu nguồn không hợp lệ.' : null };
        }),
      });
    }

    if (request.includeOnlyOneSide) {
      for (const campaign of campaigns) {
        if (seenCodes.has(campaign.code)) continue;
        rows.push({
          code: campaign.code,
          name: campaign.name,
          sourceRowNumber: null,
          campaignId: campaign.id,
          status: 'ONLY_IN_CPMS',
          errors: [],
          fields: fields.map((field) => ({ fieldKey: field.key, label: field.label, sheetValue: null, cpmsValue: this.campaignValue(campaign, field.key), status: 'ONLY_IN_CPMS', note: null })),
        });
      }
    }

    const counts: Record<CampaignSpreadsheetComparisonStatus, number> = { SAME: 0, DIFFERENT: 0, ONLY_IN_SHEET: 0, ONLY_IN_CPMS: 0, INVALID: 0 };
    for (const row of rows) counts[row.status] += 1;
    return { rows, counts, selectedFieldKeys };
  }

  private async read(file: { fileName: string; mimeType?: string; contentBase64: string }) {
    if (!/\.(xlsx|csv)$/i.test(file.fileName)) throw new BadRequestException('Chỉ chấp nhận file .xlsx hoặc .csv.');
    const content = Buffer.from(file.contentBase64, 'base64');
    if (!content.length || content.length > MAX_FILE_BYTES) throw new BadRequestException('File phải có dung lượng từ 1 byte đến 6 MB.');
    try { return await this.documents.read({ fileName: file.fileName, ...(file.mimeType ? { mimeType: file.mimeType } : {}), content }); }
    catch { throw new BadRequestException('Không thể đọc file spreadsheet. Hãy kiểm tra định dạng và thử lại.'); }
  }

  private sheetShape(rows: TabularWorkbookData['sheets'][number]['rows']) {
    const headers = (rows[0] ?? []).map(text);
    const candidateKeys = (rows[1] ?? []).map(text);
    const hasCanonicalRow = candidateKeys.some((key) => FIELD_BY_KEY.has(key as CampaignSpreadsheetFieldKey) || key.startsWith('legacy:'));
    return { headers, canonicalKeys: headers.map((_, index) => hasCanonicalRow ? candidateKeys[index] || null : null), dataRows: rows.slice(hasCanonicalRow ? 2 : 1), firstDataRow: hasCanonicalRow ? 2 : 1 };
  }

  private mapping(headers: string[], canonicalKeys: Array<string | null>, requested?: CampaignSpreadsheetMapping[], selectedKeys?: CampaignSpreadsheetFieldKey[]) {
    const selected = selectedKeys ? new Set(selectedKeys) : null;
    return headers.map((header, columnIndex): CampaignSpreadsheetMapping => {
      const override = requested?.find((item) => item.columnIndex === columnIndex);
      const keyCandidate = override?.fieldKey ?? canonicalKeys[columnIndex] ?? FIELD_BY_LABEL.get(header.trim().toLocaleLowerCase('vi'))?.key ?? null;
      const fieldKey = keyCandidate && FIELD_BY_KEY.has(keyCandidate as CampaignSpreadsheetFieldKey) ? keyCandidate as CampaignSpreadsheetFieldKey : null;
      const enabled = Boolean(fieldKey) && Boolean(FIELD_BY_KEY.get(fieldKey!)?.importable) && (!selected || selected.has(fieldKey!));
      return { columnIndex, sourceHeader: header, fieldKey: enabled ? fieldKey : null, recognized: Boolean(fieldKey) };
    });
  }

  protected async previewRow(rowNumber: number, raw: Array<string | number | boolean | null>, mapping: CampaignSpreadsheetMapping[], selected: boolean): Promise<CampaignSpreadsheetPreviewRow> {
    const values: CampaignSpreadsheetPreviewRow['values'] = {};
    for (const item of mapping) if (item.fieldKey && FIELD_BY_KEY.get(item.fieldKey)?.importable) values[item.fieldKey] = raw[item.columnIndex] ?? null;
    const code = nullableText(values.campaign_code)?.toUpperCase() ?? null;
    const name = nullableText(values.campaign_name);
    if (!selected) return { rowNumber, selected, status: 'SKIP' as const, code, name, campaignId: null, expectedVersion: null, values, diffs: [], errors: [] };
    const existing = code ? await this.lookupCampaignForPreview(code) : null;
    const errors = await this.validateValues(values, !existing);
    const deletedConflict = Boolean(existing?.isDeleted);
    if (deletedConflict) errors.push('Mã chiến dịch đang nằm trong Thùng rác. Hãy phục hồi trước khi nhập.');
    const diffs = existing ? Object.entries(values).flatMap(([key, incoming]) => {
      const fieldKey = key as CampaignSpreadsheetFieldKey;
      const current = this.campaignValue(existing, fieldKey);
      return this.equalValue(current, incoming) ? [] : [{ fieldKey, label: FIELD_BY_KEY.get(fieldKey)!.label, currentValue: current, incomingValue: incoming ?? null }];
    }) : [];
    const status: CampaignSpreadsheetRowStatus = deletedConflict ? 'CONFLICT' : errors.length ? 'INVALID' : existing ? (diffs.length ? 'UPDATE' : 'UNCHANGED') : 'CREATE';
    return { rowNumber, selected, status, code, name, campaignId: existing?.id ?? null, expectedVersion: existing?.recordVersion ?? null, values, diffs, errors };
  }

  protected lookupCampaignForPreview(code: string): Promise<CampaignSummary | null> { return this.repository.findByCode(code); }

  private async validateValues(values: CampaignSpreadsheetPreviewRow['values'], creating: boolean) {
    const errors: string[] = [];
    const name = nullableText(values.campaign_name);
    const level = nullableText(values.campaign_level_code);
    if ((creating || Object.hasOwn(values, 'campaign_name')) && !name) errors.push('Tên chiến dịch không được để trống khi chọn nhập cột này.');
    if ((creating || Object.hasOwn(values, 'campaign_level_code')) && !level) errors.push('Cấp chiến dịch không được để trống khi chọn nhập cột này.');
    if (level && !(CAMPAIGN_LEVEL_CODES as readonly string[]).includes(level)) errors.push('Cấp chiến dịch phải là CLV_01, CLV_02 hoặc CLV_03.');
    const lifecycle = nullableText(values.campaign_lifecycle_state);
    if (Object.hasOwn(values, 'campaign_lifecycle_state') && !lifecycle) errors.push('Trạng thái chiến dịch không được để trống khi chọn nhập cột này.');
    if (lifecycle && !(CAMPAIGN_LIFECYCLE_STATES as readonly string[]).includes(lifecycle)) errors.push('Trạng thái chiến dịch không hợp lệ.');
    for (const [startKey, endKey, label] of [
      ['campaign_comm_start_date', 'campaign_comm_end_date', 'Thời gian QCTT'],
      ['campaign_effect_start_date', 'campaign_effect_end_date', 'Thời gian hiệu lực'],
    ] as const) {
      const start = nullableText(values[startKey]); const end = nullableText(values[endKey]);
      if (start && !isDate(start)) errors.push(`${label}: ngày bắt đầu phải theo YYYY-MM-DD.`);
      if (end && !isDate(end)) errors.push(`${label}: ngày kết thúc phải theo YYYY-MM-DD.`);
      if (start && end && isDate(start) && isDate(end) && start > end) errors.push(`${label}: ngày bắt đầu không được sau ngày kết thúc.`);
    }
    const objective = nullableText(values.primary_objective_code);
    if (objective && !(CAMPAIGN_OBJECTIVE_CODES as readonly string[]).includes(objective)) errors.push('Mã mục tiêu chính không hợp lệ.');
    if (objective === 'OTHER' && !nullableText(values.primary_objective_other)) errors.push('Cần nhập nội dung mục tiêu khác khi chọn OTHER.');
    try {
      const marketCodes = jsonArray(values.market_codes, 'Mã thị trường');
      const origin = nullableText(values.market_selection_origin);
      if (origin && !(CAMPAIGN_MARKET_SELECTION_ORIGINS as readonly string[]).includes(origin)) errors.push('Cách chọn thị trường không hợp lệ.');
      if (marketCodes.length || origin) await this.catalogs.resolveMarketSelection(marketCodes, (origin || 'CUSTOM') as never, nullableText(values.market_selection_code));
      const unitCodes = jsonArray(values.requesting_unit_codes, 'Mã đơn vị yêu cầu');
      await this.catalogs.requireOrganizationUnits(unitCodes);
      jsonArray(values.requesting_unit_other, 'Đơn vị yêu cầu khác');
      const employeeCode = nullableText(values.requesting_employee_code);
      if (employeeCode && !await this.catalogs.findPersonnel(employeeCode)) errors.push('Không tìm thấy mã nhân sự yêu cầu trong danh bạ.');
      const email = nullableText(values.manual_requester_email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email người yêu cầu không hợp lệ.');
      if (employeeCode && email) errors.push('Chỉ chọn nhân sự hoặc email nhập tay, không dùng đồng thời.');
      const additional = jsonObject<CampaignAdditionalInformationItem[]>(values.additional_information_json, 'Thông tin bổ sung', []);
      if (!Array.isArray(additional) || additional.length > 10 || additional.some((item) => !item || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string' || !item.label.trim() || typeof item.value !== 'string')) {
        errors.push('Thông tin bổ sung phải là mảng JSON tối đa 10 dòng; mỗi dòng cần id, label và value dạng chuỗi.');
      }
      const richText = jsonObject<CampaignSummary['descriptionRichText']>(values.description_rich_text_json, 'Mô tả rich text', null);
      if (richText) errors.push(...validateCampaignRichText(richText));
      const pillarCodes = [nullableText(values.content_pillar_l1_code), nullableText(values.content_pillar_l2_code)].filter((value): value is string => Boolean(value));
      if (pillarCodes.length) {
        const pillars = await this.catalogs.listContentPillars(2026);
        const known = new Set(pillars.map((pillar) => pillar.code));
        const unknown = pillarCodes.filter((code) => !known.has(code));
        if (unknown.length) errors.push(`Mã trụ cột/chủ đề không có trong catalog: ${unknown.join(', ')}.`);
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Dữ liệu JSON không hợp lệ.'); }
    return [...new Set(errors)];
  }

  private toTyped(values: CampaignSpreadsheetPreviewRow['values']): CampaignSpreadsheetTypedRow {
    const origin = nullableText(values.market_selection_origin);
    const code = nullableText(values.campaign_code)?.toUpperCase();
    const name = nullableText(values.campaign_name) ?? undefined;
    const levelCode = nullableText(values.campaign_level_code) as Exclude<CampaignSpreadsheetTypedRow['levelCode'], undefined>;
    const lifecycleState = nullableText(values.campaign_lifecycle_state) as CampaignSpreadsheetTypedRow['lifecycleState'];
    const primaryObjectiveCode = nullableText(values.primary_objective_code) as Exclude<CampaignSpreadsheetTypedRow['primaryObjectiveCode'], undefined>;
    return {
      ...(code ? { code } : {}), ...(name ? { name } : {}), levelCode, ...(lifecycleState ? { lifecycleState } : {}),
      effectiveStartDate: nullableText(values.campaign_effect_start_date), effectiveEndDate: nullableText(values.campaign_effect_end_date),
      startDate: nullableText(values.campaign_comm_start_date), endDate: nullableText(values.campaign_comm_end_date),
      primaryObjectiveCode,
      primaryObjectiveOther: nullableText(values.primary_objective_other), kpiText: nullableText(values.kpi_text),
      descriptionRichText: jsonObject(values.description_rich_text_json, 'Mô tả rich text', null),
      contentPillarL1Code: nullableText(values.content_pillar_l1_code), contentPillarL2Code: nullableText(values.content_pillar_l2_code),
      marketCodes: jsonArray(values.market_codes, 'Mã thị trường'),
      ...(origin ? { marketSelectionOrigin: origin as Exclude<CampaignSpreadsheetTypedRow['marketSelectionOrigin'], undefined> } : {}),
      marketSelectionCode: nullableText(values.market_selection_code),
      requestingUnitCodes: jsonArray(values.requesting_unit_codes, 'Mã đơn vị yêu cầu'),
      requestingUnitOther: jsonArray(values.requesting_unit_other, 'Đơn vị yêu cầu khác'),
      requestingEmployeeCode: nullableText(values.requesting_employee_code), manualRequesterEmail: nullableText(values.manual_requester_email),
      additionalInformation: jsonObject(values.additional_information_json, 'Thông tin bổ sung', []),
    };
  }

  private toCreate(row: CampaignSpreadsheetPreviewRow, selected: Set<CampaignSpreadsheetFieldKey>): CreateCampaignCommand {
    const typed = this.toTyped(row.values);
    if (!typed.name || !typed.levelCode) throw new Error('Dòng mới cần tên và cấp chiến dịch.');
    return { ...this.commandFields(typed, selected), ...(selected.has('campaign_code') && typed.code ? { code: typed.code } : {}), name: typed.name, levelCode: typed.levelCode };
  }

  private toUpdate(row: CampaignSpreadsheetPreviewRow, selected: Set<CampaignSpreadsheetFieldKey>, expectedVersion: number): UpdateCampaignCommand {
    return { ...this.commandFields(this.toTyped(row.values), selected), expectedVersion };
  }

  private commandFields(typed: CampaignSpreadsheetTypedRow, selected: Set<CampaignSpreadsheetFieldKey>): CreateCampaignCommand | UpdateCampaignCommand {
    const output: CreateCampaignCommand | UpdateCampaignCommand = {} as UpdateCampaignCommand;
    const assign = <K extends keyof CampaignSpreadsheetTypedRow, O extends keyof UpdateCampaignCommand>(key: K, target: O, field: CampaignSpreadsheetFieldKey) => {
      if (selected.has(field)) (output as Record<string, unknown>)[target] = typed[key];
    };
    assign('name', 'name', 'campaign_name'); assign('levelCode', 'levelCode', 'campaign_level_code'); assign('lifecycleState', 'lifecycleState', 'campaign_lifecycle_state');
    assign('effectiveStartDate', 'effectiveStartDate', 'campaign_effect_start_date'); assign('effectiveEndDate', 'effectiveEndDate', 'campaign_effect_end_date');
    assign('startDate', 'startDate', 'campaign_comm_start_date'); assign('endDate', 'endDate', 'campaign_comm_end_date');
    assign('primaryObjectiveCode', 'primaryObjectiveCode', 'primary_objective_code'); assign('primaryObjectiveOther', 'primaryObjectiveOther', 'primary_objective_other');
    assign('kpiText', 'kpiText', 'kpi_text'); assign('descriptionRichText', 'descriptionRichText', 'description_rich_text_json');
    assign('requestingEmployeeCode', 'requestingEmployeeCode', 'requesting_employee_code'); assign('manualRequesterEmail', 'manualRequesterEmail', 'manual_requester_email');
    assign('additionalInformation', 'additionalInformation', 'additional_information_json');
    if (selected.has('market_codes') || selected.has('market_selection_origin') || selected.has('market_selection_code')) {
      output.marketCodes = typed.marketCodes ?? [];
      if (typed.marketSelectionOrigin) output.marketSelectionOrigin = typed.marketSelectionOrigin;
      else if (output.marketCodes.length) output.marketSelectionOrigin = 'CUSTOM';
      if (typed.marketSelectionCode !== undefined) output.marketSelectionCode = typed.marketSelectionCode;
    }
    if (selected.has('requesting_unit_codes') || selected.has('requesting_unit_other')) {
      output.requestingUnits = [
        ...(typed.requestingUnitCodes ?? []).map((unitCode): CampaignRequestingUnitInput => ({ unitCode })),
        ...(typed.requestingUnitOther ?? []).map((customName): CampaignRequestingUnitInput => ({ customName })),
      ];
    }
    if (selected.has('content_pillar_l1_code') || selected.has('content_pillar_l2_code')) {
      output.fieldValues = {
        ...(selected.has('content_pillar_l1_code') ? { content_pillar_l1_code: typed.contentPillarL1Code ?? null } : {}),
        ...(selected.has('content_pillar_l2_code') ? { content_pillar_l2_code: typed.contentPillarL2Code ?? null } : {}),
      };
    }
    return output;
  }

  private exportFields(request: CampaignSpreadsheetExportRequest) {
    const requested = request.fieldScope === 'ACTIVE_V2' ? CAMPAIGN_SPREADSHEET_FIELDS.map((field) => field.key) : request.fieldKeys ?? [];
    const normalized = requested.flatMap((key) => FIELD_BY_KEY.has(key) ? [key] : GRID_TO_EXCHANGE[key] ? [GRID_TO_EXCHANGE[key]!] : []);
    const unique = [...new Set(normalized)];
    const required = request.mode === 'TEMPLATE' ? ['campaign_code', 'campaign_name', 'campaign_level_code'] as CampaignSpreadsheetFieldKey[] : [];
    for (const key of required) if (!unique.includes(key)) unique.unshift(key);
    if (!unique.length) throw new BadRequestException('Hãy chọn ít nhất một trường để xuất.');
    return unique.map((key) => FIELD_BY_KEY.get(key)!).filter(Boolean);
  }

  private campaignValue(campaign: CampaignSummary, key: CampaignSpreadsheetFieldKey): CampaignSpreadsheetValue {
    switch (key) {
      case 'campaign_code': return campaign.code; case 'campaign_name': return campaign.name; case 'campaign_level_code': return campaign.levelCode;
      case 'campaign_lifecycle_state': return campaign.lifecycleState; case 'campaign_effect_start_date': return campaign.effectiveStartDate;
      case 'campaign_effect_end_date': return campaign.effectiveEndDate; case 'campaign_comm_start_date': return campaign.startDate; case 'campaign_comm_end_date': return campaign.endDate;
      case 'primary_objective_code': return campaign.primaryObjectiveCode; case 'primary_objective_other': return campaign.primaryObjectiveOther; case 'kpi_text': return campaign.kpiText;
      case 'description_plain_text': return richTextPlainText(campaign); case 'description_rich_text_json': return campaign.descriptionRichText ? JSON.stringify(campaign.descriptionRichText) : null;
      case 'content_pillar_l1_code': return text(campaign.fieldValues.content_pillar_l1_code) || null; case 'content_pillar_l2_code': return text(campaign.fieldValues.content_pillar_l2_code) || null;
      case 'market_selection_origin': return campaign.markets[0]?.selectionOrigin ?? null; case 'market_selection_code': return campaign.markets[0]?.selectionCode ?? null;
      case 'market_codes': return JSON.stringify(campaign.markets.map((market) => market.marketCode));
      case 'requesting_unit_codes': return JSON.stringify(campaign.requestingUnits.flatMap((unit) => unit.unitCode ? [unit.unitCode] : []));
      case 'requesting_unit_other': return JSON.stringify(campaign.requestingUnits.flatMap((unit) => unit.customName ? [unit.customName] : []));
      case 'requesting_employee_code': return campaign.requestingEmployeeCode; case 'manual_requester_email': return campaign.manualRequesterEmail;
      case 'additional_information_json': return JSON.stringify(campaign.additionalInformation);
    }
  }

  private legacyValue(campaign: CampaignSummary, key: string): CampaignSpreadsheetValue {
    const value = campaign.fieldValues[key];
    return value === undefined || value === null ? null : typeof value === 'object' ? JSON.stringify(value) : value;
  }

  private equalValue(left: CampaignSpreadsheetValue | undefined, right: CampaignSpreadsheetValue | undefined) {
    const normalize = (value: CampaignSpreadsheetValue | undefined) => text(value).replace(/\r\n/g, '\n');
    return normalize(left) === normalize(right);
  }

  private campaignInTimeRange(campaign: CampaignSummary, request: Pick<CampaignSpreadsheetCompareRequest, 'timeBasis' | 'dateFrom' | 'dateTo'>) {
    if (!request.dateFrom && !request.dateTo) return true;
    if (request.timeBasis === 'UPDATED_AT') return this.dateWithin(campaign.updatedAt.slice(0, 10), request.dateFrom, request.dateTo);
    const start = campaign.startDate;
    const end = campaign.endDate ?? campaign.startDate;
    if (!start || !end) return false;
    return (!request.dateFrom || end >= request.dateFrom) && (!request.dateTo || start <= request.dateTo);
  }

  private sourceRowInTimeRange(row: CampaignSpreadsheetPreviewRow, request: Pick<CampaignSpreadsheetCompareRequest, 'timeBasis' | 'dateFrom' | 'dateTo'>) {
    if (!request.dateFrom && !request.dateTo) return true;
    if (request.timeBasis === 'UPDATED_AT') return true;
    const start = nullableText(row.values.campaign_comm_start_date);
    const end = nullableText(row.values.campaign_comm_end_date) ?? start;
    if (!start || !end) return false;
    return (!request.dateFrom || end >= request.dateFrom) && (!request.dateTo || start <= request.dateTo);
  }

  private dateWithin(value: string, dateFrom?: string, dateTo?: string) {
    return (!dateFrom || value >= dateFrom) && (!dateTo || value <= dateTo);
  }

  private counts(rows: CampaignSpreadsheetPreviewRow[]) {
    const initial: Record<CampaignSpreadsheetRowStatus, number> = { CREATE: 0, UNCHANGED: 0, UPDATE: 0, CONFLICT: 0, INVALID: 0, SKIP: 0 };
    for (const row of rows) initial[row.status] += 1;
    return initial;
  }
}
