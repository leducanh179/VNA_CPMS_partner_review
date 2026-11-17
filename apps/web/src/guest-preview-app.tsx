import { Button, Card, CpmsIcon, type CpmsIconName } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { CampaignTimeline } from './components/campaign-table';
import { guestRoute, type GuestForm, type GuestSection } from './guest-preview-data';
import { AppLink } from './lib/router';
import { requestJson } from './lib/api';
import { campaignApprovalChipClass } from './lib/campaign-approval-color';
import { readCampaignViewMode, saveCampaignViewMode } from './lib/campaign-view-mode';
import { SharedCampaignPage } from './pages/shared-campaign-page';

type GuestCampaign = { id:string;code:string;name:string;requestingUnit:string;startDate:string|null;endDate:string|null; lifecycleState:string;qcttStatus:string|null;
  approvalStatus:string;departmentApproval:string;divisionApproval:string;departmentApprovers:string;divisionApprovers:string;levelLabel:string|null;
  effectiveStartDate:string|null;effectiveEndDate:string|null;departureStartDate:string|null;departureEndDate:string|null;
  primaryObjectiveLabel:string|null;primaryObjectiveOther:string|null;kpiText:string|null;descriptionRichText:unknown;
  additionalInformation:Array<{label:string;value:string}>;markets:Array<{marketName:string}>;provinces:Array<{provinceName:string}>;requestingUnits:Array<{displayName:string}>;
  approval?:{state:string;route:string|null;tasks:Array<{kind:string;state:string;mandatory:boolean;createdAt:string;completedAt:string|null;decision:{kind:string;decidedAt:string;person:string}|null}>;
    assignments:Array<{role:string;responsibility:string;person:string;startsAt:string}>;
    history:Array<{number:number;state:string;route:string|null;createdAt:string;closedAt:string|null;tasks:Array<{kind:string;state:string}>}>} };
type GuestContract = {id:string;code:string;name:string;number:string|null;vendor:string|null;supplyType:string;status:string;startDate:string|null;endDate:string|null};
type GuestBooking = {id:string;campaignLabel:string;contractCode:string;contractName:string;slotName:string;startDate:string;endDate:string;state:string;reportState:string};
type GuestMaterial = {id:string;materialId:string;title:string;group:string;type:string;campaign:string;status:string;updatedAt:string};
type GuestPlan = {id:string;code:string;name:string;hasPlan:boolean};
type GuestData = {campaigns:GuestCampaign[];contracts:GuestContract[];bookings:GuestBooking[];materials:GuestMaterial[];plans:GuestPlan[]};
const emptyData:GuestData={campaigns:[],contracts:[],bookings:[],materials:[],plans:[]};
const day=(value:string|null)=>value?new Intl.DateTimeFormat('vi-VN').format(new Date(`${value}T00:00:00`)):'—';

const navigation: { path: string; label: string; icon: CpmsIconName }[] = [
  { path: '/', label: 'Trợ lý AI', icon: 'comments' },
  { path: '/overview', label: 'Tổng quan', icon: 'overview' },
  { path: '/my-work', label: 'Việc của tôi', icon: 'acceptance' },
  { path: '/campaigns', label: 'Chiến dịch', icon: 'campaign' },
  { path: '/qctt-plans', label: 'Kế hoạch', icon: 'table' },
  { path: '/materials', label: 'Tư liệu', icon: 'material' },
  { path: '/contracts', label: 'Hợp đồng', icon: 'contract' },
  { path: '/bookings', label: 'Đặt chỗ', icon: 'booking' },
  { path: '/catalogs/qctt', label: 'Danh mục kênh', icon: 'table' },
  { path: '/directory', label: 'Danh bạ', icon: 'users' },
];

