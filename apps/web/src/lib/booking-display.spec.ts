import {describe,expect,it} from 'vitest';
import {formatSupply} from '../components/supply-grid';
describe('supply decimal display',()=>{
  it('rounds tiny daily remainders instead of displaying a misleading lower month total',()=>{expect(formatSupply('2599.9999999999')).toBe('2.600');expect(formatSupply('2600.0000000001')).toBe('2.600');});
  it('preserves large integers, signed values and six-decimal currency',()=>{expect(formatSupply('999999999999999999.999999')).toBe('999.999.999.999.999.999,999999');expect(formatSupply('-0.0000005')).toBe('-0,000001');expect(formatSupply('100.123456')).toBe('100,123456');expect(formatSupply(null)).toBe('—');});
});
