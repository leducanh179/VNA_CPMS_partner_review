import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { emptyQcttCatalogFields, QCTT_CATALOG_KINDS, QCTT_CATALOG_LABELS, type QcttCatalogEntry, type QcttCatalogFields, type QcttCatalogKind, type QcttCatalogView } from '@cpms/domain';
import { SupplyGrid, type SupplyGridColumn, type SupplyGridPatch } from '../components/supply-grid';
import { requestJson } from '../lib/api';
import { useAuth } from '../auth-context';
import { useUnsavedChanges } from '../lib/unsaved-changes';
type Row = QcttCatalogEntry & Record<string,unknown> & { id: string; isNew?: boolean };
type HistoryRow = { version:number;action:string;actorName:string;createdAt:string;data:{before:QcttCatalogEntry|null;after:QcttCatalogEntry|null} };
const message = (e: unknown) => e instanceof Error ? e.message : 'Không hoàn tất thao tác.';
const fieldsOf = (e: QcttCatalogEntry): QcttCatalogFields => ({ name:e.name,status:e.status,layerCode:e.layerCode,channelCode:e.channelCode,parentCode:e.parentCode,
  ownerOrgId:e.ownerOrgId,ownerOrgName:e.ownerOrgName,supplyType:e.supplyType,year:e.year,effectiveFrom:e.effectiveFrom,effectiveTo:e.effectiveTo,sortOrder:e.sortOrder,description:e.description,unit:e.unit,note:e.note });
