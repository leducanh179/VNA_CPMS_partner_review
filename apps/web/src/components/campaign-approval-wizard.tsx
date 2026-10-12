import { Button, CpmsIcon } from '@cpms/ui';
import { normalizeDirectorySearch } from '@cpms/domain';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
import { workflowChanged, type WorkflowView } from '../lib/campaign-workflow';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { accessInput } from './access-editor-controls';

export interface ApprovalWizardEntry { view: WorkflowView; stepId: string }

/** Decisions and assignments are submitted only by the final button, never between wizard steps. */
export function CampaignApprovalWizard({ entries, initialDecision = 'approve', skipDecisionStep = false, onSaved, onBusyChange, onDirtyChange }: {
  entries: ApprovalWizardEntry[]; initialDecision?: 'approve' | 'reject'; skipDecisionStep?: boolean; onSaved(): void;
  onBusyChange?(value: boolean): void; onDirtyChange?(value: boolean): void;
}) {
  const [stage, setStage] = useState(skipDecisionStep && initialDecision === 'approve' ? 1 : 0);
  const [decision, setDecision] = useState(initialDecision);
  const [lead, setLead] = useState(''); const [coops, setCoops] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { lead: string; coops: string[] }>>({});
  const [query, setQuery] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [results, setResults] = useState<{ campaignId: string; ok: boolean; message?: string }[] | null>(null);
  const [keys] = useState(() => entries.map(() => crypto.randomUUID()));
  const saving = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  useUnsavedChanges(!results);
  useEffect(() => { onDirtyChange?.(!results); return () => onDirtyChange?.(false); }, [onDirtyChange, results]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { heading.current?.focus(); }, [stage]);
  const first = entries[0]?.view;
  const eligible = entries.filter(({ view, stepId }) => view.tasks.some((step) => step.id === stepId && step.eligibility?.allowed));
  const candidates = (first?.people ?? []).filter((person) => eligible.length > 0 && eligible.every(({ view, stepId }) => {
    const step = view.tasks.find((item) => item.id === stepId);
    return view.candidates.some((candidate) => candidate.actorId === person.id && candidate.roles.includes('CAMPAIGN_MANAGER') && candidate.divisionId === (step?.assignmentOrgId ?? step?.orgId));
  }));
  const shown = candidates.filter((person) => person.id === lead || coops.includes(person.id) || normalizeDirectorySearch(`${person.displayName} ${person.jobTitle ?? ''}`).includes(normalizeDirectorySearch(query)));
  const personName = (id: string) => candidates.find((person) => person.id === id)?.displayName ?? '';
  const send = async () => {
    if (saving.current || !eligible.length || (decision === 'approve' && !candidates.some((p) => p.id === lead))) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const items = entries.flatMap(({ view, stepId }, index) => {
        const step = view.tasks.find((item) => item.id === stepId);
        if (!step?.eligibility?.allowed) return [];
        const orgId = step.assignmentOrgId ?? step.orgId;
        const assigned = overrides[view.campaign.id] ?? { lead, coops };
        return [{ campaignId: view.campaign.id, command: { operation: decision === 'reject' ? 'REJECT' : 'APPROVE_ASSIGN',
          idempotencyKey: keys[index], expectedVersion: view.version, expectedSubjectRevision: view.campaign.businessRevision,
          stepId, expectedStepVersion: step.stepVersion, reason,
          ...(decision === 'approve' ? { members: [{ actorId: assigned.lead, orgId, responsibility: 'LEAD' }, ...assigned.coops.filter((id) => candidates.some((p) => p.id === id) && id !== assigned.lead).map((actorId) => ({ actorId, orgId, responsibility: 'COOP' }))] } : {}) } }];
      });
      if (items.length === 1) {
        await requestJson(`/campaign-workflow/${items[0]!.campaignId}/commands`, { method: 'POST', body: JSON.stringify(items[0]!.command) });
        workflowChanged(); onSaved();
      } else {
        const result = await requestJson<{ items: { campaignId: string; ok: boolean; message?: string }[] }>('/campaign-workflow/batch', { method: 'POST', body: JSON.stringify({ items }) });
        setResults(result.items); workflowChanged();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể hoàn tất. Hãy tải lại để kiểm tra trạng thái.'); }
    finally { saving.current = false; setBusy(false); }
  };
  if (results) return <div className="space-y-4"><h3 className="font-semibold">Đã xử lý {results.filter((row) => row.ok).length}/{results.length} chiến dịch</h3>
    {results.map((row) => <p className={`text-sm ${row.ok ? 'text-emerald-700' : 'text-rose-700'}`} key={row.campaignId}>{entries.find((entry) => entry.view.campaign.id === row.campaignId)?.view.campaign.code}: {row.ok ? 'Hoàn tất' : row.message}</p>)}
    <Button onClick={onSaved}>Đóng và cập nhật danh sách</Button></div>;
  return <div className="mx-auto max-w-3xl space-y-5" aria-label="Các bước phê duyệt chiến dịch">
    <ol className="grid grid-cols-3 gap-2" aria-label="Tiến trình phê duyệt">{['Quyết định', 'Người chủ trì', 'Người phối hợp'].map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined} className={`rounded-xl px-3 py-2 text-sm ${stage === index ? 'bg-vna-blue font-semibold text-white' : 'bg-slate-100 text-slate-600'}`}>{index + 1}. {label}</li>)}</ol>
    {entries.length > 1 && <p className="text-sm text-slate-600">Áp dụng cho {eligible.length}/{entries.length} chiến dịch đủ điều kiện.</p>}
    <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{stage === 0 ? 'Quyết định của lãnh đạo' : stage === 1 ? 'Giao chuyên viên Ban TT phụ trách Chiến dịch' : 'Giao chuyên viên Ban TT phối hợp Chiến dịch'}</h3>
    <fieldset disabled={busy} className="space-y-4">
      {stage === 0 && <>
        <div className="flex flex-wrap gap-3">{(['approve','reject'] as const).map((value) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm ${decision === value ? 'border-vna-blue bg-cyan-50' : 'border-slate-200 bg-white'}`}><input type="radio" name="approval-decision" checked={decision === value} onChange={() => setDecision(value)} />{value === 'approve' ? 'Đồng ý phê duyệt' : 'Từ chối'}</label>)}</div>
        {decision === 'approve' ? <p className="text-sm text-slate-600">Tiếp tục chọn người chủ trì để hoàn tất phê duyệt.</p> : <label className="block text-sm">Ý kiến từ chối <span className="text-slate-500">(tùy chọn)</span><textarea aria-label="Ý kiến từ chối" className={`${accessInput} mt-2 w-full`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} /></label>}
      </>}
      {stage > 0 && <>
        {stage === 2 && <p className="text-sm text-slate-600">Có thể bỏ qua nếu chưa cần người phối hợp.</p>}
        <input aria-label="Tìm chuyên viên Ban TT" type="search" className={`${accessInput} w-full`} placeholder="Tìm tên hoặc chức vụ…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-3">Chọn</th><th className="p-3">Họ tên</th><th className="p-3">Chức vụ</th></tr></thead><tbody>{shown.filter((person) => stage === 1 || person.id !== lead).map((person) => <tr key={person.id} className="border-t border-slate-100"><td className="p-3"><input aria-label={`${stage === 1 ? 'Chủ trì' : 'Phối hợp'}: ${person.displayName}`} type={stage === 1 ? 'radio' : 'checkbox'} name={stage === 1 ? 'lead-campaign-manager' : undefined} checked={stage === 1 ? lead === person.id : coops.includes(person.id)} onChange={(event) => { if (stage === 1) { setLead(person.id); setCoops((ids) => ids.filter((id) => id !== person.id)); } else setCoops((ids) => event.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id)); }} /></td><td className="p-3 font-medium">{person.displayName}</td><td className="p-3 text-slate-600">{person.jobTitle ?? ''}</td></tr>)}</tbody></table>{!shown.length && <p className="p-4 text-sm text-slate-500">Không có người phù hợp.</p>}</div>
        {stage > 0 && <label className="block text-sm">Ý kiến giao việc <span className="text-slate-500">(tùy chọn)</span><textarea aria-label="Ý kiến giao việc" className={`${accessInput} mt-2 w-full`} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} /></label>}
        {stage === 2 && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p><strong>Phụ trách:</strong> {personName(lead)}</p><p className="mt-2"><strong>Phối hợp:</strong> {coops.map(personName).join(', ') || 'Không chọn'}</p>
          {entries.length > 1 && <div className="mt-3 max-h-72 space-y-2 overflow-auto">{eligible.map(({ view }) => {
            const assigned = overrides[view.campaign.id] ?? { lead, coops };
            const update = (value: { lead: string; coops: string[] }) => setOverrides((current) => ({ ...current, [view.campaign.id]: value }));
            return <details key={view.campaign.id} className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer">{view.campaign.code} · {personName(assigned.lead)} <span className="text-xs text-slate-500">— Điều chỉnh riêng</span></summary><p className="my-2 text-xs text-slate-500">{view.campaign.name}</p><label className="block text-sm">Chuyên viên Ban TT phụ trách<select aria-label={`Phụ trách ${view.campaign.code}`} className={`${accessInput} mt-1 w-full`} value={assigned.lead} onChange={(event) => update({ lead: event.target.value, coops: assigned.coops.filter((id) => id !== event.target.value) })}>{candidates.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><p className="mb-1 mt-3 text-sm">Chuyên viên Ban TT phối hợp</p>{candidates.filter((person) => person.id !== assigned.lead).map((person) => <label key={person.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={assigned.coops.includes(person.id)} onChange={(event) => update({ ...assigned, coops: event.target.checked ? [...assigned.coops, person.id] : assigned.coops.filter((id) => id !== person.id) })} />{person.displayName}</label>)}</details>;
          })}</div>}</div>}
      </>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4">{stage > 0 ? <Button variant="secondary" disabled={busy} onClick={() => { setStage(stage - 1); setQuery(''); }}>Quay lại</Button> : <span />}
      {stage === 0 && decision === 'reject' ? <Button disabled={busy || !eligible.length} onClick={() => void send()}>Xác nhận từ chối</Button>
        : stage < 2 ? <Button disabled={busy || !eligible.length || (stage === 1 && !lead)} onClick={() => { setStage(stage + 1); setQuery(''); }}>{stage === 0 ? 'Tiếp tục giao việc' : 'Tiếp tục'}</Button>
        : <Button disabled={busy || !lead} onClick={() => void send()}><CpmsIcon name="approve" />{busy ? 'Đang hoàn tất…' : 'Hoàn tất phê duyệt & giao việc'}</Button>}
    </div>
  </div>;
}
