import { describe, expect, it } from 'vitest';
import type { BookingContext, BookingView } from './booking';
import { activeBookingDelegation, bookingDelegationSnapshot, bookingRequestDelegations, type BookingDelegation } from './booking-delegation';

const now=Date.parse('2026-09-17T05:00:00Z');
const grant:BookingDelegation={id:'g',contractId:'c',version:1,leaderActorId:'l',delegateActorId:'m',leaderName:'Leader',delegateName:'Manager',recipientRole:'MANAGER',scope:'CONTRACT',actions:['CREATE','PAUSE'],startsOn:'2026-09-17',endsOn:'2026-09-17',revoked:false,reason:'Test',actorId:'l',actorName:'Leader',createdAt:'2026-09-17T00:00:00Z'};
const context=()=>({contract:{id:'c',managerActorId:'m',leaderActorId:'l',deletedAt:null},access:[{allocationId:'a',operatorActorIds:['o']}],approvalDelegations:[grant]} as BookingContext);
const request=()=>({allocationId:'a',workflow:{status:'PENDING_LEADER',effective:null,delegations:[bookingDelegationSnapshot(grant)]}} as BookingView);

describe('Booking delegation boundaries',()=>{
  it('uses inclusive Vietnam dates, including the UTC date boundary',()=>{
    expect(activeBookingDelegation(grant,context(),'CREATE',Date.parse('2026-09-16T16:59:59Z'),'a')).toBe(false);
    expect(activeBookingDelegation(grant,context(),'CREATE',Date.parse('2026-09-16T17:00:00Z'),'a')).toBe(true);
    expect(activeBookingDelegation(grant,context(),'CREATE',Date.parse('2026-09-17T16:59:59Z'),'a')).toBe(true);
    expect(activeBookingDelegation(grant,context(),'CREATE',Date.parse('2026-09-17T17:00:00Z'),'a')).toBe(false);
  });
  it('requires current leader/manager, matching Contract and selected operation',()=>{
    expect(activeBookingDelegation(grant,context(),'CREATE',now,'a')).toBe(true);
    for(const patch of [{leaderActorId:'new'},{delegateActorId:'old'},{contractId:'other'},{revoked:true}])expect(activeBookingDelegation({...grant,...patch},context(),'CREATE',now,'a')).toBe(false);
    expect(activeBookingDelegation(grant,context(),'EDIT',now,'a')).toBe(false);
    const c=context();c.contract.deletedAt='2026-09-17';expect(activeBookingDelegation(grant,c,'CREATE',now,'a')).toBe(false);
  });
  it('operator never inherits whole-contract scope or another allocation of the same slot',()=>{
    const g={...grant,recipientRole:'OPERATOR' as const,scope:'ASSIGNED' as const,delegateActorId:'o'};
    expect(activeBookingDelegation(g,context(),'CREATE',now,'a')).toBe(true);
    expect(activeBookingDelegation(g,context(),'CREATE',now,'other-allocation')).toBe(false);
    expect(activeBookingDelegation({...g,scope:'CONTRACT'},context(),'CREATE',now,'a')).toBe(false);
  });
  it('does not adopt legacy pending requests and invalidates captured grants on replacement or revocation',()=>{
    expect(bookingRequestDelegations(request(),context(),now)).toHaveLength(1);
    const r=request();delete r.workflow!.delegations;expect(bookingRequestDelegations(r,context(),now)).toHaveLength(0);
    for(const patch of [{version:2,id:'g2'},{revoked:true}]){const c=context();c.approvalDelegations=[{...grant,...patch}];expect(bookingRequestDelegations(request(),c,now)).toHaveLength(0);}
  });
  it('checks operation against effective edit snapshot, not the original create grant',()=>{
    const r=request();r.workflow!.effective={allocationId:'a'} as NonNullable<BookingView['workflow']>['effective'];
    expect(bookingRequestDelegations(r,context(),now)).toHaveLength(0);
    const c=context();c.approvalDelegations=[{...grant,actions:['EDIT']}];expect(bookingRequestDelegations(r,c,now)).toHaveLength(1);
  });
  it('checks both old and proposed allocations for operator approval of a move',()=>{
    const g={...grant,recipientRole:'OPERATOR' as const,scope:'ASSIGNED' as const,delegateActorId:'o',actions:['EDIT' as const]};
    const c=context();c.approvalDelegations=[g];const r=request();r.workflow!.delegations=[bookingDelegationSnapshot(g)];r.workflow!.effective={allocationId:'old'} as NonNullable<BookingView['workflow']>['effective'];
    expect(bookingRequestDelegations(r,c,now)).toHaveLength(0);
    r.workflow!.effective!.allocationId='a';expect(bookingRequestDelegations(r,c,now)).toHaveLength(1);
  });
  it('uses lifecycle operation and leaves approved decisions intact after expiry',()=>{
    const r=request();r.workflow!.status='APPROVED';r.workflow!.decisions=[{step:'PENDING_LEADER',decision:'APPROVE',actorId:'m',at:new Date(now).toISOString(),reason:'',delegation:bookingDelegationSnapshot(grant)}];
    r.lifecycleRequest={action:'PAUSE',status:'PENDING',delegations:[bookingDelegationSnapshot(grant)]} as NonNullable<BookingView['lifecycleRequest']>;
    expect(bookingRequestDelegations(r,context(),now)).toHaveLength(1);
    expect(bookingRequestDelegations(r,context(),now+86400000)).toHaveLength(0);
    expect(r.workflow!.decisions[0]?.delegation?.id).toBe('g');
    r.lifecycleRequest!.action='DELETE';expect(bookingRequestDelegations(r,context(),now)).toHaveLength(0);
  });
});
