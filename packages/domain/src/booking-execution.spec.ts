import { describe, expect, it } from 'vitest';
import type { BookingView } from './booking';
import { bookingExecutionAsOf, bookingSnapshot } from './booking-workflow';

const row = (startDate='2026-09-17'):BookingView => ({
  id:'booking',allocationId:'allocation',contractId:'contract',slotId:'slot',campaignId:null,campaignLabel:'QA',startDate,endDate:'2026-09-30',quantity:'1',materialId:null,materialUrl:null,note:'',
  unit:'Slot',unitPrice:'1',priceBasis:'1',taxRate:'0',amount:'1',vat:'0',gross:'1',state:'ACTIVE',deletedAt:null,
  vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},
  recordVersion:1,createdByActorId:'actor',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',execution:'NOT_STARTED',
});
const approved = (startDate='2026-09-17') => {
  const booking=row(startDate);
  booking.workflow={version:1,status:'APPROVED',route:'AUTO',origin:'MANAGER',policyVersion:1,required:false,requestVersion:1,submittedBy:'actor',submittedAt:'2026-09-01T00:00:00Z',reason:'',effective:bookingSnapshot(booking),decisions:[]};
  return booking;
};

describe('approved booking execution projection',()=>{
  it('changes at midnight in Vietnam, without a manual START',()=>{
    const booking=approved();
    expect(bookingExecutionAsOf(booking,new Date('2026-09-16T16:59:59Z'))).toBe('NOT_STARTED');
    expect(bookingExecutionAsOf(booking,new Date('2026-09-16T17:00:00Z'))).toBe('RUNNING');
  });
  it('never runs an unapproved proposal and uses the approved schedule while a revision awaits review',()=>{
    const draft=row('2026-09-01');draft.workflow={...approved().workflow!,status:'DRAFT',effective:null};
    expect(bookingExecutionAsOf(draft,new Date('2026-09-16T12:00:00Z'))).toBe('NOT_STARTED');
    const revision=approved('2026-09-10');revision.startDate='2026-10-01';revision.workflow!.status='PENDING_LEADER';
    expect(bookingExecutionAsOf(revision,new Date('2026-09-16T12:00:00Z'))).toBe('RUNNING');
  });
  it('respects a pause, a future resume, and completed bookings',()=>{
    const booking=approved();booking.state='PAUSED';booking.execution='PAUSED';
    expect(bookingExecutionAsOf(booking,new Date('2026-09-18T12:00:00Z'))).toBe('PAUSED');
    booking.state='ACTIVE';booking.execution='NOT_STARTED';
    expect(bookingExecutionAsOf(booking,new Date('2026-09-16T12:00:00Z'))).toBe('NOT_STARTED');
    booking.execution='FINISHED';
    expect(bookingExecutionAsOf(booking,new Date('2026-09-18T12:00:00Z'))).toBe('FINISHED');
  });
});
