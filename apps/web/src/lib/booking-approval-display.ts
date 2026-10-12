import type { BookingBootstrap, BookingListItem } from '@cpms/domain';

/** Show assigned reviewers for the exact Contract/allocation, never a generic account. */
export function bookingApproverEmails(row:Pick<BookingListItem,'contractId'|'allocationId'|'workflow'|'lifecycleRequest'|'approvalDelegations'>, data:Pick<BookingBootstrap,'contracts'|'people'>):string[] {
  const ctx=data.contracts.find(c=>c.contract.id===row.contractId);
  const access=ctx?.access.find(a=>a.allocationId===row.allocationId);
  const final=[...(access?.leaderActorIds??[]),...(row.approvalDelegations??[]).map(g=>g.delegateActorId)];
  const ids=row.lifecycleRequest?.status==='PENDING'?final:row.workflow?.status==='PENDING_INTERNAL'?[ctx?.contract.managerActorId,...(access?.operatorActorIds??[])]:row.workflow?.status==='PENDING_LEADER'?final:[];
  return [...new Set(ids.flatMap(id=>id ? [data.people.find(p=>p.id===id)?.email ?? (id===ctx?.contract.managerActorId ? ctx.contract.managerEmail : null)] : []).filter((email):email is string=>Boolean(email)))];
}
