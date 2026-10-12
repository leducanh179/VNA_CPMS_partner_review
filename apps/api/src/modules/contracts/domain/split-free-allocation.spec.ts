import { describe, expect, it } from 'vitest';
import { normalizeSupplySource } from './source-import';
import { syntheticSource, syntheticSupplyCatalogs } from './supply-fixtures';
import { splitFreeAllocation } from './split-free-allocation';
import { buildInventory, validateSupplyLimits } from './supply-engine';
import { buildSupplyWorkspace } from './supply-workspace';
import { ZeroConsumptionProvider } from '../infrastructure/zero-consumption.provider';

const at='2026-09-12T03:00:00Z';
function fixture() {
  const value=normalizeSupplySource(syntheticSource(),syntheticSupplyCatalogs).aggregate;
  value.adjustments=[];
  const slot=value.slots[0]!;slot.costType='VENDOR_FOC';slot.unit='Gói';slot.quantityUnit='Gói';slot.unitPrice='0';slot.totalQty='8';
  value.periods=[
    {id:'lifetime',code:'contract_lifetime',name:'Contract lifetime',kind:'CONTRACT',startDate:'2025-07-01',endDate:'2027-06-30'},
    {id:'p1',code:'p1',name:'First',kind:'CUSTOM',startDate:'2025-07-01',endDate:'2025-12-31'},
    {id:'p2',code:'p2',name:'Second',kind:'CUSTOM',startDate:'2026-01-01',endDate:'2026-12-31'},
    {id:'p3',code:'p3',name:'Third',kind:'CUSTOM',startDate:'2027-01-01',endDate:'2027-06-30'},
  ];
  value.allocations=[{...value.allocations[0]!,periodId:'lifetime',baselineQty:'8',baselineAmount:'0',unitPrice:'0',taxRate:'0'}];
  const input={allocationId:value.allocations[0]!.id,reason:'User-authorized synthetic distribution',parts:[{periodId:'p1',qty:'3',taxRate:'0.08',vatEstimated:false},{periodId:'p2',qty:'3',taxRate:'0.08',vatEstimated:false},{periodId:'p3',qty:'2',taxRate:'0.1',vatEstimated:true}]};
  return {value,input};
}
describe('Free entitlement period split',()=>{
  it('retains the original source/baseline and produces exactly three linked 3/3/2 entitlements',()=>{
    const {value,input}=fixture(),before=structuredClone(value),result=splitFreeAllocation(value,input,'actor',at);
    expect(value).toEqual(before);expect(result.allocations[0]).toMatchObject({baselineQty:'8',baselineAmount:'0',source:before.allocations[0]!.source,supersededAt:at});
    expect(result.allocations.slice(1).map(a=>[a.baselineQty,a.taxRate,a.vatEstimated])).toEqual([['3','0.08',false],['3','0.08',false],['2','0.1',true]]);
    expect(result.allocations.slice(1).every(a=>a.splitFromId===input.allocationId&&a.approvedByActorId==='actor'&&a.approvedAt===at)).toBe(true);
    expect(validateSupplyLimits(result,at).filter(i=>i.severity==='BLOCK')).toEqual([]);
  });
  it('counts only current stock and groups all-period free rows into 8%/estimated 10% without double counting',async()=>{
    const {value,input}=fixture(),result=splitFreeAllocation(value,input,'actor',at),inventory=await buildInventory(result,new ZeroConsumptionProvider(),at);
    expect(inventory.rows).toHaveLength(3);expect(inventory.quantityTotals[0]!.effective).toBe('8');
    const current=buildSupplyWorkspace(result,inventory);expect(current.statusRows[0]!.total).toBe('3');expect(current.periods.map(p=>p.id)).not.toContain('lifetime');
    for(const phase of ['BASELINE','EFFECTIVE'] as const){const all=buildSupplyWorkspace(result,inventory,'ALL',phase);
      expect(all.informationGroups.map(g=>[g.taxRate,g.estimated,g.rows[0]!.qty,g.gross])).toEqual([['0.08',false,'6','0'],['0.1',true,'2','0']]);
      expect(all.allocationRows.map(a=>a.qty)).toEqual(['3','3','2']);expect(all.allocationRows.every(a=>a.freeOfCharge)).toBe(true);
    }
    expect(()=>buildSupplyWorkspace(result,inventory,'lifetime')).toThrow('UNKNOWN_ALLOCATION_PERIOD');
  });
  it('rejects changed totals, overlapping or incomplete periods, paid rows and repeated split',()=>{
    const {value,input}=fixture();
    expect(()=>splitFreeAllocation(value,{...input,parts:input.parts.map((p,i)=>({...p,qty:i===0?'4':p.qty}))},'actor',at)).toThrow('Tổng số lượng');
    const paid=structuredClone(value);paid.slots[0]!.costType='PAID';expect(()=>splitFreeAllocation(paid,input,'actor',at)).toThrow('miễn phí');
    const overlap=structuredClone(value);overlap.periods[2]!.startDate='2025-12-31';expect(()=>splitFreeAllocation(overlap,input,'actor',at)).toThrow('liên tục');
    const changed=structuredClone(value);changed.periods[1]!.startDate='2025-07-02';expect(()=>splitFreeAllocation(changed,input,'actor',at)).toThrow('liên tục');
    const result=splitFreeAllocation(value,input,'actor',at);expect(()=>splitFreeAllocation(result,input,'actor',at)).toThrow('đã được tách');
  });
});
