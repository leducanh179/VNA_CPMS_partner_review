export type CampaignFieldKind = 'text' | 'longText' | 'number' | 'date' | 'dateTime' | 'url' | 'choice';
export type CampaignFieldStatus = 'ACTIVE_V2' | 'COMPATIBILITY' | 'INACTIVE' | 'DEPRECATED';

export interface CampaignFieldDefinition {
  key: string;
  label: string;
  group: string;
  kind: CampaignFieldKind;
  editable: boolean;
  defaultVisible?: boolean;
  width?: number;
  referenceList?: string;
  status: CampaignFieldStatus;
}

export interface CampaignReferenceOption {
  value: string;
  label: string;
}

const field = (
  key: string,
  label: string,
  group: string,
  kind: CampaignFieldKind = 'text',
  options: Partial<Omit<CampaignFieldDefinition, 'key' | 'label' | 'group' | 'kind'>> = {},
): Omit<CampaignFieldDefinition, 'status'> => ({ key, label, group, kind, editable: true, width: 180, ...options });

const CAMPAIGN_FIELD_BASE_DEFINITIONS: readonly Omit<CampaignFieldDefinition, 'status'>[] = [
  field('campaign_code', 'Mã chiến dịch', 'Thông tin chung', 'text', { editable: false, defaultVisible: true, width: 190 }),
  field('sort_order', 'Thứ tự', 'Thông tin chung', 'number', { width: 110 }),
  field('campaign_name', 'Tên chiến dịch', 'Thông tin chung', 'text', { defaultVisible: true, width: 340 }),
  field('campaign_lifecycle_state', 'Tình trạng Chiến dịch', 'Thông tin chung', 'choice', { defaultVisible: true, width: 220, referenceList: 'campaign_lifecycle_state' }),
  field('campaign_effective_status', 'Tình trạng hiệu lực', 'Thông tin chung', 'choice', { width: 180, referenceList: 'campaign_effective_status' }),
  field('campaign_short_name', 'Tên rút gọn', 'Thông tin chung', 'text', { width: 220 }),
  field('campaign_year', 'Năm chiến dịch', 'Thông tin chung', 'number', { width: 140 }),
  field('campaign_month', 'Tháng chiến dịch', 'Thông tin chung', 'number', { width: 150 }),
  field('campaign_priority', 'Mức độ ưu tiên', 'Thông tin chung', 'choice', { width: 160, referenceList: 'campaign_priority' }),

  field('campaign_level_code', 'Mã cấp chiến dịch', 'Phân loại chiến dịch', 'choice', { width: 170, referenceList: 'campaign_level' }),
  field('campaign_level_label', 'Cấp chiến dịch', 'Phân loại chiến dịch', 'text', { width: 160 }),
  field('campaign_level_source', 'Nguồn xác định cấp', 'Phân loại chiến dịch', 'choice', { width: 190, referenceList: 'campaign_level_source' }),
  field('campaign_level_selected_by', 'Người chọn cấp', 'Phân loại chiến dịch', 'text', { width: 210 }),
  field('campaign_level_selected_at', 'Thời điểm chọn cấp', 'Phân loại chiến dịch', 'dateTime', { width: 190 }),
  field('campaign_level_reason', 'Lý do phân loại', 'Phân loại chiến dịch', 'longText', { width: 340 }),
  field('campaign_level_rule_version', 'Phiên bản rule phân loại', 'Phân loại chiến dịch', 'text', { width: 210 }),

  field('requesting_unit', 'Đơn vị yêu cầu', 'Yêu cầu & nguồn vào', 'text', { defaultVisible: true, width: 230 }),
  field('requesting_person', 'Người yêu cầu', 'Yêu cầu & nguồn vào', 'text', { width: 230 }),
  field('request_source_type', 'Loại nguồn yêu cầu', 'Yêu cầu & nguồn vào', 'choice', { width: 190, referenceList: 'request_source_type' }),
  field('request_source_link_or_note', 'Link hoặc ghi chú nguồn', 'Yêu cầu & nguồn vào', 'longText', { width: 360 }),
  field('request_secondary_objective', 'Mục tiêu bổ trợ', 'Yêu cầu & nguồn vào', 'longText', { width: 320 }),
  field('request_campaign_description', 'Thông tin mô tả', 'Yêu cầu & nguồn vào', 'longText', { width: 420 }),
  field('campaign_genre', 'Thể loại chiến dịch', 'Yêu cầu & nguồn vào', 'text', { width: 240 }),
  field('additional_information', 'Thông tin khác', 'Yêu cầu & nguồn vào', 'longText', { width: 380 }),
  field('source_document_links', 'Tài liệu văn bản cơ sở', 'Yêu cầu & nguồn vào', 'longText', { width: 360 }),
  field('other_material_links', 'Tư liệu khác', 'Yêu cầu & nguồn vào', 'longText', { width: 360 }),

  field('approval_policy', 'Chính sách phê duyệt', 'Phê duyệt & phân công', 'choice', { width: 210, referenceList: 'approval_policy' }),
  field('approval_policy_source', 'Nguồn chính sách phê duyệt', 'Phê duyệt & phân công', 'choice', { width: 230, referenceList: 'approval_policy_source' }),
  field('approval_enforcement_mode', 'Chế độ cưỡng chế phê duyệt', 'Phê duyệt & phân công', 'choice', { width: 250, referenceList: 'approval_enforcement_mode' }),
  field('approval_policy_overridden_by', 'Người override phê duyệt', 'Phê duyệt & phân công', 'text', { width: 230 }),
  field('approval_policy_overridden_at', 'Thời điểm override phê duyệt', 'Phê duyệt & phân công', 'dateTime', { width: 240 }),
  field('approval_policy_override_reason', 'Lý do override phê duyệt', 'Phê duyệt & phân công', 'longText', { width: 340 }),
  field('department_approval_state', 'Trạng thái duyệt cấp Ban', 'Phê duyệt & phân công', 'choice', { width: 220, referenceList: 'approval_state' }),
  field('department_approval_required', 'Yêu cầu duyệt cấp Ban', 'Phê duyệt & phân công', 'choice', { width: 210, referenceList: 'approval_required_mode' }),
  field('department_approver_summary', 'Người duyệt cấp Ban', 'Phê duyệt & phân công', 'text', { width: 230 }),
  field('department_approved_at', 'Thời điểm duyệt cấp Ban', 'Phê duyệt & phân công', 'dateTime', { width: 220 }),
  field('department_assignment_summary', 'Tóm tắt phân công cấp Ban', 'Phê duyệt & phân công', 'longText', { width: 360 }),
  field('lead_division_summary', 'Phòng phụ trách chính', 'Phê duyệt & phân công', 'text', { width: 230 }),
  field('supporting_divisions_summary', 'Các phòng phối hợp', 'Phê duyệt & phân công', 'longText', { width: 300 }),
  field('division_approval_state', 'Trạng thái duyệt cấp Phòng', 'Phê duyệt & phân công', 'choice', { width: 230, referenceList: 'approval_state' }),
  field('division_approval_required', 'Yêu cầu duyệt cấp Phòng', 'Phê duyệt & phân công', 'choice', { width: 220, referenceList: 'approval_required_mode' }),
  field('division_approver_summary', 'Người duyệt cấp Phòng', 'Phê duyệt & phân công', 'text', { width: 230 }),
  field('division_approved_at', 'Thời điểm duyệt cấp Phòng', 'Phê duyệt & phân công', 'dateTime', { width: 230 }),
  field('division_assignment_summary', 'Tóm tắt phân công cấp Phòng', 'Phê duyệt & phân công', 'longText', { width: 360 }),
  field('lead_campaign_manager_summary', 'Người quản lý chiến dịch chính', 'Phê duyệt & phân công', 'text', { defaultVisible: true, width: 260 }),
  field('supporting_campaign_managers_summary', 'Người quản lý chiến dịch phối hợp', 'Phê duyệt & phân công', 'longText', { width: 330 }),
  field('campaign_manager_acceptance_state', 'Tiếp nhận của người quản lý chiến dịch', 'Phê duyệt & phân công', 'choice', { width: 290, referenceList: 'campaign_manager_acceptance_state' }),
  field('campaign_manager_accepted_at', 'Thời điểm người quản lý chiến dịch tiếp nhận', 'Phê duyệt & phân công', 'dateTime', { width: 320 }),
  field('assignment_records_link', 'Link hồ sơ phân công', 'Phê duyệt & phân công', 'text', { width: 230 }),
  field('approval_note', 'Ghi chú phê duyệt/phân công', 'Phê duyệt & phân công', 'longText', { width: 360 }),

  field('campaign_comm_start_date', 'Bắt đầu truyền thông', 'Thời gian', 'date', { defaultVisible: true, width: 180 }),
  field('campaign_comm_end_date', 'Kết thúc truyền thông', 'Thời gian', 'date', { defaultVisible: true, width: 180 }),
  field('campaign_effect_start_date', 'Bắt đầu hiệu lực', 'Thời gian', 'date', { width: 170 }),
  field('campaign_effect_end_date', 'Kết thúc hiệu lực', 'Thời gian', 'date', { width: 170 }),
  field('travel_start_date', 'Bắt đầu hành trình', 'Thời gian', 'date', { width: 180 }),
  field('travel_end_date', 'Kết thúc hành trình', 'Thời gian', 'date', { width: 180 }),

  field('market', 'Thị trường', 'Mục tiêu & KPI', 'text', { width: 180 }),
  field('route_or_product', 'Đường bay hoặc sản phẩm', 'Mục tiêu & KPI', 'text', { width: 270 }),
  field('campaign_objective', 'Mục tiêu chiến dịch', 'Mục tiêu & KPI', 'longText', { width: 340 }),
  field('kpi_revenue', 'KPI doanh thu', 'Mục tiêu & KPI', 'number', { width: 180 }),
  field('kpi_primary', 'KPI chính', 'Mục tiêu & KPI', 'longText', { width: 300 }),
  field('kpi_note', 'Ghi chú KPI', 'Mục tiêu & KPI', 'longText', { width: 340 }),

  field('content_pillar_l1_code', 'Mã trụ cột nội dung L1', 'Nội dung & phân loại Digital', 'choice', { width: 220, referenceList: 'content_pillar_l1' }),
  field('content_pillar_l1_label', 'Trụ cột nội dung L1', 'Nội dung & phân loại Digital', 'text', { width: 260 }),
  field('content_pillar_l2_code', 'Mã nhóm chủ đề L2', 'Nội dung & phân loại Digital', 'choice', { width: 220, referenceList: 'content_pillar_l2' }),
  field('content_pillar_l2_label', 'Nhóm chủ đề L2', 'Nội dung & phân loại Digital', 'text', { width: 250 }),
  field('digital_theme_group_code', 'Mã nhóm chủ đề Digital', 'Nội dung & phân loại Digital', 'choice', { width: 230, referenceList: 'digital_theme_group' }),
  field('digital_theme_group_label', 'Nhóm chủ đề Digital', 'Nội dung & phân loại Digital', 'text', { width: 260 }),

  field('campaign_workspace_link', 'Link workspace chiến dịch', 'Tư liệu & liên kết', 'url', { width: 260 }),
  field('drive_folder_link', 'Link folder tư liệu nguồn', 'Tư liệu & liên kết', 'url', { width: 260 }),
  field('main_kv_link', 'Link KV chính', 'Tư liệu & liên kết', 'url', { width: 240 }),
  field('main_resize_link', 'Link resize chính', 'Tư liệu & liên kết', 'url', { width: 240 }),
  field('landing_page_vi', 'Landing page tiếng Việt', 'Tư liệu & liên kết', 'url', { width: 260 }),
  field('landing_page_en', 'Landing page tiếng Anh', 'Tư liệu & liên kết', 'url', { width: 260 }),
  field('utm_name', 'Tên UTM', 'Tư liệu & liên kết', 'text', { width: 220 }),

  field('material_status', 'Tình trạng tư liệu', 'Theo dõi thực hiện', 'text', { width: 240 }),
  field('plan_status', 'Tình trạng Kế hoạch', 'Theo dõi thực hiện', 'text', { defaultVisible: true, width: 220 }),
  field('performance_status', 'Tình trạng hiệu quả', 'Theo dõi thực hiện', 'text', { width: 220 }),
  field('ai_confidence', 'Mức tin cậy AI', 'Theo dõi thực hiện', 'text', { width: 160 }),
  field('ai_note', 'Ghi chú AI', 'Theo dõi thực hiện', 'longText', { width: 340 }),
  field('customer_facing_summary', 'Mô tả hướng tới khách hàng', 'Theo dõi thực hiện', 'longText', { width: 420 }),

  field('created_at', 'Thời điểm tạo theo nguồn', 'Hệ thống & truy vết', 'dateTime', { editable: false, width: 220 }),
  field('created_by', 'Người tạo theo nguồn', 'Hệ thống & truy vết', 'text', { editable: false, width: 210 }),
  field('last_updated_at', 'Cập nhật gần nhất theo nguồn', 'Hệ thống & truy vết', 'dateTime', { editable: false, width: 240 }),
  field('last_updated_by', 'Người cập nhật theo nguồn', 'Hệ thống & truy vết', 'text', { editable: false, width: 230 }),
  field('campaign_folder_id', 'ID folder chiến dịch', 'Hệ thống & truy vết', 'text', { editable: false, width: 250 }),
  field('campaign_folder_link', 'Link folder chiến dịch chính thức', 'Hệ thống & truy vết', 'url', { editable: false, width: 290 }),
] as const;

