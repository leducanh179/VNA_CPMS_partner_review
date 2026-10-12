import type { CampaignLifecycleState } from '@cpms/domain';

export const CAMPAIGN_STATE_LABELS: Record<CampaignLifecycleState, string> = {
  DRAFT: 'Dự thảo',
  SUBMITTED_TO_DEPARTMENT: 'Đã gửi cấp ban',
  DEPARTMENT_ASSIGNED: 'Ban đã phân công',
  DIVISION_ASSIGNED: 'Phòng đã phân công',
  CM_ACCEPTED: 'Campaign Manager đã tiếp nhận',
  PLANNING: 'Đang lập kế hoạch',
  READY_TO_LAUNCH: 'Sẵn sàng triển khai',
  RUNNING: 'Đang triển khai',
  PAUSE_REQUESTED: 'Đề nghị tạm dừng',
  PAUSED: 'Đã tạm dừng',
  RESUME_REQUESTED: 'Đề nghị tiếp tục',
  CANCEL_REQUESTED: 'Chờ duyệt xóa',
  CANCELLED: 'Ngừng triển khai (dữ liệu cũ)',
  COMPLETED: 'Hoàn thành',
  ARCHIVED: 'Đã lưu trữ',
};

export function formatDate(value: string | null) {
  if (!value) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

export function toDateInput(value: string | null) {
  return value?.slice(0, 10) ?? '';
}
