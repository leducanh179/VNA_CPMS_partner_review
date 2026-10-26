import { columnRevealScrollLeft } from './column-reveal';

/** Focus within the scrollable pane, excluding sticky headers and frozen columns. */
export function focusGridCell(viewport: HTMLElement, cell: HTMLElement) {
  cell.focus({ preventScroll: true });
  const bounds = viewport.getBoundingClientRect(), box = cell.getBoundingClientRect();
  const headers = Array.from(viewport.querySelectorAll<HTMLElement>('[data-reveal-header="true"]'));
  const pinned = headers.filter(header => header.dataset.pinned === 'true');
  // Include the row-number/checkbox gutter even when all business columns are unpinned.
  const stickyHeaders = Array.from(viewport.querySelectorAll<HTMLElement>('thead th')).filter(header => {
    const style = getComputedStyle(header);
    return style.position === 'sticky' && style.left !== 'auto';
  });
  const pinnedWidth = stickyHeaders.reduce((right, header) => Math.max(right, header.getBoundingClientRect().right - bounds.left - viewport.clientLeft), 0);
  const frozen = pinned.some(header => header.dataset.revealColumn === cell.dataset.revealColumn);
  const left = frozen ? viewport.scrollLeft : columnRevealScrollLeft(viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth,
    box.left - bounds.left - viewport.clientLeft + viewport.scrollLeft, box.width, pinnedWidth);
  const head = viewport.querySelector('thead')?.getBoundingClientRect();
  const headerBottom = head ? Math.max(bounds.top + viewport.clientTop, head.bottom) : bounds.top + viewport.clientTop;
  const bottom = bounds.top + viewport.clientTop + viewport.clientHeight;
  const top = box.top < headerBottom ? viewport.scrollTop + box.top - headerBottom
    : box.bottom > bottom ? viewport.scrollTop + box.bottom - bottom : viewport.scrollTop;
  viewport.scrollTo({ left, top: Math.max(0, top), behavior: 'instant' });
}