const ACTIVE_V2_FIELDS = new Set([
  'campaign_code', 'campaign_name', 'campaign_lifecycle_state', 'campaign_level_code',
  'request_secondary_objective', 'request_campaign_description', 'campaign_genre',
  'additional_information', 'source_document_links', 'other_material_links',
  'campaign_comm_start_date', 'campaign_comm_end_date', 'campaign_effect_start_date',
  'campaign_effect_end_date', 'market', 'route_or_product', 'campaign_objective',
  'kpi_primary', 'content_pillar_l1_code', 'content_pillar_l2_code',
]);

const INACTIVE_FIELDS = new Set([
  'approval_policy', 'approval_policy_source', 'approval_enforcement_mode',
  'approval_policy_overridden_by', 'approval_policy_overridden_at', 'approval_policy_override_reason',
  'department_approval_state', 'department_approval_required', 'department_approver_summary',
  'department_approved_at', 'department_assignment_summary', 'lead_division_summary',
  'supporting_divisions_summary', 'division_approval_state', 'division_approval_required',
  'division_approver_summary', 'division_approved_at', 'division_assignment_summary',
  'lead_campaign_manager_summary', 'supporting_campaign_managers_summary',
  'campaign_manager_acceptance_state', 'campaign_manager_accepted_at',
  'assignment_records_link', 'approval_note', 'travel_start_date', 'travel_end_date',
  'digital_theme_group_code', 'digital_theme_group_label',
]);

