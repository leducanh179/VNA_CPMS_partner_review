import { MATERIAL_PUBLICATION_LABELS, inferMaterialGroup, parseMaterialCampaignRefs, parseMaterialLanguages, type MaterialBatchSaveItem, type MaterialFieldKey, type MaterialFields, type MaterialSummary } from '@cpms/domain';
import { materialDescription, richTextPlainValue } from './material-form';

export interface MaterialColumn {
  key: MaterialFieldKey;
  label: string;
  editable: boolean;
  width: string;
  kind?: 'date' | 'link' | 'status' | 'approval' | 'publish';
}

const editable = new Set<MaterialFieldKey>([
  'material_group', 'material_type', 'material_type_other', 'material_name', 'material_description_rich_text', 'material_link',
  'material_update_date', 'note',
]);

const definitions: Array<[MaterialFieldKey, string, string, MaterialColumn['kind']?]> = [
  ['material_id', 'Mã tư liệu', '14rem'],
  ['material_update_date', 'Ngày cập nhật', '10rem', 'date'],
  ['campaign', 'Chiến dịch', '20rem'],
  ['material_group', 'Nhóm tư liệu', '11rem'],
  ['material_type', 'Loại tư liệu', '12rem'],
  ['material_languages', 'Ngôn ngữ', '18rem'],
  ['material_name', 'Tiêu đề tư liệu', '22rem'],
  ['material_description_rich_text', 'Mô tả tư liệu', '22rem'],
  ['material_link', 'Link tư liệu', '16rem', 'link'],
  ['market_codes', 'Thị trường', '10rem'],
  ['publish_status', 'Tình trạng xuất bản', '11rem', 'publish'],
  ['note', 'Ghi chú', '22rem'],
  ['created_by', 'Tạo bởi', '15rem'],
  ['created_at', 'Tạo lúc', '12rem'],
  ['updated_by', 'Cập nhật bởi', '15rem'],
  ['updated_at', 'Cập nhật lúc', '12rem'],
  ['record_version', 'Version dữ liệu', '8rem'],
  ['deleted_at', 'Xóa lúc', '12rem'],
  ['deleted_by', 'Xóa bởi', '15rem'],
  ['delete_reason', 'Lý do xóa', '18rem'],
];

export const MATERIAL_COLUMNS: readonly MaterialColumn[] = definitions.map(([key, label, width, kind]) => ({
  key, label, width, editable: editable.has(key), ...(kind ? { kind } : {}),
}));

export const DEFAULT_MATERIAL_COLUMNS: readonly MaterialFieldKey[] = [
  'material_update_date', 'campaign', 'material_name', 'material_type', 'publish_status',
  'material_link',
  'material_description_rich_text', 'note',
];

export interface MaterialGridRow {
  clientKey: string;
  materialId: string | null;
  fields: MaterialFields;
  baselineFields: MaterialFields;
  recordVersion: number;
  isDeleted: boolean;
  dirty: boolean;
  error: string | null;
}

export function materialRowFromSummary(summary: MaterialSummary, clientKey = summary.materialId): MaterialGridRow {
  return {
    clientKey,
    materialId: summary.materialId,
    fields: { ...summary.fields },
    baselineFields: { ...summary.fields },
    recordVersion: summary.recordVersion,
    isDeleted: summary.isDeleted,
    dirty: false,
    error: null,
  };
}

export function newMaterialRow(clientKey: string): MaterialGridRow {
  const fields: MaterialFields = {
    material_update_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }),
    status: 'Undone',
    material_publish: 'Not published',
    submission_status: 'BOOKED',
    approval_status: 'BOOKED',
    publish_status: 'NOT_PUBLISHED',
    visibility: 'INTERNAL',
    source: 'WEB_APP',
    is_deleted: 'FALSE',
    workflow_state: 'DRAFT',
  };
  return { clientKey, materialId: null, fields, baselineFields: {}, recordVersion: 0, isDeleted: false, dirty: true, error: null };
}

