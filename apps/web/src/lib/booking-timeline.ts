export type BookingTimelineZoom='day'|'week'|'month'|'quarter'|'year';
const DAY=86400000;
const date=(s:string)=>new Date(`${s}T00:00:00Z`);
function startUnit(value:Date,zoom:BookingTimelineZoom) {
  const d=new Date(value);
  if(zoom==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if(['month','quarter','year'].includes(zoom))d.setUTCDate(1);
  if(zoom==='quarter')d.setUTCMonth(Math.floor(d.getUTCMonth()/3)*3);
  if(zoom==='year')d.setUTCMonth(0);
  return d;
}
function nextUnit(value:Date,zoom:BookingTimelineZoom) {
  const d=new Date(value);
  if(zoom==='day'||zoom==='week')d.setUTCDate(d.getUTCDate()+(zoom==='day'?1:7));
  else d.setUTCMonth(d.getUTCMonth()+({month:1,quarter:3,year:12}[zoom]));
  return d;
}
export function bookingTimelineScale(startDate:string,endDate:string,zoom:BookingTimelineZoom) {
  if(startDate>endDate)throw Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  const start=startUnit(date(startDate),zoom),end=nextUnit(startUnit(date(endDate),zoom),zoom),days=(+end-+start)/DAY;
  if(!Number.isFinite(days)||days<1||days>3660)throw Error('Chọn khoảng thời gian hợp lệ, tối đa 10 năm.');
  if(zoom==='day'&&days>366)throw Error('Chế độ ngày hiển thị tối đa 366 ngày; thu hẹp khoảng ngày hoặc chọn tuần/tháng.');
  const width=Math.max(900,Math.ceil(days*({day:46,week:10,month:3.2,quarter:1.5,year:0.65}[zoom])));
  const position=(value:Date)=>(+value-+start)/(+end-+start)*width;
  const ticks=[];
  for(let d=start;d<end;d=nextUnit(d,zoom)) {
    const next=nextUnit(d,zoom),label=zoom==='year'?`${d.getUTCFullYear()}`:zoom==='quarter'?`Q${Math.floor(d.getUTCMonth()/3)+1}/${d.getUTCFullYear()}`:zoom==='month'?`Th ${d.getUTCMonth()+1}/${d.getUTCFullYear()}`:`${d.getUTCDate()}/${d.getUTCMonth()+1}`;
    ticks.push({date:d,key:d.toISOString(),label,left:position(d),width:position(next)-position(d)});
  }
  return {width,ticks,position,bar:(from:string,to:string)=>{const left=position(date(from)),right=position(new Date(+date(to)+DAY));return {left:Math.max(0,left),width:Math.max(0,Math.min(width,right)-Math.max(0,left))};}};
}
