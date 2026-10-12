import { describe, expect, it } from 'vitest';
import type { BookingBootstrap, BookingView, BookingDelegationSnapshot } from '@cpms/domain';
import { bookingApproverEmails } from './booking-approval-display';

const data={
  contracts:[{contract:{id:'contract',managerActorId:'manager',managerEmail:'manager@example.test'},access:[{allocationId:'slot-a',operatorActorIds:['operator'],leaderActorIds:['leader']},{allocationId:'slot-b',operatorActorIds:['other'],leaderActorIds:[]}]}] as unknown as BookingBootstrap['contracts'],
  people:[{id:'operator',name:'Operator',email:'operator@example.test'},{id:'leader',name:'Leader',email:'leader@example.test'},{id:'other',name:'Other',email:'other@example.test'}],
};
const row=(status:NonNullable<BookingView['workflow']>['status'],allocationId='slot-a')=>({contractId:'contract',allocationId,workflow:{status}} as Pick<BookingView,'contractId'|'allocationId'|'workflow'>);

describe('booking assigned approver email presentation',()=>{
  it('uses Contract manager and matching slot operator for internal review only',()=>{
    expect(bookingApproverEmails(row('PENDING_INTERNAL'),data)).toEqual(['manager@example.test','operator@example.test']);
    expect(bookingApproverEmails(row('PENDING_INTERNAL','slot-b'),data)).toEqual(['manager@example.test','other@example.test']);
  });
  it('shows matching slot leader at leader review and no stale recipients after approval',()=>{
    expect(bookingApproverEmails(row('PENDING_LEADER'),data)).toEqual(['leader@example.test']);
    expect(bookingApproverEmails(row('PENDING_LEADER','slot-b'),data)).toEqual([]);
    expect(bookingApproverEmails(row('APPROVED'),data)).toEqual([]);
  });
  it('shows eligible delegated recipients beside the leader, and never on completed requests',()=>{
    const delegation={delegateActorId:'operator'} as BookingDelegationSnapshot;
    expect(bookingApproverEmails({...row('PENDING_LEADER'),approvalDelegations:[delegation]},data)).toEqual(['leader@example.test','operator@example.test']);
    expect(bookingApproverEmails({...row('APPROVED'),approvalDelegations:[delegation]},data)).toEqual([]);
  });
});
