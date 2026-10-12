import { ContractPeriodEditor } from './contract-period-editor';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isOwnedChannel, defaultProfessionLayer, formatSupplyPeriod, isContractLifetimePeriod, type SupplyContractWorkspace, type SupplyPeriodView, type ChannelMapCatalog, type ChannelActivity, contractValidity, contractValidityLabels, SUPPLY_CLASS_OPTIONS, type ContractChangeKind, type ContractChangeRequest, type ContractManagementPolicy, type ContractManagementWorkspace, type ContractRevision, type SupplyContractView } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock, StatusBadge } from '@cpms/ui';
import { requestJson } from '../lib/api';
import { useAuth } from '../auth-context';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { AppLink, contractEditPath, navigate } from '../lib/router';
import { contractChangeLabels, contractEditableKeys, contractFieldLabels, contractFieldValue, contractGross, contractHeaderChanged, contractPatch, contractRequestLabels, contractsChanged } from '../lib/contract-management';
import { formatSupply, type SupplyGridPatch } from './supply-grid';
import { SupplierPicker, SupplierFacts } from './supplier-editor';
import { ContractItemsPanel, ContractItemChangesReview } from './contract-items-panel';
import type { ContractItemChanges, SupplierView } from '@cpms/domain';
import type { ContractFormDraft, ContractFormDraftValue } from '../lib/contract-form-drafts';
import { registerPendingNavigationGuard } from '../lib/router';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50';
const message = (e: unknown) => e instanceof Error ? e.message : 'Không thể thực hiện thao tác.';
type Person = ContractManagementWorkspace['people'][number];
type SaveMode = 'DRAFT'|'SUBMIT'|'SELF_APPROVE';
export function ContractDialog({ title, children, onClose, busy = false }: { title:string;children:ReactNode;onClose:()=>void;busy?:boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; box.current?.focus(); return () => previous?.focus(); }, []);
  return createPortal(<div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 sm:p-8" onKeyDown={e => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') { const nodes = box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]'); if (!nodes?.length) return; const first=nodes[0]!,last=nodes[nodes.length-1]!; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} }
  }}><div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-5xl rounded-2xl bg-white p-5 shadow-xl outline-none"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><Button variant="ghost" disabled={busy} onClick={onClose} aria-label="Đóng cửa sổ hợp đồng">Đóng</Button></div>{children}</div></div>,document.body);
}
function Failure({error}:{error:string}) { return error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null; }
function ReasonFields({reason,evidence,onReason,onEvidence,disabled}:{reason:string;evidence:string;onReason:(s:string)=>void;onEvidence:(s:string)=>void;disabled:boolean}) {
  return <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Lý do<textarea aria-label="Lý do thay đổi hợp đồng" className={inputClass} value={reason} onChange={e=>onReason(e.target.value)} disabled={disabled} maxLength={4000}/></label><label className="text-sm">Căn cứ / liên kết tài liệu<textarea aria-label="Căn cứ thay đổi hợp đồng" className={inputClass} value={evidence} onChange={e=>onEvidence(e.target.value)} disabled={disabled} maxLength={4000}/></label></div>;
}
function SaveButtons({busy,saveDisabled=false,required,self,onSave,onCancel,cancelLabel='Hủy'}:{busy:boolean;saveDisabled?:boolean;required:boolean;self:boolean;onSave:(mode:SaveMode)=>void;onCancel:()=>void;cancelLabel?:string}) {
  return <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}><CpmsIcon name="back"/>{cancelLabel}</Button><Button variant="secondary" disabled={busy||saveDisabled} onClick={()=>onSave('DRAFT')}>Lưu nháp</Button><Button disabled={busy||saveDisabled} onClick={()=>onSave('SUBMIT')}><CpmsIcon name="save"/>{required?'Lưu và gửi duyệt':'Lưu thay đổi'}</Button>{self&&required&&<Button variant="secondary" disabled={busy||saveDisabled} onClick={()=>onSave('SELF_APPROVE')}>Lưu và tự duyệt</Button>}</div>;
}
function ContractFormSection({id,title,description,icon,children}:{id:string;title:string;description:string;icon:Parameters<typeof CpmsIcon>[0]['name'];children:ReactNode}){
  return <Card id={id} className="scroll-mt-4 overflow-hidden"><div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name={icon}/></span><div><h3 className="font-semibold text-slate-950">{title}</h3><p className="mt-1 text-xs text-slate-500">{description}</p></div></div><div className="space-y-4 p-4">{children}</div></Card>;
}
function ContractFormDock({children}:{children:ReactNode}){
  const dock=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=dock.current;if(!element)return;
    const banner=document.querySelector<HTMLElement>('[data-cpms-session-banner]'),root=document.documentElement,previous=root.style.scrollPaddingTop;
    const update=()=>{const offset=banner?.getBoundingClientRect().height??0;element.style.top=`${offset}px`;root.style.scrollPaddingTop=`${offset+element.getBoundingClientRect().height+16}px`;};
    const observer=new ResizeObserver(update);observer.observe(element);if(banner)observer.observe(banner);update();
    return()=>{observer.disconnect();root.style.scrollPaddingTop=previous;};
  },[]);
  return <div ref={dock} className="sticky top-0 z-30 rounded-2xl bg-slate-50/95 pb-2 backdrop-blur">{children}</div>;
}
function ContractFormFrame({title,children}:{title:string;children:ReactNode}){
  return <div className="mx-auto max-w-[1500px] space-y-4"><header className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Kênh &amp; Hợp đồng</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1></header>{children}</div>;
}
export function ContractEditor({workspace,request,ownedActivity,newOwned=false,draftId:resumeDraftId,onDraftChanged,onClose,onSaved,returnLabel='Quay lại'}:{newOwned?:boolean;ownedActivity?:ChannelActivity;workspace?:ContractManagementWorkspace;request?:ContractChangeRequest;draftId?:string|undefined;onDraftChanged?:()=>void;onClose:()=>void;onSaved:(id:string,mode:SaveMode)=>void;returnLabel?:string}) {
  const {me}=useAuth(),c=workspace?.contract,owned=Boolean(newOwned||ownedActivity||c&&isOwnedChannel(c));
  const fieldLabel=(k:string)=>owned?({name:'Tên hoạt động sở hữu',vendorActorId:'Đầu mối triển khai',signedAmount:'Ngân sách trước VAT',signedVat:'Thuế VAT',signedGross:'Ngân sách sau VAT'}[k]??contractFieldLabels[k]):contractFieldLabels[k];
  const [ownedCatalog,setOwnedCatalog]=useState<ChannelMapCatalog|null>(null),[ownedLayer,setOwnedLayer]=useState(()=>defaultProfessionLayer(me.account.profile?.departmentName)??''),[ownedChannel,setOwnedChannel]=useState('');
  useEffect(()=>{if(newOwned)void requestJson<ChannelMapCatalog>('/contracts/channel-map').then(setOwnedCatalog).catch(e=>setError(message(e)));},[newOwned]);
  const [people,setPeople]=useState<Person[]>(workspace?.people??[]),[policy,setPolicy]=useState<ContractManagementPolicy|undefined>(workspace?.policy);
  const [fields,setFields]=useState<Record<string,string>>(()=>Object.fromEntries(contractEditableKeys.map(k=>{
    const value=request&&Object.prototype.hasOwnProperty.call(request.fields,k)?request.fields[k]:c?c[k]:k==='managerActorId'?me.account.id:k==='currency'?'VND':k==='supplyType'?(owned?'INTERNAL':'PAID'):k==='serviceRecipient'?'VNA':k==='marketScope'?'UNSPECIFIED':owned&&k==='name'?ownedActivity?.name??'':owned&&k.startsWith('signed')?'0':'';
    return [k,String(value??'')];
  })));
  const [marketCodes,setMarketCodes]=useState<string[]>(()=>Array.isArray(request?.fields.marketCodes)?request.fields.marketCodes as string[]:c?.marketCodes??[]);
  const [markets,setMarkets]=useState<Array<{code:string;name?:string;regionCode?:string}>>([]),[marketSearch,setMarketSearch]=useState('');
  useEffect(()=>{void requestJson<{markets:Array<{code:string;name?:string;regionCode?:string}>}>('/contracts/catalogs').then(v=>setMarkets(v.markets)).catch(e=>setError(message(e)));},[]);
  const [formPeriods,setFormPeriods]=useState<SupplyPeriodView[]>([]),[selectedPeriodId,setSelectedPeriodId]=useState(''),[itemPhase,setItemPhase]=useState<'BASELINE'|'EFFECTIVE'>('EFFECTIVE'),[itemDirty,setItemDirty]=useState(false),[periodEditor,setPeriodEditor]=useState(false);
  useEffect(()=>{if(!c)return;void requestJson<SupplyContractWorkspace>(`/contracts/${c.id}/workspace?period=ALL&phase=EFFECTIVE`).then(v=>setFormPeriods(v.periods.filter(p=>!isContractLifetimePeriod(p)))).catch(e=>setError(message(e)));},[c?.id]);
  const [supplierId,setSupplierId]=useState(String(request?.fields.supplierId??c?.supplierId??'')),[supplierSelected,setSupplierSelected]=useState(Boolean(request?.fields.supplierId));
  const [code,setCode]=useState(''),[vendorCode,setVendorCode]=useState(owned?'VNA':''),[reason,setReason]=useState(request?.reason??''),[evidence,setEvidence]=useState(request?.evidence??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const key=useRef(crypto.randomUUID());
  const formDraftId=useRef(resumeDraftId??crypto.randomUUID()),draftVersion=useRef(0),draftExists=useRef(false),saveQueue=useRef<Promise<void>>(Promise.resolve()),finishing=useRef(false),completed=useRef(false);
  const [draftReady,setDraftReady]=useState(!resumeDraftId),[draftSaving,setDraftSaving]=useState(false),[touched,setTouched]=useState(false),[closing,setClosing]=useState(false);
  const draftKind:ContractFormDraftValue['kind']=newOwned?'OWNED_NEW':ownedActivity?'OWNED_ACTIVITY':'PAID';
  const draftValue:ContractFormDraftValue={kind:draftKind,...(ownedActivity?{activityCode:ownedActivity.code}:{}),fields,marketCodes,supplierId,supplierSelected,code,vendorCode,ownedLayer,ownedChannel,reason,evidence};
  const draftSnapshot=JSON.stringify(draftValue),latestDraftSnapshot=useRef(draftSnapshot),savedDraftSnapshot=useRef(draftSnapshot);
  latestDraftSnapshot.current=draftSnapshot;
  const headerChanged=Boolean(c&&contractHeaderChanged(c,fields,marketCodes,supplierId));
  const reviewChanged=Boolean(c&&(reason!==(request?.reason??'')||evidence!==(request?.evidence??'')));
  useUnsavedChanges(itemDirty||headerChanged||reviewChanged||!c&&touched);
  useEffect(()=>{if(!resumeDraftId||c)return;let active=true;
    void requestJson<ContractFormDraft>(`/contract-form-drafts/${encodeURIComponent(resumeDraftId)}`).then(row=>{
      if(!active)return;
      const value=row.formData;
      if(value.kind!==draftKind||value.activityCode!==(ownedActivity?.code))throw Error('Bản nhập dở không thuộc loại hợp đồng hoặc hoạt động đang mở.');
      draftVersion.current=row.recordVersion;draftExists.current=true;
      const resumedFields={...value.fields,serviceRecipient:value.fields.serviceRecipient??'VNA',marketScope:value.fields.marketScope??'UNSPECIFIED'};
      savedDraftSnapshot.current=JSON.stringify({kind:value.kind,...(value.activityCode?{activityCode:value.activityCode}:{}),fields:resumedFields,marketCodes:value.marketCodes??[],supplierId:value.supplierId,supplierSelected:value.supplierSelected,code:value.code,vendorCode:value.vendorCode,ownedLayer:value.ownedLayer,ownedChannel:value.ownedChannel,reason:value.reason,evidence:value.evidence});
      setFields(resumedFields);setMarketCodes(value.marketCodes??[]);setSupplierId(value.supplierId);setSupplierSelected(value.supplierSelected);setCode(value.code);setVendorCode(value.vendorCode);setOwnedLayer(value.ownedLayer);setOwnedChannel(value.ownedChannel);setReason(value.reason);setEvidence(value.evidence);setDraftReady(true);
    }).catch(e=>{if(active)setError(message(e));});
    return()=>{active=false;};
  },[resumeDraftId,c,draftKind,ownedActivity?.code]);
  useEffect(()=>{if(!c&&draftReady)setTouched(draftSnapshot!==savedDraftSnapshot.current);},[c,draftReady,draftSnapshot]);
  const saveDraft=(snapshot:string):Promise<void>=>{
    if(c||finishing.current||!draftReady)return Promise.resolve();
    setDraftSaving(true);
    const next=saveQueue.current.catch(()=>undefined).then(async()=>{
      if(snapshot===savedDraftSnapshot.current)return;
      const row=await requestJson<ContractFormDraft>(`/contract-form-drafts/${formDraftId.current}`,{method:'PUT',body:JSON.stringify({expectedVersion:draftVersion.current,value:JSON.parse(snapshot) as ContractFormDraftValue})});
      draftVersion.current=row.recordVersion;draftExists.current=true;savedDraftSnapshot.current=snapshot;
      if(latestDraftSnapshot.current===snapshot)setTouched(false);
      onDraftChanged?.();
    });
    saveQueue.current=next;
    void next.finally(()=>setDraftSaving(false)).catch(()=>undefined);
    return next;
  };
  useEffect(()=>{if(c||!draftReady||!touched||busy||finishing.current)return;
    const timer=window.setTimeout(()=>{void saveDraft(draftSnapshot).catch(e=>setError(message(e)));},1200);
    return()=>window.clearTimeout(timer);
  },[c,draftReady,touched,busy,draftSnapshot]);
  useEffect(()=>{if(c)return;return registerPendingNavigationGuard(async()=>{
    if(completed.current)return true;
    if(finishing.current||!draftReady)return false;
    try{if(touched)await saveDraft(latestDraftSnapshot.current);else await saveQueue.current;return true;}
    catch(e){setError(message(e));return false;}
  });},[c,touched,draftReady]);
  const closeForm=async()=>{
    if(c){if((itemDirty||headerChanged||reviewChanged)&&!window.confirm('Các thay đổi chưa được lưu. Rời form và bỏ các thay đổi này?'))return;onClose();return;}
    setClosing(true);setError('');
    try{if(touched)await saveDraft(latestDraftSnapshot.current);else await saveQueue.current;onClose();}
    catch(e){setError(message(e));}
    finally{setClosing(false);}
  };
  const discardDraft=async()=>{
    if(!window.confirm('Bỏ bản nhập dở này? Nội dung chưa tạo thành hợp đồng hoặc hoạt động sẽ không thể khôi phục.'))return;
    finishing.current=true;setClosing(true);setError('');
    try{await saveQueue.current.catch(()=>undefined);if(draftExists.current)await requestJson(`/contract-form-drafts/${formDraftId.current}`,{method:'DELETE'});onDraftChanged?.();onClose();}
    catch(e){setError(message(e));}
    finally{finishing.current=false;setClosing(false);}
  };
  useEffect(()=>{if(!workspace)void requestJson<{people:Person[];policy:ContractManagementPolicy}>('/contracts/management/catalogs').then(v=>{setPeople(v.people);setPolicy(v.policy);}).catch(e=>setError(message(e)));},[workspace]);
  const update=(k:string,v:string)=>{setFields(old=>({...old,[k]:v}));key.current=crypto.randomUUID();};
  const submit=async(mode:SaveMode)=>{setBusy(true);setError('');finishing.current=true;try{
    await saveQueue.current.catch(()=>undefined);
    const common={fields:{...contractPatch(fields),marketCodes:fields.marketScope==='SELECTED'?marketCodes:[],...(supplierSelected?{supplierId}: {})},mode,reason,evidence:evidence||null,idempotencyKey:key.current};
    const body=c?{...common,kind:'EDIT',expectedVersion:c.recordVersion,...(request?{requestId:request.id,expectedRequestVersion:request.recordVersion}:{})}:{...common,vendorCode,...(newOwned?{newOwnedActivity:{professionLayer:ownedLayer,channelCode:ownedChannel}}:{}),...(ownedActivity?{ownedActivityCode:ownedActivity.code}:{}),...(code.trim()?{code:code.trim()}:{} )};
    const result=await requestJson<{contractId:string}>(c?`/contracts/${c.id}/changes`:'/contracts',{method:'POST',body:JSON.stringify(body)});
    if(!c&&draftExists.current){try{await requestJson(`/contract-form-drafts/${formDraftId.current}`,{method:'DELETE'});draftExists.current=false;onDraftChanged?.();}catch{window.alert('Hồ sơ đã tạo nhưng chưa dọn được bản nhập dở. Vui lòng xóa bản nháp còn lại trong danh sách.');}}
    completed.current=true;contractsChanged();onSaved(result.contractId,mode);
  }catch(e){setError(message(e));}finally{setBusy(false);finishing.current=false;}};
  const renderField=(k:string)=><label key={k} className={`text-sm ${k==='name'?'md:col-span-2':''}`}>{fieldLabel(k)}{k==='supplyType'?<select aria-label="Phân loại" className={inputClass} value={fields[k]} disabled={busy||itemDirty} onChange={e=>update(k,e.target.value)}>{SUPPLY_CLASS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:k.endsWith('ActorId')?<select aria-label={fieldLabel(k)} className={inputClass} value={fields[k]??''} disabled={busy||itemDirty} onChange={e=>update(k,e.target.value)}><option value="">Chưa phân công</option>{people.map(p=><option key={p.id} value={p.id}>{k==='vendorActorId'?`${p.email??p.name} · ${p.name}`:p.name}</option>)}</select>:<input aria-label={fieldLabel(k)} type={k.endsWith('Date')?'date':k==='dossierUrl'?'url':'text'} inputMode={k.startsWith('signed')?'decimal':undefined} className={inputClass} value={fields[k]??''} disabled={busy||itemDirty||k==='vendor'&&!!supplierId} onChange={e=>update(k,e.target.value)} placeholder={k.startsWith('signed')?'Số không có dấu phân cách, VD: 1000000.50':undefined}/>}</label>;
  const sections=[['contract-form-profile','Hồ sơ'],['contract-form-parties','Các bên'],['contract-form-scope','Hiệu lực & thị trường'],['contract-form-contacts','Đầu mối'],['contract-form-value','Giá trị'],['contract-form-items','Kỳ & hạng mục']];
   if(!draftReady)return <ContractFormFrame title={owned?'Tiếp tục nhập hoạt động':'Tiếp tục nhập hợp đồng'}><Failure error={error}/>{!error&&<LoadingBlock label="Đang mở bản nhập dở…"/>}</ContractFormFrame>;
   return <ContractFormFrame title={owned?(c?'Sửa thông tin hoạt động':newOwned?'Tạo hoạt động':'Thiết lập kênh sở hữu'):c?'Sửa thông tin hợp đồng':'Tạo hợp đồng'}><div className="space-y-4"><Failure error={error}/>
    {!c&&<p role="status" className="text-sm text-slate-600">{draftSaving||closing?'Đang lưu bản nhập dở…':touched?'Đang chờ tự lưu…':draftExists.current?'Đã lưu bản nhập dở · chỉ bạn nhìn thấy':'Nội dung sẽ tự lưu khi nhập và chỉ bạn nhìn thấy.'}</p>}
     <ContractFormDock><Card className="flex flex-wrap items-center justify-between gap-3 border-slate-200 px-4 py-3 shadow-sm"><div className="flex items-center gap-2 text-sm text-slate-600"><CpmsIcon name={headerChanged||itemDirty||reviewChanged?'warning':'contract'} size={18}/>{headerChanged||itemDirty||reviewChanged?'Có thay đổi chưa lưu':c?'Đang sửa hồ sơ đã lưu':'Bản nhập dở chỉ bạn nhìn thấy'}</div><div className="flex flex-wrap items-center gap-2"><SaveButtons busy={busy||closing||draftSaving} saveDisabled={itemDirty||!policy||!draftReady||newOwned&&(!ownedCatalog?.data||!ownedLayer||!ownedChannel)} required={request?.approvalRequired===true||policy?.required!==false} self={me.directSuperadmin||Boolean(c?.leaderActorId===me.account.id)} onSave={mode=>void submit(mode)} onCancel={()=>void closeForm()} cancelLabel={returnLabel}/>{!c&&(draftExists.current||touched)&&<Button variant="ghost" disabled={busy||closing||draftSaving} onClick={()=>void discardDraft()}>Bỏ bản nhập dở</Button>}</div></Card></ContractFormDock>
     <nav aria-label="Các phần của hồ sơ" className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"><span className="mr-1 text-xs font-semibold text-slate-500">Chuyển đến</span>{sections.map(([id,label])=><button key={id} type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-vna-blue hover:bg-cyan-50" onClick={()=>document.getElementById(id!)?.scrollIntoView({behavior:'smooth',block:'start'})}>{label}</button>)}</nav>
    <ContractFormSection id="contract-form-profile" title={owned?'Hồ sơ hoạt động sở hữu':'Hồ sơ và phân loại hợp đồng'} description="Thông tin nhận diện; mã hồ sơ được khóa sau lần tạo chính thức." icon="contract">
      {!c?<div className="grid gap-3 md:grid-cols-2">{!owned&&<label className="text-sm">Mã nhà cung cấp<input className={inputClass} value={vendorCode} onChange={e=>{setVendorCode(e.target.value.toUpperCase());key.current=crypto.randomUUID();}} placeholder="VD: FPT" maxLength={20}/></label>}<label className="text-sm">{owned?'Mã hồ sơ':'Mã hợp đồng'} (để trống để tự tạo)<input className={inputClass} value={code} onChange={e=>{setCode(e.target.value.toUpperCase());key.current=crypto.randomUUID();}} placeholder={owned?'CON-VNA-202609-AB1234':'CON-FPT-202506-VNEX25'} maxLength={50}/></label></div>:<p className="text-sm"><strong>{c.code}</strong> · Mã không được sửa.</p>}
      <div className="grid gap-4 md:grid-cols-2">{renderField('name')}{!owned&&renderField('supplyType')}{!owned&&renderField('number')}{!owned&&renderField('dossierUrl')}</div>
      {newOwned&&<div className="grid gap-4 md:grid-cols-2"><label className="text-sm">Lớp nghiệp vụ<select aria-label="Lớp nghiệp vụ của hoạt động" className={inputClass} value={ownedLayer} disabled={busy} onChange={e=>{setOwnedLayer(e.target.value);setOwnedChannel('');key.current=crypto.randomUUID();}}><option value="">Chọn lớp nghiệp vụ</option>{ownedCatalog?.data?.layers.map(l=><option key={l.code} value={l.code}>{l.name}</option>)}</select></label><label className="text-sm">Kênh<select aria-label="Kênh của hoạt động" className={inputClass} value={ownedChannel} disabled={busy||!ownedLayer} onChange={e=>{setOwnedChannel(e.target.value);key.current=crypto.randomUUID();}}><option value="">Chọn kênh</option>{ownedCatalog?.data?.channels.map(ch=><option key={ch.code} value={ch.code}>{ch.name}</option>)}</select></label></div>}
      {ownedActivity&&<p className="text-sm text-slate-600">Phương tiện danh mục: <strong>{ownedActivity.name}</strong></p>}
    </ContractFormSection>
    <ContractFormSection id="contract-form-parties" title={owned?'Đơn vị hưởng và vận hành':'Thông tin các bên'} description={owned?'Hoạt động sở hữu không cần hồ sơ nhà cung cấp.':'Chọn nhà cung cấp từ Danh bạ; tên và mã số thuế trùng sẽ được cảnh báo và chặn khi tạo mới.'} icon="users">
      {!owned&&<><SupplierPicker value={supplierId} disabled={busy||itemDirty} onSelect={s=>{setSupplierId(s.id);setSupplierSelected(true);update('vendor',s.name);if(!c)setVendorCode(s.code);}}/>{!supplierId&&renderField('vendor')}</>}
      <div className="grid gap-4 md:grid-cols-2">{renderField('serviceRecipient')}</div>
      <p className="text-xs text-slate-500">Bên hưởng dịch vụ là bên nhận dịch vụ theo hồ sơ này; hạn mức CQĐV được phân bổ riêng ở từng kỳ và hạng mục.</p>
    </ContractFormSection>
    <ContractFormSection id="contract-form-scope" title="Hiệu lực và thị trường áp dụng" description="Thời hạn hồ sơ và phạm vi cung ứng; kỳ phân bổ sẽ nằm trong thời hạn này." icon="filter">
      <div className="grid gap-4 md:grid-cols-2">{renderField('startDate')}{renderField('endDate')}</div>
      <label className="block text-sm">Phạm vi thị trường<select aria-label="Phạm vi thị trường hợp đồng" className={inputClass} value={fields.marketScope??'UNSPECIFIED'} disabled={busy||itemDirty} onChange={e=>{update('marketScope',e.target.value);setMarketCodes([]);}}><option value="UNSPECIFIED">Chưa xác định</option><option value="ALL">Toàn bộ thị trường</option><option value="SELECTED">Chọn thị trường cụ thể</option></select></label>
      {fields.marketScope==='SELECTED'&&<div className="space-y-2 rounded-xl border p-3"><label className="text-sm">Tìm thị trường<input aria-label="Tìm thị trường áp dụng" className={inputClass} value={marketSearch} onChange={e=>setMarketSearch(e.target.value)} placeholder="Tên hoặc mã thị trường…"/></label><div className="max-h-48 overflow-auto rounded-lg border">{markets.filter(m=>`${m.code} ${m.name??''} ${m.regionCode??''}`.toLocaleLowerCase('vi').includes(marketSearch.toLocaleLowerCase('vi'))).map(m=><label key={m.code} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"><input type="checkbox" disabled={busy||itemDirty} checked={marketCodes.includes(m.code)} onChange={e=>{setMarketCodes(current=>e.target.checked?[...new Set([...current,m.code])]:current.filter(code=>code!==m.code));key.current=crypto.randomUUID();}}/>{m.name??m.code} <span className="text-xs text-slate-500">{m.code}</span></label>)}</div><p className="text-xs text-slate-500">Đã chọn {marketCodes.length} thị trường{marketCodes.filter(code=>!markets.some(m=>m.code===code)).length?` · ${marketCodes.filter(code=>!markets.some(m=>m.code===code)).join(', ')} hiện ngoài danh mục`:''}.</p></div>}
    </ContractFormSection>
    <ContractFormSection id="contract-form-contacts" title="Đầu mối quản lý và triển khai" description="Chọn nhân sự từ Danh bạ; phòng và ban phụ trách lấy theo LĐP." icon="users">
      <div className="grid gap-4 md:grid-cols-2">{renderField('leaderActorId')}{renderField('managerActorId')}{renderField('vendorActorId')}</div>
      {c?.responsibilitySnapshot&&c.leaderActorId===fields.leaderActorId&&<p className="text-xs text-slate-600">Phòng: {c.responsibilitySnapshot.departmentName??'—'} · Ban: {c.responsibilitySnapshot.organizationName??'—'}</p>}
    </ContractFormSection>
    <ContractFormSection id="contract-form-value" title={owned?'Ngân sách hoạt động':'Giá trị hợp đồng'} description="Tổng sau VAT được hệ thống tính; giá trị hạng mục theo kỳ được theo dõi riêng." icon="contract">
      <div className="grid gap-4 md:grid-cols-3">{renderField('signedAmount')}{renderField('signedVat')}{renderField('currency')}</div>
      <p className="rounded-lg bg-slate-50 p-3 text-sm">{owned?'Ngân sách sau VAT':'Tổng giá trị sau VAT'}: <strong>{formatSupply(contractGross(fields.signedAmount,fields.signedVat))} {fields.currency}</strong></p>
    </ContractFormSection>
    <ContractFormSection id="contract-form-items" title="Kỳ phân bổ và hạng mục slot" description="Chọn kỳ và giai đoạn trước khi sửa bảng hạng mục; các thay đổi vẫn theo luồng phê duyệt hợp đồng." icon="slot">
      {!c?<><p className="text-sm text-slate-600">Lưu hồ sơ trước để có mã gắn kỳ phân bổ và từng hạng mục. Sau khi lưu, hệ thống mở tab Thông tin hợp đồng để tiếp tục nhập liệu.</p><Button variant="secondary" disabled={busy||closing||draftSaving||!policy||newOwned&&(!ownedCatalog?.data||!ownedLayer||!ownedChannel)} onClick={()=>void submit('DRAFT')}><CpmsIcon name="save"/>Tạo hồ sơ và tiếp tục nhập kỳ, hạng mục</Button></>:<>
        {headerChanged&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Lưu hoặc hoàn tác thông tin hồ sơ đang sửa trước khi nhập hạng mục, để hai đề nghị không chồng nhau.</p>}
        {workspace?.requests.some(r=>r.state==='PENDING')&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Hồ sơ đang có đề nghị chờ duyệt. Xử lý đề nghị trước khi sửa kỳ hoặc hạng mục.</p>}
        <div className="flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-sm">Kỳ phân bổ<select aria-label="Kỳ phân bổ nhập hạng mục" className={inputClass} disabled={itemDirty||headerChanged} value={selectedPeriodId} onChange={e=>setSelectedPeriodId(e.target.value)}><option value="">Chọn kỳ phân bổ</option>{formPeriods.map(p=><option key={p.id} value={p.id}>{formatSupplyPeriod(p)}</option>)}</select></label><label className="min-w-40 text-sm">Giai đoạn<select aria-label="Giai đoạn nhập hạng mục" className={inputClass} disabled={itemDirty||headerChanged} value={itemPhase} onChange={e=>setItemPhase(e.target.value as 'BASELINE'|'EFFECTIVE')}><option value="BASELINE">Ban đầu</option><option value="EFFECTIVE">Sau điều chỉnh</option></select></label><Button variant="secondary" disabled={headerChanged||itemDirty||workspace?.requests.some(r=>r.state==='PENDING')} onClick={()=>setPeriodEditor(true)}><CpmsIcon name="add"/>Thêm kỳ</Button></div>
         {selectedPeriodId&&!headerChanged&&!workspace?.requests.some(r=>r.state==='PENDING')&&<div className="overflow-x-auto"><ContractItemsPanel key={`${c.id}:${selectedPeriodId}:${itemPhase}`} id={c.id} periodId={selectedPeriodId} phase={itemPhase} onDirty={setItemDirty} onSaved={()=>onSaved(c.id,'DRAFT')}/></div>}
      </>}
    </ContractFormSection>
    <ContractFormSection id="contract-form-review" title="Lý do và căn cứ" description="Ghi bối cảnh khi gửi duyệt hoặc áp dụng thay đổi." icon="pending"><ReasonFields reason={reason} evidence={evidence} onReason={v=>{setReason(v);key.current=crypto.randomUUID();}} onEvidence={v=>{setEvidence(v);key.current=crypto.randomUUID();}} disabled={busy}/></ContractFormSection>
     {periodEditor&&c&&workspace&&<ContractPeriodEditor workspace={workspace} onClose={()=>setPeriodEditor(false)} onSaved={()=>{setPeriodEditor(false);onSaved(c.id,'DRAFT');}}/>}
   </div></ContractFormFrame>;
}
function ContractFacts({c}:{c:SupplyContractView}) {
  const owned=isOwnedChannel(c);
  const labels=owned?{...contractFieldLabels,code:'Mã hồ sơ',name:'Hoạt động sở hữu',vendorActorId:'Đầu mối triển khai',signedAmount:'Ngân sách trước VAT',signedGross:'Ngân sách sau VAT'}:contractFieldLabels;
  const values:Record<string,unknown>={...c,leaderActorId:c.leaderName,managerActorId:c.managerName??c.managerEmail,vendorActorId:c.vendorContactEmail};
  const scan = c.dossierUrl && /^https?:\/\//i.test(c.dossierUrl) ? c.dossierUrl : null;
  return <dl className="grid gap-x-6 gap-y-4 text-sm md:grid-cols-2 xl:grid-cols-3">{['code','name','number','vendor',...contractEditableKeys.filter(k=>!['name','number','vendor','dossierUrl'].includes(k)),'marketCodes','signedGross'].filter(k=>!owned||!['number','vendor'].includes(k)).map(k=><div key={k}><dt className="text-xs text-slate-500">{labels[k]}</dt><dd className="mt-1 break-words font-medium">{k.endsWith('ActorId')?String(values[k]??'—'):contractFieldValue(k,values[k])}</dd></div>)}<div><dt className="text-xs text-slate-500">Trạng thái theo ngày hiện tại</dt><dd className="mt-1">{contractValidityLabels[contractValidity(c)]}</dd></div><div><dt className="text-xs text-slate-500">Phòng phụ trách</dt><dd>{c.responsibilitySnapshot?.departmentName??'—'}</dd></div><div><dt className="text-xs text-slate-500">Ban phụ trách</dt><dd>{c.responsibilitySnapshot?.organizationName??'—'}</dd></div>{!owned&&<div className="md:col-span-2"><dt className="text-xs text-slate-500">Bản scan hợp đồng</dt><dd className="mt-1">{scan?<a href={scan} target="_blank" rel="noreferrer" className="text-vna-blue underline">Xem bản scan hợp đồng</a>:'Chưa có liên kết'}</dd></div>}</dl>;
}
export function ContractChangeReview({c,fields,people}:{c:SupplyContractView;fields:Record<string,unknown>;people:Person[]}) {
  const changes=Object.entries(fields).filter(([k,v])=>k!=='itemChanges'&&k!=='newPeriod'&&k!=='supplierId'&&k!=='supplierSnapshot'&&k!=='responsibilitySnapshot'&&JSON.stringify(c[k as keyof SupplyContractView])!==JSON.stringify(v));
  return <div className="overflow-auto">{fields.supplierSnapshot?<details open className="mb-3 rounded-lg border p-3"><summary>Thông tin nhà cung cấp đề nghị</summary><SupplierFacts supplier={fields.supplierSnapshot as SupplierView}/></details>:null}{Boolean(fields.newPeriod)&&<p className="rounded-lg border p-3 text-sm">Thêm kỳ: {String((fields.newPeriod as Record<string,string>).name)} · {String((fields.newPeriod as Record<string,string>).startDate)} đến {String((fields.newPeriod as Record<string,string>).endDate)}</p>}{fields.itemChanges?<ContractItemChangesReview id={c.id} changes={fields.itemChanges as ContractItemChanges} people={people}/>:null}<table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="bg-slate-50"><th className="p-2">Thông tin</th><th className="p-2">Đang áp dụng</th><th className="p-2">Đề nghị</th></tr></thead><tbody>{changes.map(([k,v])=><tr key={k} className="border-t"><th className="p-2 font-medium">{contractFieldLabels[k]??k}</th><td className="p-2">{contractFieldValue(k,c[k as keyof SupplyContractView],people)}</td><td className="p-2 text-vna-blue">{contractFieldValue(k,v,people)}</td></tr>)}</tbody></table>{!changes.length&&<p className="p-2 text-sm text-slate-500">Không có thay đổi trường thông tin.</p>}</div>;
}
export function ContractRequestCard({request,workspace,onSaved}:{request:ContractChangeRequest;workspace:ContractManagementWorkspace;onSaved:()=>void}) {
  const {me}=useAuth(),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false);const key=useRef(crypto.randomUUID());
  const mine=request.requesterActorId===me.account.id, pending=request.state==='PENDING';
  const decision=async(action:'APPROVE'|'RETURN'|'WITHDRAW')=>{setBusy(true);setError('');try{await requestJson(`/contracts/${workspace.contract.id}/changes/${request.id}/decision`,{method:'POST',body:JSON.stringify({action,expectedVersion:workspace.contract.recordVersion,expectedRequestVersion:request.recordVersion,reason,idempotencyKey:key.current})});contractsChanged();onSaved();}catch(e){setError(message(e));}finally{setBusy(false);}};
  return <div className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{contractChangeLabels[request.kind]}</strong><StatusBadge>{contractRequestLabels[request.state]}</StatusBadge></div><p className="text-sm">{request.reason||'Chưa ghi lý do'}{request.evidence&&<> · Căn cứ: {request.evidence}</>}</p>{request.decisionReason&&<p className="text-sm text-slate-600">Phản hồi: {request.decisionReason}</p>}
    {(pending||request.state==='DRAFT'||request.state==='RETURNED')&&request.kind==='EDIT'&&<ContractChangeReview c={workspace.contract} fields={request.fields} people={workspace.people}/>}
    <Failure error={error}/>{pending&&workspace.capabilities.approve&&<label className="block text-sm">Ý kiến xử lý<textarea className={inputClass} value={reason} onChange={e=>{setReason(e.target.value);key.current=crypto.randomUUID();}} disabled={busy}/></label>}
    <div className="flex flex-wrap gap-2">{pending&&workspace.capabilities.approve&&<><Button disabled={busy} onClick={()=>void decision('APPROVE')}>Phê duyệt</Button><Button variant="secondary" disabled={busy} onClick={()=>void decision('RETURN')}>Trả lại</Button></>}{mine&&['DRAFT','PENDING','RETURNED'].includes(request.state)&&<Button variant="ghost" disabled={busy} onClick={()=>void decision('WITHDRAW')}>Rút đề nghị</Button>}{mine&&request.kind==='EDIT'&&['DRAFT','RETURNED','WITHDRAWN'].includes(request.state)&&workspace.capabilities.edit&&<Button variant="secondary" onClick={()=>request.fields.newPeriod||request.fields.itemChanges?setEditing(true):navigate(contractEditPath(workspace.contract.id,request.id))}>Tiếp tục sửa</Button>}</div>
    {editing&&(request.fields.newPeriod?<ContractPeriodEditor workspace={workspace} request={request} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);onSaved();}}/>:request.fields.itemChanges?<ContractDialog title="Tiếp tục sửa hạng mục" onClose={()=>setEditing(false)}><ContractItemsPanel id={workspace.contract.id} periodId={(request.fields.itemChanges as ContractItemChanges).periodId} phase={(request.fields.itemChanges as ContractItemChanges).phase} request={request} onSaved={()=>{setEditing(false);onSaved();}}/></ContractDialog>:null)}
  </div>;
}
export function ContractLifecycleDialog({workspace,kind,onClose,onSaved}:{workspace:ContractManagementWorkspace;kind:ContractChangeKind|'PURGE';onClose:()=>void;onSaved:()=>void}) {
  const owned=isOwnedChannel(workspace.contract),label=(text:string)=>owned?text.replaceAll('hợp đồng','hoạt động'):text;
  const [reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const key=useRef(crypto.randomUUID()); useUnsavedChanges(true);
  const send=async(mode:SaveMode)=>{setBusy(true);setError('');try{const c=workspace.contract;await requestJson(`/contracts/${c.id}/${kind==='PURGE'?'purge':'changes'}`,{method:'POST',body:JSON.stringify(kind==='PURGE'?{expectedVersion:c.recordVersion,confirmationCode:confirmation,reason,idempotencyKey:key.current}:{expectedVersion:c.recordVersion,kind,fields:{},reason,evidence:evidence||null,mode,idempotencyKey:key.current})});contractsChanged();onSaved();}catch(e){setError(message(e));}finally{setBusy(false);}};
  return <ContractDialog title={label(kind==='PURGE'?'Xóa vĩnh viễn hợp đồng':contractChangeLabels[kind])} busy={busy} onClose={onClose}><div className="space-y-4"><p className="font-medium">{workspace.contract.code} · {workspace.contract.name}</p><Failure error={error}/><ReasonFields reason={reason} evidence={evidence} onReason={v=>{setReason(v);key.current=crypto.randomUUID();}} onEvidence={v=>{setEvidence(v);key.current=crypto.randomUUID();}} disabled={busy}/>{kind==='PURGE'?<><p className="text-sm text-rose-700">Thao tác không thể phục hồi. Nhập mã hợp đồng để xác nhận.</p><input aria-label="Mã hợp đồng xác nhận xóa vĩnh viễn" className={inputClass} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/><Button disabled={busy||confirmation!==workspace.contract.code} onClick={()=>void send('SUBMIT')}>Xóa vĩnh viễn</Button></>:<SaveButtons busy={busy} required={workspace.policy.required} self={workspace.capabilities.approve} onSave={m=>void send(m)} onCancel={onClose}/>}</div></ContractDialog>;
}
export function ContractInfoPanel({id,onChanged,onDirty,onHistorical}:{id:string;onChanged:()=>void;onDirty:(b:boolean)=>void;onHistorical:(b:boolean)=>void}) {
  const [periodEditing,setPeriodEditing]=useState(false);
  const [data,setData]=useState<ContractManagementWorkspace|null>(null),[error,setError]=useState(''),[lifecycle,setLifecycle]=useState<ContractChangeKind|'PURGE'|null>(null),[revisionId,setRevisionId]=useState(()=>new URLSearchParams(location.search).get('revision')??''),[revision,setRevision]=useState<ContractRevision|null>(null);
  const dirty=Boolean(lifecycle);useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
  const load=useCallback(async()=>{try{setData(await requestJson<ContractManagementWorkspace>(`/contracts/${id}/management`));setError('');}catch(e){setError(message(e));}},[id]);
  useEffect(()=>{void load();},[load]);useEffect(()=>{const refresh=()=>{if(!dirty)void load();};window.addEventListener('cpms:contracts-changed',refresh);return()=>window.removeEventListener('cpms:contracts-changed',refresh);},[load,dirty]);useEffect(()=>{if(dirty)return;const timer=window.setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[load,dirty]);
  useEffect(()=>{onHistorical(Boolean(revisionId));setRevision(null);let active=true;if(revisionId)void requestJson<ContractRevision>(`/contracts/${id}/revisions/${revisionId}`).then(r=>{if(active)setRevision(r);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;onHistorical(false);};},[id,revisionId,onHistorical]);
  const changed=()=>{setLifecycle(null);void load();onChanged();};
  if(!data)return error?<Failure error={error}/>:<LoadingBlock label="Đang tải hồ sơ hợp đồng…"/>;
  const pending=data.requests.some(r=>r.state==='PENDING');
  return <div className="space-y-4"><Failure error={error}/><Card className="space-y-5 p-4"><div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm">Phiên bản hợp đồng<select aria-label="Phiên bản hợp đồng" className={inputClass} value={revisionId} onChange={e=>setRevisionId(e.target.value)} disabled={dirty}><option value="">Đang áp dụng</option>{data.revisions.map(r=><option key={r.id} value={r.id}>V{r.version} · {new Date(r.createdAt).toLocaleString('vi-VN')}{r.provenance==='MIGRATION_CAPTURE'?' · Chốt khi chuyển đổi':''}</option>)}</select></label><StatusBadge>{data.contract.deletedAt?'Trong Thùng rác':contractValidityLabels[data.validity]}</StatusBadge></div>
    {revisionId&&!revision?<LoadingBlock label="Đang tải phiên bản…"/>:<>{revision&&<p className="rounded-lg bg-amber-50 p-3 text-sm">Đang xem bản lưu V{revision.version}. {revision.reason}</p>}<ContractFacts c={revision?.snapshot.contract??data.contract}/>{(revision?.snapshot.contract??data.contract).supplierSnapshot&&<details className="rounded-lg border p-3" open><summary className="cursor-pointer text-sm font-semibold">Thông tin nhà cung cấp</summary><div className="mt-3"><SupplierFacts supplier={(revision?.snapshot.contract??data.contract).supplierSnapshot!}/></div></details>}</>}
     {!revisionId&&<div className="flex flex-wrap gap-2">{data.capabilities.edit&&<Button disabled={pending} title={pending?'Xử lý hoặc rút đề nghị đang chờ trước khi sửa tiếp':undefined} onClick={()=>navigate(contractEditPath(id))}><CpmsIcon name="edit"/>Sửa thông tin</Button>}{data.capabilities.edit&&<Button variant="secondary" disabled={pending} onClick={()=>setPeriodEditing(true)}>Thêm kỳ phân bổ</Button>}{data.capabilities.edit&&<Button variant="secondary" disabled={pending} onClick={()=>setLifecycle(['PAUSED','ARCHIVED'].includes(data.contract.status)?'RESUME':'PAUSE')}>{['PAUSED','ARCHIVED'].includes(data.contract.status)?'Tiếp tục':'Tạm dừng'}</Button>}{data.capabilities.delete&&<Button variant="secondary" disabled={pending} onClick={()=>setLifecycle('DELETE')}><CpmsIcon name="delete"/>Chuyển vào Thùng rác</Button>}{data.capabilities.restore&&<Button variant="secondary" disabled={pending} onClick={()=>setLifecycle('RESTORE')}>Phục hồi hợp đồng</Button>}{data.contract.deletedAt&&<Button variant="secondary" disabled={!data.capabilities.purge} title={data.capabilities.purgeReason??undefined} onClick={()=>setLifecycle('PURGE')}>Xóa vĩnh viễn</Button>}</div>}
  </Card>{!revisionId&&data.requests.length>0&&<Card className="space-y-3 p-4"><h2 className="font-semibold">Đề nghị và lịch sử xử lý</h2>{data.requests.map(r=><ContractRequestCard key={`${r.id}:${r.recordVersion}`} request={r} workspace={data} onSaved={changed}/>)}</Card>}
     {periodEditing&&<ContractPeriodEditor workspace={data} onClose={()=>setPeriodEditing(false)} onSaved={()=>{setPeriodEditing(false);changed();}}/>}{lifecycle&&<ContractLifecycleDialog workspace={data} kind={lifecycle} onClose={()=>setLifecycle(null)} onSaved={changed}/>}
  </div>;
}
export function ContractPolicyEditor({onClose}:{onClose:()=>void}) {
  const [policy,setPolicy]=useState<ContractManagementPolicy|null>(null),[required,setRequired]=useState(true),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void requestJson<ContractManagementPolicy>('/contracts/management/policy').then(p=>{setPolicy(p);setRequired(p.required);}).catch(e=>setError(message(e)));},[]);
  const save=async()=>{if(!policy)return;setBusy(true);try{await requestJson('/contracts/management/policy',{method:'POST',body:JSON.stringify({required,expectedVersion:policy.version,reason})});contractsChanged();onClose();}catch(e){setError(message(e));}finally{setBusy(false);}};
  return <ContractDialog title="Phê duyệt thay đổi hợp đồng" onClose={onClose} busy={busy}><div className="space-y-4"><Failure error={error}/><label className="block text-sm">Cơ chế<select className={inputClass} value={String(required)} onChange={e=>setRequired(e.target.value==='true')}><option value="true">Bắt buộc LĐP phê duyệt</option><option value="false">Không bắt buộc</option></select></label><p className="text-sm text-slate-500">Các đề nghị đã gửi vẫn giữ yêu cầu phê duyệt đã chốt.</p><label className="block text-sm">Lý do đổi chính sách<textarea className={inputClass} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={busy||!policy||!reason.trim()} onClick={()=>void save()}>Lưu chính sách</Button></div></ContractDialog>;
}
export function ContractBatchReview({patches,contracts,onClose,onDone}:{patches:SupplyGridPatch[];contracts:SupplyContractView[];onClose:()=>void;onDone:(errors:Record<string,string>,notice:string)=>void}) {
  const [data,setData]=useState<ContractManagementWorkspace[]>([]),[reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const keys=useRef(new Map(patches.map(p=>[p.id,crypto.randomUUID()])));useUnsavedChanges(true);
  useEffect(()=>{void Promise.all(patches.map(p=>requestJson<ContractManagementWorkspace>(`/contracts/${p.id}/management`))).then(setData).catch(e=>setError(message(e)));},[patches]);
  const save=async(mode:SaveMode)=>{setBusy(true);const errors:Record<string,string>={};let applied=0,pending=0,drafts=0;for(const p of patches){try{const r=await requestJson<{applied:boolean;request:ContractChangeRequest}>(`/contracts/${p.id}/changes`,{method:'POST',body:JSON.stringify({expectedVersion:p.recordVersion,kind:'EDIT',fields:contractPatch(p.fields),mode,reason,evidence:evidence||null,idempotencyKey:keys.current.get(p.id)})});if(r.applied)applied++;else if(r.request.state==='PENDING')pending++;else drafts++;}catch(e){errors[p.id]=message(e);}}setBusy(false);contractsChanged();onDone(errors,`${applied} đã áp dụng · ${pending} chờ duyệt · ${drafts} bản nháp${Object.keys(errors).length?` · ${Object.keys(errors).length} lỗi`:''}`);};
  return <ContractDialog title={`Lưu thay đổi ${patches.length} hợp đồng`} onClose={onClose} busy={busy}><div className="space-y-4"><Failure error={error}/>{patches.map(p=>{const c=contracts.find(c=>c.id===p.id);return c?<div key={p.id} className="rounded-xl border p-3"><p className="mb-2 font-semibold">{c.code} · {c.name}</p><ContractChangeReview c={c} fields={contractPatch(p.fields)} people={data.find(d=>d.contract.id===p.id)?.people??[]}/></div>:null;})}<ReasonFields reason={reason} evidence={evidence} onReason={v=>{setReason(v);keys.current=new Map(patches.map(p=>[p.id,crypto.randomUUID()]));}} onEvidence={v=>{setEvidence(v);keys.current=new Map(patches.map(p=>[p.id,crypto.randomUUID()]));}} disabled={busy}/><SaveButtons busy={busy||data.length!==patches.length} required={data.some(d=>d.policy.required)} self={data.length===patches.length&&data.every(d=>d.capabilities.approve)} onSave={m=>void save(m)} onCancel={onClose}/></div></ContractDialog>;
}
export function ContractInbox({section,onCounts}:{section:string;onCounts:(c:Record<string,number>)=>void}) {
  const [items,setItems]=useState<Array<{request:ContractChangeRequest;contract:SupplyContractView;section:string;canDecide:boolean}>>([]),[error,setError]=useState(''),[selected,setSelected]=useState<ContractManagementWorkspace|null>(null);
  const load=useCallback(async()=>{try{const rows=await requestJson<typeof items>('/contracts/management/inbox');setItems(rows);onCounts(Object.fromEntries(['PENDING','FOLLOWING','ASSIGNED','FYI'].map(s=>[s,rows.filter(r=>r.section===s).length])));setError('');}catch(e){setError(message(e));}},[onCounts]);
  useEffect(()=>{void load();const refresh=()=>{if(!selected)void load();};window.addEventListener('cpms:contracts-changed',refresh);window.addEventListener('cpms:workflow-updated',refresh);window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{clearInterval(timer);window.removeEventListener('cpms:contracts-changed',refresh);window.removeEventListener('cpms:workflow-updated',refresh);window.removeEventListener('focus',refresh);};},[load,selected]);
  return <div className="space-y-3"><Failure error={error}/>{items.filter(i=>i.section===section).map(i=><Card key={i.request.id} className="space-y-3 p-4"><div className="flex flex-wrap justify-between gap-2"><AppLink className="font-semibold text-vna-blue" to={`/contracts/${i.contract.id}?info=1`}>{i.contract.code} · {i.contract.name}</AppLink><StatusBadge>{contractRequestLabels[i.request.state]}</StatusBadge></div><p className="text-sm">{contractChangeLabels[i.request.kind]} · {i.request.reason}</p><Button size="sm" variant="secondary" onClick={()=>void requestJson<ContractManagementWorkspace>(`/contracts/${i.contract.id}/management`).then(setSelected).catch(e=>setError(message(e)))}>{i.canDecide?'Xem và xử lý':'Xem đề nghị'}</Button></Card>)}{selected&&<ContractDialog title="Xử lý đề nghị hợp đồng" onClose={()=>setSelected(null)}><p className="mb-4 font-semibold">{selected.contract.code} · {selected.contract.name}</p><div className="space-y-3">{selected.requests.filter(r=>r.state==='PENDING'||r.requesterActorId===items.find(i=>i.request.id===r.id)?.request.requesterActorId).map(r=><ContractRequestCard key={r.id} request={r} workspace={selected} onSaved={()=>{setSelected(null);void load();}}/>)}</div></ContractDialog>}</div>;
}
