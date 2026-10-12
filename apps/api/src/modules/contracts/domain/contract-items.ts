import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { slotOverbookAllowed, supplyItemSlot, type ContractItemChanges, type ContractItemRow, type ContractItemValue, type SupplyAggregate, type SupplyAllocationView, type SupplyItemTermView } from '@cpms/domain';
import { appDate, decimal, effectivePair, numeric, sum, validateSupplyLimits } from './supply-engine';

function allocations(d:SupplyAggregate,slotId:string,periodId:string){return d.allocations.filter(a=>a.slotId===slotId&&a.periodId===periodId&&!a.supersededAt&&a.scopeKind==='ENTITLEMENT');}
function derived(d:SupplyAggregate,slotId:string,periodId:string,phase:'BASELINE'|'EFFECTIVE',at:string):ContractItemValue{
  const s=d.slots.find(s=>s.id===slotId)!,rows=allocations(d,slotId,periodId);const rates=[...new Set(rows.map(a=>a.taxRate))],prices=[...new Set(rows.map(a=>a.unitPrice??s.unitPrice))];
  return{allowOverbook:slotOverbookAllowed(s),supplyType:'INHERIT',code:s.code,name:s.name,quantity:sum(rows.map(a=>phase==='BASELINE'?a.baselineQty:effectivePair(d,a,at).qty))??'',unit:s.quantityUnit??s.unit??'',unitPrice:prices.length===1?prices[0]??'':s.unitPrice??'',priceBasis:s.priceBasis??'1',taxRate:rates.length===1?rates[0]??'':'',status:'INHERIT',startDate:s.startDate??d.contract.startDate,endDate:s.endDate??d.contract.endDate,operatorActorId:null,vendorActorId:null,professionLayer:null,channelCode:null,note:s.description??'',deleted:false};
}
export function itemMoney(v:ContractItemValue){if(!v.quantity||!v.unitPrice||!v.priceBasis||!v.taxRate)return{amount:'',vat:'',gross:''};const amount=decimal(v.quantity).mul(v.unitPrice).div(v.priceBasis).toDecimalPlaces(6),vat=amount.mul(v.taxRate).toDecimalPlaces(6);return{amount:amount.toFixed(),vat:vat.toFixed(),gross:amount.plus(vat).toFixed()};}
function itemAmounts(d:SupplyAggregate,rows:SupplyAllocationView[],v:ContractItemValue,phase:'BASELINE'|'EFFECTIVE',at:string){
  const amount=sum(rows.map(a=>phase==='BASELINE'?a.baselineAmount:effectivePair(d,a,at).amount));
  if(amount===null||v.taxRate==='')return{amount:amount??'',vat:'',gross:''};
  const vat=decimal(amount).mul(v.taxRate).toDecimalPlaces(6);return{amount,vat:vat.toFixed(),gross:decimal(amount).plus(vat).toFixed()};
}
export function contractItemRows(d:SupplyAggregate,periodId:string,phase:'BASELINE'|'EFFECTIVE',at=new Date().toISOString()):ContractItemRow[]{
  return d.slots.filter(s=>allocations(d,s.id,periodId).length||d.itemTerms?.some(t=>t.slotId===s.id&&t.periodId===periodId)).flatMap(s=>{
    const term=d.itemTerms?.find(t=>t.slotId===s.id&&t.periodId===periodId),rows=allocations(d,s.id,periodId);
    const baseline=term?term.baseline:rows.length?derived(d,s.id,periodId,'BASELINE',at):null,value=phase==='BASELINE'?baseline:term?.effective??derived(d,s.id,periodId,'EFFECTIVE',at);
    if(!value||value.deleted)return[];return[{slotId:s.id,value:{...value,allowOverbook:value.allowOverbook??slotOverbookAllowed(s),supplyType:value.supplyType??'INHERIT'},baseline,baselineLocked:Boolean(baseline),...(baseline?{baselineAmounts:itemAmounts(d,rows,baseline,'BASELINE',at)}:{}),allocations:rows.map(a=>({id:a.id,beneficiaryUnitCode:a.beneficiaryUnitCode,beneficiaryLabel:a.beneficiaryLabel,quantity:(phase==='BASELINE'?a.baselineQty:effectivePair(d,a,at).qty)??''})),...itemAmounts(d,rows,value,phase,at)}];
  });
}
/** Mutates only the proposed aggregate. Publication persists it in the existing approval transaction. */
export function applyContractItems(d:SupplyAggregate,changes:ContractItemChanges,input:{actorId:string;reason:string;evidence:string|null;submitting:boolean;at:string}){
  const p=d.periods.find(p=>p.id===changes.periodId);if(!p)throw new BadRequestException('Chọn kỳ phân bổ cụ thể.');
  if(new Set(changes.rows.map(r=>r.slotId)).size!==changes.rows.length)throw new BadRequestException('Hạng mục bị lặp trong lô sửa.');
  const oldIssues=validateSupplyLimits(d,input.at);d.itemTerms??=[];
  const deltaLines:Array<{allocationId:string;deltaQty:string|null;deltaAmount:string|null;expectedAllocationVersion:number}>=[];
  for(const row of changes.rows){
    const v=structuredClone(row.value),oldSlot=d.slots.find(s=>s.id===row.slotId),oldTerm=d.itemTerms.find(t=>t.slotId===row.slotId&&t.periodId===p.id),existing=allocations(d,row.slotId,p.id);
    if(v.allowOverbook==null)v.allowOverbook=oldTerm?.effective.allowOverbook??(oldSlot?slotOverbookAllowed(oldSlot):false);
    if(v.deleted&&row.operation!=='DELETE')throw new BadRequestException('Dùng thao tác Xóa để bỏ hạng mục.');
    if(row.operation==='DELETE'&&!oldSlot)throw new BadRequestException('Hạng mục không tồn tại.');
    if(changes.phase==='BASELINE'&&(oldTerm?.baseline||existing.length))throw new BadRequestException(`${v.code}: Ban đầu đã chốt; sửa ở Sau điều chỉnh.`);
    if(d.slots.some(s=>s.id!==row.slotId&&s.code===v.code)||d.itemTerms.some(t=>t.slotId!==row.slotId&&t.effective.code===v.code))throw new BadRequestException(`Mã hạng mục trùng: ${v.code}`);
    const start=v.startDate??d.contract.startDate,end=v.endDate??d.contract.endDate;
    if(start&&end&&start>end||start&&d.contract.startDate&&start<d.contract.startDate||end&&d.contract.endDate&&end>d.contract.endDate)throw new BadRequestException(`${v.code}: ngày hiệu lực phải nằm trong hợp đồng.`);
    if(input.submitting&&(!start||!end||start>p.endDate||end<p.startDate))throw new BadRequestException(`${v.code}: thời hạn không giao kỳ đã chọn.`);
    if(oldSlot&&(v.unit!==(oldTerm?.effective.unit??oldSlot.quantityUnit??oldSlot.unit)||v.priceBasis!==(oldTerm?.effective.priceBasis??oldSlot.priceBasis??'1'))&&existing.length)throw new BadRequestException(`${v.code}: đơn vị/quy đổi đã có phân bổ; tạo hạng mục mới để đổi đơn vị.`);
    if(input.submitting&&row.operation!=='DELETE'&&decimal(v.quantity).mul(v.unitPrice).gt(0)&&d.contract.signedAmount===null)throw new BadRequestException('Cần tổng giá trị hợp đồng trước VAT trước khi áp dụng hạng mục có tính phí.');
    if(input.submitting&&existing.some(a=>a.status==='HELD'))throw new BadRequestException(v.code+': hạng mục còn lỗi đối soát nguồn, chưa thể áp dụng.');
    if(new Set(row.allocations.map(a=>a.id)).size!==row.allocations.length)throw new BadRequestException('Phân bổ bị lặp.');
    for(const a of row.allocations){const old=d.allocations.find(x=>x.id===a.id);if(old&&!existing.some(x=>x.id===a.id))throw new BadRequestException('Phân bổ không thuộc hạng mục/kỳ đang sửa.');if(old&&(old.beneficiaryUnitCode!==a.beneficiaryUnitCode||old.beneficiaryLabel!==a.beneficiaryLabel))throw new BadRequestException('Không đổi CQĐV của phân bổ đã có; thêm dòng phân bổ khác.');if(!a.beneficiaryUnitCode&&a.beneficiaryLabel!=='Toàn hợp đồng')throw new BadRequestException('Chọn CQĐV hưởng hạn mức hoặc Toàn hợp đồng.');}
    if(row.operation!=='DELETE'&&input.submitting&&!decimal(sum(row.allocations.map(a=>a.quantity))??'0').eq(v.quantity))throw new BadRequestException(`${v.code}: tổng phân bổ CQĐV phải bằng số lượng hạng mục.`);
    if(row.operation!=='DELETE'&&existing.some(a=>!row.allocations.some(x=>x.id===a.id)))throw new BadRequestException(`${v.code}: giữ dòng CQĐV hiện có; nhập số lượng 0 để cắt giảm.`);
    if(/^(ngày|day|video|gói)$/i.test(v.unit)&&[v.quantity,...row.allocations.map(a=>a.quantity)].some(q=>!decimal(q).isInteger()))throw new BadRequestException('Đơn vị Ngày, Video hoặc Gói cần số lượng nguyên.');
    const baseline=oldTerm?oldTerm.baseline:(existing.length?derived(d,row.slotId,p.id,'BASELINE',input.at):changes.phase==='BASELINE'?structuredClone(v):null);
    if(!oldSlot)d.slots.push({id:row.slotId,contractId:d.contract.id,code:v.code,name:v.name,unit:v.unit,quantityUnit:v.unit,priceBasis:v.priceBasis,unitPrice:v.unitPrice,totalQty:null,signedAmount:null,costType:decimal(v.unitPrice).isZero()?((v.supplyType==='INTERNAL'||(!v.supplyType||v.supplyType==='INHERIT')&&d.contract.supplyType==='INTERNAL')?'INTERNAL_ZERO':'VENDOR_FOC'):'PAID',businessType:'UNKNOWN',channel:null,specificChannel:null,marketCode:null,description:v.note,materialRequirement:null,previewUrl:null,managerEmail:d.contract.managerEmail,startDate:d.contract.startDate,endDate:d.contract.endDate,status:'ACTIVE',capacityMode:'UNKNOWN',capacity:null,source:{origin:'MANUAL_CONTRACT_ITEM'},quality:[],recordVersion:1,bookers:[]});
    const term:SupplyItemTermView={id:oldTerm?.id??randomUUID(),contractId:d.contract.id,slotId:row.slotId,periodId:p.id,baseline,effective:{...v,deleted:row.operation==='DELETE'},recordVersion:(oldTerm?.recordVersion??0)+1};
    d.itemTerms=d.itemTerms.filter(t=>t.id!==term.id);d.itemTerms.push(term);
    // A rule/classification edit must not publish source allocations that are still drafts.
    // Keep their quantities, money, status and versions intact when only item metadata changes.
    const prior=oldTerm?.effective??(oldSlot&&existing.length?derived(d,row.slotId,p.id,'EFFECTIVE',input.at):null);
    const metadataOnly=Boolean(oldSlot&&prior&&row.operation==='UPSERT'&&existing.length===row.allocations.length
      &&v.unit===prior.unit&&v.taxRate===prior.taxRate
      &&decimal(v.quantity).eq(prior.quantity)&&decimal(v.unitPrice).eq(prior.unitPrice)&&decimal(v.priceBasis).eq(prior.priceBasis)
      &&row.allocations.every(a=>{const old=existing.find(x=>x.id===a.id);const qty=old&&effectivePair(d,old,input.at).qty;return qty!=null&&decimal(a.quantity).eq(qty); }));
    if(!input.submitting||metadataOnly)continue;
    const targets=row.operation==='DELETE'?existing.map(a=>({id:a.id,beneficiaryUnitCode:a.beneficiaryUnitCode,beneficiaryLabel:a.beneficiaryLabel,quantity:'0'})):row.allocations;
    for(const allocation of targets){const old=existing.find(a=>a.id===allocation.id),qty=allocation.quantity,previousPrice=oldTerm?.effective.unitPrice??old?.unitPrice??oldSlot?.unitPrice,unchangedPrice=previousPrice!=null&&decimal(previousPrice).eq(v.unitPrice),before=old?effectivePair(d,old,input.at):null,amount=before?.amount!=null&&before.qty!=null&&decimal(before.qty).eq(qty)&&unchangedPrice&&row.operation!=='DELETE'?before.amount:numeric(decimal(qty).mul(v.unitPrice).div(v.priceBasis),6)!;
      if(old){if(old.status!=='APPROVED'){old.status='APPROVED';old.approvedByActorId=input.actorId;old.approvedAt=input.at;old.recordVersion++;}const before=effectivePair(d,old,input.at);if(before.qty===null||before.amount===null)throw new BadRequestException(`${v.code}: hạn mức nguồn chưa xác định, cần đối soát trước khi chỉnh.`);const dq=decimal(qty).minus(before.qty).toFixed(),da=decimal(amount).minus(before.amount).toFixed();if(dq!=='0'||da!=='0')deltaLines.push({allocationId:old.id,deltaQty:dq,deltaAmount:da,expectedAllocationVersion:old.recordVersion});}
      else{const added:SupplyAllocationView={id:allocation.id,contractId:d.contract.id,planId:randomUUID(),slotId:row.slotId,periodId:p.id,sourceKey:`manual:${allocation.id}`,beneficiaryUnitCode:allocation.beneficiaryUnitCode,beneficiaryLabel:allocation.beneficiaryLabel,scopeKind:'ENTITLEMENT',limitMode:'HARD_LIMIT',baselineQty:changes.phase==='BASELINE'?qty:'0',baselineAmount:changes.phase==='BASELINE'?amount:'0',unitPrice:v.unitPrice,inputBasis:'QTY',percent:null,denominator:null,taxRate:v.taxRate,vatEstimated:false,sourceMonthCount:null,status:'APPROVED',sourceVersion:null,source:{origin:'MANUAL_CONTRACT_ITEM'},quality:[],recordVersion:1,approvedByActorId:input.actorId,approvedAt:input.at};d.allocations.push(added);if(changes.phase==='EFFECTIVE')deltaLines.push({allocationId:added.id,deltaQty:qty,deltaAmount:amount,expectedAllocationVersion:1});}
    }
    // Explicitly changing a period total changes the current slot cap by that same delta, never its baseline history.
    const slot=d.slots.find(s=>s.id===row.slotId)!;if(slot.totalQty!==null){const beforeQty=oldTerm?.effective.quantity??sum(existing.map(a=>effectivePair(d,a,input.at).qty));if(beforeQty!==null){slot.effectiveTotalQty=numeric(decimal(slot.effectiveTotalQty??slot.totalQty).plus(row.operation==='DELETE'?'0':v.quantity).minus(beforeQty));slot.recordVersion++;}}
  }
  if(deltaLines.length)d.adjustments.push({id:randomUUID(),contractId:d.contract.id,kind:'AMENDMENT',name:'Điều chỉnh hạng mục hợp đồng',reason:input.reason,evidence:input.evidence,status:'APPROVED',effectiveDate:appDate(input.at),source:{origin:'CONTRACT_ITEM_APPROVAL'},recordVersion:1,approvedByActorId:input.actorId,approvedAt:input.at,reversesId:null,lines:deltaLines});
  if(input.submitting){const issues=validateSupplyLimits(d,input.at).filter(i=>i.severity==='BLOCK'&&!oldIssues.some(old=>old.code===i.code&&old.message===i.message&&(!i.excess||old.excess&&decimal(i.excess).lte(old.excess))));if(issues.length)throw new BadRequestException(issues.map(i=>i.message).join('; '));}
}
export function itemTermsForAllocation(d:SupplyAggregate,a:SupplyAllocationView){return supplyItemSlot(d,a.slotId??'',a.periodId);}
