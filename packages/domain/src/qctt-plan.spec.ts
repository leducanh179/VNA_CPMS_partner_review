import { describe, expect, it } from 'vitest';
import { emptyQcttPlanFields, matchingPlanItems, projectPlanBookings, qcttPlanCompleteness, type QcttPlanItem } from './qctt-plan';
import type { BookingView } from './booking';
import { bookingSnapshot } from './booking-workflow';
const classification = { professionLayer: 'PFL-001', professionLayerName: 'Advertising', channelCode: 'CHN-004', channelName: 'Social', activityCode: 'ATV-003', activityName: 'Facebook', catalogVersion: 1 };
const item = (id: string): QcttPlanItem => ({ ...emptyQcttPlanFields(), id, campaignId:'campaign', activityLabel:'Facebook', professionLayer:'PFL-001',channelCode:'CHN-004',activityCode:'ATV-003',departmentId:'division',startDate:'2026-10-05',endDate:'2026-10-25',classification,recordVersion:1,sortOrder:1,origin:'MANUAL',deletedAt:null,createdByActorId:'manager',createdAt:'2026-09-25',updatedAt:'2026-09-25' });
const booking:BookingView={id:'booking',allocationId:'allocation',contractId:'contract',slotId:'slot',campaignId:'campaign',planItemId:'opening',campaignLabel:'AMD',startDate:'2026-10-05',endDate:'2026-10-20',quantity:'100',materialId:null,materialUrl:null,note:'',unit:'reach',unitPrice:'1',priceBasis:'1',taxRate:'0',amount:'100',vat:'0',gross:'100',state:'ACTIVE',deletedAt:null,vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},recordVersion:1,createdByActorId:'vendor',createdAt:'2026-09-25',updatedAt:'2026-09-25'};
describe('QCTT operational plan', () => {
  it('keeps repeated activities distinct and matches IDs plus department, never labels', () => {
    const a=item('opening'),b={...item('launch'),activityLabel:'Another phase'};
    expect(matchingPlanItems([a,b],classification,'division').map(i=>i.id)).toEqual(['opening','launch']);
    expect(matchingPlanItems([a,b],classification,'another-division')).toEqual([]);
    expect(matchingPlanItems([{...a,activityCode:null}],classification,'division')).toEqual([]);
    expect(matchingPlanItems([{...a,deletedAt:'2026-10-01'},{...b,progress:'STOPPED'}],classification,'division')).toEqual([]);
  });
  it('supports completed work without fabricated dates and requires a real custom format', () => {
    expect(qcttPlanCompleteness({...item('a'),startDate:null,endDate:null,progress:'COMPLETED'})).toEqual([]);
    expect(qcttPlanCompleteness({...item('a'),startDate:null,format:'OTHER'})).toEqual(['Thời gian','Hình thức khác']);
  });
  it('projects old effective linkage separately from an amendment without leaking contract financials', () => {
    const row:BookingView={...booking,planItemId:'launch',endDate:'2026-11-01',workflow:{version:1,status:'PENDING_LEADER',route:'MANAGER',origin:'MANAGER',policyVersion:1,required:true,requestVersion:1,submittedBy:'manager',submittedAt:'2026-09-25',reason:'',effective:bookingSnapshot(booking),decisions:[]}};
    const result=projectPlanBookings([row],'campaign',[item('opening'),item('launch')]);
    expect(result.map(r=>[r.itemId,r.perspective,r.outsidePlan])).toEqual([['opening','EFFECTIVE',false],['launch','PROPOSED',true]]);
    expect(result[0]).not.toHaveProperty('unitPrice'); expect(result[0]).not.toHaveProperty('contractSnapshot');
    expect(projectPlanBookings([row],'another-campaign',[])).toEqual([]);
  });
  it('does not project approved booking twice and retains linked deleted history', () => {
    const row:BookingView={...booking,deletedAt:'2026-09-26',workflow:{version:1,status:'APPROVED',route:'AUTO',origin:'MANAGER',policyVersion:1,required:false,requestVersion:1,submittedBy:'manager',submittedAt:'2026-09-25',reason:'',effective:bookingSnapshot(booking),decisions:[]}};
    expect(projectPlanBookings([row],'campaign',[item('opening')])).toMatchObject([{itemId:'opening',perspective:'EFFECTIVE',deleted:true}]);
  });
});
