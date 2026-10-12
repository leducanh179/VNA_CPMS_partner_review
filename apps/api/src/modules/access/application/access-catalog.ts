import { ACCESS_PERMISSIONS, type AccessPermission, type AccessRelation, type RoleCode } from '@cpms/domain';

const labels: Record<AccessPermission, string> = {
  'catalog.manage': 'Quản lý danh mục QCTT', 'catalog.purge': 'Xóa vĩnh viễn danh mục QCTT không có tham chiếu',
  'contract.delete': 'Chuyển hợp đồng vào Thùng rác', 'contract.restore': 'Phục hồi hợp đồng', 'contract.purge': 'Xóa vĩnh viễn hợp đồng không có nghiệp vụ phụ thuộc', 'contract.policy.manage': 'Chính sách phê duyệt hợp đồng',
  'booking.submit':'Gửi đặt chỗ để phê duyệt', 'booking.approve':'Duyệt đặt chỗ theo phân công', 'booking.confirm':'Vendor xác nhận đặt chỗ', 'booking.report.approve':'Duyệt báo cáo nghiệm thu', 'booking.policy.manage':'Chính sách phê duyệt đặt chỗ',
  'booking.read': 'Xem đặt chỗ và báo cáo', 'booking.create': 'Tạo đặt chỗ', 'booking.update': 'Sửa, tạm dừng và nối lại đặt chỗ',
  'booking.delete': 'Xóa đặt chỗ', 'booking.restore': 'Phục hồi đặt chỗ', 'booking.purge': 'Xóa vĩnh viễn đặt chỗ chưa nghiệm thu',
  'booking.report': 'Ghi báo cáo và nghiệm thu', 'booking.manage': 'Phân công slot và cấu hình mẫu nghiệm thu',
  'contract.read': 'Xem hợp đồng, slot và inventory', 'contract.create': 'Tạo hợp đồng', 'contract.update': 'Sửa hợp đồng và slot',
  'contract.allocate': 'Lập phân bổ và điều chỉnh', 'contract.approve': 'Duyệt phân bổ và điều chỉnh', 'contract.import': 'Nhập nguồn hợp đồng', 'contract.export': 'Xuất nguồn hợp đồng',
  'campaign.read': 'Xem chiến dịch', 'campaign.create': 'Tạo chiến dịch', 'campaign.update': 'Sửa thông tin chiến dịch',
  'campaign.delete': 'Xóa mềm chiến dịch', 'campaign.trash.read': 'Xem Thùng rác', 'campaign.restore': 'Phục hồi chiến dịch',
  'campaign.purge': 'Xóa vĩnh viễn chiến dịch', 'campaign.export': 'Xuất dữ liệu chiến dịch', 'campaign.import': 'Nhập dữ liệu chiến dịch',
  'campaign.comment': 'Bình luận, phản hồi và phản ứng', 'campaign.comment.moderate': 'Quản trị bình luận', 'campaign.journal.read': 'Xem nhật ký chiến dịch',
  'campaign.submit': 'Gửi duyệt khởi tạo', 'campaign.approve': 'Duyệt khởi tạo', 'campaign.assign': 'Phân công chiến dịch',
  'campaign.cooperate': 'Yêu cầu hoặc phản hồi phối hợp', 'campaign.policy.manage': 'Đổi chế độ phê duyệt', 'campaign.access.manage': 'Phân quyền riêng cho chiến dịch',
  'campaign.drive.read': 'Xem tệp Drive', 'campaign.drive.ensure': 'Thiết lập thư mục Drive', 'campaign.drive.upload': 'Tải tệp lên Drive',
  'campaign.drive.rename': 'Đổi tên tệp Drive', 'campaign.drive.trash': 'Đưa tệp Drive vào Thùng rác', 'campaign.drive.restore': 'Phục hồi tệp Drive',
  'campaign.sheets.read': 'Đọc Google Sheets', 'campaign.sheets.write': 'Tạo tab kết quả trên Google Sheets',
  'material.read': 'Xem tư liệu', 'material.create': 'Tạo tư liệu', 'material.update': 'Sửa tư liệu', 'material.approve': 'Duyệt tư liệu',
  'material.publish': 'Công bố tư liệu', 'material.delete': 'Xóa mềm tư liệu', 'material.restore': 'Phục hồi tư liệu', 'material.manage': 'Quản trị tư liệu',
  'access.manage': 'Quản trị vai trò và phân quyền', 'credential.manage': 'Quản trị đăng nhập local', 'system.manage': 'Quản trị hệ thống',
  'google.connect': 'Kết nối Google của chính tài khoản', 'google.revoke': 'Ngắt kết nối Google của chính tài khoản',
};

