import { useEffect, useRef, useState, type ClipboardEvent, type MouseEvent } from 'react';

/** Spreadsheet rectangles stay in local draft state until the enclosing form is saved. */
export function useBookingClipboard(rows:Record<string,string|null>[],keys:string[],canEdit:(row:number,key:string)=>boolean,update:(row:number,key:string,value:string)=>void){
  const [range,setRange]=useState<{r:number;c:number;endR:number;endC:number}|null>(null);
  const selected=(r:number,c:number)=>Boolean(range&&r>=Math.min(range.r,range.endR)&&r<=Math.max(range.r,range.endR)&&c>=Math.min(range.c,range.endC)&&c<=Math.max(range.c,range.endC));
  const copy=(e:ClipboardEvent,cut=false)=>{if(!range)return;const target=e.target as HTMLInputElement;if(range.r===range.endR&&range.c===range.endC&&target.selectionStart!==target.selectionEnd)return;
    const output=[];for(let r=Math.min(range.r,range.endR);r<=Math.max(range.r,range.endR);r++){const cells=[];for(let c=Math.min(range.c,range.endC);c<=Math.max(range.c,range.endC);c++){const key=keys[c]!;cells.push(rows[r]?.[key]??'');if(cut&&canEdit(r,key))update(r,key,'');}output.push(cells.join('\t'));}e.clipboardData.setData('text/plain',output.join('\n'));e.preventDefault();};
  return {table:{onClick:(e:MouseEvent)=>{const input=(e.target as HTMLElement).closest<HTMLInputElement>('[data-booking-row][data-booking-column]');if(!input)return;const r=Number(input.dataset.bookingRow),c=Number(input.dataset.bookingColumn);setRange(old=>e.shiftKey&&old?{...old,endR:r,endC:c}:{r,c,endR:r,endC:c});},onCopy:(e:ClipboardEvent)=>copy(e),onCut:(e:ClipboardEvent)=>copy(e,true)},cell:(row:number,key:string)=>({'data-booking-row':row,'data-booking-column':keys.indexOf(key),style:selected(row,keys.indexOf(key))?{backgroundColor:'#e0f2fe'}:undefined})};
}
export function useBookingSaveShortcut(save:()=>void){const ref=useRef(save);ref.current=save;useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();ref.current();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);}
