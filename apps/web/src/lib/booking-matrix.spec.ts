import { describe,expect,it } from 'vitest';
import { bookingSnapshot, bookingExactSum, type BookingListItem } from '@cpms/domain';
import { bookingMatrix } from './booking-matrix';
const row:BookingListItem={id:'one',contractId:'c',allocationId:'a',slotId:'s',campaignId:'campaign',campaignLabel:'Campaign',startDate:'2026-01-01',endDate:'2026-03-31',quantity:'90',unit:'CPM',unitPrice:'100',priceBasis:'1',taxRate:'0.08',amount:'9000',vat:'720',gross:'9720',materialId:null,materialUrl:null,note:'',state:'ACTIVE',deletedAt:null,vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},recordVersion:1,createdByActorId:'u',createdAt:'2026-01-01',updatedAt:'2026-01-01',contractName:'Contract',slotName:'Slot',periodName:'Year',beneficiaryLabel:'Unit',capabilities:{update:true,delete:true,restore:true,purge:true,report:true}};
const total=(matrix:ReturnType<typeof bookingMatrix>,field:'quantity'|'amount'|'gross')=>bookingExactSum(matrix.rows.flatMap(r=>Object.values(r.values).map(v=>v[field])),field==='quantity'?10:6);
describe('Booking matrix from saved plans and report evidence',()=>{
  it('conserves quantity and exact currency across day, week, month and quarter without duplicate booking IDs',()=>{
    for(const grain of ['DAY','WEEK','MONTH','QUARTER'] as const){const matrix=bookingMatrix([row],'APPROVED',grain,'','');expect(total(matrix,'quantity')).toBe('90');expect(total(matrix,'amount')).toBe('9000');expect(total(matrix,'gross')).toBe('9720');expect(matrix.rows.every(r=>Object.values(r.values).every(v=>v.ids.length===1))).toBe(true);}
  });
  it('uses effective allocation, campaign, dates and amounts while showing proposals in a separate stage',()=>{
    const proposed:BookingListItem={...row,allocationId:'new',campaignId:'new',quantity:'180',amount:'18000',vat:'1440',workflow:{version:1,status:'PENDING_INTERNAL',origin:'VENDOR',route:'VENDOR',policyVersion:1,required:true,requestVersion:1,submittedBy:'v',submittedAt:null,reason:'',effective:bookingSnapshot(row),decisions:[]}};
    expect(bookingMatrix([proposed],'APPROVED','MONTH','','').rows[0]!.allocationId).toBe('a');expect(total(bookingMatrix([proposed],'APPROVED','MONTH','',''),'quantity')).toBe('90');expect(total(bookingMatrix([proposed],'PENDING','MONTH','',''),'quantity')).toBe('180');
  });
  it('retains approved report dates and quantities during a correction; excludes undated aggregate from calendar',()=>{
    const accepted:BookingListItem={...row,acceptedQty:'10',reportPeriods:[{id:'p',templateId:'t',startDate:'2026-02-01',endDate:'2026-02-28',quantity:'5',values:{},status:'PENDING',submittedBy:'v',submittedAt:null,reason:'',approved:{quantity:'10',values:{},startDate:'2026-01-01',endDate:'2026-01-31',actorId:'m',at:null}}]};
    const matrix=bookingMatrix([accepted],'ACCEPTED','MONTH','','');expect(matrix.keys).toEqual(['2026-01-01']);expect(total(matrix,'quantity')).toBe('10');expect(total(matrix,'amount')).toBe('1000');
    accepted.reportPeriods![0]!.approved!.startDate=null;accepted.reportPeriods![0]!.approved!.endDate=null;expect(bookingMatrix([accepted],'ACCEPTED','MONTH','','')).toEqual({rows:[],keys:[],undated:1});
  });
  it('includes empty calendar columns, clips selected dates and keeps different allocations separate',()=>{
    const matrix=bookingMatrix([{...row,endDate:'2026-01-31'}, {...row,id:'two',allocationId:'other',startDate:'2026-03-01'}],'APPROVED','MONTH','2026-01-01','2026-04-30');expect(matrix.keys).toEqual(['2026-01-01','2026-02-01','2026-03-01','2026-04-01']);expect(matrix.rows).toHaveLength(2);expect(matrix.rows[0]!.values['2026-02-01']).toBeUndefined();
    expect(total(bookingMatrix([row],'APPROVED','MONTH','2026-02-01','2026-02-28'),'quantity')).toBe('28');
  });
});
