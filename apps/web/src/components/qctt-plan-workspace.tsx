import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { DEFAULT_QCTT_PLAN_COLUMNS, QCTT_PLAN_FIELDS, emptyQcttPlanFields, qcttPlanColumnHasData,
  type CampaignRichTextNode, type QcttPlanColumn, type QcttPlanFields, type QcttPlanItem, type QcttPlanView } from '@cpms/domain';
import { requestJson } from '../lib/api';
import { navigate } from '../lib/router';
import { richTextToHtml } from '../lib/campaign-rich-text';
import { QcttPlanTimeline } from './qctt-plan-timeline';
import { copyQcttPlanRowFields, patchQcttPlanCells, qcttPlanRowClipboardFields } from '../lib/qctt-plan-cells';
import { sheetColumnAddress, sheetRecordRowNumber, sheetSavePosition } from '../lib/sheet-grid';
import { QcttPlanColumnSelector } from './qctt-plan-column-selector';
import { SupplyGrid, type SupplyGridColumn, type SupplyGridPatch, type SupplyGridCommitRequest } from './supply-grid';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không hoàn tất thao tác.';
const dateLabel = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Chưa xác định';
const topicText = (nodes: CampaignRichTextNode[] = []): string => nodes.map(node => node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : topicText(node.content ?? [])).join(' ');
const fieldLabels: Record<typeof QCTT_PLAN_FIELDS[number], string> = Object.fromEntries(DEFAULT_QCTT_PLAN_COLUMNS.map(column => [column.key, column.label])) as Record<typeof QCTT_PLAN_FIELDS[number], string>;
const fieldsOf = (item: QcttPlanFields): QcttPlanFields => ({
  customValues: { ...item.customValues }, professionLayer: item.professionLayer, channelCode: item.channelCode,
  activityCode: item.activityCode, activityLabel: item.activityLabel, content: item.content, format: item.format,
  otherFormat: item.otherFormat, startDate: item.startDate, endDate: item.endDate,
  departmentId: item.departmentId, requirements: item.requirements, progress: item.progress,
});
function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  return <div data-inline-save-surface role="dialog" aria-label={title} className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="max-h-[85vh] w-[min(900px,95vw)] overflow-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex justify-between"><h2 className="text-lg font-semibold">{title}</h2><Button variant="ghost" onClick={onClose}>Đóng</Button></div>{children}</div></div>;
}

