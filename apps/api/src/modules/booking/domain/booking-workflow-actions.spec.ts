import { describe, expect, it } from 'vitest';
import type { BookingView } from '@cpms/domain';
import { bookingApprovalActions, bookingSnapshot } from '@cpms/domain';
import { availableBookingActions, proposalWorkflow } from './booking-workflow';

const booking:BookingView={id:'b',allocationId:'a',contractId:'c',slotId:'s',campaignId:null,campaignLabel:'QA',startDate:'2026-09-20',endDate:'2026-09-30',quantity:'1',materialId:null,materialUrl:null,note:'',unit:'Slot',unitPrice:'1',priceBasis:'1',taxRate:'0',amount:'1',vat:'0',gross:'1',state:'ACTIVE',deletedAt:null,vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},recordVersion:1,createdByActorId:'vendor',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',execution:'NOT_STARTED'};

describe('Booking actions after automatic execution',()=>{
  it('preserves legacy lifecycle gates and independently gates amendments',()=>{
    expect(bookingApprovalActions({required:true})).toEqual({CREATE:true,EDIT:true,DELETE:false,RESTORE:false,PAUSE:false,RESUME:false});
    const policy={version:3,required:true,actions:{CREATE:false,EDIT:true,DELETE:true,RESTORE:true,PAUSE:true,RESUME:false},actorId:null,createdAt:null,reason:''};
    expect(proposalWorkflow(null,booking,policy,'MANAGER').status).toBe('APPROVED');
    expect(proposalWorkflow(booking,{...booking,quantity:'2'},policy,'MANAGER')).toMatchObject({status:'DRAFT',effective:{quantity:'1'}});
  });
  it('offers only the assigned leader decision while preserving a deleted restore request',()=>{
    const row:BookingView={...booking,deletedAt:'2026-09-10',lifecycleRequest:{action:'RESTORE',status:'PENDING',policyVersion:3,requestedBy:'vendor',requestedAt:'2026-09-12T00:00:00Z',reason:'',decidedAt:null,decidedBy:null}};
    const roles={leader:true,vendor:false,manager:false,operator:false,creator:false,reviewer:false};
    expect(availableBookingActions(row,roles,()=>true,'leader')).toEqual(['LIFECYCLE_APPROVE','LIFECYCLE_RETURN','LIFECYCLE_REJECT']);
    expect(availableBookingActions(row,{...roles,leader:false},()=>true,'outsider')).toEqual([]);
    expect(availableBookingActions(row,{...roles,leader:false},()=>true,'vendor')).toEqual(['LIFECYCLE_WITHDRAW']);
  });
  it('never offers a manual START, including to assigned Vendor/contract manager',()=>{
    const row:BookingView={...booking,workflow:{version:1,status:'APPROVED',route:'AUTO',origin:'VENDOR',policyVersion:1,required:false,requestVersion:1,submittedBy:'vendor',submittedAt:'2026-09-01T00:00:00Z',reason:'',effective:bookingSnapshot(booking),decisions:[]}};
    for(const roles of [{leader:false,vendor:true,manager:false,operator:false,creator:true,reviewer:false},{leader:false,vendor:false,manager:true,operator:false,creator:true,reviewer:true}]) {
      const actions=availableBookingActions(row,roles,()=>true,'actor');
      expect(actions).not.toContain('START');
      expect(actions).toContain('FINISH');
    }
  });
});
