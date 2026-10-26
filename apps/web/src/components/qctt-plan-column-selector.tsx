import { CpmsIcon } from '@cpms/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

export function QcttPlanColumnSelector({ label, value, choices, disabled, onChange, toggleVisibility=false }: {
  label: string; value: string; choices: Array<{ value: string; label: string; visibility?: 'visible' | 'hidden' | undefined }>; disabled?: boolean; onChange(value: string): void; toggleVisibility?:boolean;
}) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 300, maxHeight: 288 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const width = Math.min(340, window.innerWidth - 16), below = window.innerHeight - anchor.bottom - 12, above = anchor.top - 12;
      const height = Math.min(288, Math.max(100, below < 180 && above > below ? above : below));
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: below < 180 && above > below ? Math.max(8, anchor.top - height - 4) : anchor.bottom + 4, width, maxHeight: height });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);
  const choose = (next: string) => { setOpen(toggleVisibility&&Boolean(choices.find(choice=>choice.value===next)?.visibility)); onChange(next); trigger.current?.focus(); };
  return <div ref={root} className="relative min-w-0 flex-1" onPointerDown={event => event.stopPropagation()}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" disabled={disabled}
      className="flex w-full items-center justify-between gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:border-cyan-400 disabled:opacity-50"
      onClick={() => { setOpen(!open); setActive(Math.max(0, choices.findIndex(choice => choice.value === value))); }}
      onKeyDown={event => { if (open || event.key.startsWith('Arrow')) event.stopPropagation(); if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
        else if (event.key === 'Enter' && open) { event.preventDefault(); if (choices[active]) choose(choices[active]!.value); } }}>
      <span className="truncate">{choices.find(choice => choice.value === value)?.label ?? (toggleVisibility ? label : 'Chọn trường…')}</span><CpmsIcon name="collapse" size={14}/>
    </button>
    {open && createPortal(<div ref={panel} data-inline-save-surface role="listbox" style={position} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }} aria-label={label} aria-multiselectable={toggleVisibility||undefined} className="fixed z-[140] overflow-auto rounded-lg border bg-white py-1 text-xs font-normal shadow-panel">
      {choices.map((choice, index) => <button type="button" role="option" aria-selected={toggleVisibility?choice.visibility==='visible':choice.value === value} aria-label={choice.label} aria-description={choice.visibility==='visible'?toggleVisibility?'Đang hiển thị. Bấm để ẩn cột.':'Đang hiển thị':choice.visibility==='hidden'?toggleVisibility?'Đang ẩn. Bấm để hiển thị cột.':'Đang ẩn':undefined} title={toggleVisibility&&choice.visibility?(choice.visibility==='visible'?'Ẩn cột':'Hiển thị cột'):undefined} key={choice.value}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cyan-50 ${choice.value === 'custom:new' ? 'font-semibold text-emerald-700' : 'text-slate-700'} ${active === index ? 'bg-cyan-50' : ''}`}
        onMouseEnter={() => setActive(index)} onClick={() => choose(choice.value)}><span className="min-w-0 flex-1">{choice.label}</span><span className="inline-flex w-4 shrink-0 justify-center text-vna-blue">{choice.visibility==='visible'&&<CpmsIcon name="selected" size={16}/>}</span></button>)}
    </div>, document.body)}
  </div>;
}
