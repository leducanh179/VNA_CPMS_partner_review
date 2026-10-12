export function gridDestination(row: number, column: number, rows: number, columns: number, key: string, shift = false) {
  if (!rows || !columns) return null;
  if (key === 'Tab') {
    const index = Math.max(0, Math.min(rows * columns - 1, row * columns + column + (shift ? -1 : 1)));
    return { row: Math.floor(index / columns), column: index % columns };
  }
  const offset: Record<string, [number, number]> = { Enter: [shift ? -1 : 1, 0], ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = offset[key];
  return delta ? { row: Math.max(0, Math.min(rows - 1, row + delta[0])), column: Math.max(0, Math.min(columns - 1, column + delta[1])) } : null;
}

/** Preserve edits typed while an earlier snapshot was in flight. */
export function acknowledgeFields(current: Record<string, string>, saved: Record<string, string>) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => !(key in saved) || saved[key] !== value));
}
