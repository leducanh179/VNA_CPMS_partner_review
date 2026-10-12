export const MATERIAL_FIELD_KEYS = [
  'campaign', 'material_type', 'material_name', 'version', 'market_codes',
  'material_link', 'supplementary_link', 'status', 'material_publish', 'note',
  'campaign_refs', 'material_group', 'material_type_other', 'description_rich_text',
  'material_description_rich_text', 'material_update_date', 'material_languages', 'supplementary_link_1', 'supplementary_link_2',
  'note_rich_text', 'supplementary_links', 'workflow_state', 'workflow_reason',
  'workflow_updated_at', 'workflow_updated_by', 'market_source_campaign_id',
  'material_id', 'campaign_code', 'campaign_name', 'updated_at', 'updated_by',
  'viber_notify_status', 'viber_notified_at', 'viber_message', 'sync_status', 'source',
  'vendor_id', 'created_by', 'created_at', 'record_version', 'submission_status',
  'submitted_at', 'request_id', 'contract_ids', 'visibility', 'approval_status',
  'publish_status', 'approved_at', 'approved_by', 'is_deleted', 'deleted_at',
  'deleted_by', 'delete_reason', 'request_date', 'completion_date',
] as const;

export type MaterialFieldKey = (typeof MATERIAL_FIELD_KEYS)[number];
export type MaterialFields = Partial<Record<MaterialFieldKey, string | null>>;

export const MATERIAL_GROUPS = ['Hình ảnh', 'Video', 'Văn bản', 'Trang web', 'Khác'] as const;
export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];
export const MATERIAL_TYPES_BY_GROUP: Record<MaterialGroup, readonly string[]> = {
  'Hình ảnh': ['Key Visual', 'Ảnh quảng cáo', 'Ảnh chụp sự kiện', 'Khác'],
  Video: ['TVC quảng cáo', 'Clip sự kiện', 'Bản tin ngắn', 'Phóng sự', 'Cảnh quay tư liệu', 'Khác'],
  'Văn bản': ['Thông cáo báo chí', 'Bài viết PR báo chí', 'Bài phát biểu', 'Bài tham luận', 'Slide thuyết trình', 'Infographic', 'Khác'],
  'Trang web': ['Landing Page', 'Khác'],
  Khác: ['Khác'],
};

export const MATERIAL_LANGUAGES = [
  'Tiếng Việt', 'Tiếng Anh', 'Tiếng Trung Quốc (giản thể)', 'Tiếng Trung Quốc (Phồn thể)',
  'Tiếng Pháp', 'Tiếng Đức', 'Tiếng Nhật Bản', 'Tiếng Hàn Quốc', 'Tiếng Ấn Độ',
] as const;

export function parseMaterialLanguages(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && (MATERIAL_LANGUAGES as readonly string[]).includes(item)) : [];
  } catch { return []; }
}

export interface MaterialCampaignReference {
  kind: 'SYSTEM' | 'TEMPORARY';
  id: string;
  name: string;
}

export interface MaterialSupplementaryLink {
  label: string;
  url: string;
}

export const MATERIAL_WORKFLOW_STATES = ['DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED'] as const;
export type MaterialWorkflowState = (typeof MATERIAL_WORKFLOW_STATES)[number];
export const MATERIAL_WORKFLOW_LABELS: Record<MaterialWorkflowState, string> = {
  DRAFT: 'Nháp',
  PENDING_APPROVAL: 'Chờ phê duyệt',
  RETURNED: 'Trả lại chỉnh sửa',
  REJECTED: 'Từ chối',
  APPROVED: 'Đã phê duyệt',
};

export const MATERIAL_PUBLICATION_LABELS: Record<string, string> = {
  NOT_PUBLISHED: 'Chưa xuất bản',
  PUBLISHED: 'Đã xuất bản',
  PAUSED: 'Tạm dừng xuất bản',
};

export function materialWorkflowState(fields: MaterialFields): MaterialWorkflowState {
  const state = fields.workflow_state;
  if (state && (MATERIAL_WORKFLOW_STATES as readonly string[]).includes(state)) return state as MaterialWorkflowState;
  return fields.approval_status === 'APPROVED' ? 'APPROVED' : 'DRAFT';
}

export function parseMaterialCampaignRefs(value: string | null | undefined): MaterialCampaignReference[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MaterialCampaignReference => Boolean(item && typeof item === 'object'
      && (item.kind === 'SYSTEM' || item.kind === 'TEMPORARY')
      && typeof item.id === 'string' && typeof item.name === 'string'));
  } catch { return []; }
}

export function parseMaterialSupplementaryLinks(value: string | null | undefined): MaterialSupplementaryLink[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MaterialSupplementaryLink => Boolean(item && typeof item === 'object'
      && typeof item.label === 'string' && typeof item.url === 'string'));
  } catch { return []; }
}

export function inferMaterialGroup(type: string | null | undefined): MaterialGroup | '' {
  const text = (type || '').toLocaleLowerCase('vi');
  if (/landing page|trang web|website/.test(text)) return 'Trang web';
  if (/key visual|ảnh|resize|banner|poster|thiết kế/.test(text)) return 'Hình ảnh';
  if (/video|tvc|clip|phóng sự|cảnh quay/.test(text)) return 'Video';
  if (/văn bản|thông cáo|bài viết|bài phát biểu|tham luận|slide|infographic/.test(text)) return 'Văn bản';
  return '';
}

export interface MaterialSummary {
  id: string;
  materialId: string;
  fields: MaterialFields;
  recordVersion: number;
  isDeleted: boolean;
  updatedAt: string;
}

export interface MaterialCommentItem {
  id: string;
  materialId: string;
  authorActorId: string;
  authorName: string;
  body: string;
  parentId: string | null;
  recordVersion: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface MaterialJournalItem {
  id: string;
  action: string;
  actorName: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface MaterialBatchSaveItem {
  clientKey: string;
  materialId?: string;
  expectedVersion?: number;
  baselineFields?: MaterialFields;
  fields: MaterialFields;
}

export interface MaterialBatchItemResult {
  clientKey: string;
  materialId?: string;
  ok: boolean;
  code?: 'CONFLICT' | 'VALIDATION' | 'PERSISTENCE';
  message?: string;
  conflictingFields?: MaterialFieldKey[];
  material?: MaterialSummary;
}

export interface MaterialBatchResult {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  items: MaterialBatchItemResult[];
}

export const MATERIAL_BULK_ACTIONS = [
  'PUBLISH', 'PAUSE_PUBLISH', 'UNPUBLISH', 'SOFT_DELETE', 'RESTORE',
] as const;

export type MaterialBulkAction = (typeof MATERIAL_BULK_ACTIONS)[number];

export interface MaterialBulkActionItem {
  materialId: string;
  expectedVersion: number;
}

export interface MaterialPortalBootstrap {
  settings: Record<string, string>;
  users: readonly Record<string, string>[];
  fieldRules: readonly Record<string, string>[];
  roleRules: readonly Record<string, string>[];
  campaigns: readonly { campaign_id: string; campaign_code: string; campaign_name: string; market_codes: string[] }[];
  options: {
    materialTypes: string[];
    statuses: string[];
    markets: string[];
  };
}
