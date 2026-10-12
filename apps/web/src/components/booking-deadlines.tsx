import { bookingDeadlines, type BookingDeadline, type BookingView } from '@cpms/domain';
import { useEffect, useState } from 'react';

export function useBookingClock(enabled=true) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[enabled]);
  return now;
}
export const bookingDeadlineDate=(value:string|null)=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'}):'Chưa có mốc nhận';
function duration(ms:number) {
  const minutes=Math.max(1,Math.floor(ms/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  return [days?`${days} ngày`:'',hours?`${hours} giờ`:'',rest?`${rest} phút`:''].filter(Boolean).join(' ');
}
function message(t:BookingDeadline,now:number) {
  if(t.state==='UNKNOWN')return 'Chưa có mốc nhận để tính hạn';
  if(t.state==='LATE')return `Đã xử lý trễ ${duration(t.overdueMs)}`;
  if(t.state==='OVERDUE')return `Quá hạn ${duration(t.overdueMs)} · Đã chờ ${duration(t.elapsedMs)}`;
  if(t.state==='COMPLETED')return 'Đã xử lý đúng hạn';
  if(t.state==='UPCOMING')return `Hạn ${bookingDeadlineDate(t.dueAt)}`;
  return `Còn ${duration(Date.parse(t.dueAt!)-now)}`;
}
export function BookingDeadlinePanel({row,compact=false,now:given}:{row:BookingView;compact?:boolean;now?:number}) {
  const clock=useBookingClock(given===undefined),now=given??clock,tasks=bookingDeadlines(row,now);
  const active=tasks.filter(t=>!t.completedAt),late=tasks.filter(t=>t.state==='LATE');
  const selected=compact?[...active.filter(t=>t.state!=='UPCOMING'),...late].sort((a,b)=>b.overdueMs-a.overdueMs).slice(0,2):tasks;
  if(!selected.length)return compact?<span className="text-slate-400">—</span>:null;
  return <div aria-label="Hạn xử lý đặt chỗ" className={compact?'space-y-1 text-xs':'space-y-2 rounded-xl border bg-white p-4 text-sm'}>{!compact&&<><h3 className="font-semibold">Hạn xử lý</h3><p className="text-xs text-slate-500">24 giờ mỗi bước duyệt/xác nhận · 7 ngày nộp báo cáo sau ngày kết thúc · Giờ Việt Nam, gồm cuối tuần.</p></>}{selected.map(t=><div key={t.id} className={t.overdueMs?'text-rose-700':t.state==='ON_TIME'&&Date.parse(t.dueAt!)-now<4*3600000?'text-amber-800':'text-slate-600'} title={`Nhận: ${bookingDeadlineDate(t.receivedAt)}. Hạn: ${bookingDeadlineDate(t.dueAt)}.${t.completedAt?` Xử lý: ${bookingDeadlineDate(t.completedAt)}.`:''}`}><b>{t.label}</b>{t.reportId&&!compact&&<span> · {row.reportPeriods?.find(r=>r.id===t.reportId)?.startDate??'Tổng đặt chỗ'} → {row.reportPeriods?.find(r=>r.id===t.reportId)?.endDate??''}</span>}<p>{message(t,now)}</p>{!compact&&<p className="text-xs">Nhận: {bookingDeadlineDate(t.receivedAt)} · Hạn: {bookingDeadlineDate(t.dueAt)}{t.completedAt?` · Xử lý: ${bookingDeadlineDate(t.completedAt)}`:''}</p>}</div>)}{compact&&active.length+late.length>selected.length&&<span className="text-slate-500">Mở thông tin để xem các mốc khác</span>}</div>;
}
