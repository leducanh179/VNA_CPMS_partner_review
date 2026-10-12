import type { BookingFields, BookingView } from './booking';
import type { BookingDelegationSnapshot } from './booking-delegation';

export type BookingApprovalState = 'DRAFT' | 'PENDING_INTERNAL' | 'PENDING_LEADER' | 'PENDING_VENDOR' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'WITHDRAWN';
export type BookingExecution = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'CANCELLED';
export type BookingOrigin = 'VENDOR' | 'MANAGER' | 'HISTORICAL';
export type BookingSnapshot = BookingFields & Pick<BookingView, 'contractId'|'slotId'|'unit'|'unitPrice'|'priceBasis'|'taxRate'|'amount'|'vat'|'gross'|'contractRevisionId'|'contractSnapshot'>;
export interface BookingWorkflow {
  delegations?: BookingDelegationSnapshot[];
  version: 1; status: BookingApprovalState; route: BookingOrigin|'AUTO'|'LEGACY'; origin: BookingOrigin;
  policyVersion: number; required: boolean; requestVersion: number;
  submittedBy: string|null; submittedAt: string|null; reason: string;
  effective: BookingSnapshot|null; decisions: Array<{actorId:string;step:BookingApprovalState;at:string;decision:string;reason:string;receivedAt?:string|null;requestVersion?:number;delegation?:BookingDelegationSnapshot}>;
}
export const BOOKING_APPROVAL_OPERATIONS = ['CREATE','EDIT','DELETE','RESTORE','PAUSE','RESUME'] as const;
export type BookingApprovalOperation = typeof BOOKING_APPROVAL_OPERATIONS[number];
export type BookingApprovalActions = Record<BookingApprovalOperation, boolean>;
export const bookingOperationLabels: Record<BookingApprovalOperation,string> = { CREATE:'Tạo mới', EDIT:'Sửa thông tin', DELETE:'Xóa tạm', RESTORE:'Phục hồi', PAUSE:'Tạm dừng', RESUME:'Nối lại' };
export interface BookingPolicy { version:number; required:boolean; actions?: BookingApprovalActions | null; actorId:string|null; createdAt:string|null; reason:string }
/** Missing legacy action map preserves the previous policy, including direct lifecycle operations. */
export function bookingApprovalActions(policy: Pick<BookingPolicy,'required'|'actions'>): BookingApprovalActions {
  return policy.actions ?? { CREATE:policy.required, EDIT:policy.required, DELETE:false, RESTORE:false, PAUSE:false, RESUME:false };
}
export const bookingApprovalRequired = (policy: Pick<BookingPolicy,'required'|'actions'>, action: BookingApprovalOperation) => bookingApprovalActions(policy)[action];
export interface BookingLifecycleRequest {
  delegations?: BookingDelegationSnapshot[]; decidedDelegation?: BookingDelegationSnapshot;
  action: Exclude<BookingApprovalOperation,'CREATE'|'EDIT'>; status:'PENDING'|'APPROVED'|'RETURNED'|'REJECTED'|'WITHDRAWN';
  policyVersion:number; requestedBy:string; requestedAt:string; reason:string;
  decidedBy:string|null; decidedAt:string|null;
}
export interface BookingReportPeriod {
  id:string; startDate:string|null; endDate:string|null; templateId:string;
  status:'DRAFT'|'PENDING'|'RETURNED'|'ACCEPTED'; quantity:string; values:Record<string,string|null>;
  submittedBy:string; submittedAt:string|null; reason:string;
  submissions?:Array<{at:string;actorId:string;startDate:string|null;endDate:string|null;bookingEndDate?:string}>;
  decisions?:Array<{at:string;actorId:string;decision:'REPORT_APPROVE'|'REPORT_RETURN';receivedAt:string|null}>;
  approved:{quantity:string;values:Record<string,string|null>;actorId:string|null;at:string|null;startDate?:string|null;endDate?:string|null}|null;
}
export const BOOKING_WORKFLOW_ACTIONS = ['SUBMIT','APPROVE','CONFIRM','RETURN','REJECT','WITHDRAW','START','FINISH','REPORT_APPROVE','REPORT_RETURN','LIFECYCLE_APPROVE','LIFECYCLE_RETURN','LIFECYCLE_REJECT','LIFECYCLE_WITHDRAW'] as const;
export type BookingWorkflowAction = typeof BOOKING_WORKFLOW_ACTIONS[number];
export const bookingApprovalLabels:Record<BookingApprovalState,string> = {DRAFT:'Nháp',PENDING_INTERNAL:'Chờ CV phụ trách HĐ/CV khai thác slot duyệt',PENDING_LEADER:'Chờ LĐP duyệt',PENDING_VENDOR:'Chờ vendor xác nhận',APPROVED:'Được phê duyệt',RETURNED:'Cần chỉnh sửa',REJECTED:'Bị từ chối',WITHDRAWN:'Đã rút đề nghị'};
export const bookingExecutionLabels:Record<BookingExecution,string> = {NOT_STARTED:'Chưa triển khai',RUNNING:'Đang triển khai',PAUSED:'Tạm dừng',FINISHED:'Kết thúc',CANCELLED:'Đã hủy'};
export const bookingWorkflowActionLabels:Record<BookingWorkflowAction,string> = {SUBMIT:'Gửi duyệt',APPROVE:'Phê duyệt',CONFIRM:'Xác nhận',RETURN:'Trả lại / đề nghị sửa',REJECT:'Từ chối',WITHDRAW:'Rút đề nghị',START:'Bắt đầu triển khai (dữ liệu cũ)',FINISH:'Kết thúc đặt chỗ',REPORT_APPROVE:'Duyệt báo cáo',REPORT_RETURN:'Trả lại báo cáo',LIFECYCLE_APPROVE:'Duyệt thao tác',LIFECYCLE_RETURN:'Trả lại thao tác',LIFECYCLE_REJECT:'Từ chối thao tác',LIFECYCLE_WITHDRAW:'Rút đề nghị thao tác'};
export const bookingPending = (row:BookingView) => Boolean(row.workflow?.status.startsWith('PENDING_'));
export function bookingSnapshot(row:BookingSnapshot):BookingSnapshot {
  const {allocationId,campaignId,campaignLabel,startDate,endDate,quantity,materialId,materialUrl,note,overallStartDate,overallEndDate,campaignDatesAuto,timeDistribution,contractId,slotId,unit,unitPrice,priceBasis,taxRate,amount,vat,gross}=row;
  return {allocationId,campaignId,campaignLabel,startDate,endDate,quantity,materialId,materialUrl,note,overallStartDate,overallEndDate,campaignDatesAuto,timeDistribution,contractId,slotId,unit,unitPrice,priceBasis,taxRate,amount,vat,gross,...(row.planItemId ? {planItemId:row.planItemId} : {}),...(row.contractRevisionId ? {contractRevisionId:row.contractRevisionId,contractSnapshot:row.contractSnapshot??null} : {})};
}
export function bookingEffective(row:BookingView):BookingSnapshot|null { return row.workflow ? row.workflow.effective : bookingSnapshot(row); }
/** Execution is a read projection of the approved schedule, not a vendor-entered state. */
export function bookingExecutionAsOf(row:BookingView, asOf:Date = new Date()):BookingExecution {
  if (row.deletedAt || ['FINISHED','CANCELLED'].includes(row.execution ?? '')) return row.execution ?? 'NOT_STARTED';
  if (row.state === 'PAUSED') return 'PAUSED';
  const effective = bookingEffective(row);
  if (!effective?.startDate) return 'NOT_STARTED';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(asOf);
  const piece = (type:string) => parts.find(part => part.type === type)?.value ?? '';
  const today = `${piece('year')}-${piece('month')}-${piece('day')}`;
  return effective.startDate.slice(0,10) <= today ? 'RUNNING' : 'NOT_STARTED';
}
export function bookingReportPeriods(row:BookingView):BookingReportPeriod[] {
  if(row.reportPeriods?.length)return row.reportPeriods;
  if(!row.reportTemplateId||row.acceptedQty==='0')return [];
  return [{id:`legacy-${row.id}`,startDate:null,endDate:null,templateId:row.reportTemplateId,status:'ACCEPTED',quantity:row.acceptedQty,values:row.reportData,submittedBy:row.createdByActorId,submittedAt:null,reason:'Nghiệm thu đã ghi nhận trước lớp duyệt',approved:{quantity:row.acceptedQty,values:row.reportData,actorId:null,at:null,startDate:null,endDate:null}}];
}
export function bookingCommitments(row:BookingView):BookingSnapshot[] {
  const effective=bookingEffective(row);
  if(row.deletedAt||['FINISHED','CANCELLED'].includes(row.execution??''))return effective&&row.acceptedQty!=='0'?[{...effective,quantity:row.acceptedQty}]:[];
  const result=effective?[effective]:[];
  if(bookingPending(row))result.push(bookingSnapshot(row));
  return result;
}
