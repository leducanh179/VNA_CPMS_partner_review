import { CpmsIcon } from '@cpms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QcttPlanItem, QcttPlanView } from '@cpms/domain';
import { bookingTimelineScale, type BookingTimelineZoom } from '../lib/booking-timeline';
import { moveOrderedItemAt } from '../lib/column-order';

export function QcttPlanTimeline({items,data,rowNumbers,busy,canReorder,onReorder}:{items:QcttPlanItem[];data:QcttPlanView;rowNumbers:Record<string,number>;busy:boolean;canReorder:boolean;onReorder:(ids:string[])=>Promise<boolean>}) {
  const [zoom,setZoom]=useState<BookingTimelineZoom>('week');
  const [expanded,setExpanded]=useState<string[]>([]),[dragged,setDragged]=useState<string|null>(null),[drop,setDrop]=useState<{id:string;after:boolean}|null>(null);
  const viewport=useRef<HTMLDivElement>(null),source=useRef<string|null>(null),frame=useRef<number|null>(null),velocity=useRef(0);
  const stopScroll=()=>{velocity.current=0;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;};
  const endDrag=()=>{source.current=null;setDragged(null);setDrop(null);stopScroll();};
  useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
  const autoScroll=(event:React.DragEvent)=>{
    if(!source.current||!viewport.current)return;
    const bounds=viewport.current.getBoundingClientRect();velocity.current=event.clientY<bounds.top+64?-10:event.clientY>bounds.bottom-32?10:0;
    if(!velocity.current){stopScroll();return;}event.preventDefault();
    if(frame.current!==null)return;
    const scroll=()=>{const el=viewport.current;if(!el||!velocity.current){frame.current=null;return;}const before=el.scrollTop;el.scrollTop+=velocity.current;if(before===el.scrollTop){frame.current=null;return;}frame.current=requestAnimationFrame(scroll);};frame.current=requestAnimationFrame(scroll);
  };
  const move=(id:string,target:string,after:boolean)=>{if(!canReorder||busy||id===target)return;void onReorder(moveOrderedItemAt(items.map(item=>item.id),id,target,after?'after':'before'));};
  const children=useMemo(()=>data.bookings.filter(booking=>items.some(item=>item.id===booking.itemId)&&!booking.deleted),[data.bookings,items]);
  const dates=[...items.flatMap(item=>[item.startDate,item.endDate]),...children.flatMap(booking=>[booking.startDate,booking.endDate])].filter((value):value is string=>Boolean(value)).sort();
  let scale:ReturnType<typeof bookingTimelineScale>|null=null;
  try{if(dates.length)scale=bookingTimelineScale(dates[0]!,dates.at(-1)!,zoom);}catch{/* Keep legacy undated rows visible. */}
  const dateLabel=(value:string)=>value.split('-').reverse().join('/');
  const bar=(start:string|null,end:string|null,proposed=false)=>{
    if(!start||!end||!scale)return <span className="px-3 text-xs text-slate-400">Chưa xác định ngày</span>;
    const bounds=scale.bar(start,end);return <div title={`${dateLabel(start)} – ${dateLabel(end)}`} className={`absolute top-3 h-5 rounded transition-colors hover:ring-2 hover:ring-vna-blue ${proposed?'border-2 border-dashed border-amber-500 bg-amber-50':'bg-cyan-600'}`} style={{left:bounds.left,width:bounds.width}}/>;
  };
  return <div className="rounded-2xl border bg-white">
    <div className="flex flex-wrap items-center gap-3 border-b p-3 text-sm"><label>Khung thời gian <select aria-label="Khung thời gian Timeline" className="rounded border px-2 py-1" value={zoom} onChange={event=>setZoom(event.target.value as BookingTimelineZoom)}>{Object.entries({day:'Ngày',week:'Tuần',month:'Tháng',quarter:'Quý',year:'Năm'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><span className="text-xs text-slate-500">Thanh liền: kế hoạch/booking hiệu lực · nét đứt: booking đề nghị</span>{canReorder&&<span className="text-xs text-vna-blue">Kéo chấm dọc để đổi thứ tự Phương tiện</span>}{busy&&<span role="status" className="text-xs text-vna-blue">Đang lưu…</span>}</div>
    <div ref={viewport} className="max-h-[65vh] overflow-auto" role="region" aria-label="Timeline kế hoạch QCTT" tabIndex={0} onDragOver={autoScroll} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))stopScroll();}}>
      <div style={{minWidth:(scale?.width??900)+400}}>
        <div className="sticky top-0 z-30 flex h-12 border-b bg-slate-50"><div className="sticky left-0 z-40 flex w-[400px] shrink-0 items-center border-r bg-slate-50 font-semibold"><span className="w-14 shrink-0 text-center text-xs">STT</span><span className="px-3">Phương tiện / Booking</span></div><div className="relative flex-1">{scale?.ticks.map(tick=><span key={tick.key} className="absolute inset-y-0 border-r p-3 text-xs" style={{left:tick.left,width:tick.width}}>{tick.label}</span>)}</div></div>
        {items.map((item,index)=><div key={item.id} data-timeline-item={item.id} onDragOver={event=>{if(!source.current||!canReorder||busy)return;event.preventDefault();event.dataTransfer.dropEffect='move';const bounds=event.currentTarget.querySelector('[data-timeline-main]')!.getBoundingClientRect();setDrop({id:item.id,after:event.clientY>=bounds.top+bounds.height/2});}} onDrop={event=>{if(!source.current||!drop||!canReorder||busy)return;event.preventDefault();event.stopPropagation();const id=source.current;const after=drop.after;endDrag();move(id,item.id,after);}}>
          <div data-timeline-main className={`relative flex min-h-14 border-b ${dragged===item.id?'opacity-50':''} ${drop?.id===item.id&&dragged!==item.id?drop.after?'border-b-2 border-b-cyan-600':'border-t-2 border-t-cyan-600':''} bg-white hover:bg-cyan-50`}>
            <div className="sticky left-0 z-20 flex w-[400px] shrink-0 items-center gap-1 border-r bg-inherit py-2 pr-3">
              <span aria-label={`Dòng ${rowNumbers[item.id]??index+1}`} className="w-14 shrink-0 self-stretch border-r border-slate-200 py-2 text-center text-xs tabular-nums text-slate-500">{rowNumbers[item.id]??index+1}</span>
              {canReorder&&<button type="button" draggable={!busy} disabled={busy} aria-label={`Di chuyển Phương tiện dòng ${rowNumbers[item.id]??index+1}`} title="Kéo lên/xuống để đổi thứ tự; Alt + mũi tên lên/xuống" className="inline-flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-slate-500 hover:bg-cyan-100 hover:text-vna-blue focus-visible:ring-2 focus-visible:ring-vna-blue active:cursor-grabbing disabled:opacity-40" onDragStart={event=>{if(busy){event.preventDefault();return;}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);source.current=item.id;setDragged(item.id);}} onDragEnd={endDrag} onKeyDown={event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const after=event.key==='ArrowDown',target=items[index+(after?1:-1)];if(target)move(item.id,target.id,after);}}><CpmsIcon name="columnDrag" size={18}/></button>}
              <button aria-label={`Hiện booking của ${item.activityLabel||'dòng '+(rowNumbers[item.id]??index+1)}`} aria-expanded={expanded.includes(item.id)} className="rounded p-1 hover:bg-cyan-100" onClick={()=>setExpanded(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><CpmsIcon name={expanded.includes(item.id)?'collapse':'expand'}/></button><span className="min-w-0 text-sm font-medium text-vna-blue">{item.activityLabel||'Chưa đặt tên'}</span>
            </div><div className="relative flex-1">{bar(item.startDate,item.endDate)}</div>
          </div>
          {expanded.includes(item.id)&&children.filter(booking=>booking.itemId===item.id).map((booking,childIndex)=><div key={`${booking.id}:${booking.perspective}`} data-timeline-booking={booking.id} className="flex min-h-12 border-b bg-slate-50 hover:bg-cyan-50"><div className="sticky left-0 z-20 flex w-[400px] shrink-0 items-start border-r bg-inherit py-2 pr-3 text-xs"><span className="w-14 shrink-0 text-center tabular-nums text-slate-500">{rowNumbers[item.id]??index+1}.{childIndex+1}</span><div className="pl-12">{booking.slotName}<p className="text-slate-500">{booking.status}{booking.outsidePlan?' · Lệch thời gian':''}</p></div></div><div className="relative flex-1">{bar(booking.startDate,booking.endDate,booking.perspective==='PROPOSED')}</div></div>)}
        </div>)}
        {!items.length&&<p className="p-8 text-slate-500">Chưa có hoạt động để hiển thị.</p>}
      </div>
    </div>
  </div>;
}
