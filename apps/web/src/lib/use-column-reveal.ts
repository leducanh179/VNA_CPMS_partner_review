import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { columnRevealScrollLeft } from './column-reveal';

/** Observes visible keys, so dropdowns, batch chooser and unhide actions share the same feedback. */
export function useColumnReveal(viewport: RefObject<HTMLDivElement | null>, columns: Array<{ key: string; label: string }>, resetKey: string | number = 0) {
  const previous = useRef({ keys: columns.map(column => column.key), resetKey });
  const [message, setMessage] = useState('');
  const signature = JSON.stringify(columns.map(column => column.key));
  useLayoutEffect(() => {
    const added = columns.filter(column => !previous.current.keys.includes(column.key) && !column.key.startsWith('blank:'));
    const reset = previous.current.resetKey !== resetKey;
    previous.current = { keys: columns.map(column => column.key), resetKey };
    if (reset) { setMessage(''); return; }
    if (!added.length) return;
    let animations: Animation[] = [];
    const frame = requestAnimationFrame(() => {
      const element = viewport.current;
      if (!element) return;
      const cells = Array.from(element.querySelectorAll<HTMLElement>('[data-reveal-column]'));
      const headers = cells.filter(cell => cell.dataset.revealHeader === 'true');
      const target = headers.find(cell => cell.dataset.revealColumn === added.at(-1)!.key);
      if (target && target.dataset.pinned !== 'true') {
        const bounds = element.getBoundingClientRect(), box = target.getBoundingClientRect();
        const pinnedRight = headers.filter(cell => cell.dataset.pinned === 'true').reduce((right, cell) => Math.max(right, cell.getBoundingClientRect().right - bounds.left), 0);
        const next = columnRevealScrollLeft(element.scrollLeft, element.clientWidth, element.scrollWidth, box.left - bounds.left + element.scrollLeft, box.width, pinnedRight);
        element.scrollTo({ left: next, top: element.scrollTop, behavior: 'instant' });
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      animations = cells.filter(cell => added.some(column => column.key === cell.dataset.revealColumn)).map(cell => cell.animate(
        [{ backgroundColor: '#a5f3fc', boxShadow: 'inset 0 0 0 2px #0891b2' }, { backgroundColor: '#a5f3fc', boxShadow: 'inset 0 0 0 2px #0891b2', offset: reduced ? 1 : 0.3 }, { backgroundColor: getComputedStyle(cell).backgroundColor, boxShadow: 'none' }],
        { duration: reduced ? 700 : 1700, easing: 'ease-out' },
      ));
      setMessage(`Đã hiển thị ${added.length === 1 ? 'cột ' + added[0]!.label : added.length + ' cột: ' + added.map(column => column.label).join(', ')}.`);
    });
    return () => { cancelAnimationFrame(frame); animations.forEach(animation => animation.cancel()); };
  }, [signature, resetKey]);
  return message;
}
