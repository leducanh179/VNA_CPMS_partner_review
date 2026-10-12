import { describe, expect, it } from 'vitest';
import { acknowledgeFields, gridDestination } from './grid-navigation';

describe('spreadsheet navigation and save acknowledgement', () => {
  it('wraps Tab and Shift+Tab across rows and clamps at the grid boundary', () => {
    expect(gridDestination(0, 2, 3, 3, 'Tab')).toEqual({ row: 1, column: 0 });
    expect(gridDestination(1, 0, 3, 3, 'Tab', true)).toEqual({ row: 0, column: 2 });
    expect(gridDestination(2, 2, 3, 3, 'Tab')).toEqual({ row: 2, column: 2 });
    expect(gridDestination(0, 0, 3, 3, 'Tab', true)).toEqual({ row: 0, column: 0 });
  });
  it('moves Enter vertically, arrows by direction, and ignores editing keys', () => {
    expect(gridDestination(1, 1, 3, 3, 'Enter')).toEqual({ row: 2, column: 1 });
    expect(gridDestination(1, 1, 3, 3, 'Enter', true)).toEqual({ row: 0, column: 1 });
    expect(gridDestination(0, 0, 3, 3, 'ArrowLeft')).toEqual({ row: 0, column: 0 });
    expect(gridDestination(0, 0, 0, 3, 'Tab')).toBeNull();
    expect(gridDestination(0, 0, 3, 3, 'Escape')).toBeNull();
  });
  it('clears only the exact fields acknowledged by the server', () => {
    expect(acknowledgeFields({ name: 'newer', note: 'sent', endDate: '2026-10-12' }, { name: 'older', note: 'sent' }))
      .toEqual({ name: 'newer', endDate: '2026-10-12' });
    expect(acknowledgeFields({ note: '' }, { note: '' })).toEqual({});
  });
});
