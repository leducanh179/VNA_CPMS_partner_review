import type { BookingListItem } from '@cpms/domain';

export type BookingListGroupMode='NONE'|'MONTH'|'SLOT'|'CAMPAIGN';
type GroupedMode=Exclude<BookingListGroupMode,'NONE'>;
type BookingGroupFields=Pick<BookingListItem,'startDate'|'slotId'|'slotName'|'contractName'|'campaignLabel'>;

/** A booking belongs to one start month, even when its run spans several months. */
export function bookingListGroup(row:BookingGroupFields,mode:GroupedMode,allContracts:boolean):{key:string;label:string} {
  if(mode==='MONTH'){
    const month=/^\d{4}-(0[1-9]|1[0-2])/.exec(row.startDate??'')?.[0];
    return month?{key:month,label:`Tháng ${month.slice(5,7)}/${month.slice(0,4)}`}:{key:'0000-00',label:'Chưa có ngày bắt đầu'};
  }
  if(mode==='SLOT')return {key:`slot:${row.slotId}`,label:allContracts?`${row.slotName} · ${row.contractName}`:row.slotName};
  const name=row.campaignLabel.trim().replace(/\s+/g,' ');
  return {key:`campaign:${name.toLocaleLowerCase('vi')}`,label:name||'Chưa có chiến dịch'};
}