export function QcttPlanWorkspace({ campaignId, onInitialized }: { campaignId: string; onInitialized?(): void }) {
  const [data, setData] = useState<QcttPlanView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'table' | 'timeline'>('table');
  const [draftRows, setDraftRows] = useState<Array<{ id: string; campaignId: string; recordVersion: number; sortOrder:number; position?:number } & QcttPlanFields>>([]);
  const [gridDirty, setGridDirty] = useState(false);
  const [duplicateCommit, setDuplicateCommit] = useState<SupplyGridCommitRequest | null>(null);
  const createKeys = useRef(new Map<string, string>());
  const cellDrafts = useRef<Record<string,Record<string,string>>>({});
  const [columnNotice,setColumnNotice]=useState('');
  const [layoutRevision,setLayoutRevision]=useState(0);
  const [hiddenColumnKeys,setHiddenColumnKeys]=useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [trash, setTrash] = useState(false);
  const [history, setHistory] = useState<{ title: string; entries: Array<{ version: number; action: string; actorName: string; createdAt: string }> } | null>(null);
  const load = useCallback(async () => setData(await requestJson<QcttPlanView>(`/campaigns/${campaignId}/qctt-plan`)), [campaignId]);
  useEffect(() => { let active = true; setData(null); setDraftRows([]); setSelected([]); setError('');
    requestJson<QcttPlanView>(`/campaigns/${campaignId}/qctt-plan`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; }; }, [campaignId]);
  const command = async (body: object) => {
    await requestJson(`/campaigns/${campaignId}/qctt-plan/commands`, { method: 'POST', body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) });
    await load(); onInitialized?.();
  };
  const run = async (body: object) => { setBusy(true); setError(''); try { await command(body); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const addRows = (position?:number,count=1):string[] => {
    if(busy||trash)return [];
    const nextPosition=position??Math.max(0,...(data?.items??[]).map(row=>row.sortOrder),...draftRows.map(row=>row.sortOrder))+1;
    if(nextPosition+count-1>10000){setColumnNotice('Bảng hỗ trợ vị trí dòng đến 10.000. Không thể chèn đủ số hàng đã chọn tại đây.');return [];}
    const added=Array.from({length:count},(_,index)=>({...emptyQcttPlanFields(),id:`draft-${crypto.randomUUID()}`,campaignId,recordVersion:0,sortOrder:nextPosition+index,position:nextPosition+index}));setMode('table');setTrash(false);
    setDraftRows(current=>[...current.map(row=>row.sortOrder>=nextPosition?{...row,sortOrder:row.sortOrder+count,...(row.position===undefined?{}:{position:row.sortOrder+count})}:row),...added]);return added.map(row=>row.id);
  };
  const addRow = (position?:number):string|null => addRows(position)[0]??null;
  const saveGrid = async (patches: SupplyGridPatch[]) => {
    if (!data) return null;
    try {
      const unsavedPositions=draftRows.filter(row=>row.position!==undefined&&!patches.some(patch=>patch.id===row.id)).map(row=>row.sortOrder);
      const entries = patches.map(patch => {
        const original = data.items.find(item => item.id === patch.id);
        const draft = draftRows.find(row => row.id === patch.id);
        const targetCampaignId = original?.campaignId ?? patch.fields.campaignId ?? draft?.campaignId ?? campaignId;
        if (!data.campaigns.some(option => option.id === targetCampaignId)) throw new Error('Chiến dịch không còn trong danh sách.');
        const fields = patchQcttPlanCells(fieldsOf(original ?? draft ?? emptyQcttPlanFields()), patch.fields, data);
        if (targetCampaignId !== campaignId && Object.keys(fields.customValues ?? {}).some(key => key.startsWith('custom:'))) throw new Error('Hãy mở chiến dịch đích để dùng cột Tự nhập của kế hoạch đó.');
        return { campaignId: targetCampaignId, item: { ...(original ? { id: original.id, expectedVersion: patch.recordVersion } : draft?.position?{position:sheetSavePosition(draft.position,unsavedPositions)}:{}), fields } };
      }).sort((a,b)=>Number(!('id' in a.item))-Number(!('id' in b.item))||('position' in a.item?a.item.position:10001)-('position' in b.item?b.item.position:10001));
      if (new Set(entries.map(entry => entry.campaignId)).size > 1) throw new Error('Lưu các dòng của từng chiến dịch riêng để tránh ghi một phần.');
      for (const targetCampaignId of [...new Set(entries.map(entry => entry.campaignId))]) {
        const items = entries.filter(entry => entry.campaignId === targetCampaignId).map(entry => entry.item);
        const creating = items.some(item => !('id' in item));
        const signature = JSON.stringify({ targetCampaignId, ids: patches.map(patch => patch.id), items });
        const idempotencyKey = (creating && createKeys.current.get(signature)) || crypto.randomUUID();
        if (creating) createKeys.current.set(signature, idempotencyKey);
        await requestJson(`/campaigns/${targetCampaignId}/qctt-plan/commands`, { method: 'POST', body: JSON.stringify({ action: 'SAVE', idempotencyKey, items }) });
      }
      setDraftRows(current => current.filter(row => !patches.some(patch => patch.id === row.id)));
      if (entries.length === 1 && entries[0]!.campaignId !== campaignId) navigate(`/qctt-plans/${encodeURIComponent(entries[0]!.campaignId)}`);
      else await load();
      onInitialized?.();
      return {};
    } catch (cause) { return Object.fromEntries(patches.map(patch => [patch.id, errorText(cause)])); }
  };
  const duplicateRows = (rows: Array<Record<string, unknown> & { id: string }>) => {
    if (busy || duplicateCommit || trash || !rows.length) return;
    const copies = rows.map(row => ({ ...copyQcttPlanRowFields(row), id: `draft-${crypto.randomUUID()}`,
      campaignId: String(row.campaignId ?? campaignId), recordVersion: 0,sortOrder:Math.max(0,...data!.items.map(item=>item.sortOrder),...draftRows.map(item=>item.sortOrder))+rows.indexOf(row)+1 }));
    setError('');
    setDraftRows(current => [...current, ...copies]);
    const ids = copies.filter(row => row.campaignId === campaignId).map(row => row.id);
    if (ids.length) setDuplicateCommit({ ids, onComplete: () => setDuplicateCommit(null) });
  };
  const layoutKey=`cpms.qctt-plan.sheet.${campaignId}`;
  const placeColumn=(key:string|string[],oldKey?:string,after=false)=>{
    const keys=typeof key==='string'?[key]:key;
    let layout:{order:string[];hidden:string[];pinned:string[];widths:Record<string,number>};
    try{layout=JSON.parse(localStorage.getItem(layoutKey)??'null')??{order:data?.state.columns.map(column=>column.key)??[],hidden:[],pinned:[],widths:{}};}catch{layout={order:[],hidden:[],pinned:[],widths:{}};}
    layout.order=[...layout.order,...(data?.state.columns??[]).map(column=>column.key).filter(value=>!layout.order.includes(value))];
    layout.order=layout.order.filter(value=>!keys.includes(value));const at=oldKey?layout.order.indexOf(oldKey):-1;
    if(at>=0)layout.order.splice(at+Number(after),0,...keys);else layout.order.push(...keys);
    layout.hidden=layout.hidden.filter(value=>!keys.includes(value));localStorage.setItem(layoutKey,JSON.stringify(layout));setLayoutRevision(value=>value+1);
  };
  const changeColumns = async (next: QcttPlanColumn[],placement?:{key:string|string[];anchor?:string;after?:boolean}) => {
    if(!data||busy)return;
    setBusy(true);setError('');
    try{await requestJson(`/campaigns/${campaignId}/qctt-plan/commands`,{method:'POST',body:JSON.stringify({action:'COLUMNS',idempotencyKey:crypto.randomUUID(),expectedVersion:data.state.recordVersion,columns:next})});if(placement)placeColumn(placement.key,placement.anchor,placement.after);await load();onInitialized?.();return true;}
    catch(cause){setError(errorText(cause));return false;}finally{setBusy(false);}
  };
  if (!data) return error ? <p role="alert" className="rounded-xl border p-5 text-rose-700">{error} <Button onClick={() => void load().catch(cause => setError(errorText(cause)))}>Thử lại</Button></p> : <LoadingBlock label="Đang tải kế hoạch QCTT…" />;
  const catalog = data.catalog.data;
  const columns = data.state.columns.length ? data.state.columns : DEFAULT_QCTT_PLAN_COLUMNS;
  const campaign = data.campaigns.find(item => item.id === campaignId);
  const visible = data.items.filter(item => Boolean(item.deletedAt) === trash);
  const bookings = (id: string) => data.bookings.filter(booking => booking.itemId === id && !booking.deleted);
  const bookingCount = (id: string) => new Set(bookings(id).map(booking => booking.id)).size;
  const columnHasInput=(key:string)=>qcttPlanColumnHasData([...data.items,...draftRows],key)||Object.values(cellDrafts.current).some(patch=>Boolean(patch[key]?.trim()));
  const removeRows=async(rows:Array<Record<string,unknown>&{id:string}>):Promise<boolean>=>{
    if(busy)return false;
    const ids=new Set(rows.map(row=>row.id)),items=data.items.filter(item=>ids.has(item.id));
    if(items.length>50){setColumnNotice('Mỗi lần xóa tối đa 50 hàng đã lưu. Các hàng chưa lưu vẫn được giữ nguyên.');return false;}
    setBusy(true);setError('');
    try{if(items.length)await command({action:'DELETE',items:items.map(item=>({id:item.id,expectedVersion:item.recordVersion}))});setDraftRows(current=>current.filter(row=>!ids.has(row.id)));return true;}
    catch(cause){setError(errorText(cause));return false;}finally{setBusy(false);}
  };
  const removeColumns=async(keys:string[]):Promise<boolean>=>{
    if(keys.some(columnHasInput)){setColumnNotice('Cột đã có dữ liệu hoặc nội dung đang nhập nên không thể xóa. Hãy ẩn cột nếu chưa cần dùng; dữ liệu được giữ nguyên.');return false;}
    const next=columns.filter(column=>!keys.includes(column.key));if(!next.length)return false;
    return await changeColumns(next)??false;
  };
  const updateColumn=(index:number,value:string)=>{
    const old=columns[index]!;if(value===old.key)return;
    if(columnHasInput(old.key)){setColumnNotice(`Cột “${old.label}” đã có dữ liệu nên không thể đổi trường. Hãy thêm cột mới rồi chọn trường cần dùng; có thể ẩn cột hiện tại mà vẫn giữ dữ liệu.`);return;}
    const existing=columns.find(column=>column.key===value);
    if(existing){placeColumn(value,old.key);setColumnNotice(`Trường “${existing.label}” đã có trong bảng. Cột đó đã được hiển thị tại vị trí bạn chọn; dữ liệu được giữ nguyên.`);return;}
    let replacement:QcttPlanColumn;
    if(value==='custom:new'){const label=window.prompt('Tên trường Tự nhập mới:')?.trim();if(!label)return;replacement={key:`custom:${crypto.randomUUID()}`,label};}
    else replacement={key:value as QcttPlanColumn['key'],label:fieldLabels[value as typeof QCTT_PLAN_FIELDS[number]]??old.label};
    void changeColumns(columns.map((column,at)=>at===index?replacement:column),{key:replacement.key,anchor:old.key});
  };
  const toggleColumnVisibility=(key:string)=>{
    let layout:{order:string[];hidden:string[];pinned:string[];widths:Record<string,number>};
    try{layout=JSON.parse(localStorage.getItem(layoutKey)??'null')??{order:columns.map(column=>column.key),hidden:[],pinned:[],widths:{}};}catch{layout={order:columns.map(column=>column.key),hidden:[],pinned:[],widths:{}};}
    const hidden=new Set(layout.hidden);
    if(hidden.has(key))hidden.delete(key);
    else{if(columns.filter(column=>!hidden.has(column.key)).length<=1){setColumnNotice('Giữ ít nhất một cột hiển thị. Hãy hiện thêm cột khác trước khi ẩn cột này.');return;}hidden.add(key);}
    layout.hidden=[...hidden];localStorage.setItem(layoutKey,JSON.stringify(layout));setHiddenColumnKeys(layout.hidden);setLayoutRevision(value=>value+1);
  };
  const addColumn=(value:string,anchor?:string,after=true,count=1)=>{
    if(value==='blank:new'){
      if(columns.length+count>30){setColumnNotice(`Kế hoạch hỗ trợ tối đa 30 cột. Hiện có ${columns.length} cột nên không thể chèn thêm đủ ${count} cột đã chọn.`);return;}
      const added:QcttPlanColumn[]=Array.from({length:count},()=>({key:`blank:${crypto.randomUUID()}`,label:'Chọn trường…'}));const index=anchor?columns.findIndex(column=>column.key===anchor):-1;const next=[...columns];next.splice(index<0?next.length:index+Number(after),0,...added);void changeColumns(next,{key:added.map(column=>column.key),...(anchor?{anchor,after}:{})});return;
    }
    if(columns.some(column=>column.key===value)){if(anchor)placeColumn(value,anchor,after);else toggleColumnVisibility(value);return;}
    if(value==='custom:new'){const label=window.prompt('Tên trường Tự nhập mới:')?.trim();if(label){const column:QcttPlanColumn={key:`custom:${crypto.randomUUID()}`,label};void changeColumns([...columns,column],{key:column.key,...(anchor?{anchor,after}:{})});}}
    else if(value)void changeColumns([...columns,{key:value as QcttPlanColumn['key'],label:fieldLabels[value as typeof QCTT_PLAN_FIELDS[number]]}],{key:value,...(anchor?{anchor,after}:{})});
  };
  const fieldVisibility=(key:string):'visible'|'hidden'|undefined=>columns.some(column=>column.key===key)?hiddenColumnKeys.includes(key)?'hidden':'visible':undefined;
  const columnChoices=[{value:'custom:new',label:'Tự nhập…'},...QCTT_PLAN_FIELDS.map(key=>({value:key,label:fieldLabels[key],visibility:fieldVisibility(key)})),...columns.filter(column=>column.key.startsWith('custom:')).map(column=>({value:column.key,label:column.label,visibility:fieldVisibility(column.key)}))];
  const header=(column:QcttPlanColumn,index:number,visibleIndex:number)=><QcttPlanColumnSelector label={`Trường thông tin cột ${sheetColumnAddress(visibleIndex)}`} value={column.key} choices={column.key.startsWith('blank:')?[columnChoices[0]!,{value:column.key,label:'Chọn trường…'},...columnChoices.slice(1)]:columnChoices} disabled={busy} onChange={value=>updateColumn(index,value)}/>;
  const gridColumns: SupplyGridColumn[] = columns.map((column, index) => {
    const base: SupplyGridColumn = { key: column.key, label: column.label, editable:!column.key.startsWith('blank:'), width: column.key === 'content' || column.key === 'requirements' ? 320 : 190, headerControl: visibleIndex => header(column, index, visibleIndex) };
    if (column.key === 'campaignId') return { ...base, editableWhen: row => Boolean(row.__sheetBlank)||String(row.id).startsWith('draft-'), width: 260, options: data.campaigns.map(item => ({ value: item.id, label: `${item.code} · ${item.name}` })) };
    if (column.key === 'professionLayer') return { ...base, options: catalog?.layers.map(item => ({ value: item.code, label: item.name })) ?? [] };
    if (column.key === 'channelCode') return { ...base, optionsForRow: row => catalog?.channels.filter(item => !row.professionLayer || catalog.activities.some(activity => activity.professionLayer === row.professionLayer && activity.channelCode === item.code)).map(item => ({ value: item.code, label: item.name })) ?? [] };
    if (column.key === 'activityLabel') return { ...base, width: 280, optionsForRow: row => catalog?.activities.filter(item => (!row.professionLayer || item.professionLayer === row.professionLayer) && (!row.channelCode || item.channelCode === row.channelCode)).map(item => ({ value: item.code, label: item.name })) ?? [], render: row => <div><span className="font-semibold text-vna-blue">{catalog?.activities.find(item => item.code === row.activityCode)?.name ?? String(row.activityName ?? 'Chọn Phương tiện')}</span>{bookingCount(String(row.id)) > 0 && <span className="ml-2 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] text-vna-blue">{bookingCount(String(row.id))} booking</span>}{row.origin === 'BOOKING' && <span className="ml-2 text-[10px] text-slate-500">Từ booking</span>}</div> };
    if (column.key === 'content') return { ...base, type: 'rich-text', clipboardValue: row => topicText((row.contentDocument as QcttPlanItem['content'])?.content ?? []), render: row => <div className="campaign-rich-text max-h-20 overflow-hidden" dangerouslySetInnerHTML={{ __html: richTextToHtml(row.contentDocument as QcttPlanItem['content'] ?? null) }} /> };
    if (column.key === 'startDate' || column.key === 'endDate') return { ...base, type: 'date', width: 165 };
    if (column.key === 'departmentId') return { ...base, width: 240, options: data.departments.map(item => ({ value: item.id, label: item.name })) };
    if (column.key.startsWith('custom:')) return { ...base, width: 220 };
    return base;
  });
  const positioned=visible.map(item=>({...item}));
  if(!trash)for(const draft of [...draftRows].sort((a,b)=>a.sortOrder-b.sortOrder))if(draft.position!==undefined)for(const item of positioned)if(item.sortOrder>=draft.sortOrder)item.sortOrder++;
  const gridRows = [...positioned, ...(!trash ? draftRows : [])].map(item => ({ ...item, activityName: item.activityLabel,
    activityLabel: item.activityCode ?? '', contentDocument: item.content, content: item.content ? JSON.stringify(item.content) : '',
    ...Object.fromEntries(columns.filter(column => column.key.startsWith('custom:')).map(column => [column.key, item.customValues?.[column.key] ?? ''])) }));
  const projectDraft = (row: Record<string, unknown>, patch: Record<string, string>) => {
    if (!Object.keys(patch).length) return {};
    try {
      const original = data.items.find(item => item.id === row.id) ?? draftRows.find(item => item.id === row.id);
      const next = patchQcttPlanCells(fieldsOf(original ?? emptyQcttPlanFields()), patch, data);
      return { ...next, activityName: next.activityLabel, activityLabel: next.activityCode ?? '', contentDocument: next.content,
        content: next.content ? JSON.stringify(next.content) : '', ...Object.fromEntries(columns.filter(column => column.key.startsWith('custom:')).map(column => [column.key, next.customValues?.[column.key] ?? ''])) };
    } catch { return {}; }
  };
  const openHistory = async (item: QcttPlanItem) => { try {
    const entries = await requestJson<NonNullable<typeof history>['entries']>(`/campaigns/${campaignId}/qctt-plan/items/${item.id}/history`);
    setHistory({ title: item.activityLabel, entries });
  } catch (cause) { setError(errorText(cause)); } };
  const reorderTimeline=async(itemIds:string[]):Promise<boolean>=>{if(busy||trash||gridDirty)return false;setBusy(true);setError('');try{await command({action:'REORDER',expectedVersion:data.state.recordVersion,itemIds});return true;}catch(cause){setError(errorText(cause));return false;}finally{setBusy(false);}};
  let removedBlankRows:number[]=[];try{removedBlankRows=JSON.parse(localStorage.getItem(layoutKey)??'null')?.removedBlankRows??[];}catch{/* Keep default row addresses. */}
  const occupiedPositions=visible.map(item=>item.sortOrder),timelineRowNumbers=Object.fromEntries(visible.map(item=>[item.id,sheetRecordRowNumber(item.sortOrder,occupiedPositions,removedBlankRows)]));
  return <section aria-label="Kế hoạch QCTT" className="w-full min-w-0 space-y-4">
    <div className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kế hoạch QCTT</p><h2 className="mt-1 max-w-5xl text-2xl font-bold leading-snug text-vna-blue-deep md:text-3xl">{campaign?.name??campaignId}</h2><p className="mt-1 text-sm font-semibold text-vna-blue">{campaign?.code}</p><p className="mt-1 text-sm text-slate-600">{data.state.recordVersion ? 'Kế hoạch đang nhận Booking theo Chiến dịch và Phương tiện QCTT.' : 'Nhập bất kỳ nội dung nào để bắt đầu; có thể lưu trước và bổ sung Phương tiện QCTT sau.'}</p></div><div className="flex flex-wrap gap-2"><Button data-inline-save-surface disabled={busy} onClick={()=>addRow()}><CpmsIcon name="add"/>Thêm dòng</Button><Button variant="ghost" disabled={busy || gridDirty} onClick={() => void load().catch(cause => setError(errorText(cause)))}>Tải lại</Button></div></div>
      <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Chiến dịch<select aria-label="Chọn chiến dịch lập kế hoạch" className="ml-2 w-[min(640px,75vw)] max-w-full rounded-lg border px-3 py-2 font-semibold" value={campaignId} disabled={gridDirty} onChange={event => navigate(`/qctt-plans/${encodeURIComponent(event.target.value)}`)}>{data.campaigns.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}{item.hasPlan ? ' · Đã có kế hoạch' : ''}</option>)}</select></label><div className="flex rounded-lg bg-slate-100 p-1">{(['table', 'timeline'] as const).map(value => <button key={value} aria-pressed={mode === value} className={`rounded-md px-3 py-2 text-sm ${mode === value ? 'bg-white font-semibold text-vna-blue shadow-sm' : 'text-slate-600'}`} onClick={() => { if (gridDirty && !window.confirm('Bỏ các chỉnh sửa chưa lưu?')) return; setMode(value); }}>{value === 'table' ? 'Bảng' : 'Timeline'}</button>)}</div><label className="text-sm"><input type="checkbox" className="mr-1" checked={trash} disabled={gridDirty} onChange={event => setTrash(event.target.checked)}/>Thùng rác</label><div data-inline-save-surface className="flex min-w-[260px] items-center gap-2 text-sm"><span className="shrink-0">Thêm cột</span><QcttPlanColumnSelector toggleVisibility label="Thêm cột thông tin" value="" choices={[columnChoices[0]!,{value:'blank:new',label:'Cột trống…'},...columnChoices.slice(1)]} disabled={busy} onChange={value=>addColumn(value)}/></div></div>
    </div>
    {columnNotice&&<Dialog title="Thông tin cột" onClose={()=>setColumnNotice('')}><p className="text-sm leading-relaxed">{columnNotice}</p></Dialog>}
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {mode === 'table' ? <div className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3 pb-16 shadow-panel"><SupplyGrid key={`${campaignId}:${trash}`} layoutVersion={layoutRevision} onHiddenColumnsChange={setHiddenColumnKeys} onDraftsChange={value=>{cellDrafts.current=value;}} rows={gridRows} columns={gridColumns} storageKey={`cpms.qctt-plan.sheet.${campaignId}`} viewportClassName="min-h-[420px] bg-white" columnReordering manualColumnPinning sheet={!trash?{createRow:position=>addRow(position),insertRows:(position,count)=>addRows(position,count),insertColumn:(anchor,after,count)=>addColumn('blank:new',anchor,after,count),removeRows,removeColumns,clearRow:row=>{if(bookingCount(String(row.id))){setColumnNotice('Dòng đã có booking nên không thể xóa toàn bộ nội dung. Chọn riêng các ô mô tả hoặc Ghi chú để sửa; dữ liệu booking được giữ nguyên.');return null;}return qcttPlanRowClipboardFields({...emptyQcttPlanFields(),activityName:'',contentDocument:null,...Object.fromEntries(columns.filter(column=>column.key.startsWith('custom:')).map(column=>[column.key,'']))});}}:undefined} spreadsheet rowNumbers columnLetters selectionStyle="campaign" canEdit={!trash} onRestoreRows={restored => setDraftRows(current => [...current, ...restored.filter(row => String(row.id).startsWith("draft-") && !current.some(item => item.id === row.id)).map((row,index)=>({...row,sortOrder:Number(row.sortOrder)||Math.max(0,...data.items.map(item=>item.sortOrder))+index+1,content:row.contentDocument??null,activityLabel:row.activityName??""})) as unknown as typeof current])} rowClipboard={{scope:'QCTT_PLAN',fields:qcttPlanRowClipboardFields}} commitRequest={duplicateCommit} onSave={saveGrid} onDirty={setGridDirty} onDiscard={() => setDraftRows([])} draftRowIds={draftRows.map(row => row.id)} projectDraft={projectDraft} onSelectionChange={setSelected} empty={trash ? 'Thùng rác không có dòng.' : 'Chưa có dòng kế hoạch. Thêm dòng để bắt đầu.'} onCreate={()=>addRow()} createLabel="Thêm dòng kế hoạch" contextActions={rows => {
      const items = rows.map(row => data.items.find(item => item.id === row.id)).filter((item): item is QcttPlanItem => Boolean(item));
      return [...(!trash && rows.length ? [{ label: 'Nhân bản',icon:'duplicate' as const, disabled: busy || Boolean(duplicateCommit), run: () => duplicateRows(rows) }] : []),
        { label: 'Xem booking của hoạt động',icon:'booking', tone: 'primary', run: () => setSelected(items.map(item => item.id)) },
        ...(items.length === 1 ? [{ label: 'Lịch sử dòng',icon:'history' as const, run: () => void openHistory(items[0]!) }] : []),
        ...(trash && items.length ? [{ label: 'Phục hồi dòng đã chọn', tone: 'positive' as const, run: () => void run({ action: 'RESTORE', items: items.map(item => ({ id: item.id, expectedVersion: item.recordVersion })) }) }] : [])];
    }} /></div> : <QcttPlanTimeline items={visible} data={data} rowNumbers={timelineRowNumbers} busy={busy} canReorder={!trash} onReorder={reorderTimeline} />}
    <div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">Booking trong kế hoạch</h3><p className="mt-1 text-xs text-slate-500">Booking tự xuất hiện dưới Phương tiện QCTT tương ứng. Chọn dòng trong bảng để chỉ xem hoạt động đó.</p><div className="mt-3 space-y-3">{visible.filter(item => !selected.length || selected.includes(item.id)).filter(item => bookingCount(item.id)).map(item => <details key={item.id} open={selected.includes(item.id)} className="rounded-lg border"><summary className="cursor-pointer bg-slate-50 p-3 text-sm font-medium">{item.activityLabel} · {bookingCount(item.id)} booking</summary><PlanBookingTable rows={bookings(item.id)}/></details>)}{data.bookings.filter(booking => !booking.itemId && !booking.deleted).length > 0 && <details className="rounded-lg border"><summary className="cursor-pointer bg-amber-50 p-3 text-sm font-medium">Booking chưa liên kết Phương tiện</summary><PlanBookingTable rows={data.bookings.filter(booking => !booking.itemId && !booking.deleted)}/></details>}</div></div>
    {history && <Dialog title={`Lịch sử · ${history.title}`} onClose={() => setHistory(null)}><div className="space-y-2">{history.entries.map(entry => <p key={entry.version} className="border-b py-2 text-sm">Phiên bản {entry.version} · {entry.action} · {entry.actorName} · {new Date(entry.createdAt).toLocaleString('vi-VN')}</p>)}</div></Dialog>}
  </section>;
}

function PlanBookingTable({ rows }: { rows: QcttPlanView['bookings'] }) {
  return <div className="overflow-auto"><table className="w-full min-w-[750px] text-left text-xs"><thead className="bg-slate-50"><tr>{['Slot', 'Bắt đầu', 'Kết thúc', 'Số lượng', 'Trạng thái', 'Thực hiện'].map(label => <th key={label} className="border-b px-3 py-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.id}:${row.perspective}`} className="border-b hover:bg-cyan-50"><td className="px-3 py-2">{row.slotName}{row.perspective === 'PROPOSED' ? ' · Đề nghị' : ''}{row.outsidePlan ? ' · Lệch thời gian' : ''}</td><td className="px-3 py-2">{dateLabel(row.startDate)}</td><td className="px-3 py-2">{dateLabel(row.endDate)}</td><td className="px-3 py-2">{row.quantity} {row.unit}</td><td className="px-3 py-2">{row.status}</td><td className="px-3 py-2">{row.execution}</td></tr>)}</tbody></table></div>;
}