const DEPRECATED_FIELDS = new Set([
  'sort_order', 'campaign_effective_status', 'campaign_short_name', 'campaign_priority', 'campaign_year', 'campaign_month',
  'campaign_level_label', 'kpi_revenue', 'kpi_note', 'ai_confidence', 'ai_note',
]);

export const CAMPAIGN_FIELD_DEFINITIONS: readonly CampaignFieldDefinition[] = CAMPAIGN_FIELD_BASE_DEFINITIONS.map((definition) => ({
  ...definition,
  status: ACTIVE_V2_FIELDS.has(definition.key)
    ? 'ACTIVE_V2'
    : INACTIVE_FIELDS.has(definition.key)
      ? 'INACTIVE'
      : DEPRECATED_FIELDS.has(definition.key)
        ? 'DEPRECATED'
        : 'COMPATIBILITY',
}));

export const CAMPAIGN_FIELD_KEYS = CAMPAIGN_FIELD_DEFINITIONS.map((definition) => definition.key);
export const CAMPAIGN_FIELD_BY_KEY: Readonly<Record<string, CampaignFieldDefinition>> = Object.fromEntries(
  CAMPAIGN_FIELD_DEFINITIONS.map((definition) => [definition.key, definition]),
);
export const DEFAULT_CAMPAIGN_VISIBLE_FIELDS = [
  'campaign_code', 'campaign_name', 'campaign_lifecycle_state', 'plan_status',
  ...CAMPAIGN_FIELD_DEFINITIONS.filter((definition) => definition.defaultVisible && !['campaign_code', 'campaign_name', 'campaign_lifecycle_state', 'plan_status'].includes(definition.key)).map((definition) => definition.key),
];

