import type { CampaignRichTextDocument } from './campaign';
import type { ChannelMapCatalog, ItemClassificationSnapshot } from './channel-map';
import type { BookingView } from './booking';
import { bookingApprovalLabels, bookingEffective, bookingExecutionAsOf, bookingExecutionLabels } from './booking-workflow';

export const QCTT_FORMATS = { WRITE: 'Viết', FILM: 'Quay', PHOTO: 'Chụp', OTHER: 'Khác' } as const;
export const QCTT_PROGRESS = { PLANNED: 'Dự kiến', IN_PROGRESS: 'Đang thực hiện', COMPLETED: 'Hoàn thành', STOPPED: 'Ngừng thực hiện' } as const;
export const QCTT_PLAN_FIELDS = ['campaignId', 'professionLayer', 'channelCode', 'activityLabel', 'content', 'startDate', 'endDate', 'departmentId', 'requirements'] as const;
export type QcttPlanColumn = { key: typeof QCTT_PLAN_FIELDS[number] | `custom:${string}`; label: string };
export const DEFAULT_QCTT_PLAN_COLUMNS: QcttPlanColumn[] = [
  { key: 'campaignId', label: 'Chiến dịch' }, { key: 'professionLayer', label: 'Lớp nghiệp vụ' },
  { key: 'channelCode', label: 'Kênh' }, { key: 'activityLabel', label: 'Phương tiện QCTT' },
  { key: 'content', label: 'Nội dung/Chủ đề' }, { key: 'startDate', label: 'Thời gian bắt đầu' },
  { key: 'endDate', label: 'Thời gian kết thúc' }, { key: 'departmentId', label: 'CQ, ĐV phụ trách (cấp ban)' },
  { key: 'requirements', label: 'Ghi chú' },
];
export interface QcttPlanFields {
  customValues?: Record<string, string>;
  professionLayer: string | null; channelCode: string | null; activityCode: string | null; activityLabel: string;
  content: CampaignRichTextDocument | null; format: keyof typeof QCTT_FORMATS | null; otherFormat: string;
  startDate: string | null; endDate: string | null; departmentId: string | null;
  requirements: string; progress: keyof typeof QCTT_PROGRESS;
}
export interface QcttPlanItem extends QcttPlanFields {
  id: string; campaignId: string; recordVersion: number; sortOrder: number; origin: 'MANUAL' | 'BOOKING';
  classification: ItemClassificationSnapshot | null; deletedAt: string | null; createdByActorId: string;
  createdAt: string; updatedAt: string;
}
export interface QcttPlanState { campaignId: string; recordVersion: number; initializedAt: string | null; initializedByActorId: string | null; columns: QcttPlanColumn[] }
/** Only campaign-relevant operational fields are exposed, never contract prices or supplier dossiers. */
export interface QcttPlanBooking {
  id: string; itemId: string | null; perspective: 'EFFECTIVE' | 'PROPOSED'; slotName: string;
  startDate: string; endDate: string; quantity: string; unit: string; status: string; execution: string;
  deleted: boolean; outsidePlan: boolean;
}
export interface QcttPlanView {
  schemaVersion: 1; state: QcttPlanState; items: QcttPlanItem[]; bookings: QcttPlanBooking[];
  catalog: ChannelMapCatalog; departments: { id: string; name: string }[];
  capabilities: { edit: boolean; initialize: boolean; acceptingBookings: boolean }; defaultDepartmentId: string | null;
  legacyPlans: { id: string; title: string; objective: string; tasks: { title: string; startDate: string; endDate: string }[] }[];
  campaigns: { id: string; code: string; name: string; hasPlan: boolean }[];
}
export interface QcttPlanTarget { id: string; activityCode: string | null; professionLayer: string | null; channelCode: string | null; activityLabel: string; departmentId: string | null; startDate: string | null; endDate: string | null }
export const emptyQcttPlanFields = (): QcttPlanFields => ({ customValues: {}, professionLayer: null, channelCode: null, activityCode: null, activityLabel: '', content: null, format: null, otherFormat: '', startDate: null, endDate: null, departmentId: null, requirements: '', progress: 'PLANNED' });
export function qcttPlanCompleteness(item: QcttPlanFields): string[] {
  const missing: string[] = [];
  if (!item.activityLabel.trim()) missing.push('Phương tiện');
  if (!item.professionLayer && !item.customValues?.professionLayer?.trim()) missing.push('Nghiệp vụ');
  if (!item.channelCode && !item.customValues?.channelCode?.trim()) missing.push('Kênh');
  if (!item.departmentId && !item.customValues?.departmentId?.trim()) missing.push('Phòng phụ trách');
  if (item.progress !== 'COMPLETED' && (!item.startDate || !item.endDate)) missing.push('Thời gian');
  if (item.format === 'OTHER' && !item.otherFormat.trim()) missing.push('Hình thức khác');
  return missing;
}
export function matchingPlanItems(items: QcttPlanItem[], classification: ItemClassificationSnapshot | null, departmentId: string | null) {
  if (!classification) return [];
  return items.filter(i => !i.deletedAt && i.progress !== 'STOPPED' && i.activityCode === classification.activityCode && i.professionLayer === classification.professionLayer && i.channelCode === classification.channelCode && i.departmentId === departmentId);
}
export function projectPlanBookings(rows: BookingView[], campaignId: string, items: QcttPlanItem[]): QcttPlanBooking[] {
  return rows.flatMap(row => {
    const effective = bookingEffective(row);
    const projections: QcttPlanBooking[] = [];
    const add = (value: NonNullable<typeof effective>, perspective: QcttPlanBooking['perspective']) => {
      if (value.campaignId !== campaignId) return;
      const item = items.find(i => i.id === value.planItemId);
      projections.push({ id: row.id, itemId: value.planItemId ?? null, perspective,
        slotName: value.contractSnapshot?.slotName ?? 'Slot chưa có tên chụp tại thời điểm đặt',
        startDate: value.startDate, endDate: value.endDate, quantity: value.quantity, unit: value.unit,
        status: perspective === 'EFFECTIVE' ? 'Có hiệu lực' : row.workflow ? bookingApprovalLabels[row.workflow.status] : 'Dữ liệu cũ',
        execution: bookingExecutionLabels[bookingExecutionAsOf(row)], deleted: Boolean(row.deletedAt),
        outsidePlan: Boolean(item && (item.startDate && value.startDate < item.startDate || item.endDate && value.endDate > item.endDate)) });
    };
    if (effective) add(effective, 'EFFECTIVE');
    if (!effective || row.workflow && row.workflow.status !== 'APPROVED') add(row, 'PROPOSED');
    return projections;
  });
}
