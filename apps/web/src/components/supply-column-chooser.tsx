import { Button } from '@cpms/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SupplyColumnLayout { order: string[]; hidden: string[]; pinned: string[]; widths: Record<string, number> }
export function SupplyColumnChooser({ columns, value, onChange }: { columns: Array<{key:string;label:string}>; value: SupplyColumnLayout; onChange:(value:SupplyColumnLayout)=>void }) {
  const [draft,setDraft]=useState<SupplyColumnLayout|null>(null),[query,setQuery]=useState('');
  const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
  const [position,setPosition]=useState({left:8,top:8,width:320,maxHeight:400});
  const open=Boolean(draft);
  const close=()=>{setDraft(null);button.current?.focus();};
  useLayoutEffect(()=>{
    if(!open)return;
    const reposition=()=>{const anchor=button.current?.getBoundingClientRect();if(!anchor)return;
      const width=Math.min(352,window.innerWidth-16),below=window.innerHeight-anchor.bottom-16,above=anchor.top-16;
      const useAbove=below<260&&above>below,maxHeight=Math.max(100,Math.min(480,useAbove?above:below));
      setPosition({left:Math.max(8,Math.min(anchor.left,window.innerWidth-width-8)),top:useAbove?Math.max(8,anchor.top-maxHeight-8):Math.min(anchor.bottom+8,window.innerHeight-maxHeight-8),width,maxHeight});
    };
    reposition();search.current?.focus();window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
    return()=>{window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!panel.current?.contains(target)&&!button.current?.contains(target))setDraft(null);};
    window.addEventListener('pointerdown',outside);return()=>window.removeEventListener('pointerdown',outside);
  },[open]);
  const toggle=(items:string[],key:string)=>items.includes(key)?items.filter(v=>v!==key):[...items,key];
  const order=draft?[...new Set([...draft.order,...columns.map(c=>c.key)])].filter(key=>columns.some(c=>c.key===key)):[];
  return <><button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} className="rounded px-2 py-1 text-xs font-semibold" onClick={()=>{if(open)close();else{setQuery('');setDraft(structuredClone(value));}}}>Cột hiển thị</button>
    {draft&&createPortal(<div ref={panel} role="dialog" aria-label="Cột hiển thị" style={position} className="fixed z-[110] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xl" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2"><strong className="text-sm">Cột hiển thị</strong><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={close}>Hủy</Button><Button size="sm" disabled={columns.every(c=>draft.hidden.includes(c.key))} onClick={()=>{onChange(draft);close();}}>Áp dụng</Button></div></div>
      <input ref={search} type="search" aria-label="Tìm cột hiển thị" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm cột…" className="mb-2 w-full shrink-0 rounded border px-2 py-2 text-xs"/>
      <div className="min-h-0 overflow-auto overscroll-contain">{order.map(key=>columns.find(c=>c.key===key)!).filter(c=>c.label.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))).map(c=><div key={c.key} className="flex items-center gap-2 border-b py-2 text-xs">
        <label className="flex min-w-0 flex-1 items-start gap-2"><input type="checkbox" className="mt-0.5" checked={!draft.hidden.includes(c.key)} onChange={()=>setDraft({...draft,hidden:toggle(draft.hidden,c.key)})}/><span className="break-words">{c.label}</span></label>
        <button type="button" aria-label={`${draft.pinned.includes(c.key)?'Bỏ ghim':'Ghim'} ${c.label}`} disabled={!draft.pinned.includes(c.key)&&draft.pinned.length>=3} className="shrink-0 rounded border px-2 py-1 disabled:opacity-40" onClick={()=>setDraft({...draft,pinned:toggle(draft.pinned,c.key)})}>{draft.pinned.includes(c.key)?'Bỏ ghim':'Ghim'}</button>
        <button type="button" aria-label={`Đưa ${c.label} lên trước`} disabled={order.indexOf(c.key)===0} className="shrink-0 rounded border px-2 py-1 disabled:opacity-40" onClick={()=>{const next=[...order],at=next.indexOf(c.key);[next[at-1],next[at]]=[next[at]!,next[at-1]!];setDraft({...draft,order:next});}}>Trước</button>
      </div>)}</div><p className="mt-2 text-xs text-slate-500">Ghim tối đa 3 cột. STT luôn ở đầu bảng khi được bật.</p>
    </div>,button.current?.closest('dialog[open]')??document.body)}
  </>;
}
