import { Button } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignSummary } from '@cpms/domain';
import { requestJson } from '../lib/api';
import { workflowChanged, type WorkflowView } from '../lib/campaign-workflow';
import type { CampaignOperationsView } from '../lib/campaign-operations';
import { hasUnsavedChanges, useUnsavedChanges } from '../lib/unsaved-changes';
import { CampaignApprovalWizard } from './campaign-approval-wizard';
import { accessInput } from './access-editor-controls';
const labels: Record<string, string> = { APPROVE_ASSIGN: 'Phê duyệt & giao việc', REASSIGN: 'Giao nhiệm vụ', REQUEST_COOPERATION: 'Đề nghị phối hợp', PAUSE: 'Tạm dừng', CANCEL: 'Xóa' };
type Entry = { view: WorkflowView; operations: CampaignOperationsView };
export function CampaignBatchWorkflowActions({ selectedIds, campaigns, onSaved }: { selectedIds: readonly string[]; campaigns: readonly CampaignSummary[]; onSaved(): void }) {
  const [action, setAction] = useState<{ operation: string; ids: string[] } | null>(null); const [error, setError] = useState('');
  const canProcess = campaigns.some((campaign) => selectedIds.includes(campaign.id) && ['campaign.approve','campaign.assign','campaign.cooperate'].some((permission) => campaign.access?.permissions[permission as 'campaign.approve' | 'campaign.assign' | 'campaign.cooperate']));
  if (!selectedIds.length || !canProcess) return null;
  return <div className="border-b border-slate-100 bg-cyan-50/50 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><strong className="mr-2 text-sm">Đã chọn {selectedIds.length} chiến dịch</strong>{Object.entries(labels).map(([operation, label]) => <Button key={operation} size="sm" variant={operation === 'APPROVE_ASSIGN' ? 'primary' : 'secondary'} onClick={() => { if (hasUnsavedChanges()) { setError('Hãy lưu hoặc hủy nội dung đang nhập trước khi xử lý hàng loạt.'); return; } setError(''); setAction({ operation, ids: [...selectedIds] }); }}>{label}</Button>)}</div>{error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    {action && <BatchDialog operation={action.operation} ids={action.ids} onClose={() => setAction(null)} onSaved={() => { setAction(null); onSaved(); }} />}</div>;
}
function BatchDialog({ ids, operation, onClose, onSaved }: { ids: string[]; operation: string; onClose(): void; onSaved(): void }) {
  const [entries, setEntries] = useState<Entry[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { let active = true; void (async () => { try { const data = await Promise.all(ids.map(async (id) => ({ view: await requestJson<WorkflowView>(`/campaign-workflow/${id}`), operations: await requestJson<CampaignOperationsView>(`/campaign-operations/${id}`) }))); if (active) setEntries(data); } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'Không tải được lựa chọn.'); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, [ids]);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; panel.current?.focus(); return () => opener?.focus({ preventScroll: true }); }, []);
  const close = () => { if (!busy && (!dirty || window.confirm('Bỏ lựa chọn chưa xác nhận?'))) onClose(); };
  const approvals = entries.flatMap(({ view }) => { const step = view.tasks.find((task) => task.kind === 'DIVISION_ACCEPT_AND_ASSIGN' && task.eligibility?.allowed); return step ? [{ view, stepId: step.id }] : []; });
  return createPortal(<div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4"><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${labels[operation]} hàng loạt`} className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-panel outline-none" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') { const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length); const first = controls[0]; const last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 p-5"><h2 className="text-lg font-semibold">{labels[operation]} · {ids.length} chiến dịch</h2><Button variant="ghost" size="sm" disabled={busy} onClick={close}>Đóng</Button></header><div className="overflow-auto p-5">
    {loading ? <p role="status">Đang kiểm tra các chiến dịch đã chọn…</p> : error ? <p role="alert" className="text-rose-700">{error}</p> : operation === 'APPROVE_ASSIGN'
      ? approvals.length ? <><p className="mb-4 text-sm text-slate-600">{approvals.length}/{entries.length} chiến dịch đủ điều kiện.</p><CampaignApprovalWizard entries={approvals} onSaved={onSaved} onBusyChange={setBusy} onDirtyChange={setDirty} /></> : <p>Không có chiến dịch đủ điều kiện phê duyệt trong lựa chọn này.</p>
      : <BatchForm entries={entries} operation={operation} onSaved={onSaved} onBusyChange={setBusy} onDirtyChange={setDirty} />}
  </div></div></div>, document.body);
}
function BatchForm({ entries, operation, onSaved, onBusyChange, onDirtyChange }: { entries: Entry[]; operation: string; onSaved(): void; onBusyChange(value: boolean): void; onDirtyChange(value: boolean): void }) {
  const [lead, setLead] = useState(''); const [coops, setCoops] = useState<string[]>([]); const [target, setTarget] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ id: string; ok: boolean; message: string }[] | null>(null); const sending = useRef(false);
  const [keys] = useState(() => new Map(entries.map(({ view }) => [view.campaign.id, crypto.randomUUID()])));
  useUnsavedChanges(!results); useEffect(() => { onDirtyChange(!results); return () => onDirtyChange(false); }, [onDirtyChange, results]);
  const scope = (view: WorkflowView) => view.reassignableScopes.find((item) => item.functionalRole === 'CAMPAIGN_MANAGER');
  const eligible = entries.filter(({ view, operations }) => operation === 'REASSIGN' ? Boolean(scope(view)) : operation === 'REQUEST_COOPERATION' ? view.cooperationSourceOrgIds.length > 0 : operations.capabilities.decide && operations.operationalState !== 'CANCELLED' && (operation !== 'PAUSE' || operations.operationalState === 'ACTIVE'));
  const candidates = (eligible[0]?.view.people ?? []).filter((person) => eligible.every(({ view }) => view.candidates.some((candidate) => candidate.actorId === person.id && candidate.roles.includes('CAMPAIGN_MANAGER') && candidate.divisionId === scope(view)?.orgId)));
  const targets = (eligible[0]?.view.organizations ?? []).filter((org) => org.kind === 'DIVISION' && eligible.every(({ view }) => !view.cooperationSourceOrgIds.includes(org.id) && !view.tasks.some((task) => task.orgId === org.id)));
  const valid = Boolean(eligible.length && reason.trim() && (operation !== 'REASSIGN' || lead) && (operation !== 'REQUEST_COOPERATION' || target));
  const send = async () => {
    if (sending.current || !valid) return; sending.current = true; setBusy(true); onBusyChange(true); const output = [];
    for (const { view, operations } of eligible) {
      try {
        let endpoint = `/campaign-workflow/${view.campaign.id}/commands`; const base = { idempotencyKey: keys.get(view.campaign.id), expectedVersion: view.version, expectedSubjectRevision: view.campaign.businessRevision, reason }; let command: Record<string, unknown>;
        if (operation === 'REASSIGN') { const orgId = scope(view)!.orgId; command = { ...base, operation, orgId, functionalRole: 'CAMPAIGN_MANAGER', members: [{ actorId: lead, orgId, responsibility: 'LEAD' }, ...coops.filter((id) => id !== lead).map((actorId) => ({ actorId, orgId, responsibility: 'COOP' }))] }; }
        else if (operation === 'REQUEST_COOPERATION') command = { ...base, operation, sourceOrgId: view.cooperationSourceOrgIds[0], targetOrgId: target, targetActorId: null };
        else { const pending = operations.requests.find((request) => request.kind === operation && request.state === 'PENDING'); endpoint = `/campaign-operations/${view.campaign.id}/commands`; command = { ...base, expectedVersion: operations.version, expectedSubjectRevision: operations.subjectRevision, ...(pending ? { operation: 'DECIDE', requestId: pending.id, expectedRequestVersion: pending.recordVersion, approve: true } : { operation }) }; }
        await requestJson(endpoint, { method: 'POST', body: JSON.stringify(command) }); output.push({ id: view.campaign.id, ok: true, message: 'Hoàn tất' });
      } catch (caught) { output.push({ id: view.campaign.id, ok: false, message: caught instanceof Error ? caught.message : 'Không xử lý được dòng này.' }); }
    }
    setResults(output); setBusy(false); onBusyChange(false); sending.current = false; workflowChanged();
  };
  if (results) return <div className="space-y-4"><strong>Hoàn tất {results.filter((row) => row.ok).length}/{results.length} chiến dịch</strong>{results.map((row) => <p key={row.id} className={`text-sm ${row.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{entries.find(({ view }) => view.campaign.id === row.id)?.view.campaign.code} · {row.message}</p>)}<Button onClick={onSaved}>Đóng và cập nhật danh sách</Button></div>;
  return <div className="space-y-4"><fieldset disabled={busy} className="space-y-4">
    {operation === 'REASSIGN' && <><label className="block text-sm">Campaign Manager chủ trì<select aria-label="Campaign Manager chủ trì hàng loạt" className={`${accessInput} mt-1 w-full`} value={lead} onChange={(event) => { setLead(event.target.value); setCoops((ids) => ids.filter((id) => id !== event.target.value)); }}><option value="">Chọn người chủ trì</option>{candidates.map((person) => <option value={person.id} key={person.id}>{person.displayName}</option>)}</select></label><div><p className="mb-2 text-sm">Campaign Manager phối hợp (tùy chọn)</p>{candidates.filter((person) => person.id !== lead).map((person) => <label className="flex items-center gap-2 py-1 text-sm" key={person.id}><input type="checkbox" checked={coops.includes(person.id)} onChange={(event) => setCoops((ids) => event.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id))} />{person.displayName}</label>)}</div></>}
    {operation === 'REQUEST_COOPERATION' && <label className="block text-sm">Phòng đề nghị phối hợp<select className={`${accessInput} mt-1 w-full`} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Chọn phòng phối hợp</option>{targets.map((org) => <option value={org.id} key={org.id}>{org.sourceName}</option>)}</select></label>}
    <label className="block text-sm">Ý kiến / lý do<textarea className={`${accessInput} mt-1 w-full`} rows={3} value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="max-h-56 overflow-auto rounded-xl border border-slate-200">{entries.map((entry) => <p className="border-b border-slate-100 p-3 text-sm" key={entry.view.campaign.id}>{entry.view.campaign.code} · {entry.view.campaign.name}<span className="ml-2 text-slate-500">{eligible.includes(entry) ? entry.operations.requests.some((request) => request.kind === operation && request.state === 'PENDING') ? 'Duyệt đề nghị đang chờ' : 'Sẽ xử lý' : 'Không đủ điều kiện'}</span></p>)}</div>
  </fieldset><Button disabled={busy || !valid} onClick={() => void send()}>{busy ? 'Đang xử lý…' : `Xác nhận ${eligible.length} chiến dịch`}</Button></div>;
}
