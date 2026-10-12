import { Button,CpmsIcon } from '@cpms/ui';
import { useEffect,useId,useMemo,useRef,useState,type ReactNode } from 'react';
import { useGridSave } from '../lib/use-grid-save';
import { acknowledgeFields, gridDestination } from '../lib/grid-navigation';
import { columnDragAutoScrollDelta, moveOrderedItemAt, type ColumnDropPosition } from '../lib/column-order';
import { SupplyColumnChooser, type SupplyColumnLayout } from './supply-column-chooser';
import { bookingClipboardRows, bookingClipboardValue } from '../lib/booking-grid';
import { GRID_ROW_CLIPBOARD_TYPE, clearGridRows, readGridRows, rememberGridRows } from '../lib/grid-row-clipboard';
import type { CampaignRichTextDocument } from '@cpms/domain';
import { CampaignRichTextEditor } from './campaign-rich-text-editor';

export interface SupplyGridColumn { key:string;label:string;editable?:boolean;editableWhen?:(row:Record<string,unknown>)=>boolean;validate?:(row:Record<string,unknown>)=>string|null;type?:'text'|'date'|'number'|'rich-text';options?:Array<{value:string;label:string}>;allowCustomValue?:boolean;softWarning?:(row:Record<string,unknown>)=>string|null;optionsForRow?:(row:Record<string,unknown>)=>Array<{value:string;label:string}>;width?:number;hint?:string;headerControl?:ReactNode|((visibleIndex:number)=>ReactNode);render?:(row:Record<string,unknown>)=>ReactNode;clipboardValue?:(row:Record<string,unknown>)=>string }
export interface SupplyGridAction { label:string;run:()=>void;disabled?:boolean;tone?:'primary'|'danger'|'positive' }
export interface SupplyGridPatch { id:string;fields:Record<string,string>;recordVersion:number }
export interface SupplyGridCommitRequest { ids:string[];onComplete:()=>void }
export interface SupplyGridRowClipboard { scope:string;fields:(row:Record<string,unknown>)=>Record<string,string> }
export interface SupplyGridGrouping { mode:string;resolve:(row:Record<string,unknown>)=>{key:string;label:string};order:'NEWEST_FIRST'|'LABEL_ASC' }
function richValue(value:string): CampaignRichTextDocument | null { try { return value ? JSON.parse(value) as CampaignRichTextDocument : null; } catch { return { schemaVersion:1,type:'doc',content:[{type:'paragraph',content:[{type:'text',text:value}]}] }; } }
function columnAddress(index:number):string { let value=index+1,result='';while(value>0){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26);}return result; }
export function formatSupply(value:unknown,fractionDigits:2|6=6):string {
  if(value===null||value===undefined||value==='')return '—';
  const text=String(value);if(!/^-?\d+(\.\d+)?$/.test(text))return text;
  const negative=text.startsWith('-'),[whole,fraction='']=(negative?text.slice(1):text).split('.');
  const scaled=BigInt(whole!+fraction.slice(0,fractionDigits).padEnd(fractionDigits,'0'))+(fraction.length>fractionDigits&&fraction[fractionDigits]!>='5'?1n:0n);
  const rounded=scaled.toString().padStart(fractionDigits+1,'0'),digits=rounded.slice(-fractionDigits).replace(/0+$/,'');
  return (negative&&scaled?'-':'')+rounded.slice(0,-fractionDigits).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(digits?','+digits:'');
}
export function SupplyGrid({rows,columns,storageKey,onSave,onDirty,onOpen,onSelectionChange,draftRowIds=[],onDiscard,onRestoreRows,commitRequest,rowClipboard,committedPatches=[],resetToken=0,projectDraft,spreadsheet=false,rowNumbers=false,columnLetters=false,canEdit=true,canEditRow=()=>true,empty='Chưa có dữ liệu.',onCreate,onCellsChange,contextActions,toolbar,grouping,createLabel='Tạo đặt chỗ mới',selectionStyle='default',viewportClassName,columnReordering=false}:{rows:Array<Record<string,unknown>&{id:string;recordVersion?:number}>;columns:SupplyGridColumn[];storageKey:string;onRestoreRows?:(rows:Array<Record<string,unknown>&{id:string}>)=>void;committedPatches?:SupplyGridPatch[];resetToken?:number;viewportClassName?:string;columnReordering?:boolean;commitRequest?:SupplyGridCommitRequest|null;rowClipboard?:SupplyGridRowClipboard;
  onSave?:(patches:SupplyGridPatch[])=>Promise<Record<string,string>|null>;onDirty?:(dirty:boolean)=>void;onOpen?:(id:string)=>void;onSelectionChange?:(ids:string[])=>void;draftRowIds?:string[];onDiscard?:()=>void;projectDraft?:(row:Record<string,unknown>,patch:Record<string,string>)=>Record<string,unknown>;spreadsheet?:boolean;rowNumbers?:boolean;columnLetters?:boolean;canEdit?:boolean;canEditRow?:(row:Record<string,unknown>)=>boolean;empty?:ReactNode;onCreate?:(()=>void)|undefined;onCellsChange?:(patches:SupplyGridPatch[])=>void;contextActions?:(rows:Array<Record<string,unknown>&{id:string}>)=>SupplyGridAction[];toolbar?:(patches:SupplyGridPatch[],selected:string[])=>ReactNode;grouping?:SupplyGridGrouping;createLabel?:string;selectionStyle?:'default'|'campaign'}) {
  const gridId=useId();
  const [drafts,updateDrafts]=useState<Record<string,Record<string,string>>>({});const draftsRef=useRef(drafts);
  const setDrafts=(value:typeof drafts|((old:typeof drafts)=>typeof drafts))=>{draftsRef.current=typeof value==='function'?value(draftsRef.current):value;updateDrafts(draftsRef.current);};
  const root=useRef<HTMLDivElement>(null);
  const baselineVersions=useRef<Record<string,number>>({});
  useEffect(()=>{if(!committedPatches.length)return;setDrafts(old=>{const next={...old};for(const patch of committedPatches){const remaining=acknowledgeFields(next[patch.id]??{},patch.fields);if(Object.keys(remaining).length)next[patch.id]=remaining;else delete next[patch.id];}return next;});},[committedPatches]);
  useEffect(()=>{if(resetToken){setDrafts({});setErrors({});setEditing(null);}},[resetToken]);
  const [errors,setErrors]=useState<Record<string,string>>({});const [selection,setSelection]=useState<string[]>([]);
  const [cellRange,setCellRange]=useState<{r:number;c:number;endR:number;endC:number}|null>(null);
  const [menu,setMenu]=useState<{x:number;y:number;row:number;col:number;ids:string[];column?:string}|null>(null),[clipboardError,setClipboardError]=useState('');
  const viewport=useRef<HTMLDivElement>(null),columnDrag=useRef<string|null>(null),scrollFrame=useRef<number|null>(null),scrollVelocity=useRef(0);
  const [draggedColumn,setDraggedColumn]=useState<string|null>(null),[columnDrop,setColumnDrop]=useState<{key:string;position:ColumnDropPosition}|null>(null);
  const stopColumnScroll=()=>{scrollVelocity.current=0;if(scrollFrame.current!==null)window.cancelAnimationFrame(scrollFrame.current);scrollFrame.current=null;};
  const endColumnDrag=()=>{stopColumnScroll();columnDrag.current=null;setDraggedColumn(null);setColumnDrop(null);};
  useEffect(()=>{window.addEventListener('dragend',endColumnDrag);window.addEventListener('drop',endColumnDrag);return()=>{window.removeEventListener('dragend',endColumnDrag);window.removeEventListener('drop',endColumnDrag);stopColumnScroll();};},[]);
  const drag=useRef(false),menuRef=useRef<HTMLDivElement>(null),rowAnchor=useRef<number>(0),editingValue=useRef('');
  useEffect(()=>{const up=()=>{drag.current=false;};const dismiss=(e:PointerEvent)=>{if(!menuRef.current?.contains(e.target as Node))setMenu(null);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&menuRef.current){e.preventDefault();e.stopPropagation();setMenu(null);}};window.addEventListener('pointerup',up);window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',key);return()=>{window.removeEventListener('pointerup',up);window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',key);};},[]);
  useEffect(()=>{onSelectionChange?.(selection);},[selection,onSelectionChange]);
  const [editing,setEditing]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [filter,setFilter]=useState<Record<string,string>>({});const [facets,setFacets]=useState<Record<string,string[]>>({});const [showFilters,setShowFilters]=useState(false);
  const [creatingIds,setCreatingIds]=useState<string[]>([]);
  const [sort,setSort]=useState<{key:string;desc:boolean}|null>(null);const [options,setOptions]=useState<SupplyColumnLayout>(()=>{
    try{return JSON.parse(localStorage.getItem(storageKey)??'null') as {order:string[];hidden:string[];pinned:string[];widths:Record<string,number>}??{order:columns.map(c=>c.key),hidden:[],pinned:[],widths:{}};}catch{return{order:columns.map(c=>c.key),hidden:[],pinned:[],widths:{}};}
  });
  const [collapsedGroups,setCollapsedGroups]=useState<string[]>([]);
  useEffect(()=>{setCollapsedGroups([]);setSelection([]);setCellRange(null);setEditing(null);setMenu(null);rowAnchor.current=0;},[grouping?.mode]);
  const dirty=Object.keys(drafts).length>0||draftRowIds.length>0;
  useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
  useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(options));},[options,storageKey]);
  const editableColumns=columns.filter(c=>c.editable);const saveRef=useRef<()=>void>(()=>undefined);
  const saveRows=async(targets?:string[])=>{if(!onSave)return true;const ids=[...new Set([...Object.keys(draftsRef.current),...draftRowIds])].filter(id=>!targets||targets.includes(id)).slice(0,50);if(!ids.length)return true;
    const patches=ids.map(id=>({id,fields:{...draftsRef.current[id]},recordVersion:baselineVersions.current[id]??Number(rows.find(r=>r.id===id)?.recordVersion??0)}));setBusy(true);setCreatingIds(patches.filter(p=>p.recordVersion===0).map(p=>p.id));
    try{const result=await onSave(patches);if(result===null)return false;setErrors(old=>({...old,...Object.fromEntries(ids.map(id=>[id,result[id]??'']))}));
      setDrafts(old=>{const next={...old};for(const patch of patches)if(!result[patch.id]){baselineVersions.current[patch.id]=patch.recordVersion+1;const remaining=acknowledgeFields(next[patch.id]??{},patch.fields);if(Object.keys(remaining).length)next[patch.id]=remaining;else delete next[patch.id];}return next;});return !Object.values(result).some(Boolean);
    }catch(e){setErrors(old=>({...old,...Object.fromEntries(ids.map(id=>[id,e instanceof Error?e.message:'Lưu thất bại']))}));return false;}finally{setBusy(false);setCreatingIds([]);}};
  const autosaveRef=useRef<(ids?:string[])=>Promise<boolean>>(async()=>false);
  const save=(ids?:string[])=>autosaveRef.current(ids);
  saveRef.current=()=>void save();useEffect(()=>{if(!onSave)return;const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveRef.current();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onSave]);
  const visible=useMemo(()=>{
    const order=[...options.order,...columns.map(c=>c.key).filter(k=>!options.order.includes(k))];
    return order.filter(k=>!options.hidden.includes(k)).map(k=>columns.find(c=>c.key===k)).filter((c):c is SupplyGridColumn=>Boolean(c)).sort((a,b)=>Number(options.pinned.includes(b.key))-Number(options.pinned.includes(a.key)));
  },[columns,options]);
  const filteredRows=rows.map(row=>({...row,...drafts[row.id],...projectDraft?.(row,drafts[row.id]??{})})).filter(row=>columns.every(c=>(!filter[c.key]||String(row[c.key]??'').toLocaleLowerCase().includes(filter[c.key]!.toLocaleLowerCase()))&&(!facets[c.key]||facets[c.key]!.includes(String(row[c.key]??'')))));
  const compareRows=(a:typeof filteredRows[number],b:typeof filteredRows[number])=>{
    if(sort){const left=a[sort.key],right=b[sort.key];if(left==null)return right==null?0:1;if(right==null)return -1;
      return String(left).localeCompare(String(right),'vi',{numeric:true})*(sort.desc?-1:1);}
    if(!grouping)return 0;
    return String(b.startDate??'').localeCompare(String(a.startDate??''))||String(b.endDate??'').localeCompare(String(a.endDate??''))||String(a.id).localeCompare(String(b.id));
  };
  const sections=grouping?(()=>{const byKey=new Map<string,{key:string;label:string;rows:typeof filteredRows}>();
    for(const row of filteredRows){const group=grouping.resolve(row);const section=byKey.get(group.key);if(section)section.rows.push(row);else byKey.set(group.key,{...group,rows:[row]});}
    return [...byKey.values()].sort((a,b)=>grouping.order==='NEWEST_FIRST'?b.key.localeCompare(a.key):a.label.localeCompare(b.label,'vi',{numeric:true})||a.key.localeCompare(b.key)).map(section=>({...section,rows:section.rows.sort(compareRows)}));
  })():[];
  const shown=grouping?sections.flatMap(section=>collapsedGroups.includes(section.key)?[]:section.rows):filteredRows.sort(compareRows);
  const gridItems:Array<{kind:'group';key:string;label:string;count:number;ids:string[];collapsed:boolean}|{kind:'row';row:typeof shown[number];rowIndex:number}>=[];
  let visibleIndex=0;
  if(grouping)for(const section of sections){const collapsed=collapsedGroups.includes(section.key);
    gridItems.push({kind:'group',key:section.key,label:section.label,count:section.rows.length,ids:section.rows.map(row=>row.id),collapsed});
    if(!collapsed)for(const row of section.rows)gridItems.push({kind:'row',row,rowIndex:visibleIndex++});
  }else for(const row of shown)gridItems.push({kind:'row',row,rowIndex:visibleIndex++});
  const editable=(row:Record<string,unknown>,col:SupplyGridColumn)=>Boolean(canEdit&&!creatingIds.includes(String(row.id))&&canEditRow(row)&&col.editable&&(!col.editableWhen||col.editableWhen(row)));
  const apply=(patches:SupplyGridPatch[])=>{
    patches=patches.filter(p=>Object.keys(p.fields).length>0);if(!patches.length)return;
    for(const patch of patches)if(!draftsRef.current[patch.id])baselineVersions.current[patch.id]=patch.recordVersion;
    setClipboardError('');onCellsChange?.(patches);
    setDrafts(old=>{const next={...old};for(const patch of patches){next[patch.id]={...next[patch.id],...patch.fields};for(const [key,value] of Object.entries(patch.fields)){if(value===String(rows.find(r=>r.id===patch.id)?.[key]??''))delete next[patch.id]![key];}if(!Object.keys(next[patch.id]!).length)delete next[patch.id];}return next;});
  };
  const edit=(id:string,key:string,value:string)=>apply([{id,fields:{[key]:value},recordVersion:Number(rows.find(r=>r.id===id)?.recordVersion??0)}]);
  const pending=()=>[...new Set([...Object.keys(drafts),...draftRowIds])].map(id=>({id,fields:drafts[id]??{},recordVersion:baselineVersions.current[id]??Number(rows.find(r=>r.id===id)?.recordVersion??0)}));
  const selectedCells=()=>{
    if(cellRange)return shown.slice(Math.min(cellRange.r,cellRange.endR),Math.max(cellRange.r,cellRange.endR)+1).map(r=>({row:r,columns:visible.slice(Math.min(cellRange.c,cellRange.endC),Math.max(cellRange.c,cellRange.endC)+1)}));
    return shown.filter(r=>selection.includes(r.id)).map(row=>({row,columns:visible}));
  };
  const copySelection=()=>selectedCells().map(({row,columns:cols})=>cols.map(col=>{if(col.clipboardValue)return col.clipboardValue(row);const value=String(row[col.key]??'');return (col.optionsForRow?.(row)??col.options)?.find(o=>o.value===value)?.label??value;}).join('\t')).join('\n');
  const clearSelection=()=>{const cells=selectedCells();if(cells.length>50){setClipboardError('Mỗi lần sửa tối đa 50 dòng.');return;}apply(cells.map(({row,columns:cols})=>({id:row.id,recordVersion:Number(row.recordVersion??0),fields:Object.fromEntries(cols.filter(c=>editable(row,c)).map(c=>[c.key,'']))})));void autosaveRef.current(cells.map(v=>v.row.id));};
  const captureClipboard=()=>{
    const text=copySelection();
    if(!rowClipboard||cellRange||!selection.length)clearGridRows();
    const encoded=rowClipboard&&!cellRange&&selection.length?rememberGridRows({scope:rowClipboard.scope,text,rows:shown.filter(row=>selection.includes(row.id)).map(rowClipboard.fields)}):'';
    return{text,encoded};
  };
  const copyEvent=(event:React.ClipboardEvent,fallback='')=>{try{const value=captureClipboard();if(!value.text&&!value.encoded&&!fallback)return false;event.preventDefault();event.clipboardData.setData('text/plain',value.text||fallback);if(value.encoded)event.clipboardData.setData(GRID_ROW_CLIPBOARD_TYPE,value.encoded);return true;}catch(error){event.preventDefault();setClipboardError(error instanceof Error?error.message:'Không thể sao chép dữ liệu.');return false;}};
  const paste=(raw:string,r:number,c:number,encoded='')=>{try{
    const wholeRows=!cellRange&&selection.length>0;
    const typed=wholeRows&&rowClipboard?readGridRows(raw,rowClipboard.scope,encoded):null;
    let patches:SupplyGridPatch[];
    if(typed&&rowClipboard){
      const selectedRows=shown.filter(row=>selection.includes(row.id));
      const targets=selectedRows.length>1?selectedRows:shown.slice(r,r+typed.length);
      if(typed.length>1&&targets.length!==typed.length)throw Error('Chọn đủ số dòng đích để dán cả dòng.');
      if(targets.length>50)throw Error('Mỗi lần dán tối đa 50 dòng.');
      patches=targets.map((row,index)=>{const fields=typed[typed.length===1?0:index]!;const allowed=rowClipboard.fields(row);
        return{id:row.id,recordVersion:Number(row.recordVersion??0),fields:canEdit&&canEditRow(row)&&!creatingIds.includes(row.id)?Object.fromEntries(Object.entries(fields).filter(([key])=>Object.hasOwn(allowed,key))):{}};
      });
    }else{
      const values=bookingClipboardRows(raw),startColumn=wholeRows?0:c;
      if(r+values.length>shown.length)throw Error('Không đủ dòng để dán. Thêm hoặc nhân bản dòng trước khi dán.');
      patches=values.map((line,i)=>{const row=shown[r+i]!;return{id:row.id,recordVersion:Number(row.recordVersion??0),fields:Object.fromEntries(line.flatMap((value,j)=>{const col=visible[startColumn+j];return col&&editable(row,col)?[[col.key,col.allowCustomValue?bookingClipboardValue(value,col.type):bookingClipboardValue(value,col.type,col.optionsForRow?.(row)??col.options)]]:[];}))};});
    }
    apply(patches);void autosaveRef.current(patches.map(p=>p.id));
  }catch(e){setClipboardError(e instanceof Error?e.message:'Không thể dán dữ liệu.');}};
  const openMenu=(e:React.MouseEvent,r:number,c:number)=>{if((!spreadsheet&&!onCreate)||(r<0&&!onCreate))return;e.preventDefault();e.stopPropagation();const row=shown[r];const inRange=cellRange&&r>=Math.min(cellRange.r,cellRange.endR)&&r<=Math.max(cellRange.r,cellRange.endR)&&c>=Math.min(cellRange.c,cellRange.endC)&&c<=Math.max(cellRange.c,cellRange.endC);let ids=row?[row.id]:[];if(row&&selection.includes(row.id)){ids=selection;setCellRange(null);}else if(row&&inRange)ids=selectedCells().map(v=>v.row.id);else if(row){setSelection([]);setCellRange({r,c:Math.max(c,0),endR:r,endC:Math.max(c,0)});}setMenu({x:e.clientX,y:e.clientY,row:r,col:c,ids});};
  const selectRow=(i:number,shift:boolean)=>{const row=shown[i];if(!row)return;selectCell('');root.current?.focus({preventScroll:true});setCellRange(null);setSelection(old=>shift?[...new Set([...old,...shown.slice(Math.min(rowAnchor.current,i),Math.max(rowAnchor.current,i)+1).map(r=>r.id)])]:toggle(old,row.id));if(!shift)rowAnchor.current=i;};
  const toggle=(values:string[],key:string)=>values.includes(key)?values.filter(v=>v!==key):[...values,key];
  const leadingWidth=44+(rowNumbers?56:0);
  const pinLeft=(key:string)=>leadingWidth+visible.slice(0,visible.findIndex(c=>c.key===key)).filter(c=>options.pinned.includes(c.key)).reduce((sum,c)=>sum+(options.widths[c.key]??c.width??180),0);
  const updateColumnScroll=(event:React.DragEvent<HTMLDivElement>)=>{
    const element=viewport.current;if(!columnDrag.current||!element)return;
    const bounds=element.getBoundingClientRect(),pinnedWidth=leadingWidth+visible.filter(c=>options.pinned.includes(c.key)).reduce((sum,c)=>sum+(options.widths[c.key]??c.width??180),0);
    const velocity=columnDragAutoScrollDelta(event.clientX,Math.min(bounds.right,bounds.left+pinnedWidth),bounds.right);
    if(!velocity){stopColumnScroll();return;}event.preventDefault();scrollVelocity.current=velocity;
    if(scrollFrame.current!==null)return;
    const scroll=()=>{const grid=viewport.current;if(!grid||!scrollVelocity.current){scrollFrame.current=null;return;}const prior=grid.scrollLeft;grid.scrollLeft=Math.min(Math.max(0,grid.scrollWidth-grid.clientWidth),Math.max(0,prior+scrollVelocity.current));if(grid.scrollLeft===prior){scrollFrame.current=null;return;}scrollFrame.current=window.requestAnimationFrame(scroll);};
    scrollFrame.current=window.requestAnimationFrame(scroll);
  };
  const columnDropPosition=(event:React.DragEvent<HTMLElement>,key:string):ColumnDropPosition|null=>{
    const source=columnDrag.current;if(!source)return null;
    const sourcePinned=options.pinned.includes(source),targetPinned=options.pinned.includes(key),lastPinned=visible.filter(c=>options.pinned.includes(c.key)).at(-1)?.key;
    if(!sourcePinned&&targetPinned&&key===lastPinned)return 'after';
    if(sourcePinned!==targetPinned)return null;
    const bounds=event.currentTarget.getBoundingClientRect();return event.clientX>=bounds.left+bounds.width/2?'after':'before';
  };
  const dropColumn=(event:React.DragEvent<HTMLElement>,key:string)=>{
    const source=columnDrag.current,position=columnDropPosition(event,key);if(!source||!position){endColumnDrag();return;}event.preventDefault();event.stopPropagation();
    const boundary=!options.pinned.includes(source)&&options.pinned.includes(key),target=boundary?visible.find(c=>!options.pinned.includes(c.key))?.key:key;
    if(target)setOptions(current=>({...current,order:moveOrderedItemAt([...new Set([...current.order,...columns.map(c=>c.key)])],source,target,boundary?'before':position),pinned:options.pinned.includes(source)?moveOrderedItemAt(current.pinned,source,key,position):current.pinned}));
    setCellRange(null);endColumnDrag();
  };
  const pinColumn=(key:string)=>{setOptions(current=>({...current,pinned:current.pinned.includes(key)?current.pinned.filter(value=>value!==key):current.pinned.length<3?[...current.pinned,key]:current.pinned}));setCellRange(null);setMenu(null);};
  const draftValue=dirty?{drafts,versions:baselineVersions.current,rows:rows.filter(row=>draftRowIds.includes(row.id)||drafts[row.id])}:{};
  const autosave=useGridSave({scope:`${storageKey}:${location.pathname}`,enabled:Boolean(onSave||onCellsChange),value:draftValue,root,commit:saveRows,editing:Boolean(editing&&drafts[rows.find(row=>editing.startsWith(`${row.id}:`))?.id??'']),
    restore:value=>{const restored=(value.drafts??{}) as typeof drafts;baselineVersions.current={...(value.versions??{}) as Record<string,number>,...baselineVersions.current};setDrafts(old=>({...restored,...old}));onRestoreRows?.((value.rows??[]) as Array<Record<string,unknown>&{id:string}>);onCellsChange?.(Object.entries(restored).map(([id,fields])=>({id,fields,recordVersion:baselineVersions.current[id]??Number(rows.find(r=>r.id===id)?.recordVersion??0)})));}});
  autosaveRef.current=autosave.save;
  useEffect(()=>{if(!commitRequest)return;void(async()=>{
    for(let start=0;start<commitRequest.ids.length;start+=50)if(!await autosaveRef.current(commitRequest.ids.slice(start,start+50)))break;
    commitRequest.onComplete();
  })();},[commitRequest]);
  const move=(r:number,c:number,key:string,shift=false)=>{const next=gridDestination(r,c,shown.length,visible.length,key,shift);if(!next)return;const targetId=shown[next.row]!.id,targetKey=visible[next.column]!.key;setSelection([]);setCellRange(old=>shift&&key.startsWith('Arrow')&&old?{...old,endR:next.row,endC:next.column}:{r:next.row,c:next.column,endR:next.row,endC:next.column});window.setTimeout(()=>Array.from(root.current?.querySelectorAll<HTMLElement>("[data-grid-cell]")??[]).find(cell=>cell.dataset.rowId===targetId&&cell.dataset.fieldKey===targetKey)?.focus(),0);};
  const commitCell=(id:string,r:number,c:number,key?:string,shift=false)=>{setEditing(null);void autosave.save([id]);if(key)move(r,c,key,shift);};
  const editorKey=(event:React.KeyboardEvent,id:string,r:number,c:number,isSelect=false)=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();const col=visible[c];if(col)edit(id,col.key,editingValue.current);setEditing(null);return;}if(gridDestination(r,c,shown.length,visible.length,event.key,event.shiftKey)&&!(isSelect&&event.key.startsWith('Arrow'))){event.preventDefault();event.stopPropagation();commitCell(id,r,c,event.key,event.shiftKey);}};
  const selectCell=(id:string)=>{if(editing&&!editing.startsWith(`${id}:`)){const prior=rows.find(r=>editing.startsWith(`${r.id}:`));if(prior){setEditing(null);void autosave.save([prior.id]);}}};
  const menuItemStyle=(tone?:SupplyGridAction['tone'])=>selectionStyle==='campaign'?`block w-full px-4 py-2 text-left disabled:text-slate-400 ${tone==='primary'?'font-semibold text-vna-blue hover:bg-cyan-50':tone==='danger'?'text-rose-700 hover:bg-rose-50':tone==='positive'?'text-emerald-700 hover:bg-emerald-50':'text-slate-700 hover:bg-slate-50'}`:'block w-full rounded-lg p-2 text-left hover:bg-cyan-50 disabled:opacity-40';
  return <div ref={root} tabIndex={-1} className="supply-grid outline-none" onContextMenu={e=>{if(!(e.target as HTMLElement).closest('[data-grid-row],th,button,input,select'))openMenu(e,-1,-1);}} onCopy={e=>{if(editing||(e.target as HTMLElement).closest('input:not([type=checkbox]),textarea,select,[contenteditable=true]'))return;copyEvent(e);}} onCut={e=>{if(editing||!spreadsheet||(e.target as HTMLElement).closest('input:not([type=checkbox]),textarea,select,[contenteditable=true]'))return;if(copyEvent(e))clearSelection();}} onPaste={e=>{if(editing||!spreadsheet||!canEdit||(e.target as HTMLElement).closest('[data-grid-cell],input:not([type=checkbox]),textarea,select,[contenteditable=true]'))return;e.preventDefault();const first=shown.findIndex(r=>selection.includes(r.id));if(first>=0)paste(e.clipboardData.getData('text/plain'),first,0,e.clipboardData.getData(GRID_ROW_CLIPBOARD_TYPE));}}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
      {toolbar?.(pending(),selection)}
      {canEdit&&(onSave||onCellsChange)&&<><span role="status" className="text-xs text-slate-600">{autosave.status||'Enter / Tab / Arrow để lưu ô'}</span>{(Object.values(errors).some(Boolean)||dirty&&!editing)&&<Button size="sm" disabled={busy||autosave.busy} onClick={()=>{const failed=Object.keys(errors).filter(id=>errors[id]);void save(failed.length?failed:undefined);}}>Thử lưu lại</Button>}<Button size="sm" variant="secondary" disabled={!dirty||busy||autosave.busy} onClick={()=>{setDrafts({});setErrors({});setEditing(null);onDiscard?.();}}>Bỏ bản nhập dở</Button></>}
      <Button size="sm" variant={selectionStyle==='campaign'&&showFilters?'secondary':'ghost'} className={selectionStyle==='campaign'&&showFilters?'border-cyan-200 bg-cyan-50 text-vna-blue':''} aria-pressed={showFilters} title="Hiện hoặc ẩn bộ lọc tại tiêu đề cột" onClick={()=>setShowFilters(v=>!v)}><CpmsIcon name="filter" size={18}/><span className="ml-1">{selectionStyle==='campaign'?(showFilters?'Tắt bộ lọc':'Bật bộ lọc'):'Lọc cột'}</span></Button>
      <SupplyColumnChooser columns={columns} value={options} onChange={setOptions}/>
      <span className="ml-auto text-xs text-slate-500">{selection.length} chọn · {shown.length}{grouping&&shown.length!==filteredRows.length?`/${filteredRows.length}`:''} dòng{editableColumns.length&&canEdit?' · Double-click để sửa · Enter lưu ô':''}</span>
    </div>
    <div ref={viewport} data-supply-grid-scroll className={`max-h-[65vh] overflow-auto ${viewportClassName??(spreadsheet?'min-h-44':'')}`} onDragOver={updateColumnScroll} onDragLeave={event=>{const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)stopColumnScroll();}}><table className="w-full border-collapse text-left text-xs" style={{minWidth:visible.reduce((sum,c)=>sum+(options.widths[c.key]??c.width??180),leadingWidth),tableLayout:'fixed'}}><colgroup>{rowNumbers&&<col style={{width:56}}/>}<col style={{width:44}}/>{visible.map(c=><col key={c.key} style={{width:options.widths[c.key]??c.width??180}}/>)}</colgroup>
      <thead className="sticky top-0 z-20 bg-slate-50 text-slate-700">{columnLetters&&<tr className="bg-slate-100 text-center font-mono text-[11px] text-slate-500">{rowNumbers&&<th className="sticky left-0 z-30 border-b border-r bg-slate-100 p-1">#</th>}<th className="sticky z-30 border-b border-r bg-slate-100 p-1" style={{left:rowNumbers?56:0}}/>{visible.map((c,index)=><th key={c.key} className="border-b border-r bg-slate-100 p-1" style={options.pinned.includes(c.key)?{position:'sticky',left:pinLeft(c.key),zIndex:22}:undefined}>{columnAddress(index)}</th>)}</tr>}<tr>{rowNumbers&&<th className="sticky left-0 z-30 border-b bg-slate-50 p-3">{columnLetters?'#':'STT'}</th>}<th className="sticky z-30 border-b bg-slate-50 p-3" style={{left:rowNumbers?56:0}}><input aria-label="Chọn tất cả dòng" type="checkbox" checked={shown.length>0&&shown.every(r=>selection.includes(r.id))} onChange={e=>{setCellRange(null);setSelection(e.target.checked?shown.map(r=>r.id):[]);}}/></th>{visible.map(c=><th key={c.key} data-supply-column={c.key} data-pinned={options.pinned.includes(c.key)} draggable={columnReordering} title={columnReordering?`Kéo để đổi vị trí cột ${c.label}${options.pinned.includes(c.key)?' trong nhóm cột ghim':''}`:undefined} className={`relative border-b border-r px-3 py-2 align-top ${columnReordering?'cursor-grab select-none transition active:cursor-grabbing':''} ${columnDrop?.key===c.key&&draggedColumn!==c.key?`bg-cyan-50 ${columnDrop.position==='before'?'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-vna-blue':'after:absolute after:inset-y-0 after:right-0 after:w-1 after:bg-vna-blue'}`:'bg-slate-50'} ${draggedColumn===c.key?'opacity-55':''}`} style={options.pinned.includes(c.key)?{position:'sticky',left:pinLeft(c.key),zIndex:21}:undefined}
        onDragStart={event=>{if(!columnReordering||(event.target as HTMLElement).closest('input,select,textarea,[contenteditable=true],[role=separator]')){event.preventDefault();return;}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',c.key);columnDrag.current=c.key;setDraggedColumn(c.key);setColumnDrop({key:c.key,position:'before'});setMenu(null);}}
        onDragOver={event=>{const position=columnDropPosition(event,c.key);if(!columnDrag.current)return;event.dataTransfer.dropEffect=position?'move':'none';if(!position){setColumnDrop(null);return;}event.preventDefault();setColumnDrop({key:c.key,position});}}
        onDrop={event=>dropColumn(event,c.key)} onDragEnd={endColumnDrag}
        onContextMenu={event=>{if(!columnReordering||(event.target as HTMLElement).closest('input,select,textarea,[contenteditable=true]'))return;event.preventDefault();event.stopPropagation();setMenu({x:event.clientX,y:event.clientY,row:-1,col:-1,ids:[],column:c.key});}}>
        <button className="text-left font-semibold" title={c.hint??(c.editable?'Sắp xếp; double-click ô để sửa bản nháp':'Cột tính toán/tham chiếu chỉ đọc')} onClick={()=>setSort(s=>({key:c.key,desc:s?.key===c.key?!s.desc:false}))}>{c.label}</button>
        {typeof c.headerControl==='function'?c.headerControl(visible.indexOf(c)):c.headerControl}
        {showFilters&&<div className="mt-2 space-y-1"><input aria-label={`Lọc ${c.label}`} className="w-full rounded border px-2 py-1 font-normal" value={filter[c.key]??''} onChange={e=>setFilter(v=>({...v,[c.key]:e.target.value}))} placeholder="Chứa…"/><details><summary className="cursor-pointer font-normal">Chọn giá trị</summary><div className="absolute z-30 max-h-56 w-56 overflow-auto rounded border bg-white p-2 shadow-xl"><button className="mr-2 text-vna-blue" onClick={()=>setFacets(f=>{const next={...f};delete next[c.key];return next;})}>Tất cả</button><button className="text-vna-blue" onClick={()=>setFacets(f=>({...f,[c.key]:[]}))}>Bỏ chọn</button>{[...new Set(rows.map(r=>String(r[c.key]??'')))].sort().map(v=><label key={v} className="flex items-start gap-2 py-1 font-normal"><input type="checkbox" checked={!facets[c.key]||facets[c.key]!.includes(v)} onChange={()=>setFacets(f=>({...f,[c.key]:toggle(f[c.key]??[...new Set(rows.map(r=>String(r[c.key]??'')))],v)}))}/>{v||'(Trống)'}</label>)}</div></details></div>}
        <span role="separator" aria-label={`Đổi rộng ${c.label}`} aria-orientation="vertical" className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-cyan-500" onPointerDown={e=>{e.preventDefault();const x=e.clientX,width=options.widths[c.key]??c.width??180;const move=(event:PointerEvent)=>setOptions(o=>({...o,widths:{...o.widths,[c.key]:Math.max(90,Math.min(650,width+event.clientX-x))}}));const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);}}/>
      </th>)}</tr></thead><tbody>{gridItems.map(item=>{if(item.kind==='group')return <tr key={`group:${item.key}`} onContextMenu={e=>e.stopPropagation()} className="bg-cyan-50"><th scope="rowgroup" colSpan={visible.length+1+Number(rowNumbers)} className="sticky left-0 border-b border-cyan-200 px-3 py-2 text-left"><button type="button" aria-expanded={!item.collapsed} aria-label={`${item.collapsed?'Mở':'Thu'} nhóm ${item.label}`} className="inline-flex max-w-full items-center gap-2 text-left font-semibold text-vna-blue-deep" onClick={()=>{setCollapsedGroups(old=>item.collapsed?old.filter(key=>key!==item.key):[...old,item.key]);if(!item.collapsed)setSelection(old=>old.filter(id=>!item.ids.includes(id)));setCellRange(null);setEditing(null);setMenu(null);rowAnchor.current=0;}}><CpmsIcon name={item.collapsed?'expand':'collapse'} size={16}/><span className="truncate">{item.label}</span><span className="shrink-0 text-[11px] font-normal text-slate-600">{item.count} đặt chỗ</span></button></th></tr>;
        const {row,rowIndex}=item;return <tr data-grid-row key={row.id} onContextMenu={e=>openMenu(e,rowIndex,0)} className={errors[row.id]?'bg-rose-50':drafts[row.id]?'bg-amber-50':selection.includes(row.id)?'bg-cyan-50':'bg-white hover:bg-cyan-50/50'}>{rowNumbers&&<td className="sticky left-0 z-10 border-b bg-inherit p-3 align-top tabular-nums"><button aria-label={`Chọn dòng ${rowIndex+1}`} onClick={e=>selectRow(rowIndex,e.shiftKey)}>{rowIndex+1}</button></td>}<td className="sticky z-10 border-b bg-inherit p-3 align-top" style={{left:rowNumbers?56:0}}><input aria-label={`Chọn dòng ${rowIndex+1}`} type="checkbox" checked={selection.includes(row.id)} onClick={e=>e.stopPropagation()} onChange={e=>selectRow(rowIndex,'shiftKey' in e.nativeEvent&&e.nativeEvent.shiftKey===true)}/></td>{visible.map((c,colIndex)=>{
        const value=String(row[c.key]??'');const active=editing===`${row.id}:${c.key}`&&editable(row,c);
        const cellOptions=c.optionsForRow?.(row)??c.options, warning=c.validate?.(row);
        const softWarning=c.softWarning?.(row);
        const inRange=spreadsheet&&cellRange&&rowIndex>=Math.min(cellRange.r,cellRange.endR)&&rowIndex<=Math.max(cellRange.r,cellRange.endR)&&colIndex>=Math.min(cellRange.c,cellRange.endC)&&colIndex<=Math.max(cellRange.c,cellRange.endC);
        const begin=()=>{if(editable(row,c)&&autosave.ready){if(editing&&editing!==`${row.id}:${c.key}`){const prior=rows.find(r=>editing.startsWith(`${r.id}:`));if(prior)void autosave.save([prior.id]);}editingValue.current=value;setEditing(`${row.id}:${c.key}`);}else if(onOpen&&c.key==='name')onOpen(row.id);};
        return <td data-row-id={row.id} data-field-key={c.key} data-grid-cell={`${rowIndex}:${colIndex}`} key={c.key} tabIndex={0} className={`border-b border-r px-3 py-2 align-top outline-cyan-600 ${selectionStyle==='campaign'?'transition-colors hover:bg-cyan-50 focus:ring-2 focus:ring-inset focus:ring-vna-blue':''} ${warning?'text-rose-700 ring-1 ring-inset ring-rose-300':''} ${inRange?'bg-cyan-100/80':options.pinned.includes(c.key)?'bg-inherit':''}`} style={options.pinned.includes(c.key)?{position:'sticky',left:pinLeft(c.key),zIndex:10}:undefined}
          onPointerDown={e=>{if(spreadsheet&&!active&&e.button===0&&!(e.target as HTMLElement).closest('button,a')){e.preventDefault();selectCell(editing===`${row.id}:${c.key}`?row.id:'');e.currentTarget.focus();drag.current=true;setSelection([]);setCellRange(old=>e.shiftKey&&old?{...old,endR:rowIndex,endC:colIndex}:{r:rowIndex,c:colIndex,endR:rowIndex,endC:colIndex});}}}
          onPointerEnter={()=>{if(drag.current&&spreadsheet)setCellRange(old=>old?{...old,endR:rowIndex,endC:colIndex}:old);}}
          onContextMenu={e=>openMenu(e,rowIndex,colIndex)}
          title={warning??errors[row.id]??c.hint??(editable(row,c)?'Nháy đúp để sửa; Enter / Tab / Arrow để lưu':'Chỉ đọc — lấy từ dữ liệu gốc')}
          onDoubleClick={begin}
          onKeyDown={e=>{if(active||e.nativeEvent.isComposing)return;if(e.key==='Enter'||e.key==='F2'){e.preventDefault();begin();return;}if(e.key==='Delete'&&spreadsheet){e.preventDefault();clearSelection();}if(gridDestination(rowIndex,colIndex,shown.length,visible.length,e.key,e.shiftKey)&&spreadsheet){e.preventDefault();move(rowIndex,colIndex,e.key,e.shiftKey);}}}
          onCopy={e=>{if(active)return;e.stopPropagation();copyEvent(e,value);}}
          onCut={e=>{if(!spreadsheet||active||!canEdit)return;e.stopPropagation();if(copyEvent(e))clearSelection();}}
          onPaste={e=>{if(!canEdit)return;const text=e.clipboardData.getData('text/plain');if(active&&!text.includes('\t')&&!text.includes('\n'))return;e.preventDefault();e.stopPropagation();paste(text,rowIndex,colIndex,e.clipboardData.getData(GRID_ROW_CLIPBOARD_TYPE));}}>
          {active?(c.type==='rich-text'?<div className="relative z-30 w-[min(520px,70vw)] rounded-xl border border-cyan-400 bg-white p-2 shadow-xl" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><CampaignRichTextEditor value={richValue(value)} onChange={doc=>edit(row.id,c.key,JSON.stringify(doc))} onValidationError={setClipboardError} label={c.label}/><button className="mt-2 rounded bg-vna-blue px-3 py-1 text-white" onClick={()=>commitCell(row.id,rowIndex,colIndex)}>Xong và lưu</button></div>:cellOptions&&!c.allowCustomValue?<select autoFocus aria-label={`Sửa ${c.label}`} className="w-full rounded border border-cyan-500 bg-white p-1" value={value} onChange={e=>edit(row.id,c.key,e.target.value)} onBlur={e=>{if(e.relatedTarget instanceof Element&&root.current?.contains(e.relatedTarget)&&e.relatedTarget.closest("[data-grid-cell]"))commitCell(row.id,rowIndex,colIndex);}} onKeyDown={e=>editorKey(e,row.id,rowIndex,colIndex,true)}><option value="">Chọn {c.label.toLocaleLowerCase()}</option>{cellOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input list={c.allowCustomValue?`${gridId}-${c.key}-${row.id}`:undefined} autoFocus aria-label={`Sửa ${c.label}`} className="w-full rounded border border-cyan-500 bg-white p-1" type={c.type==='date'?'date':'text'} value={c.allowCustomValue?cellOptions?.find(o=>o.value===value)?.label??value:value} onChange={e=>edit(row.id,c.key,e.target.value)} onBlur={e=>{if(e.relatedTarget instanceof Element&&root.current?.contains(e.relatedTarget)&&e.relatedTarget.closest("[data-grid-cell]"))commitCell(row.id,rowIndex,colIndex);}} onKeyDown={e=>editorKey(e,row.id,rowIndex,colIndex)}/>):c.render?c.render(row):<span className="whitespace-pre-wrap break-words">{cellOptions?.find(o=>o.value===value)?.label??(c.type==='number'?formatSupply(value):value||'—')}</span>}
          {active&&c.allowCustomValue&&<datalist id={`${gridId}-${c.key}-${row.id}`}>{cellOptions?.filter(o=>o.value).map(o=><option key={o.value} value={o.label} label={o.value}/>)}</datalist>}
          {softWarning&&<span tabIndex={0} title={softWarning} aria-label={softWarning} className="ml-2 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Tự nhập</span>}
          {warning&&<p className="mt-1 text-[11px] text-rose-700">{warning}</p>}
          {colIndex===0&&errors[row.id]&&<p role="alert" className="mt-1 text-rose-700">{errors[row.id]}</p>}
        </td>;
      })}</tr>;})}</tbody></table>{!filteredRows.length&&<div className="flex min-h-44 flex-col items-center justify-center gap-3 p-10 text-center text-sm text-slate-500">{empty}{onCreate&&<button className="inline-flex items-center gap-2 rounded-xl border border-dashed border-cyan-300 px-6 py-4 text-sm text-vna-blue hover:bg-cyan-50" onClick={onCreate}><CpmsIcon name="add" size={20}/>{createLabel}</button>}</div>}</div>
    {clipboardError&&<p role="alert" className="px-4 py-2 text-sm text-rose-700">{clipboardError}</p>}
    {menu&&<div ref={menuRef} role="menu" aria-label="Thao tác bảng" className={`fixed z-[100] w-64 overflow-auto rounded-xl border border-slate-200 bg-white text-sm ${selectionStyle==='campaign'?'py-1.5 shadow-panel':'p-1 shadow-xl'}`} style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-270)),top:Math.max(8,Math.min(menu.y,window.innerHeight-370)),maxHeight:'min(360px,80vh)'}}>
      {menu.column?<><button role="menuitem" className={menuItemStyle('primary')} disabled={!options.pinned.includes(menu.column)&&options.pinned.length>=3} title="Ghim tối đa 3 cột thông tin" onClick={()=>pinColumn(menu.column!)}>{options.pinned.includes(menu.column)?'Bỏ ghim cột':'Ghim cột'}</button><div className="my-1 border-t border-slate-100"/><button role="menuitem" className={menuItemStyle()} disabled={visible.length<=1} onClick={()=>{setOptions(current=>({...current,hidden:[...new Set([...current.hidden,menu.column!])]}));setCellRange(null);setMenu(null);}}>Ẩn cột khỏi bảng hiển thị</button></>:menu.row<0?onCreate&&<button role="menuitem" className="flex w-full items-center gap-2 rounded-lg p-3 text-left text-vna-blue hover:bg-cyan-50" onClick={()=>{setMenu(null);onCreate();}}><CpmsIcon name="add" size={18}/>{createLabel}</button>:<>
        {editable(shown[menu.row]!,visible[menu.col]!)&&<button role="menuitem" className={menuItemStyle('primary')} onClick={()=>{const row=shown[menu.row]!,col=visible[menu.col]!;editingValue.current=String(row[col.key]??'');setEditing(`${row.id}:${col.key}`);setMenu(null);}}>Sửa ô</button>}
        {['Sao chép','Cắt','Dán'].map((label,i)=><button role="menuitem" key={label} disabled={i>0&&!canEdit} className={menuItemStyle()} onClick={()=>{void(async()=>{try{if(i===2)paste(await navigator.clipboard.readText(),menu.row,menu.col);else{await navigator.clipboard.writeText(captureClipboard().text);if(i===1)clearSelection();}}catch{setClipboardError('Trình duyệt chưa cho truy cập clipboard. Dùng Ctrl+C / Ctrl+X / Ctrl+V trên vùng đã chọn.');}finally{setMenu(null);root.current?.focus({preventScroll:true});}})();}}>{label}<span className="float-right text-xs text-slate-400">Ctrl+{['C','X','V'][i]}</span></button>)}
        {(contextActions?.(shown.filter(r=>menu.ids.includes(r.id)))??[]).map(a=><button role="menuitem" key={a.label} disabled={a.disabled} className={menuItemStyle(a.tone)} onClick={()=>{setMenu(null);a.run();}}>{a.label}</button>)}
      </>}
    </div>}
  </div>;
}
