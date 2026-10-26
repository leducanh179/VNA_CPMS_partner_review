import { describe, expect, it } from 'vitest';
import { appendRevealedColumns, columnRevealScrollLeft } from './column-reveal';
describe('Column reveal across grids', () => {
  it('appends newly shown unpinned fields and preserves manual reordering', () => {
    expect(appendRevealedColumns(['a','b'], ['a','x','b','y'], ['a'])).toEqual(['a','b','x','y']);
    expect(appendRevealedColumns(['a','b'], ['x','b','a'], ['x'])).toEqual(['x','b','a']);
    expect(appendRevealedColumns(['a','b'], ['b','a'])).toEqual(['b','a']);
    expect(appendRevealedColumns(['a','b'], ['a','blank:1','b'])).toEqual(['a','blank:1','b']);
  });
  it('reveals columns beyond either edge without scrolling underneath frozen columns', () => {
    expect(columnRevealScrollLeft(0, 1000, 2000, 1600, 200, 600)).toBe(800);
    expect(columnRevealScrollLeft(800, 1000, 2000, 1100, 200, 600)).toBe(500);
    expect(columnRevealScrollLeft(0, 1000, 2200, 1500, 600, 700)).toBe(800);
    expect(columnRevealScrollLeft(0, 1000, 900, 700, 200, 600)).toBe(0);
  });
});
