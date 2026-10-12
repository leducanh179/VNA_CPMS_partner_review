export interface GridChoice { value: string; label: string }
export function bookingClipboardValue(value:string,type?:string,choices?:GridChoice[]):string {
  const text=value.trim();
  if(choices){
    const byId=choices.find(o=>o.value===text);if(byId)return byId.value;
    const matches=choices.filter(o=>o.label.toLocaleLowerCase()===text.toLocaleLowerCase());
    if(matches.length!==1)throw Error(`Không xác định được lựa chọn “${text}”. Hãy chọn từ danh sách.`);
    return matches[0]!.value;
  }
  if(type==='date'){
    const match=text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    return match?`${match[3]}-${match[2]!.padStart(2,'0')}-${match[1]!.padStart(2,'0')}`:text;
  }
  if(type==='number'&&text.includes(','))return text.replace(/\./g,'').replace(',','.').replace(/\s/g,'');
  return value;
}
export function bookingClipboardRows(text:string):string[][] {
  const rows=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(line=>line.split('\t'));
  if(rows.length>50)throw Error('Mỗi lần dán tối đa 50 dòng.');
  if(rows.some(r=>r.length>100))throw Error('Mỗi lần dán tối đa 100 cột.');
  return rows;
}
