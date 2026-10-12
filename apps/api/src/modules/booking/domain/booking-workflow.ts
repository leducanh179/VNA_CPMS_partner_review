import { bookingApprovalRequired, bookingCommitments, bookingEffective, bookingPending, bookingSnapshot, type BookingContext, type BookingOrigin, type BookingPolicy, type BookingView, type BookingWorkflow, type BookingWorkflowAction } from '@cpms/domain';
import { decimal } from '../../contracts/domain/supply-engine';

export function bookingResponsibilities(ctx:BookingContext, allocationId:string, actorId:string) {
  const a=ctx.access.find(a=>a.allocationId===allocationId);
  const leader=Boolean(a?.leaderActorIds.includes(actorId));
  const vendor=Boolean(a?.vendorActorIds.includes(actorId));
  const manager=ctx.contract.managerActorId===actorId;
  const operator=Boolean(a?.operatorActorIds.includes(actorId));
  return {leader,vendor,manager,operator,creator:!leader&&(manager||vendor||operator),reviewer:!vendor&&(manager||operator)};
}
export function proposalWorkflow(before:BookingView|null, row:BookingView, policy:BookingPolicy, origin:BookingOrigin):BookingWorkflow {
  policy = { ...policy, required: bookingApprovalRequired(policy, before && bookingEffective(before) ? 'EDIT' : 'CREATE') };
  const effective=before?bookingEffective(before):null;
  return {version:1,status:policy.required?'DRAFT':'APPROVED',route:policy.required?origin:'AUTO',origin,policyVersion:policy.version,required:policy.required,requestVersion:before?.workflow?.requestVersion??0,submittedBy:null,submittedAt:null,reason:'',effective:policy.required?effective:bookingSnapshot(row),decisions:before?.workflow?.decisions??[]};
}
export function availableBookingActions(row:BookingView, roles:ReturnType<typeof bookingResponsibilities>, granted:(p:string)=>boolean, actorId:string, reportRoles=roles, delegated=false):BookingWorkflowAction[] {
  if (row.lifecycleRequest?.status === 'PENDING') {
    const actions:BookingWorkflowAction[] = [];
    if ((roles.leader || delegated) && granted('booking.approve')) actions.push('LIFECYCLE_APPROVE','LIFECYCLE_RETURN','LIFECYCLE_REJECT');
    if (row.lifecycleRequest.requestedBy === actorId && granted('booking.read')) actions.push('LIFECYCLE_WITHDRAW');
    return actions;
  }
  if(row.deletedAt)return [];
  const a:BookingWorkflowAction[]=[], w=row.workflow;
  if(w&&['DRAFT','RETURNED','REJECTED','WITHDRAWN'].includes(w.status)&&roles.creator&&granted('booking.submit'))a.push('SUBMIT');
  const reviewer=w?.status==='PENDING_INTERNAL'&&roles.reviewer||w?.status==='PENDING_LEADER'&&(roles.leader||delegated);
  if(reviewer&&granted('booking.approve'))a.push('APPROVE','RETURN','REJECT');
  if(w?.status==='PENDING_VENDOR'&&roles.vendor&&granted('booking.confirm'))a.push('CONFIRM','RETURN','REJECT');
  if(bookingPending(row)&&w?.submittedBy===actorId&&granted('booking.submit'))a.push('WITHDRAW');
  if(bookingEffective(row)&&!['FINISHED','CANCELLED'].includes(row.execution??'')&&(roles.vendor||roles.manager)&&granted('booking.update')) {
    if(!bookingPending(row)&&row.reportState!=='PENDING')a.push('FINISH');
  }
  if(row.reportPeriods?.some(r=>r.status==='PENDING')&&reportRoles.reviewer&&granted('booking.report.approve'))a.push('REPORT_APPROVE','REPORT_RETURN');
  return a;
}
/** One reservation per booking/allocation. Proposed and effective versions never add twice. */
export function reservationRows(row:BookingView):BookingView[] {
  if(!row.workflow)return [row];
  const groups=new Map<string,BookingView>();
  for(const part of bookingCommitments(row)) {
    const old=groups.get(part.allocationId);
    const next={...row,...part,workflow:null,acceptedQty:bookingEffective(row)?.allocationId===part.allocationId?row.acceptedQty:'0'};
    if(!old)groups.set(part.allocationId,next);
    else {const larger=decimal(next.quantity).gt(old.quantity)?next:old;groups.set(part.allocationId,{...larger,startDate:old.startDate<next.startDate?old.startDate:next.startDate,endDate:old.endDate>next.endDate?old.endDate:next.endDate});}
  }
  return [...groups.values()];
}
export function physicalIntervals(row:BookingView) {
  if(row.deletedAt||['FINISHED','CANCELLED'].includes(row.execution??''))return [];
  const intervals=(row.workflow?bookingCommitments(row):row.deletedAt?[]:[bookingSnapshot(row)]).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  const out:Array<{id:string;slotId:string;startDate:string;endDate:string}>=[];
  for(const item of intervals) {const previous=[...out].reverse().find(p=>p.slotId===item.slotId&&p.endDate>=item.startDate);if(previous)previous.endDate=previous.endDate>item.endDate?previous.endDate:item.endDate;else out.push({id:row.id,slotId:item.slotId,startDate:item.startDate,endDate:item.endDate});}
  return out;
}
export function bookingUsageRows(row:BookingView, stage:'booked'|'committed'|'approved'|'vendorConfirmed'|'accepted'):Array<BookingView & {planBasis?:ReturnType<typeof bookingSnapshot>}> {
  if(stage==='booked'||stage==='committed')return reservationRows(row).map(part=>({...part,...(row.deletedAt||['FINISHED','CANCELLED'].includes(row.execution??'')?{planBasis:bookingEffective(row)??bookingSnapshot(row)}:{})}));
  const effective=bookingEffective(row);
  const proposalConfirmed=stage==='vendorConfirmed'&&bookingPending(row)&&(row.workflow?.route==='VENDOR'||row.workflow?.route==='MANAGER'&&row.workflow.status==='PENDING_LEADER');
  const base=proposalConfirmed?bookingSnapshot(row):effective;
  const quantity=stage==='accepted'?row.acceptedQty:row.deletedAt?'0':stage==='approved'?(row.workflow?effective?.quantity:row.sourceApprovedQty):proposalConfirmed?row.quantity:row.vendorConfirmedQty;
  return base&&quantity&&decimal(quantity).gt(0)?[{...row,...base,quantity,workflow:null,planBasis:base}]:[];
}
