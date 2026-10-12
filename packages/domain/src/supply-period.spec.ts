import { describe, expect, it } from 'vitest';
import { formatSupplyDate, formatSupplyPeriod, isContractLifetimePeriod } from './supply-period';
describe('Supply period presentation',()=>{
  it('preserves a partial first month and prints exact source dates',()=>{
    expect(formatSupplyPeriod({id:'p',code:'p',name:'21/08-12/2025',kind:'CUSTOM',startDate:'2025-08-21',endDate:'2025-12-31'})).toBe('Tháng 08/2025–12/2025 (21/08/2025 đến 31/12/2025)');
    expect(formatSupplyDate('2026-01-01T00:00:00Z')).toBe('01/01/2026');
  });
  it('identifies explicit lifetime scopes, without treating a long normal period as a shared entitlement',()=>{
    const p={id:'p',code:'p',name:'Contract lifetime',kind:'CUSTOM',startDate:'2025-01-01',endDate:'2027-12-31'};
    expect(isContractLifetimePeriod(p)).toBe(true);expect(isContractLifetimePeriod({...p,name:'2025–2027'})).toBe(false);
  });
});
