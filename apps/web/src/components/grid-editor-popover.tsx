import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portal is still part of the grid's input surface for outside-click draft protection. */
export function GridEditorPopover({ anchor, label, onCancel, children }: { anchor: Element | null; label: string; onCancel(): void; children: ReactNode }) {
  const [position, setPosition] = useState({ left: 16, top: 80 });
  useLayoutEffect(() => {
    const place = () => { const box = anchor?.getBoundingClientRect(); if (box) setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 540)), top: Math.max(8, Math.min(box.bottom, window.innerHeight - 440)) }); };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  return createPortal(<div data-inline-save-surface data-grid-editor role="dialog" aria-label={label} style={position}
    className="fixed z-[150] max-h-[min(420px,80vh)] w-[min(520px,calc(100vw-16px))] overflow-auto rounded-xl border border-cyan-400 bg-white p-4 shadow-panel"
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onCancel(); } }}>
    {children}
  </div>, document.body);
}
