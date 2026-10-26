import type { AiCampaignProposal } from '@cpms/ai-contracts';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';
import { hasUnsavedChanges } from '../lib/unsaved-changes';

export function AiProposalCard({ id }: { id: string }) {
  const [proposal,setProposal] = useState<AiCampaignProposal | null>(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [editing,setEditing] = useState(false), [values,setValues] = useState<Record<string,string>>({}), [excluded,setExcluded] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void requestJson<AiCampaignProposal>(`/ai/workspace/proposals/${id}`).then(row => { if (active) setProposal(row); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  },[id]);
  const confirm = async (action: 'SAVE'|'SAVE_AND_SUBMIT') => {
    if (!proposal || busy) return;
    if (hasUnsavedChanges()) { setError('Màn hình nghiệp vụ đang có nội dung chưa lưu. Hãy lưu hoặc hủy các thay đổi đó trước, rồi yêu cầu AI tạo lại đề xuất để tránh ghi đè.'); return; }
    setBusy(true); setError('');
    try {
      const result = await requestJson<AiCampaignProposal>(`/ai/workspace/proposals/${proposal.id}/confirm`,{ method:'POST', body:JSON.stringify({ action,confirmed:true }) });
      setProposal(result); window.dispatchEvent(new CustomEvent('cpms:ai-record-updated',{detail:{kind:'CAMPAIGN',id:result.campaignId}}));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const revise = async () => {
    if (!proposal) return; setBusy(true); setError('');
    try {
      const changes = proposal.changes.filter(c => !excluded.includes(c.field)).map(c => ({field:c.field,value:values[c.field] || null}));
      const result = await requestJson<AiCampaignProposal>(`/ai/workspace/proposals/${proposal.id}/revise`,{method:'POST',body:JSON.stringify(changes)});
      setProposal(result); setEditing(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section aria-label="Đề xuất nhập liệu" className="mt-4 space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
    <h3 className="flex items-center gap-2 font-semibold text-slate-900"><CpmsIcon name="edit"/>Đề xuất nhập liệu</h3>
    {!proposal && !error && <p>Đang kiểm tra hồ sơ và quyền hiện hành…</p>}
    {proposal && <>
      <p className="font-medium">{proposal.title}</p><p className="text-xs text-slate-600">{proposal.reason}</p>
      <div className="space-y-3">{proposal.changes.map(change => <div key={change.field} className="rounded-lg bg-white p-2">
        <label className="flex items-center gap-2 font-medium">{editing && <input type="checkbox" checked={!excluded.includes(change.field)} onChange={e => setExcluded(list => e.target.checked ? list.filter(x=>x!==change.field) : [...list,change.field])}/>} {change.label}</label>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">Hiện tại: {change.before || '(Trống)'}</p>
        {editing ? <textarea aria-label={`Giá trị đề xuất ${change.label}`} disabled={excluded.includes(change.field)} className="mt-2 w-full rounded border p-2 text-sm" rows={3} value={values[change.field] ?? ''} onChange={e => setValues(current=>({...current,[change.field]:e.target.value}))}/> :
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-vna-blue">Đề xuất: {change.after || '(Xóa nội dung)'}</p>}
      </div>)}</div>
      {proposal.state === 'PREPARED' ? <>
        <p className="text-xs text-slate-600">{proposal.submission}</p>
        <p className="text-xs text-slate-600">Chưa ghi vào hồ sơ. Kiểm tra các giá trị trên rồi xác nhận bằng một trong các nút bên dưới.</p>
        <div className="flex flex-wrap gap-2">{editing ? <><Button size="sm" disabled={busy || excluded.length===proposal.changes.length} onClick={() => void revise()}>Xem lại đề xuất</Button><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Hủy sửa</Button></> : <>
          <Button size="sm" disabled={busy} onClick={() => void confirm('SAVE')}>Xác nhận lưu</Button>
          <Button size="sm" disabled={busy || !proposal.canSubmit} onClick={() => void confirm('SAVE_AND_SUBMIT')}>Lưu và gửi duyệt</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setValues(Object.fromEntries(proposal.changes.map(c=>[c.field,c.after ?? ''])));setExcluded([]);setEditing(true); }}>Chỉnh đề xuất</Button>
        </>}</div>
      </> : <><p role="status" className="font-medium text-emerald-800">{String(proposal.result?.message ?? 'Đã thực hiện.')}</p>
        <p className="text-xs">Hồ sơ đang mở có thể cần tải lại để hiển thị dữ liệu mới.</p>
        <a href={`/campaigns/${proposal.campaignId}`} target="_blank" rel="noreferrer" className="inline-block text-vna-blue underline">Mở hồ sơ đã lưu</a></>}
    </>}
    {error && <p role="alert" className="text-rose-800">{error}</p>}
  </section>;
}