type DemoTable = { title: string; description: string; columns: string[]; rows: string[][]; create?: { label: string; path: string } };
function moduleTable(section:GuestSection,data:GuestData):DemoTable {
  if(section==='contracts') return {title:'Kênh & Hợp đồng',description:'Hợp đồng hiện có · Chỉ xem bảng chính.',columns:['MÃ HỢP ĐỒNG','TÊN HỢP ĐỒNG','SỐ HỢP ĐỒNG','NHÀ CUNG CẤP','PHÂN LOẠI','HIỆU LỰC','TRẠNG THÁI'],rows:data.contracts.map(r=>[r.code,r.name,r.number??'—',r.vendor??'—',r.supplyType,`${day(r.startDate)} – ${day(r.endDate)}`,r.status]),create:{label:'Thử nhập hợp đồng',path:'/contracts/new'}};
  if(section==='bookings') return {title:'Đặt chỗ',description:'Đặt chỗ hiện có · Chỉ xem bảng chính.',columns:['CHIẾN DỊCH','HỢP ĐỒNG','SLOT','THỜI GIAN','TRẠNG THÁI'],rows:data.bookings.map(r=>[r.campaignLabel,`${r.contractCode} · ${r.contractName}`,r.slotName,`${day(r.startDate)} – ${day(r.endDate)}`,r.state]),create:{label:'Thử nhập đặt chỗ',path:'/bookings/new'}};
  if(section==='materials') return {title:'Tư liệu',description:'Tư liệu hiện có trong CPMS.',columns:['MÃ TƯ LIỆU','TIÊU ĐỀ','NHÓM','LOẠI','CHIẾN DỊCH','TRẠNG THÁI'],rows:data.materials.map(r=>[r.materialId,r.title,r.group,r.type,r.campaign,r.status]),create:{label:'Thử nhập tư liệu',path:'/materials/new'}};
  if(section==='qctt-plans') return {title:'Kế hoạch QCTT',description:'Tình trạng kế hoạch của chiến dịch hiện có.',columns:['MÃ CHIẾN DỊCH','CHIẾN DỊCH','KẾ HOẠCH'],rows:data.plans.map(r=>[r.code,r.name,r.hasPlan?'Đã khởi tạo':'Chưa khởi tạo'])};
  return {title:'Việc của tôi',description:'Khách không có công việc cá nhân. Đăng nhập để xem việc được phân công.',columns:['CÔNG VIỆC'],rows:[]};
}

const formContent: Record<GuestForm, { title: string; returnPath: string; sections: { title: string; fields: string[] }[] }> = {
  campaign: { title: 'Tạo chiến dịch mới', returnPath: '/campaigns', sections: [
    { title: 'Thông tin chính', fields: ['Tên chiến dịch *', 'Mã chiến dịch', 'Cấp chiến dịch *'] },
    { title: 'Thời gian', fields: ['Tự động tính thời gian QCTT', 'Bắt đầu hiệu lực chương trình/xuất vé', 'Kết thúc hiệu lực chương trình/xuất vé', 'Bắt đầu hiệu lực khởi hành', 'Kết thúc hiệu lực khởi hành', 'Bắt đầu QCTT', 'Kết thúc QCTT'] },
    { title: 'Mục tiêu và nội dung', fields: ['Mục tiêu chính', 'Chỉ tiêu', 'Trụ cột nội dung', 'Chủ đề nội dung', 'Mô tả chiến dịch'] },
    { title: 'Phạm vi thị trường', fields: ['Việt Nam', 'Tỉnh, thành phố', 'Quốc tế', 'Khu vực', 'Thị trường'] },
    { title: 'Đơn vị yêu cầu', fields: ['Đơn vị yêu cầu'] },
    { title: 'Thông tin bổ sung', fields: ['Tên thông tin', 'Nội dung'] },
  ] },
  contract: { title: 'Tạo hợp đồng', returnPath: '/contracts', sections: [
    { title: 'Hồ sơ và phân loại hợp đồng', fields: ['Mã nhà cung cấp', 'Mã hợp đồng', 'Tên hợp đồng', 'Phân loại', 'Số hợp đồng', 'Link hồ sơ'] },
    { title: 'Thông tin các bên', fields: ['Nhà cung cấp', 'Bên hưởng dịch vụ'] },
    { title: 'Hiệu lực và thị trường áp dụng', fields: ['Ngày bắt đầu', 'Ngày kết thúc', 'Phạm vi thị trường'] },
    { title: 'Đầu mối quản lý và triển khai', fields: ['Lãnh đạo phòng', 'Chuyên viên quản lý', 'Đầu mối nhà cung cấp'] },
    { title: 'Giá trị hợp đồng', fields: ['Giá trị trước VAT', 'VAT', 'Đơn vị tiền tệ', 'Tổng giá trị sau VAT'] },
    { title: 'Kỳ phân bổ và hạng mục slot', fields: ['Kỳ phân bổ', 'Giai đoạn', 'Slot', 'Đơn vị', 'Số lượng'] },
    { title: 'Lý do và căn cứ', fields: ['Lý do', 'Căn cứ / liên kết tài liệu'] },
  ] },
  booking: { title: 'Tạo đặt chỗ', returnPath: '/bookings', sections: [
    { title: '1. Thông tin dùng chung', fields: ['Chiến dịch', 'Hợp đồng', 'Kỳ phân bổ', 'CQĐV khai thác', 'Ngày bắt đầu tổng thể', 'Ngày kết thúc tổng thể'] },
    { title: '2. Chọn slot và nhập số lượng', fields: ['Slot quảng cáo', 'Ngày bắt đầu', 'Ngày kết thúc', 'Số lượng', 'Tư liệu (URL)', 'Ghi chú'] },
  ] },
  material: { title: 'Tạo tư liệu mới', returnPath: '/materials', sections: [
    { title: 'Phạm vi truy cập', fields: ['Chế độ chia sẻ', 'Quyền xem'] },
    { title: 'Chiến dịch sử dụng tư liệu', fields: ['Chiến dịch chuẩn', 'Tên Chiến dịch khác'] },
    { title: 'Thông tin chính', fields: ['Nhóm tư liệu', 'Loại tư liệu', 'Ngôn ngữ', 'Tiêu đề tư liệu'] },
    { title: 'Đường dẫn tư liệu', fields: ['Link tư liệu'] },
    { title: 'Mô tả tư liệu', fields: ['Mô tả tư liệu'] },
    { title: 'Phạm vi thị trường', fields: ['Việt Nam', 'Khu vực', 'Thị trường'] },
    { title: 'Ghi chú', fields: ['Ghi chú'] },
    { title: 'Lưu trữ và xuất bản', fields: ['Mã tư liệu', 'Ngày cập nhật', 'Tình trạng xuất bản'] },
  ] },
};

