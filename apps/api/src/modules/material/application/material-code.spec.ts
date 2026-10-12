import { describe, expect, it } from 'vitest';
import { generateMaterialCode, isValidMaterialCode } from './material-code';

describe('Material code', () => {
  it('generates the alternating suffix with Vietnam year/month', () => {
    const picks = [0, 2, 2, 9, 19, 6];
    const code = generateMaterialCode(new Date('2026-09-30T18:00:00.000Z'), () => picks.shift()!);
    expect(code).toBe('MTR-202610-A2C9T8');
    expect(isValidMaterialCode(code)).toBe(true);
  });

  it('never combines forbidden digit pairs or ends with 4/7', () => {
    for (let index = 0; index < 1000; index += 1) expect(isValidMaterialCode(generateMaterialCode(new Date('2026-10-03T00:00:00Z')))).toBe(true);
    for (const code of ['MTR-202610-A7C8T2', 'MTR-202610-A4C9T2', 'MTR-202610-A5C3T2', 'MTR-202610-A2C9T4', 'MTR-202610-A2C9T7']) expect(isValidMaterialCode(code)).toBe(false);
  });
});