export function QcttCatalogPage() {
  const { me } = useAuth();
  const [data,setData]=useState<QcttCatalogView|null>(null),[rows,setRows]=useState<Row[]>([]),[changed,setChanged]=useState<string[]>([]);
  const [kind,setKind]=useState<QcttCatalogKind>('ACTIVITY'),[trash,setTrash]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [details,setDetails]=useState<{title:string;what:'usage'|'history';value:unknown}|null>(null),[importBody,setImportBody]=useState<Record<string,unknown>|null>(null),[preview,setPreview]=useState<{activities:number;created:number;updated:number;preserved:number}|null>(null);
  useUnsavedChanges(changed.length>0);
  const load=useCallback(async()=>{const v=await requestJson<QcttCatalogView>('/catalogs/qctt');setData(v);setRows(v.entries.map(e=>({...e,id:e.code})));setChanged([]);setSelected([]);},[]);
  useEffect(()=>{void load().catch(e=>setError(message(e)));},[load]);
  const canEdit=Boolean(data?.capabilities.manage)&&!trash&&!busy;
  const mark=(ids:string[])=>setChanged(old=>[...new Set([...old,...ids])]);
  const edit=(patches:SupplyGridPatch[])=>{setRows(old=>old.map(row=>{const patch=patches.find(p=>p.id===row.id);if(!patch)return row;
    const fields:Record<string,unknown>={...patch.fields};for(const k of ['layerCode','channelCode','parentCode','ownerOrgId','supplyType','effectiveFrom','effectiveTo'])if(fields[k]==='')fields[k]=null;
    for(const k of ['year','sortOrder'])if(k in fields)fields[k]=fields[k]===''?(k==='year'?null:0):Number(fields[k]);
    if('ownerOrgId' in fields)fields.ownerOrgName=data?.organizations.find(o=>o.id===fields.ownerOrgId)?.name??'';
    if('parentCode' in fields)fields.year=rows.find(e=>e.code===fields.parentCode)?.year??row.year;
    return {...row,...fields} as Row;
  }));mark(patches.map(p=>p.id));};
  const add=(copies?:Row[],count=1)=>{const now=new Date().toISOString();const fresh=(copies??Array.from({length:count},()=>null)).map(copy=>{
    const id=crypto.randomUUID();return {...emptyQcttCatalogFields(),...copy,id,code:'',kind,recordVersion:0,isNew:true,deletedAt:null,source:{origin:'CPMS'},createdAt:now,updatedAt:now,
      ...(kind==='ACTIVITY'&&!copy?{ownerOrgName:'Ban TT',supplyType:'PAID' as const}:{}),...(kind==='PILLAR'||kind==='TOPIC'?{year:copy?.year??new Date().getFullYear()}:{}),name:copy?`${copy.name} (bản sao)`:''};
  });setRows(old=>[...old,...fresh]);mark(fresh.map(e=>e.id));};
  const save=async(patches:SupplyGridPatch[])=>{setError('');if(patches.length>50)return Object.fromEntries(patches.map(p=>[p.id,'Lưu tối đa 50 dòng/lần.']));
    try{await requestJson('/catalogs/qctt/commands',{method:'POST',body:JSON.stringify({action:'SAVE',idempotencyKey:crypto.randomUUID(),items:patches.map(p=>{const before=rows.find(r=>r.id===p.id)!;const patch:Record<string,unknown>={...p.fields};for(const k of ['layerCode','channelCode','parentCode','ownerOrgId','supplyType','effectiveFrom','effectiveTo'])if(patch[k]==='')patch[k]=null;for(const k of ['year','sortOrder'])if(k in patch)patch[k]=patch[k]===''?(k==='year'?null:0):Number(patch[k]);const row={...before,...patch};return{...(row.code?{code:row.code}:{}),kind:row.kind,expectedVersion:p.recordVersion,fields:fieldsOf(row)};})})});const next=await requestJson<QcttCatalogView>('/catalogs/qctt');setData(next);setRows(current=>[...next.entries.filter(e=>!changed.includes(e.code)||patches.some(p=>p.id===e.code)).map(e=>({...e,id:e.code})),...current.filter(row=>changed.includes(row.id)&&!patches.some(p=>p.id===row.id))]);setChanged(current=>current.filter(id=>!patches.some(p=>p.id===id)));setNotice(`Đã lưu ${patches.length} mục.`);return{};}catch(e){return Object.fromEntries(patches.map(p=>[p.id,message(e)]));}};
  const action=async(action:'TRASH'|'RESTORE'|'PURGE',ids:string[])=>{
    if(!ids.length)return;if(changed.length){setError('Lưu hoặc hủy các chỉnh sửa trước khi thao tác Thùng rác.');return;}
    if(action==='PURGE'&&!window.confirm(`Xóa vĩnh viễn ${ids.length} mục? Hệ thống sẽ kiểm tra tham chiếu và giữ mã cùng lịch sử.`))return;
    setBusy(true);setError('');try{await requestJson('/catalogs/qctt/commands',{method:'POST',body:JSON.stringify({action,idempotencyKey:crypto.randomUUID(),items:ids.map(id=>{const row=rows.find(r=>r.id===id)!;return{code:row.code,expectedVersion:row.recordVersion};})})});await load();setNotice(action==='TRASH'?'Đã chuyển vào Thùng rác.':action==='RESTORE'?'Đã khôi phục.':'Đã xóa vĩnh viễn.');}catch(e){setError(message(e));}finally{setBusy(false);}
  };
  const show=async(row:Row,what:'usage'|'history')=>{try{const value=await requestJson(`/catalogs/qctt/${encodeURIComponent(row.code)}/${what}`);setDetails({title:`${what==='usage'?'Đang sử dụng':'Lịch sử'} · ${row.code} · ${row.name}`,what,value});}catch(e){setError(message(e));}};
  const choices=(k:QcttCatalogKind)=>[{value:'',label:'Chưa chọn'},...rows.filter(e=>e.kind===k&&!e.deletedAt&&e.status==='ACTIVE').map(e=>({value:e.code,label:e.name}))];
  const columns:SupplyGridColumn[]=[{key:'code',label:'Mã',width:160,render:r=>String(r.code||'Cấp khi lưu')},{key:'name',label:QCTT_CATALOG_LABELS[kind],editable:true,width:300},
    ...(kind==='ACTIVITY'?[{key:'layerCode',label:'Lớp nghiệp vụ',editable:true,options:choices('LAYER'),width:190},{key:'channelCode',label:'Kênh',editable:true,options:choices('CHANNEL'),width:230},
      {key:'ownerOrgId',label:'CQĐV phụ trách',editable:true,options:[{value:'',label:'Chưa liên kết danh bạ'},...(data?.organizations??[]).map(o=>({value:o.id,label:o.name}))],width:220},
      {key:'ownerOrgName',label:'Tên CQĐV nguồn',editable:true,width:180},{key:'supplyType',label:'Loại media',editable:true,options:[{value:'PAID',label:'Paid Media'},{value:'INTERNAL',label:'Owned Media'}],width:150}]:[]),
    ...(kind==='TOPIC'?[{key:'parentCode',label:'Trụ cột QCTT',editable:true,options:choices('PILLAR'),width:290}]:[]),
    ...(kind==='PILLAR'||kind==='TOPIC'?[{key:'year',label:'Năm áp dụng',editable:true,type:'number' as const,width:140}]:[]),
    {key:'status',label:'Tình trạng',editable:true,options:[{value:'ACTIVE',label:'Đang sử dụng'},{value:'INACTIVE',label:'Ngừng sử dụng'},{value:'DRAFT',label:'Chờ rà soát'}],width:180},
    {key:'effectiveFrom',label:'Hiệu lực từ',editable:true,type:'date',width:150},{key:'effectiveTo',label:'Hiệu lực đến',editable:true,type:'date',width:150},
    {key:'sortOrder',label:'Thứ tự',editable:true,type:'number',width:120},
    {key:'source',label:'Nguồn',width:240,render:r=>{const source=r.source as Row['source'];return <span>{source.origin==='GOOGLE_SHEET'?'Google Sheets':source.origin==='CPMS'?'Nhập tại CPMS':'Dữ liệu kế thừa'}{source.needsConfirmation===true&&<span className="ml-2 text-amber-700">Cần xác nhận</span>}</span>;}},
  ];
  const chooseKind=(next:QcttCatalogKind)=>{if(changed.length&&!window.confirm('Bỏ chỉnh sửa chưa lưu?'))return;setKind(next);setRows(data?.entries.map(e=>({...e,id:e.code}))??[]);setChanged([]);setSelected([]);setDetails(null);};
  const readImport=async(file:File|undefined)=>{setImportBody(null);setPreview(null);if(!file)return;setError('');try{if(file.size>2_000_000)throw Error('Tệp nhập vượt quá 2 MB.');const source=JSON.parse(await file.text()) as Record<string,unknown>;
    const body={...source,expectedVersion:data!.recordVersion,idempotencyKey:crypto.randomUUID(),items:(source.items as {code:string;[key:string]:unknown}[]).map(item=>({...item,expectedVersion:rows.find(r=>r.code===item.code)?.recordVersion??0}))};
    const p=await requestJson<NonNullable<typeof preview>>('/catalogs/qctt/import/preview',{method:'POST',body:JSON.stringify(body)});setImportBody(body);setPreview(p);
  }catch(e){setError(message(e));}};
  if(!data)return <div>{error?<p role="alert">{error}</p>:<LoadingBlock label="Đang tải danh mục QCTT…"/>}</div>;
  return <div className="space-y-4"><div><h1 className="text-2xl font-semibold">Danh mục QCTT</h1><p className="mt-1 text-sm text-slate-500">Dữ liệu dùng chung cho Chiến dịch, Kế hoạch QCTT, slot mua ngoài và kênh sở hữu.</p></div>
    <div role="tablist" aria-label="Danh mục QCTT" className="flex flex-wrap gap-2">{QCTT_CATALOG_KINDS.map(k=><button key={k} role="tab" aria-selected={kind===k} className={`rounded-xl px-4 py-2 text-sm ${kind===k?'bg-vna-blue text-white':'bg-white text-slate-700'}`} onClick={()=>chooseKind(k)}>{QCTT_CATALOG_LABELS[k]}{k==='ACTIVITY'?' (Activity)':''}</button>)}</div>
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trash} disabled={changed.length>0} onChange={e=>{setTrash(e.target.checked);setSelected([]);}}/>Thùng rác</label><Button size="sm" variant="ghost" disabled={changed.length>0||busy} onClick={()=>void load().catch(e=>setError(message(e)))}>Tải lại</Button>{notice&&<span role="status" className="text-sm text-emerald-700">{notice}</span>}</div>
    {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <Card className="overflow-hidden"><SupplyGrid key={`${kind}:${trash}`} selectionStyle="campaign" rowNumbers spreadsheet rows={rows.filter(r=>r.kind===kind&&Boolean(r.deletedAt)===trash)} columns={columns} storageKey={`cpms:qctt-catalog:v1:${me.account.id}:${kind}`} canEdit={canEdit}
      onRestoreRows={restored=>{setRows(current=>[...restored as Row[],...current.filter(row=>!restored.some(item=>item.id===row.id))]);mark(restored.map(row=>row.id));}} draftRowIds={changed} onCellsChange={edit} {...(data.capabilities.manage&&!trash?{onSave:save}:{})} onDiscard={()=>{setRows(data.entries.map(e=>({...e,id:e.code})));setChanged([]);}}
      onSelectionChange={setSelected} onCreate={canEdit?()=>add():undefined} createLabel={`Thêm ${QCTT_CATALOG_LABELS[kind].toLocaleLowerCase()}`}
      toolbar={()=><>{canEdit&&<><Button size="sm" variant="secondary" onClick={()=>add()}><CpmsIcon name="add"/>Thêm dòng</Button><Button size="sm" variant="ghost" onClick={()=>add(undefined,10)}>Thêm 10 dòng</Button><Button size="sm" variant="ghost" disabled={!selected.length} onClick={()=>edit(selected.map(id=>({id,recordVersion:rows.find(r=>r.id===id)!.recordVersion,fields:{status:'INACTIVE'}})))}>Ngừng sử dụng</Button><Button size="sm" variant="ghost" disabled={!selected.length||changed.length>0} onClick={()=>void action('TRASH',selected)}>Xóa tạm</Button></>}{trash&&data.capabilities.manage&&<Button size="sm" disabled={!selected.length||busy} onClick={()=>void action('RESTORE',selected)}>Khôi phục</Button>}{trash&&data.capabilities.purge&&<Button size="sm" variant="ghost" disabled={!selected.length||busy} onClick={()=>void action('PURGE',selected)}>Xóa vĩnh viễn</Button>}</>}
      contextActions={picked=>{const chosen=picked.map(r=>rows.find(e=>e.id===r.id)!).filter(Boolean);return [
        {label:'Nhân bản dòng',disabled:!canEdit,run:()=>add(chosen)},
        {label:'Bỏ dòng chưa lưu',disabled:!chosen.some(r=>r.isNew),run:()=>{const ids=chosen.filter(r=>r.isNew).map(r=>r.id);setRows(old=>old.filter(r=>!ids.includes(r.id)));setChanged(old=>old.filter(id=>!ids.includes(id)));}},
        {label:trash?'Khôi phục':'Xóa tạm',disabled:!data.capabilities.manage||changed.length>0,run:()=>void action(trash?'RESTORE':'TRASH',chosen.map(r=>r.id))},
        ...(trash?[{label:'Xóa vĩnh viễn',disabled:!data.capabilities.purge,run:()=>void action('PURGE',chosen.map(r=>r.id))}]:[]),
        {label:'Xem nơi đang sử dụng',disabled:chosen.length!==1||!chosen[0]?.code||!data.capabilities.manage,run:()=>void show(chosen[0]!,'usage')},
        {label:'Xem lịch sử',disabled:chosen.length!==1||!chosen[0]?.code,run:()=>void show(chosen[0]!,'history')},
      ];}}/></Card>
    {details&&<Card className="p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{details.title}</h2><Button size="sm" variant="ghost" onClick={()=>setDetails(null)}>Đóng</Button></div><div className="mt-3 max-h-80 overflow-auto text-sm">
      {details.what==='usage'?<>{(details.value as {category:string;count:number}[]).length?(details.value as {category:string;count:number}[]).map(r=><p key={r.category} className="border-b py-2">{r.category}: {r.count} hồ sơ</p>):<p>Chưa có hồ sơ tham chiếu đến mã này.</p>}</>:<>{(details.value as HistoryRow[]).length?(details.value as HistoryRow[]).map(r=><div key={r.version} className="border-b py-3"><p className="font-medium">Phiên bản {r.version} · {r.actorName} · {new Date(r.createdAt).toLocaleString('vi-VN')}</p><p className="text-slate-500">{{'catalog.save':'Lưu chỉnh sửa','catalog.trash':'Xóa tạm','catalog.restore':'Khôi phục','catalog.purge':'Xóa vĩnh viễn','catalog.import':'Nhập quy hoạch','catalog.legacy-import':'Nhập danh mục kênh'}[r.action]??'Cập nhật danh mục'}</p><CatalogChanges before={r.data.before} after={r.data.after} entries={data.entries}/></div>):<p>Chưa có chỉnh sửa sau khi chuyển sang danh mục dùng chung.</p>}</>}
    </div></Card>}
    {data.capabilities.manage&&<Card className="p-4"><details><summary className="cursor-pointer text-sm font-semibold">Nhập quy hoạch Ban TT</summary><p className="my-3 text-sm text-slate-500">Chọn bản dữ liệu đã đối chiếu. Chỉ nhập Phương tiện của Ban TT và lớp/kênh liên quan; bỏ các cột mô tả nguồn.</p><input type="file" accept=".json,application/json" aria-label="Tệp quy hoạch Ban TT" disabled={changed.length>0||busy} onChange={e=>void readImport(e.target.files?.[0])}/>{preview&&<div className="mt-3 space-y-2 text-sm"><p>{preview.activities} Phương tiện · {preview.created} mục mới · {preview.updated} cập nhật · {preview.preserved} mục giữ nguyên.</p><Button disabled={busy||!importBody} onClick={()=>{setBusy(true);void requestJson('/catalogs/qctt/import/apply',{method:'POST',body:JSON.stringify(importBody)}).then(async()=>{setPreview(null);setImportBody(null);await load();setNotice('Đã nhập quy hoạch Ban TT.');}).catch(e=>setError(message(e))).finally(()=>setBusy(false));}}>Áp dụng bản nhập</Button></div>}</details></Card>}
  </div>;
}
function CatalogChanges({before,after,entries}:{before:QcttCatalogEntry|null;after:QcttCatalogEntry|null;entries:QcttCatalogEntry[]}) {
  const labels:Partial<Record<keyof QcttCatalogFields,string>>={name:'Tên',status:'Tình trạng',layerCode:'Lớp nghiệp vụ',channelCode:'Kênh',parentCode:'Trụ cột',ownerOrgName:'CQĐV phụ trách',supplyType:'Loại media',year:'Năm',effectiveFrom:'Hiệu lực từ',effectiveTo:'Hiệu lực đến',sortOrder:'Thứ tự'};
  const value=(row:QcttCatalogEntry|null,key:keyof QcttCatalogFields)=>{const v=row?.[key];if(v===null||v===undefined||v==='')return'—';if(key==='status')return {ACTIVE:'Đang sử dụng',INACTIVE:'Ngừng sử dụng',DRAFT:'Chờ rà soát'}[String(v)]??String(v);if(key==='supplyType')return v==='INTERNAL'?'Owned Media':'Paid Media';if(key.endsWith('Code'))return `${entries.find(e=>e.code===v)?.name??v} (${v})`;return String(v);};
  return <table className="mt-2 w-full text-left text-xs"><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{(Object.keys(labels) as (keyof QcttCatalogFields)[]).filter(k=>before?.[k]!==after?.[k]).map(k=><tr key={k}><td className="py-1">{labels[k]}</td><td>{value(before,k)}</td><td>{value(after,k)}</td></tr>)}</tbody></table>;
}
