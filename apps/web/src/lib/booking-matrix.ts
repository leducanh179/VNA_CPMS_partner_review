import { bookingDates, bookingEffective, bookingPending, bookingPlanBuckets, bookingPlanDays, bookingReportPeriods, bookingScaled, bookingUnscaled, supplyTimeKey, type BookingListItem } from '@cpms/domain';
import { bookingProduct } from './booking-money';
export type BookingMatrixStage='APPROVED'|'PENDING'|'DRAFT'|'ACCEPTED';
export type BookingMatrixGrain='DAY'|'WEEK'|'MONTH'|'QUARTER';
export interface BookingMatrixValue {quantity:string;amount:string;gross:string;ids:string[]}
export interface BookingMatrixRow {id:string;campaign:string;campaignId:string|null;slotId:string;allocationId:string;unit:string;values:Record<string,BookingMatrixValue>}
export interface BookingMatrixPrefill {allocationId:string;campaignId:string|null;campaignLabel:string;startDate:string;endDate:string}
export function bookingMatrix(rows:BookingListItem[],stage:BookingMatrixStage,grain:BookingMatrixGrain,from:string,to:string){
  const result=new Map<string,BookingMatrixRow>(), keys=new Set<string>();let undated=0,work=0;
  for(const row of rows){
    if(row.deletedAt&&stage!=='ACCEPTED')continue;
    const effective=bookingEffective(row);const sources=[];
    if(stage==='ACCEPTED'){
      for(const period of bookingReportPeriods(row)){if(!period.approved)continue;const startDate=('startDate' in period.approved?period.approved.startDate:period.startDate),endDate=('endDate' in period.approved?period.approved.endDate:period.endDate);if(!startDate||!endDate){undated++;continue;}const base=effective??row;const amount=bookingProduct(period.approved.quantity,base.unitPrice,base.priceBasis);sources.push({...base,startDate,endDate,quantity:period.approved.quantity,amount,vat:bookingProduct(amount,base.taxRate),timeDistribution:undefined});}
    }else if(stage==='APPROVED'&&effective)sources.push(effective);
    else if(stage==='PENDING'&&bookingPending(row))sources.push(row);
    else if(stage==='DRAFT'&&row.workflow&&['DRAFT','RETURNED','REJECTED','WITHDRAWN'].includes(row.workflow.status))sources.push(row);
    for(const source of sources){
      work+=(Date.parse(source.endDate)-Date.parse(source.startDate))/86400000+1;if(work>500000)throw Error('Chọn ít hợp đồng hoặc đặt chỗ hơn để xem ma trận.');
      const id=`${source.campaignId??source.campaignLabel}/${source.allocationId}`;
      const target=result.get(id)??{id,campaign:source.campaignLabel,campaignId:source.campaignId,slotId:source.slotId,allocationId:source.allocationId,unit:source.unit,values:{}};
      const buckets=bookingPlanBuckets(bookingPlanDays(source),grain==='QUARTER'?'MONTH':grain,from,to);
      for(const bucket of buckets){const key=supplyTimeKey(bucket.startDate,grain);keys.add(key);
        const old=target.values[key]??{quantity:'0',amount:'0',gross:'0',ids:[]};target.values[key]={quantity:bookingUnscaled(bookingScaled(old.quantity)+bookingScaled(bucket.quantity)),amount:bookingUnscaled(bookingScaled(old.amount,6)+bookingScaled(bucket.amount,6),6),gross:bookingUnscaled(bookingScaled(old.gross,6)+bookingScaled(bucket.gross,6),6),ids:[...new Set([...old.ids,row.id])]};
      }if(buckets.length)result.set(id,target);
    }
  }
  const sorted=[...keys].sort(),start=from||sorted[0],end=to||sorted.at(-1);
  if(start&&end)for(const day of bookingDates(start,end))keys.add(supplyTimeKey(day,grain));
  if(keys.size>366||keys.size*result.size>100000)throw Error('Ma trận quá rộng; thu hẹp thời gian hoặc chọn tuần/tháng/quý.');
  return {rows:[...result.values()].sort((a,b)=>a.campaign.localeCompare(b.campaign,'vi')),keys:[...keys].sort(),undated};
}