// Promotion requires a tested Application Service boundary. Reserved definitions never grant execution.
// Workflow definitions are activated by explicit workflow initialization.
const pending = new Set<string>(['campaign.submit','campaign.approve','campaign.assign','campaign.cooperate',
  'campaign.policy.manage','campaign.access.manage']);
const implemented = new Set<string>(ACCESS_PERMISSIONS.filter((permission) => !pending.has(permission)));
export const ACCESS_CATALOG: { code: string; label: string; module: string; groupLabel: string; description: string; supportedScopes: string[]; implementationStatus: string }[] = ACCESS_PERMISSIONS.map((code) => ({
  code, label: labels[code], module: code.split('.')[0]!.toUpperCase(),
  groupLabel: code.includes('.drive.') ? 'Google Drive' : code.includes('.sheets.') ? 'Google Sheets' : code.startsWith('campaign.') ? 'Chiến dịch' : 'Quản trị và phân hệ',
  description: `${labels[code]}. Vẫn cần phiên hợp lệ, phạm vi tài nguyên và các điều kiện nghiệp vụ tương ứng.`,
  supportedScopes: code === 'campaign.update' ? ['SYSTEM', 'MODULE', 'MODULE_ORG', 'RECORD', 'FIELD']
    : code.startsWith('campaign.') ? ['SYSTEM', 'MODULE', 'MODULE_ORG', 'RECORD'] : ['SYSTEM', 'MODULE'],
  implementationStatus: implemented.has(code) ? 'IMPLEMENTED' : 'RESERVED',
}));
ACCESS_CATALOG.push(...[
  ['plan.read', 'Xem phần kế hoạch'], ['plan.approve', 'Duyệt phần kế hoạch'],
  ['contract.manage', 'Quản lý hợp đồng'], ['channel.manage', 'Quản lý kênh'],
  ['slot.operate', 'Vận hành slot'], ['booking.propose', 'Đề xuất booking'],
].map(([code, label]) => ({ code: code!, label: label!, module: code!.split('.')[0]!.toUpperCase(), groupLabel: 'Phân hệ tương lai',
  description: 'Dự phòng — phân hệ chưa triển khai. Không cấp khả năng nghiệp vụ hiện tại.', supportedScopes: ['SYSTEM', 'MODULE'], implementationStatus: 'RESERVED' })));

export interface DefaultRolePermission { permissionCode: AccessPermission; relation: AccessRelation; effect: 'ALLOW'; defaultScope: 'MODULE' | 'MODULE_ORG' }
const grant = (permissionCode: AccessPermission, relation: AccessRelation, defaultScope: DefaultRolePermission['defaultScope'] = 'MODULE'): DefaultRolePermission => ({ permissionCode, relation, effect: 'ALLOW', defaultScope });
export const DEFAULT_ROLE_PRESETS: Partial<Record<RoleCode, DefaultRolePermission[]>> = {
  COMM_CONTRACT_MANAGER: [grant('contract.create', 'ALL'), ...(['contract.read','contract.update','contract.allocate','contract.export'] as const).map(p => grant(p, 'ASSIGNED'))],
  CONTRACT_MANAGER: [grant('contract.create', 'ALL'), ...(['contract.read','contract.update','contract.allocate','contract.export'] as const).map(p => grant(p, 'ASSIGNED'))],
  CAMPAIGN_REQUESTER: [grant('campaign.create', 'ALL'), grant('campaign.read', 'OWN'), grant('campaign.update', 'OWN_DRAFT'),
    grant('campaign.submit', 'OWN_DRAFT'), grant('campaign.comment', 'OWN'), grant('campaign.journal.read', 'OWN'), grant('campaign.export', 'OWN')],
  COMM_CAMPAIGN_MANAGER: ['campaign.read', 'campaign.update', 'campaign.submit', 'campaign.comment', 'campaign.journal.read', 'campaign.export',
    'campaign.drive.read', 'campaign.drive.upload', 'campaign.drive.rename', 'campaign.drive.trash', 'campaign.drive.restore']
    .map((code) => grant(code as AccessPermission, 'ASSIGNED')),
  DIVISION_LEADER: ['campaign.read', 'campaign.approve', 'campaign.assign', 'campaign.cooperate', 'campaign.comment', 'campaign.journal.read']
    .map((code) => grant(code as AccessPermission, 'UNIT', 'MODULE_ORG')),
  DEPARTMENT_LEADER: ['campaign.read', 'campaign.approve', 'campaign.assign', 'campaign.cooperate', 'campaign.comment', 'campaign.journal.read']
    .map((code) => grant(code as AccessPermission, 'UNIT', 'MODULE_ORG')),
};
