import { formatSupplyPeriod, type BookingAllocationAccess, type BookingBootstrap, type SupplyAllocationInformationRow, type SupplyInformationPhase, type SupplyPeriodView } from '@cpms/domain';
import { Button, Card, LoadingBlock, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth-context';
import { requestJson } from '../lib/api';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { SupplyGrid, formatSupply, type SupplyGridColumn } from './supply-grid';

const inputClass='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const statusLabel=(status:unknown)=>({APPROVED:'Đã áp dụng',DRAFT:'Bản nháp',PENDING:'Chờ duyệt',HELD:'Chờ đối soát',REJECTED:'Từ chối'}[String(status)]??String(status));
export function ContractAllocationPanel({contractId,rows,periods,phase,onDirty,readOnly=false}:{readOnly?:boolean;contractId:string;rows:SupplyAllocationInformationRow[];periods:SupplyPeriodView[];phase:SupplyInformationPhase;onDirty:(dirty:boolean)=>void}) {
  const {me}=useAuth();
  const [data,setData]=useState<BookingBootstrap|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [editing,setEditing]=useState<BookingAllocationAccess|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const generation=useRef(0),editor=useRef<HTMLDivElement>(null);
  useUnsavedChanges(Boolean(editing));
  useEffect(()=>{onDirty(Boolean(editing));return()=>onDirty(false);},[editing,onDirty]);
  useEffect(()=>{if(editing)editor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[editing]);
  const load=useCallback(async()=>{const request=++generation.current;setLoading(true);try{
    const result=await requestJson<BookingBootstrap>('/bookings/bootstrap');
    if(request===generation.current){setData(result);setError('');}
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Không tải được phân công.');}
  finally{if(request===generation.current)setLoading(false);}},[]);
  useEffect(()=>{setData(null);void load();return()=>{generation.current++;};},[contractId,load]);
  const ctx=data?.contracts.find(c=>c.contract.id===contractId);
  const personNames=(ids:string[])=>ids.map(id=>data?.people.find(p=>p.id===id)?.name??'Tài khoản chưa xác định').join(', ')||'Chưa phân công';
  const orgName=(id:string|null|undefined)=>data?.departments.find(d=>d.id===id)?.name??'Chưa phân công';
  const accessText=(id:string,key:keyof BookingAllocationAccess)=>{
    if(loading)return 'Đang tải…';
    if(error||!ctx?.allocations.some(a=>a.id===id))return 'Chưa có quyền xem phân công';
    const access=ctx.access.find(a=>a.allocationId===id);
    if(key==='ownerDepartmentId'||key==='beneficiaryDepartmentId')return orgName(access?.[key]);
    return personNames((access?.[key]??[]) as string[]);
  };
  const begin=(id:string)=>{const access=ctx?.access.find(a=>a.allocationId===id);setNotice('');setEditing(structuredClone(access??{allocationId:id,ownerDepartmentId:null,beneficiaryDepartmentId:null,leaderActorIds:[],operatorActorIds:[],beneficiaryActorIds:[],vendorActorIds:[],recordVersion:1}));};
  const save=async()=>{if(!editing)return;setBusy(true);setError('');try{
    await requestJson('/bookings/allocations/access',{method:'POST',body:JSON.stringify(editing)});
    setEditing(null);setNotice('Đã lưu phân công.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Không lưu được phân công.');}finally{setBusy(false);}};
  const columns:SupplyGridColumn[]=[
    {key:'name',label:'Hàng hóa, dịch vụ',width:300,render:r=><><strong className="font-medium">{String(r.name)}</strong>{r.freeOfCharge===true&&<p className="mt-1 text-xs text-vna-blue">Tặng miễn phí</p>}</>},
    {key:'periodLabel',label:'Kỳ phân bổ',width:285},
    {key:'beneficiaryLabel',label:'CQĐV hưởng hạn mức',width:170},
    {key:'unit',label:'Đơn vị tính',width:110},
    {key:'qty',label:phase==='BASELINE'?'Số lượng ban đầu':'Số lượng sau điều chỉnh',type:'number',width:155},
    {key:'adjustmentQty',label:'Chênh lệch số lượng',type:'number',width:145},
    {key:'unitPrice',label:'Đơn giá trước VAT',type:'number',width:150,render:r=><>{formatSupply(r.unitPrice)}{r.priceBasis!==null&&r.priceBasis!=='1'&&<p className="text-xs text-slate-500">/ {formatSupply(r.priceBasis)} {String(r.unit)}</p>}</>},
    {key:'amount',label:'Thành tiền trước VAT',type:'number',width:175},
    {key:'status',label:'Trạng thái phân bổ',width:150,render:r=><StatusBadge>{statusLabel(r.status)}</StatusBadge>},
    ...(['ownerDepartmentId','leaderActorIds','operatorActorIds','beneficiaryDepartmentId','beneficiaryActorIds','vendorActorIds'] as const).map((key,i)=>({key,label:['CQĐV phụ trách','LĐP phụ trách','Chuyên viên phụ trách','CQĐV khai thác','Chuyên viên khai thác','Đầu mối NCC'][i]!,width:190})),
    ...(!readOnly&&data?.canManage?[{key:'action',label:'Thao tác',width:140,render:(r:Record<string,unknown>)=>ctx?.allocations.some(a=>a.id===r.id)?<Button size="sm" variant="ghost" disabled={Boolean(editing)||loading} onClick={()=>begin(String(r.id))}>Sửa phân công</Button>:null}]:[]),
  ];
  const selected=rows.find(r=>r.id===editing?.allocationId);
  return <section aria-label="Phân bổ và phân công theo slot, kỳ, CQĐV" className="space-y-3">
    <div><h2 className="text-sm font-semibold">Phân bổ và phân công theo slot, kỳ, CQĐV</h2><p className="mt-1 text-xs text-slate-500">Số lượng theo giai đoạn {phase==='BASELINE'?'Ban đầu':'Sau điều chỉnh'}. Phân công hiện tại của các phân bổ đang xem; không tái dựng người phụ trách trong quá khứ.</p><p className="mt-1 text-xs text-slate-500">Các chuyên viên được phân công cùng dùng chung hạn mức CQĐV. Hạn mức bằng 0 vẫn được giữ để đối chiếu.</p></div>
    {error&&<div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void load()}>Tải lại phân công</Button></div>}
    {notice&&<p role="status" className="text-sm text-vna-blue">{notice}</p>}
    <Card className="overflow-hidden"><SupplyGrid rowNumbers canEdit={false} rows={rows.map(r=>({...r,periodLabel:formatSupplyPeriod(periods.find(p=>p.id===r.periodId)!),...Object.fromEntries(['ownerDepartmentId','leaderActorIds','operatorActorIds','beneficiaryDepartmentId','beneficiaryActorIds','vendorActorIds'].map(key=>[key,accessText(r.id,key as keyof BookingAllocationAccess)]))}))} columns={columns} storageKey={`cpms:supply:allocation-info-v1:${me.account.id}`} empty="Không có phân bổ trong kỳ đang xem."/></Card>
    {loading&&<LoadingBlock label="Đang tải phân công…"/>}
    {editing&&<div ref={editor} role="region" aria-label="Sửa phân công" className="space-y-4 rounded-xl border border-cyan-300 bg-white p-5">
      <h3 className="font-semibold">Sửa phân công · {selected?.name}</h3><p className="text-sm">{selected?.periodName} · {selected?.beneficiaryLabel}</p><p className="text-xs text-slate-500">Lưu hoặc Hủy phân công trước khi đổi tab hay mặt cắt. Số lượng phân bổ được giữ nguyên.</p>
      <div className="grid gap-4 md:grid-cols-2">{(['ownerDepartmentId','beneficiaryDepartmentId'] as const).map((key,i)=><label key={key} className="space-y-1 text-sm">{i?'CQĐV khai thác':'CQĐV phụ trách'}<select className={inputClass} disabled={busy} value={editing[key]??''} onChange={e=>setEditing({...editing,[key]:e.target.value||null})}><option value="">Chưa phân công</option>{data?.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>)}
        {(['leaderActorIds','operatorActorIds','beneficiaryActorIds','vendorActorIds'] as const).map((key,i)=><label key={key} className="space-y-1 text-sm">{['LĐP phụ trách','Chuyên viên phụ trách','Chuyên viên khai thác','Đầu mối NCC'][i]}<select multiple disabled={busy} className={`${inputClass} h-36`} value={editing[key]} onChange={e=>setEditing({...editing,[key]:Array.from(e.target.selectedOptions,o=>o.value)})}>{data?.people.map(p=><option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}</select></label>)}
      </div><div className="flex justify-end gap-3"><Button variant="secondary" disabled={busy} onClick={()=>setEditing(null)}>Hủy</Button><Button disabled={busy} onClick={()=>void save()}>Lưu phân công</Button></div>
    </div>}
  </section>;
}
