import { describe,expect,it } from 'vitest';
import type { BookingListItem } from '@cpms/domain';
import { bookingListGroup } from './booking-list-grouping';

const row={startDate:'2026-01-25',endDate:'2026-03-10',slotId:'slot-a',slotName:'Mass PC',contractName:'Admicro',campaignLabel:'Mở bán vé Tết'} as BookingListItem;

describe('Booking list grouping',()=>{
  it('places a multi-month booking once, in its start month',()=>{
    expect(bookingListGroup(row,'MONTH',false)).toEqual({key:'2026-01',label:'Tháng 01/2026'});
  });
  it('keeps equal slot names from different contracts in separate groups',()=>{
    expect(bookingListGroup(row,'SLOT',true).key).not.toBe(bookingListGroup({...row,slotId:'slot-b',contractName:'VnExpress'},'SLOT',true).key);
  });
  it('groups spelling variants of a free-text campaign without losing the display name',()=>{
    expect(bookingListGroup({...row,campaignLabel:'  Mở  Bán vé Tết '},'CAMPAIGN',false).key)
      .toBe(bookingListGroup({...row,campaignLabel:'mở bán vé tết'},'CAMPAIGN',false).key);
    expect(bookingListGroup({...row,campaignLabel:'  Mở  Bán vé Tết '},'CAMPAIGN',false).label).toBe('Mở Bán vé Tết');
  });
});
