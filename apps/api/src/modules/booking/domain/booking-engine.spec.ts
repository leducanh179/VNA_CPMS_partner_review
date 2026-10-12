import { describe,expect,it } from 'vitest';
import type { BookingFields,BookingView } from '@cpms/domain';
import { bookingReportSelection } from '@cpms/domain';
import { normalizeSupplySource } from '../../contracts/domain/source-import';
import { syntheticSource,syntheticSupplyCatalogs } from '../../contracts/domain/supply-fixtures';
import { calculateBookingReport,checkBookingLimits,priceBooking,reservedBooking,slotPeakConcurrency } from './booking-engine';
import { contractItemRows } from '../../contracts/domain/contract-items';
const supply=()=>normalizeSupplySource(syntheticSource(),syntheticSupplyCatalogs).aggregate;
const at='2026-09-10T12:00:00Z';
function fixture(quantity='10',id='row1'){
  const ctx=supply();const allocation=ctx.allocations.find(a=>a.sourceKey==='A-1')!;
  const fields:BookingFields={allocationId:allocation.id,campaignId:null,campaignLabel:'Test campaign',startDate:'2026-09-10',endDate:'2026-09-20',quantity,materialId:null,materialUrl:null,note:''};
  const row:BookingView={...fields,...priceBooking(fields,ctx),id,state:'ACTIVE',deletedAt:null,vendorConfirmedQty:null,sourceApprovedQty:null,acceptedQty:'0',reportState:'EMPTY',reportTemplateId:null,reportData:{},sourceKey:null,source:{},recordVersion:1,createdByActorId:'actor',createdAt:at,updatedAt:at};return{ctx,row,fields};
}
describe('booking quantity, money and lifecycle invariants',()=>{
  it('uses a CPM package once; prices and VAT are decimal snapshots',()=>{const {row}=fixture('0.123456789');expect(row.amount).toBe('12.345679');expect(row.vat).toBe('0.987654');expect(row.gross).toBe('13.333333');});
  it('checks the sum of a batch and replaces old rows on edit',()=>{const {ctx,row}=fixture('20');const second={...row,id:'row2',quantity:'20',amount:'2000'};expect(checkBookingLimits(ctx,[],[row,second],at).some(i=>i.severity==='BLOCK')).toBe(true);expect(checkBookingLimits(ctx,[row],[{...row,quantity:'25',amount:'2500'}],at).some(i=>i.severity==='BLOCK')).toBe(false);});
  it('keeps paused quota and accepted usage after deletion without double counting stages',()=>{const {row}=fixture();expect(reservedBooking({...row,state:'PAUSED',vendorConfirmedQty:'8',sourceApprovedQty:'8',acceptedQty:'4'}).qty.toFixed()).toBe('10');expect(reservedBooking({...row,deletedAt:at,acceptedQty:'4'}).qty.toFixed()).toBe('4');});
  it('blocks restoring into quota already reused',()=>{const {ctx,row}=fixture('25');const deleted={...row,id:'deleted',quantity:'10',deletedAt:at};expect(checkBookingLimits(ctx,[row,deleted],[{...deleted,deletedAt:null}],at).some(i=>i.severity==='BLOCK')).toBe(true);});
  it('rejects a draft allocation and crossing the period boundary',()=>{const {ctx,fields}=fixture();expect(()=>priceBooking({...fields,endDate:'2027-01-01'},ctx)).toThrow();expect(()=>priceBooking({...fields,allocationId:ctx.allocations.find(a=>a.sourceKey==='A-3')!.id,startDate:'2027-01-01',endDate:'2027-01-02'},ctx)).toThrow();});
  it('warns on monthly pacing while preserving valid hard limits',()=>{const {ctx,row}=fixture('20');const issues=checkBookingLimits(ctx,[],[row],at);expect(issues.some(i=>i.message.includes('bình quân'))).toBe(true);expect(issues.some(i=>i.severity==='BLOCK')).toBe(false);});
  it('uses custom monthly pacing and treats overall dates as warnings only',()=>{const {ctx,row}=fixture('10');const long={...row,startDate:'2026-09-01',endDate:'2026-12-31',overallStartDate:'2026-09-02',timeDistribution:{version:1 as const,mode:'CUSTOM' as const,fillRemainder:true,segments:[{startDate:'2026-09-01',endDate:'2026-09-30',quantity:'10'}]}};priceBooking(long,ctx);const issues=checkBookingLimits(ctx,[],[long],at);expect(issues.some(i=>i.message.includes('bình quân'))).toBe(true);expect(issues.some(i=>i.message.includes('tổng thể'))).toBe(true);expect(issues.some(i=>i.severity==='BLOCK')).toBe(false);});
  it('enforces real capacity when configured and warns when unknown',()=>{const {ctx,row}=fixture();ctx.slots[0]!.capacityMode='EXCLUSIVE';expect(checkBookingLimits(ctx,[{...row,id:'other'}],[row],at).some(i=>i.message.includes('công suất'))).toBe(true);});
  it('uses the approved period overlap choice while quantity and money caps still apply',()=>{
    const {ctx,row}=fixture(),allocation=ctx.allocations.find(a=>a.id===row.allocationId)!,value=contractItemRows(ctx,allocation.periodId,'EFFECTIVE',at)[0]!.value;
    ctx.itemTerms=[{id:'term',contractId:ctx.contract.id,slotId:row.slotId,periodId:allocation.periodId,baseline:null,effective:{...value,allowOverbook:true},recordVersion:1}];
    ctx.slots[0]!.capacityMode='EXCLUSIVE';const peer={...row,id:'peer'};
    expect(checkBookingLimits(ctx,[peer],[row],at).filter(i=>i.severity==='BLOCK')).toEqual([]);
    expect(checkBookingLimits(ctx,[peer],[{...row,quantity:'100',amount:'10000'}],at).some(i=>i.severity==='BLOCK'&&i.field==='quantity')).toBe(true);
    ctx.allocations.find(a=>a.id===row.allocationId)!.baselineAmount='1';expect(checkBookingLimits(ctx,[peer],[row],at).some(i=>i.message.includes('tiền'))).toBe(true);
    ctx.itemTerms[0]!.effective.allowOverbook=false;
    expect(checkBookingLimits(ctx,[peer],[row],at).some(i=>i.severity==='BLOCK'&&i.message.includes('trùng khung'))).toBe(true);
  });
  it('blocks overlap across beneficiary allocations and in one batch, but not adjacent days or editing the same booking',()=>{
    const {ctx,row}=fixture('1');ctx.slots[0]!.capacityMode='EXCLUSIVE';const other=ctx.allocations.find(a=>a.sourceKey==='A-2')!;
    const peer={...row,id:'peer',allocationId:other.id,endDate:row.startDate};
    expect(checkBookingLimits(ctx,[peer],[row],at).some(i=>i.message.includes('trùng khung'))).toBe(true);
    expect(checkBookingLimits(ctx,[],[peer,row],at).filter(i=>i.message.includes('trùng khung'))).toHaveLength(2);
    expect(checkBookingLimits(ctx,[{...peer,endDate:'2026-09-09',startDate:'2026-09-01'}],[row],at).some(i=>i.message.includes('trùng khung'))).toBe(false);
    expect(checkBookingLimits(ctx,[row],[{...row,note:'Edited'}],at).some(i=>i.severity==='BLOCK')).toBe(false);
  });
  it('keeps paused reservations, releases deleted/finished/cancelled intervals and rechecks restoration',()=>{
    const {ctx,row}=fixture('1');ctx.slots[0]!.capacityMode='EXCLUSIVE';const peer={...row,id:'peer'};
    expect(checkBookingLimits(ctx,[{...peer,state:'PAUSED'}],[row],at).some(i=>i.message.includes('trùng khung'))).toBe(true);
    for(const released of [{...peer,deletedAt:at},{...peer,execution:'FINISHED' as const},{...peer,execution:'CANCELLED' as const}])expect(checkBookingLimits(ctx,[released],[row],at).some(i=>i.message.includes('trùng khung'))).toBe(false);
    expect(checkBookingLimits(ctx,[row,{...peer,deletedAt:at}],[{...peer,deletedAt:null}],at).some(i=>i.message.includes('trùng khung'))).toBe(true);
  });
  it('counts concurrency only inside the requested window',()=>{const {row}=fixture('1');expect(slotPeakConcurrency(row.slotId,[{...row,startDate:'2026-09-01',endDate:'2026-09-15'},{...row,id:'peer',startDate:'2026-09-01',endDate:'2026-09-10'}],'2026-09-10','2026-09-20')).toBe(2);expect(slotPeakConcurrency(row.slotId,[{...row,startDate:'2026-09-01',endDate:'2026-09-15'},{...row,id:'peer',startDate:'2026-09-01',endDate:'2026-09-10'}],'2026-09-11','2026-09-20')).toBe(1);});
  it('handles free production slots with positive integral quantity',()=>{const {ctx,fields}=fixture();ctx.slots[0]!.quantityUnit='Gói';ctx.slots[0]!.unitPrice='0';ctx.allocations.find(a=>a.id===fields.allocationId)!.unitPrice='0';expect(priceBooking(fields,ctx).gross).toBe('0');expect(()=>priceBooking({...fields,quantity:'1.5'},ctx)).toThrow();});
});
describe('contract report templates',()=>{
  const template={metrics:['impression','linkClick','conversion'] as const,conversionDenominator:'linkClick' as const,excludedSlotIds:[]};
  it('derives percentages and leaves zero or missing denominators undefined',()=>{const t={...template,metrics:[...template.metrics]};expect(calculateBookingReport({impression:'1000',linkClick:'20',conversion:'2'},t,'slot')).toMatchObject({linkClickRate:'2',conversionRate:'10'});expect(calculateBookingReport({impression:'0',linkClick:'0',conversion:'2'},t,'slot')).toMatchObject({linkClickRate:null,conversionRate:null});expect(calculateBookingReport({conversion:'2'},{...t,conversionDenominator:null},'slot').conversionRate).toBeNull();});
  it('rejects forged calculated values, disallowed metrics and production measurements',()=>{const t={...template,metrics:[...template.metrics]};expect(()=>calculateBookingReport({linkClickRate:'100'},t,'slot')).toThrow();expect(()=>calculateBookingReport({reach:'3'},t,'slot')).toThrow();expect(()=>calculateBookingReport({impression:'2'},{...t,excludedSlotIds:['slot']},'slot')).toThrow();expect(()=>calculateBookingReport({fileUrl:'javascript:alert(1)'},t,'slot')).toThrow();});
  it('requires a single contract for a selected report workspace',()=>{expect(bookingReportSelection([{id:'1',contractId:'a',deletedAt:null},{id:'2',contractId:'b',deletedAt:null}]).allowed).toBe(false);expect(bookingReportSelection([{id:'1',contractId:'a',deletedAt:null},{id:'2',contractId:'a',deletedAt:null}]).allowed).toBe(true);});
});
