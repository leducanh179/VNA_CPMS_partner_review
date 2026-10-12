import { useCallback, useEffect, useState } from 'react';
import { contractValidity, contractValidityLabels, ownedActivityCode, type ChannelMapCatalog, type ContractChangeKind, type ContractManagementWorkspace, type SupplyContractView } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { requestJson } from '../lib/api';
import { contractEditPath, contractNewPath, navigate } from '../lib/router';
import { useAuth } from '../auth-context';
import { SupplyGrid, type SupplyGridColumn } from './supply-grid';
import { ContractLifecycleDialog } from './contract-management';
import type { ContractFormDraftSummary } from '../lib/contract-form-drafts';
import { ownedProfilesOutsideCatalog } from '../lib/owned-catalog-profiles';

type OwnedProfile = SupplyContractView & {capabilities:ContractManagementWorkspace['capabilities'];pendingChange:boolean};
type OwnedChannels = {catalog:ChannelMapCatalog;profiles:OwnedProfile[];canCreate:boolean};
export function OwnedChannelsPanel() {
  const {me}=useAuth();
  const [data,setData]=useState<OwnedChannels|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[trash,setTrash]=useState(false);
  const [drafts,setDrafts]=useState<ContractFormDraftSummary[]>([]),[busy,setBusy]=useState(false),[lifecycle,setLifecycle]=useState<{workspace:ContractManagementWorkspace;kind:ContractChangeKind|'PURGE'}|null>(null);
  const load=useCallback(async()=>{try{setData(await requestJson<OwnedChannels>('/contracts/owned'));setError('');}catch(e){setError(e instanceof Error?e.message:'Không tải được kênh sở hữu.');}},[]);
  const loadDrafts=useCallback(()=>{void requestJson<ContractFormDraftSummary[]>('/contract-form-drafts').then(setDrafts).catch(e=>setError(e instanceof Error?e.message:'Không tải được bản nhập dở.'));},[]);
  useEffect(()=>{void load();const refresh=()=>void load();window.addEventListener('cpms:contracts-changed',refresh);return()=>window.removeEventListener('cpms:contracts-changed',refresh);},[load]);
  useEffect(()=>{if(data?.canCreate)loadDrafts();},[data?.canCreate,loadDrafts]);
  const map=data?.catalog.data;
  const catalogRows=(map?.activities??[]).filter(a=>a.supplyType==='INTERNAL').map(a=>{
    const profile=data?.profiles.find(p=>ownedActivityCode(p)===a.code);
    return {id:a.code,code:profile?.source.activityOrigin==='LOCAL'?profile.code:a.code,name:profile?.name??a.name,description:a.description,layer:map?.layers.find(l=>l.code===a.professionLayer)?.name??a.professionLayer,channel:map?.channels.find(c=>c.code===a.channelCode)?.name??a.channelCode,unit:a.unit,profile,activity:a,status:profile?profile.status==='DRAFT'?'Bản nháp':contractValidityLabels[contractValidity(profile)]:'Chưa thiết lập',manager:profile?.managerName??profile?.managerEmail??'—',leader:profile?.leaderName??'—'};
  });
  const legacyRows=ownedProfilesOutsideCatalog(data?.profiles??[],data?.catalog).map(p=>({id:p.id,code:p.code,name:p.name,description:'',layer:ownedActivityCode(p)?'Danh mục kế thừa / ngừng sử dụng':'Chưa phân loại',channel:'Chưa phân loại',unit:'',profile:p,activity:undefined,status:p.status==='DRAFT'?'Bản nháp':contractValidityLabels[contractValidity(p)],manager:p.managerName??p.managerEmail??'—',leader:p.leaderName??'—'}));
  const rows=[...catalogRows,...legacyRows].filter(r=>Boolean(r.profile?.deletedAt)===trash&&`${r.code} ${r.name} ${r.layer} ${r.channel}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  const open=(id:string)=>{const row=rows.find(r=>r.id===id);if(row?.profile)navigate(`/contracts/${row.profile.id}${trash?'?info=1':''}`);else if(row?.activity&&data?.canCreate)navigate(contractNewPath({owned:true,activityCode:row.activity.code}));};
  const action=async(profile:OwnedProfile,kind:ContractChangeKind|'PURGE')=>{setBusy(true);setError('');try{
    const ws=await requestJson<ContractManagementWorkspace>(`/contracts/${profile.id}/management`);
    setLifecycle({workspace:ws,kind});
  }catch(e){setError(e instanceof Error?e.message:'Không tải được thao tác.');}finally{setBusy(false);}};
  const columns:SupplyGridColumn[]=[
    {key:'code',label:'Mã Phương tiện',width:150},{key:'name',label:'Phương tiện sở hữu',width:350,render:r=><button className="text-left font-medium text-vna-blue hover:underline" onClick={()=>open(String(r.id))}>{String(r.name)}</button>},
    {key:'layer',label:'Lớp nghiệp vụ',width:180},{key:'channel',label:'Kênh',width:220},{key:'status',label:'Trạng thái',width:180},
    {key:'leader',label:'LĐP phụ trách',width:200},{key:'manager',label:'CV phụ trách',width:200},{key:'unit',label:'Đơn vị gợi ý',width:170},
    {key:'action',label:'Quản lý',width:180,render:r=><Button size="sm" variant="secondary" disabled={!r.profile&&!data?.canCreate} onClick={()=>open(String(r.id))}>{r.profile?trash?'Xem / phục hồi':'Mở quản lý':'Thiết lập kênh'}</Button>},
  ];
  return <section className="space-y-4" aria-label="Kênh sở hữu">
    {data?.canCreate&&<div className="flex justify-end"><Button disabled={busy} onClick={()=>navigate(contractNewPath({owned:true}))}><CpmsIcon name="add"/>Tạo hoạt động</Button></div>}
    {!trash&&data?.canCreate&&drafts.filter(d=>d.kind!=='PAID').map(d=><Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-3 text-sm"><span><strong>Bản nháp đang nhập · chỉ bạn nhìn thấy:</strong> {d.title||'Chưa đặt tên hoạt động'}</span><Button size="sm" variant="secondary" onClick={()=>navigate(contractNewPath({owned:true,draftId:d.id,...(d.kind==='OWNED_ACTIVITY'&&d.activityCode?{activityCode:d.activityCode}:{})}))}>Tiếp tục nhập</Button></Card>)}
    <Card className="flex flex-wrap items-end gap-3 p-4"><label className="flex-1 text-sm">Tìm hoạt động<input aria-label="Tìm kênh sở hữu" className="mt-1 block w-full rounded-lg border px-3 py-2" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="p-2 text-sm"><input type="checkbox" checked={trash} onChange={e=>setTrash(e.target.checked)}/> Thùng rác</label><Button variant="secondary" onClick={()=>void load()}>Tải lại</Button></Card>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {!data?<LoadingBlock label="Đang tải kênh sở hữu…"/>:<Card className="overflow-hidden"><SupplyGrid rows={rows} columns={columns} rowNumbers spreadsheet storageKey={`cpms:owned-channels:v1:${me.account.id}`} canEdit={false} onOpen={open} contextActions={selected=>{
      const actions=data.canCreate?[{label:'Tạo hoạt động',disabled:busy,run:()=>navigate(contractNewPath({owned:true}))}]:[];
      if(selected.length!==1)return actions;
      const row=rows.find(r=>r.id===selected[0]!.id),p=row?.profile;
      if(!p)return [...actions,{label:'Thiết lập hoạt động',disabled:busy||!data.canCreate,run:()=>open(String(selected[0]!.id))}];
      const locked=busy||p.pendingChange;
      return [...actions,{label:'Mở hoạt động',disabled:busy,run:()=>open(row!.id)},
        {label:'Thông tin / đề nghị / lịch sử',disabled:busy,run:()=>navigate(`/contracts/${p.id}?info=1`)},
        ...(!trash?[
          {label:'Sửa thông tin',disabled:locked||!p.capabilities.edit,run:()=>navigate(contractEditPath(p.id))},
          {label:['PAUSED','ARCHIVED'].includes(p.status)?'Tiếp tục':'Tạm dừng',disabled:locked||!p.capabilities.edit,run:()=>void action(p,['PAUSED','ARCHIVED'].includes(p.status)?'RESUME':'PAUSE')},
          {label:'Chuyển vào Thùng rác',disabled:locked||!p.capabilities.delete,run:()=>void action(p,'DELETE')},
        ]:[
          {label:'Phục hồi hoạt động',disabled:locked||!p.capabilities.restore,run:()=>void action(p,'RESTORE')},
          {label:'Xóa vĩnh viễn…',disabled:locked||!p.capabilities.purge,run:()=>void action(p,'PURGE')},
        ])];
    }}/><p className="border-t p-3 text-sm text-slate-500">{rows.length} hoạt động{!trash&&' · Thiết lập thời hạn, người phụ trách và hạn mức hạng mục để dùng cho đặt chỗ.'}</p></Card>}
    {data&&!map&&<p className="text-sm text-amber-800">Danh mục phân loại kênh chưa được nhập.</p>}
    {lifecycle&&<ContractLifecycleDialog workspace={lifecycle.workspace} kind={lifecycle.kind} onClose={()=>setLifecycle(null)} onSaved={()=>{setLifecycle(null);void load();}}/>}
  </section>;
}
