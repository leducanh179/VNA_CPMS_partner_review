import { describe, expect, it } from 'vitest';
import type { BookingView, BookingWorkflow } from './index';
import { bookingDeadlines, bookingReportDeadline, bookingStepReceivedAt } from './booking-deadlines';
import { bookingSnapshot } from './booking-workflow';
const row=():BookingView=>({id:'booking',allocationId:'a',contractId:'c',slotId:'s',campaignId:null,campaignLabel:'Campaign',startDate:'2026-09-01',endDate:'2026-09-30',quantity:'10',materialId:null,materialUrl:null,note:'',unit:'slot',unitPrice:'10',priceBasis:'1',taxRate:'0',amount:'100',vat:'0',gross:'100',state:'ACTIVE',deletedAt:null,vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},recordVersion:1,createdByActorId:'vendor',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',reportPeriods:[]});
const workflow=(status:BookingWorkflow['status']):BookingWorkflow=>({version:1,status,route:'VENDOR',origin:'VENDOR',policyVersion:1,required:true,requestVersion:1,submittedAt:'2026-09-04T03:00:00Z',submittedBy:'vendor',reason:'',effective:null,decisions:[]});
describe('Booking deadlines',()=>{
  it('uses elapsed 24 hours including weekends and does not reset on unrelated edits',()=>{
    const r=row();r.workflow=workflow('PENDING_INTERNAL');r.updatedAt='2026-09-06T00:00:00Z';
    expect(bookingDeadlines(r,Date.parse('2026-09-05T03:00:00Z'))[0]?.state).toBe('ON_TIME');
    const t=bookingDeadlines(r,Date.parse('2026-09-05T05:00:00Z'))[0]!;
    expect(t.overdueMs).toBe(2*3600000);expect(t.elapsedMs).toBe(26*3600000);
  });
  it('gives the leader a fresh 24 hours at handoff and preserves the late internal step',()=>{
    const r=row();r.workflow=workflow('PENDING_LEADER');r.workflow.decisions=[{step:'PENDING_INTERNAL',at:'2026-09-05T05:00:00Z',receivedAt:r.workflow.submittedAt,decision:'APPROVE',actorId:'operator',reason:''}];
    expect(bookingStepReceivedAt(r)).toBe('2026-09-05T05:00:00Z');
    const tasks=bookingDeadlines(r,Date.parse('2026-09-05T06:00:00Z'));
    expect(tasks[0]?.state).toBe('ON_TIME');expect(tasks[0]?.dueAt).toBe('2026-09-06T05:00:00.000Z');expect(tasks[1]?.state).toBe('LATE');
    r.workflow.submittedAt='2026-09-07T00:00:00Z';r.workflow.status='PENDING_INTERNAL';
    expect(bookingDeadlines(r,Date.parse('2026-09-07T01:00:00Z')).filter(t=>t.state==='LATE')).toHaveLength(1);
  });
  it('starts the manager-route leader clock at Vendor confirmation and retains each late step',()=>{
    const r=row();r.workflow={...workflow('PENDING_LEADER'),route:'MANAGER',origin:'MANAGER'};
    r.workflow.decisions=[{step:'PENDING_VENDOR',at:'2026-09-05T05:00:00Z',receivedAt:r.workflow.submittedAt,decision:'CONFIRM',actorId:'vendor',reason:''}];
    expect(bookingStepReceivedAt(r)).toBe('2026-09-05T05:00:00Z');
    const tasks=bookingDeadlines(r,Date.parse('2026-09-05T06:00:00Z'));
    expect(tasks[0]?.dueAt).toBe('2026-09-06T05:00:00.000Z');expect(tasks[0]?.state).toBe('ON_TIME');expect(tasks[1]?.overdueMs).toBe(2*3600000);
    r.workflow.status='APPROVED';r.workflow.decisions.push({step:'PENDING_LEADER',at:'2026-09-06T07:00:00Z',decision:'APPROVE',actorId:'leader',reason:''});
    const leaderTask=bookingDeadlines(r).find(t=>t.id==='booking-decision-1');
    expect(leaderTask?.receivedAt).toBe('2026-09-05T05:00:00Z');expect(leaderTask?.state).toBe('LATE');expect(leaderTask?.overdueMs).toBe(2*3600000);
  });
  it('calculates seven complete Vietnam calendar days across month and leap-year boundaries',()=>{
    expect(bookingReportDeadline('2026-09-30')).toEqual({receivedAt:'2026-09-30T17:00:00.000Z',dueAt:'2026-10-07T16:59:59.999Z'});
    expect(bookingReportDeadline('2028-02-28').dueAt).toBe('2028-03-06T16:59:59.999Z');
  });
  it('uses effective end date, retains the closing obligation after partial reports and separates reviewer delay',()=>{
    const r=row();r.workflow=workflow('DRAFT');r.workflow.effective=bookingSnapshot(r);r.endDate='2026-12-31';
    r.reportPeriods=[{id:'p',templateId:'t',startDate:'2026-09-01',endDate:'2026-09-07',status:'PENDING',quantity:'2',values:{},submittedAt:'2026-10-01T00:00:00Z',submittedBy:'vendor',reason:'',approved:null}];
    let tasks=bookingDeadlines(r,Date.parse('2026-10-08T00:00:00Z'));
    expect(tasks.find(t=>t.kind==='REPORT_SUBMISSION')?.state).toBe('OVERDUE');expect(tasks.find(t=>t.kind==='REPORT_APPROVAL')?.state).toBe('OVERDUE');
    r.reportPeriods[0]!.submissions=[{at:'2026-10-01T00:00:00Z',startDate:null,endDate:null,actorId:'vendor'}];
    tasks=bookingDeadlines(r,Date.parse('2026-10-08T00:00:00Z'));
    expect(tasks.find(t=>t.kind==='REPORT_SUBMISSION')?.state).toBe('COMPLETED');expect(tasks.find(t=>t.kind==='REPORT_APPROVAL')?.state).toBe('OVERDUE');
  });
  it('does not fabricate missing handoffs or legacy acceptance timestamps',()=>{
    const r=row();r.workflow=workflow('PENDING_LEADER');expect(bookingDeadlines(r)[0]?.state).toBe('UNKNOWN');
    r.workflow=null;r.reportTemplateId='t';r.acceptedQty='1';r.reportState='ACCEPTED';expect(bookingDeadlines(r)).toHaveLength(0);
    r.deletedAt='2026-09-30T00:00:00Z';expect(bookingDeadlines(r)).toHaveLength(0);
  });
  it('does not show a vendor report overdue for an accepted historical import without invented submission time',()=>{
    const r=row();r.reportState='ACCEPTED';r.acceptedQty=r.quantity;
    r.workflow={...workflow('APPROVED'),origin:'HISTORICAL',route:'LEGACY',effective:bookingSnapshot(r),submittedAt:null,submittedBy:null,decisions:[]};
    expect(bookingDeadlines(r,Date.parse('2026-10-20T00:00:00Z'))).toHaveLength(0);
  });
  it('does not let an earlier total report close an extended effective booking',()=>{
    const r=row();r.endDate='2026-10-31';r.reportPeriods=[{id:'p',templateId:'t',startDate:null,endDate:null,status:'ACCEPTED',quantity:'1',values:{},submittedAt:'2026-10-02T00:00:00Z',submittedBy:'vendor',reason:'',approved:null,submissions:[{at:'2026-10-02T00:00:00Z',actorId:'vendor',startDate:null,endDate:null,bookingEndDate:'2026-09-30'}]}];
    expect(bookingDeadlines(r,Date.parse('2026-11-08T00:00:00Z')).find(t=>t.kind==='REPORT_SUBMISSION')?.state).toBe('OVERDUE');
  });
  it('keeps return/resubmit review clocks separate from the first closing submission',()=>{
    const r=row();r.reportPeriods=[{id:'p',templateId:'t',startDate:null,endDate:null,status:'PENDING',quantity:'0',values:{},submittedAt:'2026-10-10T00:00:00Z',submittedBy:'vendor',reason:'',approved:null,submissions:[{at:'2026-10-02T00:00:00Z',actorId:'vendor',startDate:null,endDate:null}],decisions:[{at:'2026-10-05T00:00:00Z',actorId:'operator',decision:'REPORT_RETURN',receivedAt:'2026-10-02T00:00:00Z'}]}];
    const tasks=bookingDeadlines(r,Date.parse('2026-10-10T01:00:00Z'));
    expect(tasks.find(t=>t.id==='report-p')?.state).toBe('ON_TIME');expect(tasks.find(t=>t.kind==='REPORT_SUBMISSION')?.state).toBe('COMPLETED');expect(tasks.filter(t=>t.state==='LATE')).toHaveLength(1);
  });
});
