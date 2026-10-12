import { useState } from 'react';
import { Button } from '@cpms/ui';
import { requestJson } from '../lib/api';

type ImportItem={sourceKey:string;historicalStatus:'ACCEPTED'|'APPROVED';note:string};
type ImportPayload={version:1;sourceUrl:string;items:ImportItem[]};
type ImportPreview={valid:boolean;count:number;accepted:number;approved:number;contractId:string;warnings:Array<{sourceKey:string;message:string}>};
type ImportResult={count:number;accepted:number;approved:number;contractId:string};
const sourceUrl='https://docs.google.com/spreadsheets/d/14QT8wrEWCKXMhqpXGT6Osh7XIfadH2DxaTuZD36_PKc/edit';
const post=<T,>(action:'preview'|'apply',payload:ImportPayload)=>requestJson<T>(`/bookings/historical-import/${action}`,{method:'POST',body:JSON.stringify(payload)});

/** Administrator-only, source-reconciled historical transfer. The server owns all business validation and audit. */
export function BookingHistoricalImport({onSaved}:{onSaved:()=>Promise<void>}) {
  const [open,setOpen]=useState(false),[payload,setPayload]=useState<ImportPayload|null>(null),[preview,setPreview]=useState<ImportPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<ImportResult|null>(null);
  const choose=async(file:File|undefined)=>{
    setPayload(null);setPreview(null);setResult(null);setError('');
    if(!file)return;
    try {
      if(file.size>2_000_000)throw Error('Tệp đối soát vượt 2 MB.');
      const parsed=JSON.parse(await file.text()) as Record<string,unknown>;
      if(parsed.version!==1||parsed.sourceUrl!==sourceUrl||!Array.isArray(parsed.items)||parsed.items.length===0||parsed.items.length>150)
        throw Error('Tệp không phải bản đối soát Admicro đã chuẩn bị.');
      setPayload({version:1,sourceUrl,items:parsed.items as ImportItem[]});
    } catch(e){setError(e instanceof Error?e.message:'Không đọc được tệp đối soát.');}
  };
  const check=async()=>{if(!payload)return;setBusy(true);setError('');try{setPreview(await post<ImportPreview>('preview',payload));}catch(e){setError(e instanceof Error?e.message:'Không kiểm tra được lô.');}finally{setBusy(false);}};
  const apply=async()=>{if(!payload||!preview?.valid)return;setBusy(true);setError('');try{const saved=await post<ImportResult>('apply',payload);setResult(saved);await onSaved();}catch(e){setError(e instanceof Error?e.message:'Không nhập được lô.');}finally{setBusy(false);}};
  return <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
    <button type="button" className="font-semibold text-vna-blue underline" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>Nhập lịch sử Admicro từ tệp đối soát</button>
    {open&&<div className="mt-3 space-y-3">
      <p className="text-slate-600">Chỉ tài khoản quản trị được nhập. Hệ thống đối chiếu từng mã dòng nguồn với đúng hợp đồng, slot và kỳ phân bổ; các ngày/kỳ được suy định hiển thị trong ghi chú từng booking.</p>
      <label className="block">Tệp JSON đối soát <input className="mt-1 block" type="file" accept=".json,application/json" onChange={e=>void choose(e.target.files?.[0])}/></label>
      {payload&&<p role="status">{payload.items.length} dòng đặt chỗ: {payload.items.filter(i=>i.historicalStatus==='ACCEPTED').length} Accepted, {payload.items.filter(i=>i.historicalStatus==='APPROVED').length} Approved. Các ngoại lệ nằm trong ghi chú.</p>}
      <div className="flex gap-2"><Button disabled={!payload||busy} onClick={()=>void check()}>Kiểm tra nguồn và hạn mức</Button><Button disabled={!preview?.valid||busy||Boolean(result)} onClick={()=>void apply()}>Nhập {preview?.count??0} dòng đã kiểm tra</Button></div>
      {preview&&<div className="rounded-lg bg-cyan-50 p-3" role="status"><b>Đối soát hợp lệ:</b> {preview.count} dòng, {preview.accepted} Accepted, {preview.approved} Approved. {preview.warnings.length} cảnh báo cần hậu kiểm.
        {preview.warnings.slice(0,12).map((w,i)=><p key={i} className="mt-1 text-amber-800">{w.sourceKey}: {w.message}</p>)}
        {preview.warnings.length>12&&<p className="mt-1">Còn {preview.warnings.length-12} cảnh báo trong từng booking.</p>}
      </div>}
      {result&&<p className="rounded-lg bg-emerald-50 p-3 text-emerald-800" role="status">Đã nhập {result.count} booking: {result.accepted} Accepted, {result.approved} Approved.</p>}
      {error&&<p className="rounded-lg bg-rose-50 p-3 text-rose-700" role="alert">{error}</p>}
    </div>}
  </section>;
}
