import type {
  CampaignBatchItemResult,
  CampaignLevelCode,
  CampaignLifecycleState,
  CampaignMarketSelectionOrigin,
  CampaignObjectiveCode,
  CampaignSummary,
  CreateCampaignCommand,
  UpdateCampaignCommand,
} from './campaign';

export const CAMPAIGN_SPREADSHEET_FIELDS = [
  { key: 'campaign_code', label: 'Mã chiến dịch', type: 'text', importable: true },
  { key: 'campaign_name', label: 'Tên chiến dịch', type: 'text', importable: true },
  { key: 'campaign_level_code', label: 'Cấp chiến dịch', type: 'code', importable: true },
  { key: 'campaign_lifecycle_state', label: 'Trạng thái chiến dịch', type: 'code', importable: true },
  { key: 'campaign_effect_start_date', label: 'Bắt đầu hiệu lực', type: 'date', importable: true },
  { key: 'campaign_effect_end_date', label: 'Kết thúc hiệu lực', type: 'date', importable: true },
  { key: 'campaign_comm_start_date', label: 'Bắt đầu QCTT', type: 'date', importable: true },
  { key: 'campaign_comm_end_date', label: 'Kết thúc QCTT', type: 'date', importable: true },
  { key: 'primary_objective_code', label: 'Mã mục tiêu chính', type: 'code', importable: true },
  { key: 'primary_objective_other', label: 'Nội dung mục tiêu khác', type: 'text', importable: true },
  { key: 'kpi_text', label: 'Chỉ tiêu', type: 'longText', importable: true },
  { key: 'description_plain_text', label: 'Mô tả chiến dịch (dễ đọc)', type: 'longText', importable: false },
  { key: 'description_rich_text_json', label: 'Mô tả chiến dịch (JSON chuẩn)', type: 'json', importable: true },
  { key: 'content_pillar_l1_code', label: 'Mã trụ cột nội dung', type: 'code', importable: true },
  { key: 'content_pillar_l2_code', label: 'Mã chủ đề nội dung', type: 'code', importable: true },
  { key: 'market_selection_origin', label: 'Cách chọn thị trường', type: 'code', importable: true },
  { key: 'market_selection_code', label: 'Mã vùng chọn thị trường', type: 'code', importable: true },
  { key: 'market_codes', label: 'Mã thị trường (mảng JSON)', type: 'jsonArray', importable: true },
  { key: 'requesting_unit_codes', label: 'Mã đơn vị yêu cầu (mảng JSON)', type: 'jsonArray', importable: true },
  { key: 'requesting_unit_other', label: 'Đơn vị yêu cầu khác (mảng JSON)', type: 'jsonArray', importable: true },
  { key: 'requesting_employee_code', label: 'Mã nhân sự yêu cầu', type: 'code', importable: true },
  { key: 'manual_requester_email', label: 'Email người yêu cầu nhập tay', type: 'text', importable: true },
  { key: 'additional_information_json', label: 'Thông tin bổ sung (JSON)', type: 'json', importable: true },
] as const;

export type CampaignSpreadsheetFieldKey = (typeof CAMPAIGN_SPREADSHEET_FIELDS)[number]['key'];
export type CampaignSpreadsheetValue = string | number | boolean | null;
export type CampaignSpreadsheetRowStatus = 'CREATE' | 'UNCHANGED' | 'UPDATE' | 'CONFLICT' | 'INVALID' | 'SKIP';

export interface CampaignSpreadsheetFile {
  fileName: string;
  mimeType?: string;
  contentBase64: string;
}

export interface CampaignSpreadsheetSheet {
  name: string;
  rowCount: number;
  headers: string[];
  canonicalKeys: Array<string | null>;
}

export interface CampaignSpreadsheetInspectResult {
  sheets: CampaignSpreadsheetSheet[];
  fields: typeof CAMPAIGN_SPREADSHEET_FIELDS;
}

export interface CampaignSpreadsheetMapping {
  columnIndex: number;
  sourceHeader: string;
  fieldKey: CampaignSpreadsheetFieldKey | null;
  recognized: boolean;
}

export interface CampaignSpreadsheetDiff {
  fieldKey: CampaignSpreadsheetFieldKey;
  label: string;
  currentValue: CampaignSpreadsheetValue;
  incomingValue: CampaignSpreadsheetValue;
}

export interface CampaignSpreadsheetPreviewRow {
  rowNumber: number;
  selected: boolean;
  status: CampaignSpreadsheetRowStatus;
  code: string | null;
  name: string | null;
  campaignId: string | null;
  expectedVersion: number | null;
  values: Partial<Record<CampaignSpreadsheetFieldKey, CampaignSpreadsheetValue>>;
  diffs: CampaignSpreadsheetDiff[];
  errors: string[];
}

export interface CampaignSpreadsheetPreviewResult {
  sheetName: string;
  mapping: CampaignSpreadsheetMapping[];
  rows: CampaignSpreadsheetPreviewRow[];
  counts: Record<CampaignSpreadsheetRowStatus, number>;
}

export interface CampaignSpreadsheetPreviewRequest extends CampaignSpreadsheetFile {
  sheetName: string;
  mapping?: CampaignSpreadsheetMapping[];
  selectedRows?: number[];
  selectedFieldKeys?: CampaignSpreadsheetFieldKey[];
}

export interface CampaignSpreadsheetImportDecision {
  rowNumber: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP';
  selectedFieldKeys: CampaignSpreadsheetFieldKey[];
  expectedVersion?: number;
}

export interface CampaignSpreadsheetImportRequest extends CampaignSpreadsheetPreviewRequest {
  decisions: CampaignSpreadsheetImportDecision[];
}

export interface CampaignSpreadsheetImportResult {
  preview: CampaignSpreadsheetPreviewResult;
  processed: number;
  succeeded: number;
  failed: number;
  items: CampaignBatchItemResult[];
}

export interface CampaignSpreadsheetExportRequest {
  mode: 'DATA' | 'TEMPLATE';
  recordScope: 'ALL_CURRENT' | 'SELECTED' | 'FILTERED';
  campaignIds?: string[];
  fieldScope: 'ACTIVE_V2' | 'VISIBLE' | 'CUSTOM';
  fieldKeys?: CampaignSpreadsheetFieldKey[];
  includeLegacyReadOnly?: boolean;
}

export interface CampaignSpreadsheetExportResult {
  fileName: string;
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  contentBase64: string;
  rowCount: number;
  fieldKeys: string[];
}

export interface CampaignSpreadsheetTypedRow {
  code?: string;
  name?: string;
  levelCode?: CampaignLevelCode;
  lifecycleState?: CampaignLifecycleState;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  primaryObjectiveCode?: CampaignObjectiveCode | null;
  primaryObjectiveOther?: string | null;
  kpiText?: string | null;
  descriptionRichText?: CampaignSummary['descriptionRichText'];
  contentPillarL1Code?: string | null;
  contentPillarL2Code?: string | null;
  marketCodes?: string[];
  marketSelectionOrigin?: CampaignMarketSelectionOrigin;
  marketSelectionCode?: string | null;
  requestingUnitCodes?: string[];
  requestingUnitOther?: string[];
  requestingEmployeeCode?: string | null;
  manualRequesterEmail?: string | null;
  additionalInformation?: CampaignSummary['additionalInformation'];
}

export type CampaignSpreadsheetMutation = CreateCampaignCommand | UpdateCampaignCommand;
