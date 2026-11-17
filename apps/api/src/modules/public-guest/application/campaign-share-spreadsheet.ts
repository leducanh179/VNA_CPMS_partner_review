import { CAMPAIGN_SHARE_TAB_LABELS, QCTT_PROGRESS, type CampaignShareTab, type SharedCampaign } from '@cpms/domain';
import type { TabularSheetData } from '@cpms/integrations';

const workflowLabels: Record<string, string> = {
  DRAFT: 'Nháp', PENDING: 'Chờ phê duyệt', APPROVED: 'Đã phê duyệt', COMPLETED: 'Hoàn tất',
  RETURNED: 'Trả lại chỉnh sửa', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
  SUPERSEDED: 'Đã thay thế', NO_APPROVAL: 'Không cần phê duyệt', SKIPPED_BY_ADMIN: 'Bỏ qua bởi quản trị viên',
  DEPARTMENT_APPROVAL: 'Ban TT phê duyệt', DIVISION_ACCEPT_AND_ASSIGN: 'Lãnh đạo Phòng tiếp nhận và phân công',
};
const label = (value: string) => workflowLabels[value] ?? value;
const date = (value: string | null) => value ? value.slice(0, 10) : '';

export function campaignShareSpreadsheet(view: SharedCampaign, sourceUrl: string, exportedAt: Date) {
  const information = view.information ?? [];
  const approval = view.approval;
  const rows: Record<CampaignShareTab, TabularSheetData['rows']> = {
    information: [
      ['Trường', 'Nội dung'],
      ['Mã chiến dịch', view.code], ['Tên chiến dịch', view.name], ['Nguồn CPMS', sourceUrl],
      ['Thời điểm xuất', exportedAt.toISOString()],
      ...information.map(field => [field.label, field.value]),
    ],
    approval: [
      ['Mục', 'Tình trạng', 'Ngày'],
      ['Tình trạng phê duyệt hiện tại', label(approval?.status ?? 'Chưa trình')],
      ...approval?.tasks.map(task => [label(task.kind), label(task.state), date(task.completedAt)]) ?? [],
      ...approval?.history.map(item => [`Lần trình ${item.number}`, label(item.state), date(item.createdAt)]) ?? [],
    ],
    documents: [
      ['Mã tư liệu', 'Tiêu đề', 'Loại', 'Liên kết'],
      ...view.documents?.materials.map(item => [item.id, item.title, item.type, item.url]) ?? [],
    ],
    planning: [
      ['Hạng mục', 'Mã kênh', 'Bắt đầu', 'Kết thúc', 'Nội dung', 'Tiến độ'],
      ...view.planning?.map(item => [item.activity, item.channel, date(item.start), date(item.end), item.content,
        QCTT_PROGRESS[item.progress as keyof typeof QCTT_PROGRESS] ?? item.progress]) ?? [],
    ],
    results: [['Kết quả'], ['Chưa có dữ liệu kết quả trên CPMS.']],
  };
  return {
    title: `CPMS · ${view.code} · ${view.name}`,
    sheets: view.tabs.map(tab => ({ name: CAMPAIGN_SHARE_TAB_LABELS[tab], rows: rows[tab] })),
  };
}
