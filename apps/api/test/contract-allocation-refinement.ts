import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ActorContext, BookingFields, BookingListItem, SupplySourceSnapshot } from '@cpms/domain';
import type { ContractsApplicationService } from '../src/modules/contracts/application/contracts.application-service';
import type { BookingApplicationService } from '../src/modules/booking/application/booking.application-service';
import { syntheticSource } from '../src/modules/contracts/domain/supply-fixtures';

function freeSource():SupplySourceSnapshot {
  const source=syntheticSource();source.spreadsheetId='synthetic-free-split';
  const records=source.sheets.map(sheet=>({name:sheet.name,rows:sheet.rows.slice(1).map(row=>Object.fromEntries(sheet.rows[0]!.map((h,i)=>[String(h.value),row[i]?.value??null])))}));
  for(const sheet of records)for(const row of sheet.rows){row.contract_id='CON-SYN-FREE';if(row.slot_id)row.slot_id='SLOT-SYN-PAID-FREE';}
  records[0]!.rows[0]!.contract_no='SYN-FREE';
  records[1]!.rows.push({...records[1]!.rows[0],slot_id:'SLOT-SYN-FREE',slot_name:'Synthetic free design',unit:'Gói',base_unit_cost_no_vat:0,total_contract_qty:8,total_amount_no_vat:0,cost_type:'vendor_free_of_charge'});
  const first=records[2]!.rows[0]!;first.period_code='2025';first.period_name='2025';first.period_start_date='2025-01-01';first.period_end_date='2025-12-31';
  records[2]!.rows.push({...records[2]!.rows[1],allocation_id:'FREE-LIFETIME',slot_id:'SLOT-SYN-FREE',period_code:'contract_lifetime',period_name:'Contract lifetime',period_start_date:'2025-01-01',period_end_date:'2027-12-31',planned_qty:8,planned_unit_cost_no_vat:0,planned_amount_no_vat:0,planned_tax_rate:0,effective_qty:8,effective_amount_no_vat:0});
  source.sheets=records.map(s=>{const headers=[...new Set(s.rows.flatMap(r=>Object.keys(r)))];return{name:s.name,rows:[headers.map(value=>({value})),...s.rows.map(r=>headers.map(h=>({value:r[h]??null})))]};});
  return source;
}
export async function verifyContractRefinement(app:INestApplication,contracts:ContractsApplicationService,bookings:BookingApplicationService,actor:ActorContext,pass:(name:string)=>void) {
  const source=freeSource(),preview=await contracts.importPreview(source,actor);
  const original=await contracts.importApply(preview.id,{idempotencyKey:randomUUID(),acknowledgeWarnings:true},actor);
  const allocation=original.allocations.find(a=>a.sourceKey==='FREE-LIFETIME')!;
  const assignment={allocationId:allocation.id,ownerDepartmentId:null,beneficiaryDepartmentId:null,leaderActorIds:[actor.id],operatorActorIds:[actor.id],beneficiaryActorIds:[],vendorActorIds:[],recordVersion:1};
  await bookings.configureAllocation(assignment,actor);
  const periods=original.periods.filter(p=>p.id!==allocation.periodId).sort((a,b)=>a.startDate.localeCompare(b.startDate));assert.equal(periods.length,3);
  const command={expectedVersion:original.contract.recordVersion,allocationId:allocation.id,idempotencyKey:randomUUID(),reason:'User-authorized synthetic 3/3/2 demonstration',parts:periods.map((p,i)=>({periodId:p.id,qty:i===2?'2':'3',taxRate:i===2?'0.1':'0.08',vatEstimated:i===2}))};
  await assert.rejects(contracts.splitFreeEntitlement(original.contract.id,{...command,parts:command.parts.map(p=>({...p,qty:'3'}))},actor));
  assert.equal((await contracts.detail(original.contract.id,actor)).contract.recordVersion,original.contract.recordVersion);
  const response=await fetch(`${await app.getUrl()}/api/contracts/${original.contract.id}/allocations/split-free`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});
  assert.equal(response.status,201,await response.clone().text());
  const result=await response.json() as {allocationIds:string[]};assert.equal(result.allocationIds.length,3);
  await contracts.splitFreeEntitlement(original.contract.id,command,actor);
  const updated=await contracts.detail(original.contract.id,actor),retained=updated.allocations.find(a=>a.id===allocation.id)!;
  assert.equal(updated.contract.recordVersion,original.contract.recordVersion+1);assert.equal(updated.contract.localRevision,original.contract.localRevision+1);
  assert.equal(retained.baselineQty,'8');assert.equal(retained.baselineAmount,'0');assert.deepEqual(retained.source,allocation.source);assert(retained.supersededAt);
  assert.equal(updated.allocations.filter(a=>a.splitFromId===allocation.id).length,3);
  const bootstrap=await bookings.bootstrap(actor),context=bootstrap.contracts.find(c=>c.contract.id===original.contract.id)!;
  assert(!context.allocations.some(a=>a.id===allocation.id));
  for(const id of result.allocationIds){const access=context.access.find(a=>a.allocationId===id)!;assert.deepEqual(access.operatorActorIds,assignment.operatorActorIds);assert.equal(access.recordVersion,1);}
  pass('free split HTTP conserves baseline/history and copies assignments once with idempotent retry');
  const all=await contracts.workspace(original.contract.id,{period:'ALL',phase:'BASELINE'},actor);
  const freeRows=all.allocationRows.filter(r=>r.slotId===allocation.slotId);assert.deepEqual(freeRows.map(r=>r.qty),['3','3','2']);assert(freeRows.every(r=>r.freeOfCharge&&r.amount==='0'&&r.vat==='0'));
  assert.deepEqual(freeRows.map(r=>[r.taxRate,r.vatEstimated]),[['0.08',false],['0.08',false],['0.1',true]]);
  assert(!all.periods.some(p=>p.id===allocation.periodId));
  const effective=await contracts.workspace(original.contract.id,{period:periods[1]!.id,phase:'EFFECTIVE'},actor);assert.equal(effective.allocationRows.filter(r=>r.slotId===allocation.slotId)[0]!.qty,'3');
  const before=await contracts.workspace(original.contract.id,{period:periods[0]!.id,phase:'BASELINE'},actor),after=await contracts.workspace(original.contract.id,{period:periods[0]!.id,phase:'EFFECTIVE'},actor);
  assert.equal(before.allocationRows.find(r=>r.slotId!==allocation.slotId)!.qty,'40');assert.equal(after.allocationRows.find(r=>r.slotId!==allocation.slotId)!.qty,'30');
  await assert.rejects(contracts.workspace(original.contract.id,{period:allocation.periodId},actor));
  await assert.rejects(contracts.splitFreeEntitlement(original.contract.id,{...command,idempotencyKey:randomUUID()},actor));
  await assert.rejects(contracts.splitFreeEntitlement(original.contract.id,command,{...actor,id:randomUUID()}));
  pass('period/phase projections retain beneficiary quantities and free VAT groups; old scopes and stale actors rejected');
  const current=updated.allocations.find(a=>a.splitFromId===allocation.id&&a.periodId===periods[1]!.id)!;
  const fields:BookingFields={allocationId:current.id,campaignId:null,campaignLabel:'Synthetic free design',startDate:'2026-09-12',endDate:'2026-09-15',quantity:'2',materialId:null,materialUrl:null,note:''};
  const save=(quantity:string,id=current.id)=>bookings.save({idempotencyKey:randomUUID(),items:[{fields:{...fields,allocationId:id,quantity}}]},actor);
  await assert.rejects(save('1',allocation.id));await assert.rejects(save('4'));
  const simultaneous=await Promise.allSettled([save('2'),save('2')]);assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1,simultaneous.filter(r=>r.status==='rejected').map(r=>String(r.reason)).join('; '));
  const saved=(await bookings.list({contractId:original.contract.id},actor)) as BookingListItem[];assert.equal(saved.length,1);assert.equal(saved[0]!.amount,'0');assert.equal(saved[0]!.vat,'0');
  await save('1');await assert.rejects(save('1'));
  await assert.rejects(contracts.splitFreeEntitlement(original.contract.id,{...command,expectedVersion:updated.contract.recordVersion,allocationId:current.id,idempotencyKey:randomUUID()},actor),/đã có đặt chỗ/);
  assert.equal((await contracts.workspace(original.contract.id,{},actor)).statusRows.find(r=>r.id===allocation.slotId)!.remaining.booked,'0');
  pass('free bookings enforce the 3-package period ceiling under concurrent saves and preserve existing consumption');
}
