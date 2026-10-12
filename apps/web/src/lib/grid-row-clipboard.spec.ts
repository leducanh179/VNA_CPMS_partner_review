import { beforeEach, describe, expect, it } from 'vitest';
import { clearGridRows, readGridRows, rememberGridRows } from './grid-row-clipboard';

describe('typed row clipboard', () => {
  beforeEach(clearGridRows);
  it('retains IDs, hidden fields and multiline rich text for menu copy/paste', () => {
    const rows = [{ activityLabel: 'A1', content: '{"bold":"Dòng 1\\nDòng 2"}', hidden: 'Ẩn' }];
    rememberGridRows({ scope: 'QCTT_PLAN', text: 'Phương tiện\tNội dung\n', rows });
    rows[0]!.hidden = 'Đã sửa';
    const result = readGridRows('Phương tiện\tNội dung\r\n', 'QCTT_PLAN')!;
    expect(result[0]!.hidden).toBe('Ẩn');
    result[0]!.hidden = 'Sửa bản dán';
    expect(readGridRows('Phương tiện\tNội dung\n', 'QCTT_PLAN')![0]!.hidden).toBe('Ẩn');
  });
  it('reads keyboard clipboard metadata without using unrelated cached rows', () => {
    const encoded = rememberGridRows({ scope: 'QCTT_PLAN', text: 'Source', rows: [{ field: 'value' }] });
    clearGridRows();
    expect(readGridRows('Source', 'QCTT_PLAN', encoded)).toEqual([{ field: 'value' }]);
    expect(readGridRows('External', 'QCTT_PLAN', encoded)).toBeNull();
    expect(readGridRows('Source', 'BOOKING', encoded)).toBeNull();
    expect(readGridRows('Source', 'QCTT_PLAN', '{broken')).toBeNull();
    expect(readGridRows('Source', 'QCTT_PLAN', JSON.stringify({ scope: 'QCTT_PLAN', text: 'Source', rows: [{ field: {} }] }))).toBeNull();
  });
  it('enforces the existing 50-row limit before changing the clipboard', () => {
    expect(() => rememberGridRows({ scope: 'QCTT_PLAN', text: 'Too many', rows: Array.from({ length: 51 }, () => ({ field: '' })) })).toThrow(/50/);
    expect(readGridRows('Too many', 'QCTT_PLAN')).toBeNull();
  });
});
