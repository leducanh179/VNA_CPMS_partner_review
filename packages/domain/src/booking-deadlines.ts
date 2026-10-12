import type { BookingView, BookingListItem } from './booking';
import { bookingEffective, bookingOperationLabels, bookingReportPeriods } from './booking-workflow';

const DAY = 86_400_000;
export type BookingDeadlineState = 'UPCOMING'|'ON_TIME'|'OVERDUE'|'COMPLETED'|'LATE'|'UNKNOWN';
export interface BookingDeadline {
  id:string; kind:'APPROVAL'|'REPORT_SUBMISSION'|'REPORT_APPROVAL'; label:string;
  responsibility:string; receivedAt:string|null; dueAt:string|null; completedAt:string|null;
  reportId?:string; state:BookingDeadlineState; elapsedMs:number; overdueMs:number;
}
const stepLabels:Record<string,string> = {
  PENDING_VENDOR:'Vendor xác nhận', PENDING_INTERNAL:'Contract manager / Slot operator duyệt',
  PENDING_LEADER:'Lãnh đạo phòng duyệt',
};
const leaderHandoff=(decision:{step:string;decision:string})=>decision.step==='PENDING_INTERNAL'&&decision.decision==='APPROVE'||decision.step==='PENDING_VENDOR'&&decision.decision==='CONFIRM';
/** Each new step starts at its own handoff, never at a generic record updatedAt. */
export function bookingStepReceivedAt(row:BookingView):string|null {
  const w=row.workflow;if(!w?.status.startsWith('PENDING_'))return null;
  if(w.status!=='PENDING_LEADER')return w.submittedAt;
  return [...w.decisions].reverse().find(d=>leaderHandoff(d)&&(!w.submittedAt||d.at>=w.submittedAt))?.at??null;
}
function task(input:Omit<BookingDeadline,'state'|'elapsedMs'|'overdueMs'>,now:number):BookingDeadline {
  const received=Date.parse(input.receivedAt??''),due=Date.parse(input.dueAt??''),at=input.completedAt?Date.parse(input.completedAt):now;
  const known=Number.isFinite(received)&&Number.isFinite(due)&&Number.isFinite(at);
  return {...input,state:!known?'UNKNOWN':input.completedAt?(at>due?'LATE':'COMPLETED'):now<received?'UPCOMING':now>due?'OVERDUE':'ON_TIME',
    elapsedMs:known?Math.max(0,at-received):0,overdueMs:known?Math.max(0,at-due):0};
}
const plusDay=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+DAY).toISOString():null;
/** Calendar dates belong to Vietnam; seven full calendar days follow the end date. */
export function bookingReportDeadline(endDate:string) {
  const end=Date.parse(`${endDate}T00:00:00+07:00`);
  return {receivedAt:new Date(end+DAY).toISOString(),dueAt:new Date(end+8*DAY-1).toISOString()};
}
export function bookingDeadlines(row:BookingView & Pick<BookingListItem,'approvalDelegations'>,now=Date.now()):BookingDeadline[] {
  const tasks:BookingDeadline[]=[],w=row.workflow;
  const request=row.lifecycleRequest;
  if(request){const who=request.decidedDelegation?`${request.decidedDelegation.delegateName} duyệt theo ủy quyền`:request.status==='PENDING'&&row.approvalDelegations?.length?'Người được ủy quyền / LĐP duyệt':'LĐP duyệt';tasks.push(task({id:'lifecycle-approval',kind:'APPROVAL',label:`${who} ${bookingOperationLabels[request.action].toLocaleLowerCase('vi-VN')}`,responsibility:who,receivedAt:request.requestedAt,dueAt:plusDay(request.requestedAt),completedAt:request.decidedAt},now));}
  if(row.deletedAt||row.execution==='CANCELLED'||row.id.startsWith('draft-'))return tasks;
  if(w?.status.startsWith('PENDING_')) {
    const receivedAt=bookingStepReceivedAt(row),label=w.status==='PENDING_LEADER'&&row.approvalDelegations?.length?'Người được ủy quyền / LĐP duyệt':stepLabels[w.status]!;
    tasks.push(task({id:'booking-approval',kind:'APPROVAL',label,responsibility:label,receivedAt,dueAt:plusDay(receivedAt),completedAt:null},now));
  }
  for(const [index,d] of (w?.decisions??[]).entries()) {
    if(!stepLabels[d.step]||!['APPROVE','CONFIRM','RETURN','REJECT'].includes(d.decision))continue;
    const receivedAt=d.receivedAt??(d.at>=(w?.submittedAt??'~')?(d.step==='PENDING_LEADER'?[...(w?.decisions??[])].reverse().find(p=>leaderHandoff(p)&&p.at<=d.at&&p.at>=(w?.submittedAt??''))?.at??null:w?.submittedAt??null):null);
    const label=d.delegation?`${d.delegation.delegateName} duyệt theo ủy quyền (v${d.delegation.version})`:stepLabels[d.step]!;
    tasks.push(task({id:`booking-decision-${index}`,kind:'APPROVAL',label,responsibility:label,receivedAt,dueAt:plusDay(receivedAt),completedAt:d.at},now));
  }
  const reports=bookingReportPeriods(row),effective=bookingEffective(row);
  for(const report of reports) {
    if(report.status==='PENDING')tasks.push(task({id:`report-${report.id}`,reportId:report.id,kind:'REPORT_APPROVAL',label:'Duyệt báo cáo',responsibility:'Contract manager / Slot operator',receivedAt:report.submittedAt,dueAt:plusDay(report.submittedAt),completedAt:null},now));
    for(const [index,d] of (report.decisions??[]).entries())tasks.push(task({id:`report-decision-${report.id}-${index}`,reportId:report.id,kind:'REPORT_APPROVAL',label:'Duyệt báo cáo',responsibility:'Contract manager / Slot operator',receivedAt:d.receivedAt,dueAt:plusDay(d.receivedAt),completedAt:d.at},now));
  }
  if(effective) {
    // A total report, or a period covering the effective end, is the closing report.
    // Partial earlier periods must not silently discharge the Vendor's obligation.
    const submissions=reports.flatMap(r=>r.submissions?.length?r.submissions:r.submittedAt?[{at:r.submittedAt,actorId:r.submittedBy,startDate:r.startDate,endDate:r.endDate}]:[]);
    const completedAt=submissions.filter(s=>{const end=s.endDate??s.bookingEndDate;return !end||end>=effective.endDate;}).map(s=>s.at).sort()[0]??null;
    const legacyComplete=(w?.origin==='HISTORICAL'&&row.reportState==='ACCEPTED'&&row.acceptedQty!=='0'&&!reports.length)||
      reports.some(r=>r.status==='ACCEPTED'&&!r.submittedAt&&!r.submissions?.length&&(!r.approved?.endDate||r.approved.endDate>=effective.endDate));
    if(!legacyComplete)tasks.push(task({id:'vendor-report',kind:'REPORT_SUBMISSION',label:'Vendor nộp báo cáo cuối kỳ',responsibility:'Vendor',...bookingReportDeadline(effective.endDate),completedAt},now));
  }
  return tasks;
}
