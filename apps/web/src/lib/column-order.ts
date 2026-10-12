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
