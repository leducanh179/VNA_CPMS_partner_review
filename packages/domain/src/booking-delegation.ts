import type { SupplyContractView } from './contracts';
import type { BookingApprovalOperation } from './booking-workflow';
import type { BookingContext, BookingView } from './booking';

export interface BookingDelegation {
  id: string; contractId: string; version: number; leaderActorId: string; delegateActorId: string;
  leaderName: string; delegateName: string; actions: BookingApprovalOperation[];
  recipientRole: 'MANAGER'|'OPERATOR'; scope: 'CONTRACT'|'ASSIGNED';
  startsOn: string; endsOn: string | null; revoked: boolean; reason: string;
  actorId: string; actorName: string; createdAt: string;
}
export type BookingDelegationSnapshot = Pick<BookingDelegation, 'id'|'contractId'|'version'|'leaderActorId'|'delegateActorId'|'leaderName'|'delegateName'|'startsOn'|'endsOn'|'recipientRole'|'scope'>;
export function bookingVietnamDate(now = Date.now()) {
  return new Date(now + 7 * 3600000).toISOString().slice(0, 10);
}
export function activeBookingDelegation(grant: BookingDelegation | null | undefined, context: Pick<BookingContext,'contract'|'access'>, action: BookingApprovalOperation, now = Date.now(), allocationId?:string) {
  const contract:SupplyContractView=context.contract;
  const date = bookingVietnamDate(now);
  return Boolean(grant && !grant.revoked && !contract.deletedAt && grant.contractId === contract.id
    && grant.leaderActorId === contract.leaderActorId && (grant.recipientRole==='MANAGER'
      ? grant.scope==='CONTRACT' && grant.delegateActorId===contract.managerActorId
      : grant.scope==='ASSIGNED' && context.access.some(a=>a.operatorActorIds.includes(grant.delegateActorId)&&(!allocationId||a.allocationId===allocationId)))
    && grant.startsOn <= date && (!grant.endsOn || grant.endsOn >= date) && grant.actions.includes(action));
}
export function bookingDelegationSnapshot(grant: BookingDelegation): BookingDelegationSnapshot {
  const {id,contractId,version,leaderActorId,delegateActorId,leaderName,delegateName,startsOn,endsOn,recipientRole,scope} = grant;
  return {id,contractId,version,leaderActorId,delegateActorId,leaderName,delegateName,startsOn,endsOn,recipientRole,scope};
}
/** A new grant never retroactively adopts a pending request. Replaced/revoked grants fail closed. */
export function bookingRequestDelegations(row:BookingView,ctx:BookingContext,now=Date.now()):BookingDelegationSnapshot[] {
  const lifecycle=row.lifecycleRequest?.status==='PENDING'?row.lifecycleRequest:null;
  if(!lifecycle&&!row.workflow?.status.startsWith('PENDING_'))return [];
  const snapshots=(lifecycle?lifecycle.delegations:row.workflow?.delegations)??[];
  const action=lifecycle?.action??(row.workflow?.effective?'EDIT':'CREATE');
  return snapshots.filter(snapshot=>{const grant=ctx.approvalDelegations?.find(g=>g.delegateActorId===snapshot.delegateActorId);
    return grant&&snapshot.id===grant.id&&snapshot.version===grant.version
      &&activeBookingDelegation(grant,ctx,action,now,row.allocationId)
      &&(!row.workflow?.effective||activeBookingDelegation(grant,ctx,action,now,row.workflow.effective.allocationId));});
}
export interface BookingDelegationOption {
  id:string; code:string; name:string; leader:{id:string;name:string;email:string|null}|null;
  delegate:{id:string;name:string;email:string|null}|null; history:BookingDelegation[];
  operators:Array<{id:string;name:string;email:string|null;slotNames:string[]}>;
  assignmentVersion:number;
}