export function duplicateMaterialRow(source: MaterialGridRow, clientKey: string): MaterialGridRow {
  const duplicate = newMaterialRow(clientKey);
  const fields = { ...source.fields };
  for (const key of [
    'material_id', 'updated_at', 'updated_by', 'created_at', 'created_by', 'record_version',
    'submitted_at', 'approved_at', 'approved_by', 'deleted_at', 'deleted_by', 'delete_reason',
    'viber_notified_at', 'viber_message', 'supplementary_link', 'supplementary_links', 'supplementary_link_1', 'supplementary_link_2', 'contract_ids',
  ] as MaterialFieldKey[]) delete fields[key];
  return {
    ...duplicate,
    fields: {
      ...fields,
      workflow_state: 'DRAFT',
      workflow_reason: null,
      workflow_updated_at: null,
      workflow_updated_by: null,
      submission_status: 'BOOKED',
      approval_status: 'BOOKED',
      publish_status: 'NOT_PUBLISHED',
      material_publish: 'Not published',
      viber_notify_status: 'NOT_SENT',
      is_deleted: 'FALSE',
    },
  };
}

export function materialSaveItem(row: MaterialGridRow): MaterialBatchSaveItem {
  return {
    clientKey: row.clientKey,
    ...(row.materialId ? { materialId: row.materialId, expectedVersion: row.recordVersion } : {}),
    ...(row.materialId ? { baselineFields: row.baselineFields } : {}),
    fields: row.fields,
  };
}

export function matchesMaterialSearch(row: MaterialGridRow, search: string) {
  const needle = search.trim().toLocaleLowerCase('vi');
  if (!needle) return true;
  return Object.values(row.fields).some((value) => String(value ?? '').toLocaleLowerCase('vi').includes(needle));
}

export function materialDisplayValue(fields: MaterialFields, key: MaterialFieldKey): string {
  if (key === 'material_group') return fields.material_group || inferMaterialGroup(fields.material_type) || '—';
  if (key === 'publish_status') return MATERIAL_PUBLICATION_LABELS[fields.publish_status || 'NOT_PUBLISHED'] || fields.publish_status || 'Chưa xuất bản';
  if (key === 'campaign') return parseMaterialCampaignRefs(fields.campaign_refs).map((reference) => reference.name).join('; ') || fields.campaign || '—';
  if (key === 'material_type') return fields.material_type === 'Khác' ? fields.material_type_other || 'Khác' : fields.material_type || '—';
  if (key === 'material_languages') return parseMaterialLanguages(fields.material_languages).join(', ') || '—';
  if (key === 'material_description_rich_text') return richTextPlainValue(materialDescription(fields)) || '—';
  if (key === 'material_update_date') return fields.material_update_date || (fields.created_at ? new Date(fields.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—');
  return String(fields[key] ?? '') || '—';
}

export function completionMonthKey(row: MaterialGridRow) {
  const value = materialDisplayValue(row.fields, 'material_update_date');
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : 'UNKNOWN';
}

export function materialCompletionInRange(row: MaterialGridRow, range: { from: string; to: string }) {
  if (!range.from && !range.to) return true;
  const date = materialDisplayValue(row.fields, 'material_update_date');
  return Boolean(date !== '—' && (!range.from || date >= range.from) && (!range.to || date <= range.to));
}

export function materialSortDirectionLabel(column: MaterialColumn, direction: 'asc' | 'desc') {
  if (column.key === 'record_version') return direction === 'asc' ? 'Nhỏ tới lớn' : 'Lớn tới nhỏ';
  if (column.kind === 'date' || column.key.endsWith('_at')) return direction === 'asc' ? 'Cũ tới mới' : 'Mới tới cũ';
  return direction === 'asc' ? 'A tới Z' : 'Z tới A';
}

export function compareMaterialRows(left: MaterialGridRow, right: MaterialGridRow, column: MaterialColumn, direction: 'asc' | 'desc') {
  const leftValue = materialDisplayValue(left.fields, column.key);
  const rightValue = materialDisplayValue(right.fields, column.key);
  if (leftValue === '—' && rightValue === '—') return 0;
  if (leftValue === '—') return 1;
  if (rightValue === '—') return -1;
  const compared = column.key === 'record_version'
    ? Number(leftValue) - Number(rightValue)
    : column.kind === 'date' || column.key.endsWith('_at')
      ? (Date.parse(leftValue) || 0) - (Date.parse(rightValue) || 0)
      : leftValue.localeCompare(rightValue, 'vi', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? compared : -compared;
}
