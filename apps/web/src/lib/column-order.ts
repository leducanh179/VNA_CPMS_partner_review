export function moveOrderedItem<T>(items: readonly T[], source: T, target: T): T[] {
  const sourceIndex = items.indexOf(source);
  const targetIndex = items.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...items];

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return next;
  next.splice(targetIndex, 0, moved);
  return next;
}

export type ColumnDropPosition = 'before' | 'after';

/** Old sheet layouts did not distinguish default pins from deliberate user choices. */
export function manualColumnPins<T extends { pinned: string[]; pinningVersion?: number }>(layout: T): T {
  return layout.pinningVersion === 1 ? layout : { ...layout, pinned: [], pinningVersion: 1 };
}

/** Pinning brings a column forward; unpinning keeps its current displayed position. */
export function toggleManualColumnPin<T extends { order: string[]; pinned: string[] }>(layout: T, key: string, keys: string[]): T {
  const order = [...new Set([...layout.order, ...keys])].filter(value => keys.includes(value));
  if (layout.pinned.includes(key)) return { ...layout, order, pinned: layout.pinned.filter(value => value !== key) };
  if (!keys.includes(key) || layout.pinned.length >= 3) return layout;
  const pinned = [...layout.pinned, key];
  return { ...layout, pinned, order: [...order.filter(value => pinned.includes(value)), ...order.filter(value => !pinned.includes(value))] };
}

export function moveOrderedItemAt<T>(
  items: readonly T[],
  source: T,
  target: T,
  position: ColumnDropPosition,
): T[] {
  const sourceIndex = items.indexOf(source);
  const targetIndex = items.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...items];

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return next;
  const adjustedTargetIndex = next.indexOf(target);
  next.splice(adjustedTargetIndex + (position === 'after' ? 1 : 0), 0, moved);
  return next;
}

export function columnDragAutoScrollDelta(
  pointerX: number,
  scrollableLeft: number,
  scrollableRight: number,
  edgeSize = 72,
  maximumStep = 18,
) {
  if (scrollableRight <= scrollableLeft || edgeSize <= 0 || maximumStep <= 0) return 0;
  if (pointerX < scrollableLeft + edgeSize) {
    const intensity = Math.min(1, Math.max(0, (scrollableLeft + edgeSize - pointerX) / edgeSize));
    return -Math.max(2, Math.round(maximumStep * intensity));
  }
  if (pointerX > scrollableRight - edgeSize) {
    const intensity = Math.min(1, Math.max(0, (pointerX - (scrollableRight - edgeSize)) / edgeSize));
    return Math.max(2, Math.round(maximumStep * intensity));
  }
  return 0;
}
