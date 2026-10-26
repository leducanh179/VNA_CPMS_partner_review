import { describe, expect, it } from 'vitest';
import { compareSheetValues, isRemovedSheetBlank, parseSheetAddress, sheetCellAddress, sheetInsertionRange, sheetSavePosition, sheetRecordRowNumber } from './sheet-grid';
describe('sheet addresses and typed sorting', () => {
  it('resolves addresses past Z and rejects invalid coordinates', () => {
    expect(sheetCellAddress(4, 27)).toBe('AB5');
    expect(parseSheetAddress(' ab5 ')).toEqual({ row: 4, column: 27 });
    expect(parseSheetAddress('A0')).toBeNull(); expect(parseSheetAddress('5B')).toBeNull();
  });
  it('sorts numbers, ISO dates and visible labels while retaining blanks at the bottom', () => {
    expect(compareSheetValues('2,5', '10', 'number', false)).toBeLessThan(0);
    expect(compareSheetValues('2026-10-14', '2026-10-01', 'date', true)).toBeLessThan(0);
    expect(compareSheetValues('Alpha', 'Beta', 'text', false)).toBeLessThan(0);
    expect(compareSheetValues('', 'Alpha', 'text', true)).toBeGreaterThan(0);
  });
  it('inserts the selected count before the first or after the last selected coordinate', () => {
    expect(sheetInsertionRange([4, 2, 3, 2], 9)).toEqual({ first: 2, last: 4, count: 3 });
    expect(sheetInsertionRange([1, 4], 4)).toEqual({ first: 1, last: 4, count: 2 });
    expect(sheetInsertionRange([], 5)).toEqual({ first: 5, last: 5, count: 1 });
  });
  it('keeps inserted rows in their displayed positions when other inserted rows remain private drafts', () => {
    expect(sheetSavePosition(4, [2, 3])).toBe(2);
    expect(sheetSavePosition(3, [2, 4])).toBe(2);
    expect(sheetSavePosition(2, [3, 4])).toBe(2);
    expect(sheetSavePosition(4, [])).toBe(4);
  });
  it('removes only virtual empty slots and never conceals real data occupying the same position', () => {
    expect(isRemovedSheetBlank({ __sheetBlank: true, sortOrder: 2 }, [2])).toBe(true);
    expect(isRemovedSheetBlank({ __sheetBlank: true, sortOrder: 3 }, [2])).toBe(false);
    expect(isRemovedSheetBlank({ id: 'restored-row', sortOrder: 2, requirements: 'Kept' }, [2])).toBe(false);
  });
});


it('keeps timeline record numbers aligned with sheet addresses after removing virtual blanks',()=>{
  expect(sheetRecordRowNumber(5,[1,3,5],[2,3,4,4])).toBe(3);
  expect(sheetRecordRowNumber(5,[1,3,5],[])).toBe(5);
});