function DemoNotice() {
  return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    Chế độ Guest công khai · Dữ liệu hiển thị lấy từ CPMS. Bản nhập thử chỉ lưu trong tab trình duyệt; không ghi lên hệ thống.
  </div>;
}

function DemoTableView({ data }: { data: DemoTable }) {
  const [query, setQuery] = useState('');
  const visible = data.rows.filter(row => row.some(value => value.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))));
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold text-vna-blue-deep">{data.title}</h1><p className="mt-2 text-sm text-slate-600">{data.description}</p></div>
      {data.create && <AppLink to={data.create.path} className="inline-flex items-center gap-2 rounded-xl bg-vna-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-vna-blue-deep"><CpmsIcon name="add" />{data.create.label}</AppLink>}
    </header>
    <label className="block w-fit text-sm font-semibold">Tìm trong bảng<input aria-label={`Tìm ${data.title}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Nhập từ khóa…" className="mt-1 block min-w-64 rounded-lg border px-3 py-2 font-normal" /></label>
    <Card className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{data.columns.map(column => <th key={column} className="border-b px-5 py-4">{column}</th>)}</tr></thead><tbody>{visible.map((row,index) => <tr key={`${row[0]}-${index}`} className="border-b last:border-b-0">{row.map((cell, columnIndex) => <td key={`${row[0]}-${index}-${columnIndex}`} className="px-5 py-4 text-slate-700">{cell}</td>)}</tr>)}{!visible.length&&<tr><td colSpan={data.columns.length} className="p-8 text-center text-slate-500">Không có dòng phù hợp.</td></tr>}</tbody></table></Card>
  </div>;
}


function CampaignList({campaigns}:{campaigns:GuestCampaign[]}) {
  const [query,setQuery]=useState(''),[view,setView]=useState(() => readCampaignViewMode('public-guest'));
  useEffect(() => { saveCampaignViewMode(view, 'public-guest'); }, [view]);
  const visible=campaigns.filter(c=>`${c.code} ${c.name} ${c.requestingUnit}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold text-vna-blue-deep">Chiến dịch</h1><p className="mt-2 text-sm text-slate-600">Danh sách chiến dịch hiện có trong CPMS.</p></div>
      <AppLink to="/campaigns/new" className="inline-flex items-center gap-2 rounded-xl bg-vna-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-vna-blue-deep"><CpmsIcon name="add" />Thử nhập chiến dịch</AppLink>
    </header><div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-semibold">Tìm chiến dịch<input aria-label="Tìm chiến dịch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Mã, tên, đơn vị…" className="mt-1 block min-w-64 rounded-lg border px-3 py-2 font-normal"/></label><div className="flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={()=>setView('table')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view==='table'?'bg-white text-vna-blue shadow-sm':''}`}>Bảng</button><button type="button" onClick={()=>setView('timeline')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view==='timeline'?'bg-white text-vna-blue shadow-sm':''}`}>Timeline</button></div></div>
    {view==='timeline'?<Card className="overflow-hidden"><CampaignTimeline campaigns={visible}/></Card>:<Card className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['MÃ', 'TÊN CHIẾN DỊCH', 'ĐƠN VỊ YÊU CẦU', 'THỜI GIAN', 'TÌNH TRẠNG PHÊ DUYỆT'].map(column => <th key={column} className="border-b px-5 py-4">{column}</th>)}</tr></thead><tbody>{visible.map(c=><tr key={c.id} className="border-b last:border-b-0"><td className="px-5 py-4 font-mono text-xs">{c.code}</td><td className="px-5 py-4"><AppLink className="font-semibold text-vna-blue hover:underline" to={`/campaigns/${c.id}`}>{c.name}</AppLink></td><td className="px-5 py-4">{c.requestingUnit}</td><td className="whitespace-nowrap px-5 py-4">{day(c.startDate)} – {day(c.endDate)}</td><td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${campaignApprovalChipClass(c.approvalStatus)}`}>{c.approvalStatus}</span></td></tr>)}{!visible.length&&<tr><td colSpan={5} className="p-8 text-center text-slate-500">Chưa có chiến dịch phù hợp.</td></tr>}</tbody></table></Card>}
  </div>;
}

function FormPreview({ form }: { form: GuestForm }) {
  const data = formContent[form];
  const storageKey=`cpms:guest-draft:${form}`;
  const [values,setValues]=useState<Record<string,string>>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)??'{}') as Record<string,string>;}catch{return {};}});
  useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify(values));},[storageKey,values]);
  return <div className="mx-auto max-w-6xl space-y-5"><AppLink to={data.returnPath} className="inline-flex items-center gap-2 text-sm font-semibold text-vna-blue"><CpmsIcon name="back" />Về danh sách</AppLink>
    <header><p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Thử nhập · Chỉ lưu trong tab trình duyệt</p><h1 className="mt-2 text-3xl font-semibold text-vna-blue-deep">{data.title}</h1><p className="mt-2 text-sm text-slate-600">Nhập thử tự do. CPMS không nhận hoặc lưu dữ liệu này; đóng tab sẽ xóa bản nháp.</p></header>
    <div className="space-y-5">{data.sections.map(section => <Card key={section.title} className="overflow-hidden"><div className="border-b bg-slate-50 px-5 py-4"><h2 className="font-semibold text-slate-900">{section.title}</h2></div><div className="grid gap-5 p-5 md:grid-cols-2">{section.fields.map(field => <PreviewField key={field} label={field} value={values[field]??''} onChange={value=>setValues(old=>({...old,[field]:value}))}/>)}</div></Card>)}<div className="flex justify-end"><Button variant="secondary" onClick={()=>{sessionStorage.removeItem(storageKey);setValues({});}}>Xóa bản nhập thử</Button></div></div>
  </div>;
}

function PreviewField({ label,value,onChange }: { label: string;value:string;onChange(value:string):void }) {
  const className = 'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm';
  if (['Việt Nam', 'Quốc tế', 'Tự động tính thời gian QCTT'].includes(label)) return <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={value==='true'} onChange={e=>onChange(String(e.target.checked))}/>{label}</label>;
  const longText = /Mô tả|Chỉ tiêu|Nội dung|Lý do|Căn cứ|Ghi chú/.test(label);
  const date = /^(Ngày|Bắt đầu|Kết thúc)/.test(label);
  return <label className="block text-sm font-semibold text-slate-700">{label}{longText ? <textarea aria-label={label} value={value} onChange={e=>onChange(e.target.value)} className={`${className} min-h-20 resize-y`} /> : <input aria-label={label} value={value} onChange={e=>onChange(e.target.value)} type={date ? 'date' : 'text'} className={className} />}</label>;
}

function NoAccess() {
  return <Card className="mx-auto max-w-2xl p-8 text-center"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-500"><CpmsIcon name="locked" size={24}/></span><h1 className="mt-4 text-2xl font-semibold">Không có quyền xem</h1><p className="mt-2 text-sm text-slate-600">Nội dung này chỉ dành cho người dùng CPMS đã đăng nhập và được cấp quyền.</p><div className="mt-5 flex justify-center gap-3"><AppLink className="rounded-xl border px-4 py-2 text-sm font-semibold text-vna-blue" to="/overview">Về Tổng quan</AppLink><AppLink className="rounded-xl bg-vna-blue px-4 py-2 text-sm font-semibold text-white" to="/login">Đăng nhập</AppLink></div></Card>;
}

function AssistantPreview({ panel = false, onClose }: { panel?: boolean; onClose?: () => void }) {
  return <section aria-label="ChatGPT xem thử" className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${panel ? 'fixed inset-y-3 right-3 z-[80] w-[min(440px,calc(100vw-24px))] shadow-2xl' : 'min-h-[560px]'}`}>
    <header className="flex items-center gap-3 border-b px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-vna-blue text-white"><CpmsIcon name="comments" size={20}/></span><div className="min-w-0 flex-1"><h2 className="font-semibold text-vna-blue-deep">ChatGPT trong CPMS</h2><p className="text-xs text-slate-500">Chế độ xem thử · Chưa có hội thoại</p></div>{onClose && <button type="button" aria-label="Đóng ChatGPT sidepanel" title="Đóng ChatGPT sidepanel" onClick={onClose} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><CpmsIcon name="windowClose" /></button>}</header>
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center"><h3 className="text-xl font-semibold text-slate-900">Trợ lý AI hỗ trợ công việc truyền thông</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Khách có thể xem bố cục. Đăng nhập để đặt câu hỏi, xem lịch sử riêng và tra cứu theo quyền được cấp.</p></div>
    <div className="border-t p-4"><label className="block text-xs font-semibold text-slate-600">Đặt câu hỏi với ChatGPT<textarea aria-label="Câu hỏi ChatGPT bị khóa" disabled placeholder="Đăng nhập để đặt câu hỏi" className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" /></label><Button disabled className="mt-2 w-full">Gửi câu hỏi</Button></div>
  </section>;
}

