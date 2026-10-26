import { describe, expect, it } from 'vitest';
import { boundedContext, lookupContextSchema } from './lookup-context';
describe('AI context boundary', () => {
  it('accepts a record reference, not a client-supplied record snapshot', () => {
    expect(lookupContextSchema.safeParse({ type: 'RECORD', record: { kind: 'CONTRACT', id: 'id' } }).success).toBe(true);
    expect(lookupContextSchema.safeParse({ type: 'RECORD', record: { kind: 'CONTRACT', id: 'id', salary: 100 } }).success).toBe(false);
    expect(lookupContextSchema.safeParse({ type: 'RECORD', record: { kind: 'USER', id: 'id' } }).success).toBe(false);
  });
  it('keeps valid Vietnamese UTF-8 within the context byte bound and signals truncation', () => {
    const result = boundedContext('Đà Nẵng – Tết', 9);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(9);
    expect(result.truncated).toBe(true); expect(result.text).not.toContain('�');
    expect(boundedContext('Tết', 20)).toEqual({ text: 'Tết', truncated: false });
  });
});