const options = (...entries: Array<[string, string]>): CampaignReferenceOption[] => entries.map(([value, label]) => ({ value, label }));

export const CAMPAIGN_REFERENCE_OPTIONS: Readonly<Record<string, readonly CampaignReferenceOption[]>> = {
  campaign_effective_status: options(['Kế hoạch', 'Kế hoạch'], ['Đang hiệu lực', 'Đang hiệu lực'], ['Hết hiệu lực', 'Hết hiệu lực']),
  campaign_priority: options(['Thấp', 'Thấp'], ['Trung bình', 'Trung bình'], ['Cao', 'Cao']),
  campaign_level: options(['CLV_01', 'Cấp 1'], ['CLV_02', 'Cấp 2'], ['CLV_03', 'Cấp 3']),
  campaign_level_source: options(['Người tạo chọn', 'Người tạo chọn'], ['AI gợi ý', 'AI gợi ý'], ['Theo rule hệ thống', 'Theo rule hệ thống'], ['Admin override', 'Admin override']),
  request_source_type: options(['Email', 'Email'], ['Excel', 'Excel'], ['Word/Docx', 'Word/Docx'], ['Google Drive Folder', 'Google Drive Folder']),
  approval_policy: options(['Duyệt đầy đủ', 'Duyệt đầy đủ'], ['Bỏ qua LĐB, duyệt cấp Phòng', 'Bỏ qua LĐB, duyệt cấp Phòng'], ['CM xử lý trực tiếp', 'CM xử lý trực tiếp']),
  approval_policy_source: options(['Mặc định hệ thống', 'Mặc định hệ thống'], ['Admin override', 'Admin override'], ['Theo rule tự động', 'Theo rule tự động'], ['Nhập tay', 'Nhập tay']),
  approval_enforcement_mode: options(['Phê duyệt mềm', 'Phê duyệt mềm'], ['Phê duyệt cứng', 'Phê duyệt cứng']),
  approval_state: options(['Chưa trình', 'Chưa trình'], ['Chờ duyệt', 'Chờ duyệt'], ['Đã duyệt', 'Đã duyệt'], ['Từ chối', 'Từ chối'], ['Bỏ qua', 'Bỏ qua'], ['Xác nhận mềm', 'Xác nhận mềm'], ['Hệ thống tự bỏ qua do chính sách duyệt', 'Hệ thống tự bỏ qua do chính sách duyệt']),
  approval_required_mode: options(['Bắt buộc', 'Bắt buộc'], ['Tùy chọn', 'Tùy chọn'], ['Không yêu cầu', 'Không yêu cầu'], ['Chỉ xác nhận mềm', 'Chỉ xác nhận mềm']),
  campaign_manager_acceptance_state: options(['Chưa phân công', 'Chưa phân công'], ['Đã phân công', 'Đã phân công'], ['Đã tiếp nhận', 'Đã tiếp nhận'], ['Từ chối tiếp nhận', 'Từ chối tiếp nhận']),
  content_pillar_l1: options(['MTH2026_00', 'Bay cao cùng khát vọng Việt Nam'], ['MTH2026_01', 'Bay cao khát vọng bền vững'], ['MTH2026_02', 'Bay cao khát vọng 5 sao'], ['MTH2026_03', 'Bay cao khát vọng cống hiến']),
  content_pillar_l2: options(['MTH2026_00_01', 'Dấu mốc đất nước'], ['MTH2026_00_02', 'Kết nối Việt Nam và thế giới'], ['MTH2026_00_03', 'Dấu mốc phát triển Vietnam Airlines'], ['MTH2026_01_01', 'Cánh bay kết nối / Khát vọng kết nối'], ['MTH2026_01_02', 'Bay nhẹ cùng VNA'], ['MTH2026_01_03', 'Khát vọng vì cộng đồng'], ['MTH2026_02_01', 'Thương hiệu'], ['MTH2026_02_02', 'SPDV'], ['MTH2026_02_03', 'Chuyển đổi số'], ['MTH2026_02_04', 'SXKD'], ['MTH2026_02_05', 'Giải thưởng'], ['MTH2026_03_01', 'Đảng trong tim chúng ta'], ['MTH2026_03_02', 'Chuyển động 247'], ['MTH2026_03_03', 'Những Cánh Sen Vàng']),
  digital_theme_group: options(['DGT2026_01', 'Chiến lược'], ['DGT2026_02', 'Hình ảnh - Thương hiệu'], ['DGT2026_03', 'Đường bay, SPDV mới'], ['DGT2026_04', 'Chương trình bán lớn'], ['DGT2026_05', 'Chương trình bán chiến thuật'], ['DGT2026_06', 'Chương trình khác']),
};