function Overview({data}:{data:GuestData}) {
  return <div className="space-y-6"><div className="rounded-2xl bg-vna-blue-deep p-8 text-white"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-vna-gold">Tổng quan CPMS</p><h1 className="mt-4 text-3xl font-semibold">Điều phối chiến dịch trong một nguồn dữ liệu thống nhất.</h1><p className="mt-3 text-sm text-cyan-100">Timeline và chỉ số lấy từ chiến dịch hiện có trong CPMS.</p></div><div className="grid gap-4 md:grid-cols-4">{[['Tổng chiến dịch',data.campaigns.length],['Đang triển khai',data.campaigns.filter(c=>['Đang triển khai','RUNNING'].includes(c.qcttStatus??c.lifecycleState)).length],['Hợp đồng',data.contracts.length],['Đặt chỗ',data.bookings.length]].map(([label,number])=><Card key={label} className="p-5"><p className="text-sm text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold text-vna-blue-deep">{number}</p></Card>)}</div><CampaignList campaigns={data.campaigns}/></div>;
}

export function GuestPreviewApp({ pathname }: { pathname: string }) {
  const route = guestRoute(pathname);
  const [aiOpen, setAiOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [data,setData]=useState<GuestData>(emptyData),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  useEffect(()=>{if(route.kind==='denied'||route.kind==='form'||route.kind==='campaign-info'||route.kind==='section'&&['ai','my-work'].includes(route.section)){setLoading(false);return;}
    let active=true;setLoading(true);
    const section = route.kind==='section' ? route.section : 'overview';
    const paths = section==='overview' ? ['campaigns','contracts','bookings'] : [section==='qctt-plans'?'plans':section];
    void Promise.all(paths.map(async path => [path,await requestJson<GuestData[keyof GuestData]>(`/public/guest/${path}`)] as const))
      .then(results=>{if(active){setData(previous => ({...previous,...Object.fromEntries(results)}));setLoadError('');}})
      .catch(e=>{if(active)setLoadError(e instanceof Error?e.message:'Không tải được dữ liệu CPMS.');})
      .finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[route.kind,route.kind==='section'?route.section:null]);
  const active = (path: string) => path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
  return <div data-guest-preview className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#edf7f7_100%)]">
    <aside className="fixed inset-y-0 left-0 z-40 flex w-20 flex-col border-r border-slate-200 bg-white lg:w-64"><AppLink to="/" className="border-b px-3 py-5 lg:px-5" aria-label="Về trang xem thử CPMS"><div className="hidden overflow-hidden rounded-xl bg-[#086985] lg:block"><img src="/brand/vna-logo-horizontal-blue.png" alt="Vietnam Airlines" /></div><div className="mx-auto grid size-11 place-items-center rounded-xl bg-vna-blue-deep text-xs font-bold text-vna-gold lg:hidden">VNA</div><p className="mt-3 hidden font-semibold text-vna-blue-deep lg:block">CPMS</p></AppLink>
      <nav aria-label="Điều hướng xem thử" className="flex-1 space-y-1 overflow-y-auto px-2 py-4 lg:px-3">{navigation.map(item => <AppLink key={item.path} to={item.path} title={item.label} aria-current={active(item.path) ? 'page' : undefined} className={`flex min-h-11 items-center justify-center gap-3 rounded-xl px-2 text-sm font-semibold lg:justify-start lg:px-3 ${active(item.path) ? 'bg-cyan-50 text-vna-blue' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${active(item.path) ? 'bg-vna-blue text-white' : 'bg-slate-100 text-slate-500'}`}><CpmsIcon name={item.icon} size={20}/></span><span className="hidden lg:inline">{item.label}</span></AppLink>)}</nav>
      <div className="border-t p-2 lg:p-3"><p className="mb-2 hidden rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 lg:block">Khách · Dữ liệu CPMS · Chỉ xem</p><AppLink to="/login" className="flex min-h-10 items-center justify-center rounded-lg bg-vna-blue px-2 text-xs font-semibold text-white hover:bg-vna-blue-deep">Đăng nhập CPMS</AppLink></div>
    </aside>
    <div className="min-h-screen pl-20 lg:pl-64"><main className="space-y-5 px-4 py-6 lg:px-7 lg:py-7"><DemoNotice/><div className="flex justify-end"><button type="button" onClick={() => setAiOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-vna-blue shadow-sm hover:bg-cyan-50"><CpmsIcon name="comments" />Mở ChatGPT sidepanel</button></div>
      {loadError?<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{loadError}</p>:null}
      {route.kind === 'denied' ? <NoAccess/> : route.kind === 'campaign-info' ? <SharedCampaignPage key={route.id} id={route.id} standalone={false}/> : route.kind === 'form' ? <FormPreview form={route.form}/> : route.section === 'ai' ? <AssistantPreview/> : loading ? <p role="status" className="p-5 text-sm text-slate-600">Đang tải dữ liệu CPMS…</p> : route.section === 'overview' ? <Overview data={data}/> : route.section === 'campaigns' ? <CampaignList campaigns={data.campaigns}/> : <DemoTableView data={moduleTable(route.section,data)}/>}
    </main></div>
    <button type="button" onClick={() => setNotesOpen(true)} aria-label="Mở ghi chú" title="Mở ghi chú" className="fixed bottom-5 right-5 z-40 grid size-11 place-items-center rounded-full bg-vna-blue text-white shadow-lg hover:bg-vna-blue-deep"><CpmsIcon name="notes" size={20}/></button>
    {aiOpen && <AssistantPreview panel onClose={() => setAiOpen(false)}/>}
    {notesOpen && <aside aria-label="Ghi chú xem thử" className="fixed inset-y-3 right-3 z-[90] flex w-[min(440px,calc(100vw-24px))] flex-col rounded-2xl border bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-semibold">Ghi chú cá nhân</h2><button type="button" aria-label="Đóng ghi chú" title="Đóng ghi chú" onClick={() => setNotesOpen(false)}><CpmsIcon name="windowClose"/></button></header><div className="flex flex-1 flex-col items-center justify-center px-6 text-center"><CpmsIcon name="notes" size={28}/><p className="mt-4 font-semibold">Ghi chú chỉ dành cho người đăng nhập</p><p className="mt-2 text-sm text-slate-600">Khách xem được bố cục panel nhưng không xem, tạo hoặc lưu ghi chú cá nhân.</p></div></aside>}
  </div>;
}
