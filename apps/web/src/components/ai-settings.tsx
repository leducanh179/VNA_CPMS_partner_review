import type { AiLibraryResult, AiPolicyView, AiWorkspacePolicy } from '@cpms/ai-contracts';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { AiLibraryResults } from './ai-library-results';

export function AiSettings() {
  const [settings,setSettings] = useState<AiPolicyView | null>(null), [draft,setDraft] = useState<AiWorkspacePolicy | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const [query,setQuery] = useState(''), [mediaType,setMediaType] = useState('PHOTO'), [results,setResults] = useState<AiLibraryResult[]>([]);
  const dirty = Boolean(draft && settings && JSON.stringify(draft)!==JSON.stringify(settings.draft));
  useUnsavedChanges(dirty);
  const apply = (value: AiPolicyView) => {setSettings(value);setDraft(value.draft);};
  useEffect(() => {let active=true;void requestJson<AiPolicyView>('/ai/workspace/settings').then(value=>{if(active)apply(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const update = <K extends keyof AiWorkspacePolicy>(key: K,value: AiWorkspacePolicy[K]) => setDraft(current=>current ? {...current,[key]:value}:current);
  const command = async (path:string,body?:unknown) => {
    setBusy(true);setError('');setMessage('');
    try {apply(await requestJson<AiPolicyView>(`/ai/workspace/${path}`,{method:'POST',...(body ? {body:JSON.stringify(body)}:{})}));setMessage(path==='library/sync'?'Đã đồng bộ chỉ mục thư viện.':'Đã lưu cấu hình.');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const test = async () => {
    setBusy(true);setError('');
    try{const value=await requestJson<{items:AiLibraryResult[];note:string}>('/ai/workspace/library/test',{method:'POST',body:JSON.stringify({query,mediaType})});setResults(value.items);setMessage(value.note);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const inputClass='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  return <div className="space-y-6 p-5 lg:p-6">
    <header><h2 className="text-lg font-semibold">Thiết lập Trợ lý AI</h2><p className="mt-1 text-sm text-slate-600">Quy tắc dùng chung, thư viện tư liệu và tính năng nhập liệu.</p></header>
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {message&&<p role="status" className="rounded-lg bg-cyan-50 p-3 text-sm text-vna-blue">{message}</p>}
    {!draft||!settings?<p>Đang tải cấu hình…</p>:<>
      <div className="rounded-xl bg-slate-50 p-3 text-sm"><p>Đang áp dụng: phiên bản {settings.version || 'mặc định'} · Bản nháp {settings.draftVersion}</p><p className="mt-1 text-xs text-slate-500">Thử nghiệm giữ nguyên tài khoản được chỉ định và trần tổng 100.000 đ/tháng. Mọi thao tác ghi phải được người dùng xác nhận và đủ quyền CPMS.</p></div>
      <fieldset disabled={busy} className="space-y-4"><legend className="mb-3 font-semibold">Tính năng</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.agentEnabled} onChange={e=>update('agentEnabled',e.target.checked)}/>Cho phép đề xuất nhập liệu Chiến dịch và gửi theo quy trình Ban TT</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.libraryEnabled} onChange={e=>update('libraryEnabled',e.target.checked)}/>Tra thư viện tư liệu QCTT</label>
        <label className="block text-sm">Google Sheet thư viện (ID hoặc đường link)<input className={inputClass} value={draft.spreadsheetId} onChange={e=>update('spreadsheetId',e.target.value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? e.target.value.trim())}/></label>
        <label className="block text-sm">Giới hạn folder gốc (mỗi dòng một ID; để trống để dùng tất cả folder trong Sheet)<textarea rows={3} className={inputClass} value={draft.allowedRootIds.join('\n')} onChange={e=>update('allowedRootIds',e.target.value.split(/\s+/).filter(Boolean))}/></label>
        <p className="text-xs text-slate-500">Đọc tab DriveIndex qua kết nối Google Drive dùng chung. CPMS chỉ lưu metadata và link, không tải kho file về VPS. Nội dung chia sẻ của thư viện dùng chung cho người đã được cấp quyền dùng AI; quyền mở file do Drive quản lý.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.includeUnknownRights} onChange={e=>update('includeUnknownRights',e.target.checked)}/>Cho hiện tư liệu chưa rõ hiệu lực, kèm nhãn “Chưa có thông tin”</label>
        <p className="text-xs text-slate-500">Tư liệu hết hiệu lực, không còn ACTIVE hoặc có link không hợp lệ không được gợi ý.</p>
        <label className="block text-sm">Nguyên tắc chọn tư liệu<textarea rows={4} maxLength={1000} className={inputClass} value={draft.selectionRules} onChange={e=>update('selectionRules',e.target.value)}/></label>
        <label className="block text-sm">Hướng dẫn của quản trị viên và cách trả lời<textarea rows={5} maxLength={1500} className={inputClass} value={draft.instructions} onChange={e=>update('instructions',e.target.value)} placeholder="Ví dụ: Ưu tiên tư liệu chính thức, nói rõ lý do phù hợp, ghi nhãn hiệu lực, giữ câu trả lời ngắn gọn…"/></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Số câu hỏi làm rõ tối đa<select className={inputClass} value={draft.maxQuestions} onChange={e=>update('maxQuestions',Number(e.target.value))}>{[0,1,2].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-sm">Số kết quả tối đa<select className={inputClass} value={draft.maxResults} onChange={e=>update('maxResults',Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-sm">Trình bày kết quả<select className={inputClass} value={draft.answerFormat} onChange={e=>update('answerFormat',e.target.value as 'CARDS'|'TABLE')}><option value="CARDS">Thẻ tư liệu</option><option value="TABLE">Bảng gọn</option></select></label>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void command('settings/draft',{expectedVersion:settings.draftVersion,policy:draft})}><CpmsIcon name="save"/>Lưu bản nháp</Button>
        <Button variant="secondary" disabled={busy||dirty||!settings.draftVersion} onClick={()=>void command('settings/publish',{expectedVersion:settings.draftVersion})}>Phát hành cấu hình</Button></div>
      <section className="space-y-3 border-t pt-5"><h3 className="font-semibold">Chỉ mục thư viện</h3>
        <p className="text-sm">{settings.library.count.toLocaleString('vi-VN')} dòng · {settings.library.syncedAt?`Đồng bộ ${new Date(settings.library.syncedAt).toLocaleString('vi-VN')}`:'Chưa đồng bộ'}</p>
        <Button variant="secondary" disabled={busy||dirty||!settings.published.libraryEnabled} onClick={()=>void command('library/sync')}><CpmsIcon name="refresh"/>Đồng bộ từ Google Sheet</Button>
        <p className="text-xs text-slate-500">Đồng bộ theo nút này. Khi lỗi, giữ nguyên chỉ mục trước. Ngày cập nhật của từng dòng nguồn có thể cũ hơn ngày đồng bộ CPMS.</p>
        <div className="flex flex-wrap items-end gap-2"><label className="min-w-40 flex-1 text-sm">Thử tìm trên bản nháp<input className={inputClass} value={query} onChange={e=>setQuery(e.target.value)} maxLength={120} placeholder="Ví dụ: Đà Nẵng"/></label><select aria-label="Loại tư liệu thử tìm" className="rounded-lg border p-2 text-sm" value={mediaType} onChange={e=>setMediaType(e.target.value)}><option value="PHOTO">Ảnh</option><option value="VIDEO">Video</option><option value="FOLDER">Folder</option><option value="ANY">Tất cả file</option></select><Button disabled={busy||dirty} variant="secondary" onClick={()=>void test()}>Thử bộ lọc</Button></div>
        <AiLibraryResults artifacts={{library:results,answerFormat:draft.answerFormat,...(settings.library.syncedAt?{librarySyncedAt:settings.library.syncedAt}:{})}}/>
      </section>
      <section className="space-y-2 border-t pt-5"><h3 className="font-semibold">Phiên bản đã phát hành</h3>{settings.versions.map(version=><div key={version.version} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm"><span>v{version.version} · {new Date(version.createdAt).toLocaleString('vi-VN')}</span><Button size="sm" variant="ghost" disabled={busy||dirty||version.version===settings.version} onClick={()=>void command('settings/publish',{expectedVersion:settings.draftVersion,rollbackVersion:version.version})}>Áp dụng lại phiên bản này</Button></div>)}</section>
      <section className="rounded-xl border border-dashed p-4 text-sm"><h3 className="font-semibold">Đọc trực tiếp ảnh trong folder — giai đoạn nâng cao</h3><p className="mt-2 text-slate-600">Đã chuẩn bị hợp đồng xử lý, khóa bộ nhớ đệm theo phiên bản file, báo cáo phạm vi đã đọc và giới hạn ảnh/chi phí. Chưa bật quét hay gọi AI xem ảnh. Ngân sách đọc ảnh hiện là 0 đ.</p></section>
    </>}
  </div>;
}
