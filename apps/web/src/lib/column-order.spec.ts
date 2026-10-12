import { describe, expect, it } from 'vitest';
import { columnDragAutoScrollDelta, moveOrderedItem, moveOrderedItemAt } from './column-order';

describe('moveOrderedItem', () => {
  it('moves a column to the dropped column position', () => {
    expect(moveOrderedItem(['code', 'name', 'status'], 'code', 'status')).toEqual(['name', 'status', 'code']);
    expect(moveOrderedItem(['code', 'name', 'status'], 'status', 'code')).toEqual(['status', 'code', 'name']);
  });

  it('keeps the order when either column is unknown or unchanged', () => {
    expect(moveOrderedItem(['code', 'name'], 'code', 'code')).toEqual(['code', 'name']);
    expect(moveOrderedItem(['code', 'name'], 'missing', 'name')).toEqual(['code', 'name']);
  });

  it('places a distant column on the requested side of the drop target', () => {
    const columns = ['pinned-1', 'pinned-2', 'first', 'middle', 'distant'];
    expect(moveOrderedItemAt(columns, 'distant', 'first', 'before')).toEqual([
      'pinned-1', 'pinned-2', 'distant', 'first', 'middle',
    ]);
    expect(moveOrderedItemAt(['pinned-1', 'pinned-2'], 'pinned-2', 'pinned-1', 'before')).toEqual([
      'pinned-2', 'pinned-1',
    ]);
    expect(moveOrderedItemAt(columns, 'first', 'middle', 'after')).toEqual([
      'pinned-1', 'pinned-2', 'middle', 'first', 'distant',
    ]);
  });

  it('calculates smooth auto-scroll only near the scrollable edges', () => {
    expect(columnDragAutoScrollDelta(260, 250, 1000)).toBeLessThan(0);
    expect(columnDragAutoScrollDelta(990, 250, 1000)).toBeGreaterThan(0);
    expect(columnDragAutoScrollDelta(600, 250, 1000)).toBe(0);
    expect(Math.abs(columnDragAutoScrollDelta(250, 250, 1000))).toBeGreaterThan(
      Math.abs(columnDragAutoScrollDelta(300, 250, 1000)),
    );
    // A pinned area shifts the left scroll edge; the trailing action column shifts the right edge.
    expect(columnDragAutoScrollDelta(400, 48 + 320, 1000 - 96)).toBeLessThan(0);
    expect(columnDragAutoScrollDelta(890, 48 + 320, 1000 - 96)).toBeGreaterThan(0);
    expect(columnDragAutoScrollDelta(600, 48 + 320, 1000 - 96)).toBe(0);
  });
});
