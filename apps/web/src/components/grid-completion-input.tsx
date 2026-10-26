import { useId, useLayoutEffect, useRef, useState, type FocusEventHandler, type KeyboardEventHandler } from 'react';
import { createPortal } from 'react-dom';

/** A suggestion never changes input until explicitly accepted; Enter keeps normal grid save behavior. */
export function GridCompletionInput({ value, suggestion, label, onChange, onBlur, onKeyDown }: {
  value: string; suggestion: string | null; label: string; onChange(value: string): void;
  onBlur: FocusEventHandler<HTMLInputElement>; onKeyDown: KeyboardEventHandler<HTMLInputElement>;
}) {
  const input = useRef<HTMLInputElement>(null), id = useId();
  const [focused, setFocused] = useState(true), [composing, setComposing] = useState(false);
  const [atEnd, setAtEnd] = useState(true), [dismissed, setDismissed] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320 });
  const visible = Boolean(suggestion && suggestion !== value && focused && !composing && atEnd && dismissed !== value);
  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const box = input.current?.getBoundingClientRect();
      if (box) {
        const width = Math.min(Math.max(box.width, 320), window.innerWidth - 16);
        setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 118)), width });
      }
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [visible, suggestion]);
  const accept = () => { if (suggestion) { onChange(suggestion); input.current?.focus(); } };
  return <>
    <input ref={input} autoFocus autoComplete="off" aria-label={label} aria-describedby={visible ? id : undefined}
      className="w-full rounded border border-cyan-500 bg-white p-1" value={value}
      onChange={event => onChange(event.target.value)} onFocus={() => setFocused(true)}
      onSelect={event => setAtEnd(event.currentTarget.selectionStart === value.length && event.currentTarget.selectionEnd === value.length)}
      onBlur={event => { setFocused(false); onBlur(event); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={event => {
        if (composing || event.nativeEvent.isComposing) return;
        if (visible && event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); accept(); return; }
        if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(value); return; }
        onKeyDown(event);
      }}/>
    {visible && createPortal(<div id={id} data-inline-save-surface style={position}
      className="fixed z-[160] rounded-lg border border-cyan-200 bg-white p-2 shadow-panel"
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}>
      <p className="mb-1 text-[11px] text-slate-500">Gợi ý từ Chiến dịch · Tab để điền · Enter lưu nội dung đang nhập</p>
      <button type="button" tabIndex={-1} aria-label={'Dùng gợi ý: ' + suggestion} className="w-full rounded bg-cyan-50 px-2 py-1.5 text-left text-sm text-vna-blue hover:bg-cyan-100" onClick={event => { event.stopPropagation(); accept(); }}>
        <span>{value}</span><strong>{suggestion!.slice(value.length)}</strong>
      </button>
    </div>, document.body)}
  </>;
}
