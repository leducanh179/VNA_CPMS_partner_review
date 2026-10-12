import type { SupplyAggregate, SupplySlotView } from './contracts';
import type { ItemClassificationSnapshot } from './channel-map';

/** Keep existing storage codes; sourcing classification is independent of item costType and price. */
export const SUPPLY_CLASS_OPTIONS=[{value:'PAID',label:'Mua ngoài'},{value:'INTERNAL',label:'Sở hữu'}] as const;
export const supplyClassLabel=(value:unknown)=>SUPPLY_CLASS_OPTIONS.find(o=>o.value===value)?.label??'Chưa phân loại';

export const PROFESSION_LAYERS=[{code:'PF001',name:'Quảng cáo'},{code:'PF002',name:'Truyền thông'},{code:'PF003',name:'Sự kiện - Tài trợ'},{code:'PF004',name:'Khác'}] as const;
export const ITEM_CHANNELS=['Báo chí','Truyền hình','Trang tin nội bộ','Mạng xã hội','Website VNA','Mobile app VNA','Email','Tin nhắn','Biển quảng cáo/LED/LCD','Hệ thống giải trí máy bay','Sự kiện','Radio - Phát thanh','Khác'].map((name,i)=>({code:`CH${String(i+1).padStart(3,'0')}`,name}));
export interface ContractItemValue {
  activityCode?:string|null;
  classificationSnapshot?:ItemClassificationSnapshot;
  supplyType?:'INHERIT'|'PAID'|'INTERNAL';
  /** Missing/null retains the source capacity rule; explicit choices apply within this allocation period. */
  allowOverbook?:boolean|null;
  code:string;name:string;quantity:string;unit:string;unitPrice:string;priceBasis:string;taxRate:string;
  status:'INHERIT'|'ACTIVE'|'PAUSED'|'EXPIRED';startDate:string|null;endDate:string|null;
  operatorActorId:string|null;vendorActorId:string|null;professionLayer:string|null;channelCode:string|null;note:string;
  deleted:boolean;
}
export interface SupplyItemTermView {id:string;contractId:string;slotId:string;periodId:string;baseline:ContractItemValue|null;effective:ContractItemValue;recordVersion:number;}
export interface ContractItemAllocationInput {id:string;beneficiaryUnitCode:string|null;beneficiaryLabel:string;quantity:string;}
export interface ContractItemRowInput {slotId:string;operation:'UPSERT'|'DELETE';value:ContractItemValue;allocations:ContractItemAllocationInput[];}
export interface ContractItemChanges {periodId:string;phase:'BASELINE'|'EFFECTIVE';rows:ContractItemRowInput[];}
export interface ContractItemRow {slotId:string;value:ContractItemValue;baseline:ContractItemValue|null;baselineLocked:boolean;baselineAmounts?:{amount:string;vat:string;gross:string};allocations:ContractItemAllocationInput[];amount:string;vat:string;gross:string;}
export function slotOverbookAllowed(slot:Pick<SupplySlotView,'capacityMode'>):boolean|null {
  return slot.capacityMode==='UNRESTRICTED'?true:slot.capacityMode==='EXCLUSIVE'?false:null;
}
/** Resolve contractual terms in a period without rewriting the shared slot or archived snapshots. */
export function supplyItemSlot(aggregate:SupplyAggregate,slotId:string,periodId:string,phase:'BASELINE'|'EFFECTIVE'='EFFECTIVE'):SupplySlotView|undefined{
  const slot=aggregate.slots.find(s=>s.id===slotId);if(!slot)return undefined;const record=aggregate.itemTerms?.find(t=>t.slotId===slotId&&t.periodId===periodId);const term=phase==='BASELINE'?record?.baseline:record?.effective;if(!term)return {...slot,supplyType:aggregate.contract.supplyType};
  return{...slot,supplyType:term.supplyType&&term.supplyType!=='INHERIT'?term.supplyType:aggregate.contract.supplyType,code:term.code,name:term.name,quantityUnit:term.unit,unit:term.unit,unitPrice:term.unitPrice,priceBasis:term.priceBasis,
    ...(typeof term.allowOverbook==='boolean'?{capacityMode:term.allowOverbook?'UNRESTRICTED' as const:'EXCLUSIVE' as const,capacity:null}:{}),
    channel:term.classificationSnapshot?.channelName??ITEM_CHANNELS.find(c=>c.code===term.channelCode?.replace('CHN-','CH'))?.name??slot.channel,description:term.note,startDate:term.startDate??aggregate.contract.startDate,endDate:term.endDate??aggregate.contract.endDate,
    status:term.deleted?'ARCHIVED':term.status==='INHERIT'?aggregate.contract.status:term.status};
}
export function supplyItemTax(aggregate:SupplyAggregate,slotId:string,periodId:string,phase:'BASELINE'|'EFFECTIVE'='EFFECTIVE'){
  const t=aggregate.itemTerms?.find(t=>t.slotId===slotId&&t.periodId===periodId);return (phase==='BASELINE'?t?.baseline:t?.effective)?.taxRate;
}
