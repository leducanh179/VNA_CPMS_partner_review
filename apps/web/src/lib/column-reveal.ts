/** Newly shown, unpinned fields form one block at the end of the visible columns. */
export function appendRevealedColumns(previous: readonly string[], next: readonly string[], pinned: readonly string[] = []) {
  const added = next.filter(key => !previous.includes(key) && !pinned.includes(key) && !key.startsWith('blank:'));
  return [...next.filter(key => !added.includes(key)), ...added];
}

export function columnRevealScrollLeft(current: number, viewport: number, content: number, columnLeft: number, columnWidth: number, pinnedWidth: number) {
  const available = Math.max(0, viewport - pinnedWidth);
  const target = columnWidth > available ? columnLeft - pinnedWidth
    : columnLeft < current + pinnedWidth ? columnLeft - pinnedWidth
    : columnLeft + columnWidth > current + viewport ? columnLeft + columnWidth - viewport : current;
  return Math.max(0, Math.min(Math.max(0, content - viewport), target));
}
