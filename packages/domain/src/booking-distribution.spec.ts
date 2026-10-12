import { describe, expect, it } from 'vitest';
import { automaticBookingDistribution, bookingExactSum, bookingPlanBuckets, bookingPlanDays, editBookingPlan } from './booking-distribution';

const base={startDate:'2026-09-01',endDate:'2026-11-30',quantity:'91000',amount:'1000000.123456',vat:'80000.009876'};
describe('booking temporal plan',()=>{
  it('uses inclusive calendar days and actual month lengths',()=>{
    const days=bookingPlanDays(base);expect(days).toHaveLength(91);
    expect(bookingPlanBuckets(days,'MONTH').map(b=>b.quantity)).toEqual(['30000','31000','30000']);
    expect(bookingExactSum(days.map(d=>d.amount),6)).toBe(base.amount);
    expect(bookingExactSum(days.map(d=>d.vat),6)).toBe(base.vat);
    expect(bookingPlanBuckets(days,'RANGE','2026-09-14','2026-09-20')[0]?.quantity).toBe('7000');
  });
  it('preserves exact very large quantities and micro-currency after rounding',()=>{
    const days=bookingPlanDays({startDate:'2026-01-01',endDate:'2026-01-03',quantity:'999999999999999999.1234567891',amount:'999999999999999999.999999',vat:'0.000001'});
    expect(bookingExactSum(days.map(d=>d.quantity))).toBe('999999999999999999.1234567891');
    expect(bookingExactSum(days.map(d=>d.amount),6)).toBe('999999999999999999.999999');
    expect(bookingExactSum(days.map(d=>d.vat),6)).toBe('0.000001');
  });
  it('supports monthly totals, lower-granularity overrides, and remainder fill',()=>{
    const first=editBookingPlan(base,{startDate:'2026-09-01',endDate:'2026-09-30',quantity:'20000'});
    const second=editBookingPlan({...base,timeDistribution:first},{startDate:'2026-10-01',endDate:'2026-10-31',quantity:'50000'});
    expect(bookingPlanBuckets(bookingPlanDays({...base,timeDistribution:second}),'MONTH').map(b=>b.quantity)).toEqual(['20000','50000','21000']);
    const third=editBookingPlan({...base,timeDistribution:second},{startDate:'2026-10-05',endDate:'2026-10-11',quantity:'7000'});
    const days=bookingPlanDays({...base,timeDistribution:third});
    expect(bookingPlanBuckets(days,'RANGE','2026-10-05','2026-10-11')[0]?.quantity).toBe('7000');
    expect(bookingExactSum(days.map(d=>d.quantity))).toBe('91000');
    expect(bookingPlanBuckets(days,'MONTH')[0]?.quantity).toBe('20000');
  });
  it('honors zero, rejects overlap, invalid dates, unassigned quantities and changed ranges',()=>{
    const zero=editBookingPlan(base,{startDate:'2026-09-01',endDate:'2026-09-30',quantity:'0'});
    expect(bookingPlanBuckets(bookingPlanDays({...base,timeDistribution:zero}),'MONTH')[0]?.quantity).toBe('0');
    expect(()=>bookingPlanDays({...base,timeDistribution:{...zero,fillRemainder:false}})).toThrow('chưa phân bổ');
    expect(()=>bookingPlanDays({...base,timeDistribution:{...zero,segments:[...zero.segments,...zero.segments]}})).toThrow('chồng lấn');
    expect(()=>bookingPlanDays({...base,startDate:'2026-09-02',timeDistribution:zero})).toThrow('ngoài ngày chạy');
    expect(()=>bookingPlanDays({...base,startDate:'2026-02-30'})).toThrow('không hợp lệ');
    expect(()=>bookingPlanDays({...base,timeDistribution:editBookingPlan(base,{startDate:base.startDate,endDate:base.endDate,quantity:'90000'})})).toThrow('chưa khớp');
  });
  it('clips Monday-based weeks and handles leap days',()=>{
    const days=bookingPlanDays({startDate:'2024-02-28',endDate:'2024-03-05',quantity:'7',timeDistribution:automaticBookingDistribution()});
    expect(days).toHaveLength(7);
    expect(bookingPlanBuckets(days,'WEEK').map(b=>[b.startDate,b.endDate,b.quantity])).toEqual([['2024-02-28','2024-03-03','5'],['2024-03-04','2024-03-05','2']]);
  });
  it('clears a selected interval without discarding manual quantities outside it',()=>{
    const input={startDate:'2026-09-01',endDate:'2026-09-10',quantity:'100'};
    const manual=editBookingPlan(input,{startDate:'2026-09-02',endDate:'2026-09-07',quantity:'60'});
    const cleared=editBookingPlan({...input,timeDistribution:manual},{startDate:'2026-09-04',endDate:'2026-09-05',quantity:'0'},true);
    expect(cleared.segments).toEqual([{startDate:'2026-09-02',endDate:'2026-09-03',quantity:'20'},{startDate:'2026-09-06',endDate:'2026-09-07',quantity:'20'}]);
    const days=bookingPlanDays({...input,timeDistribution:cleared});
    expect(bookingExactSum(days.map(day=>day.quantity))).toBe('100');
    expect(days.filter(day=>day.manual).map(day=>day.date)).toEqual(['2026-09-02','2026-09-03','2026-09-06','2026-09-07']);
  });
});
