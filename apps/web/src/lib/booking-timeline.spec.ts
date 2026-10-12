import { describe, expect, it } from 'vitest';
import { bookingTimelineScale } from './booking-timeline';
describe('Booking timeline calendar geometry',()=>{
  it('includes the entire end date, including one-day bookings',()=>{
    const s=bookingTimelineScale('2026-09-01','2026-09-30','month');
    expect(s.bar('2026-09-01','2026-09-30')).toEqual({left:0,width:s.width});
    expect(s.bar('2026-09-30','2026-09-30').width).toBeCloseTo(s.width/30);
  });
  it('uses Monday weeks, real leap days and clips to the visible interval',()=>{
    const s=bookingTimelineScale('2028-02-29','2028-03-02','week');expect(s.ticks[0]?.key).toBe('2028-02-28T00:00:00.000Z');
    expect(s.bar('2028-01-01','2028-04-01')).toEqual({left:0,width:s.width});
  });
  it('bounds dense day views and rejects reversed ranges',()=>{
    expect(()=>bookingTimelineScale('2026-01-01','2027-12-31','day')).toThrow('366');
    expect(()=>bookingTimelineScale('2026-10-01','2026-09-01','day')).toThrow();
  });
});
