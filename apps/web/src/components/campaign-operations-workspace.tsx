import { CAMPAIGN_FIELD_BY_KEY, canonicalCampaignFieldKey, type CampaignAccessCapabilities } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
import { changeLabels, type CampaignChangeRequest, type CampaignOperationsView } from '../lib/campaign-operations';
import { workflowChanged, workflowTime } from '../lib/campaign-workflow';
import { hasUnsavedChanges, useUnsavedChanges } from '../lib/unsaved-changes';
import { accessInput } from './access-editor-controls';

type RequestDecision = 'approve' | 'reject';

/** Initial workflow tasks and later change requests are separate queues. Show both on the approval tab. */
export function CampaignPendingRequestReview({ view, disabled = false, actorName, onSaved }: {
  view: CampaignOperationsView; disabled?: boolean; actorName(id: string | null): string; onSaved(message: string): void;
}) {
  const [editor, setEditor] = useState<{ request: CampaignChangeRequest; decision: RequestDecision; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const pending = view.requests.filter((request) => request.state === 'PENDING');
  const stale = Boolean(editor && (editor.version !== view.version || !pending.some((request) => request.id === editor.request.id && request.recordVersion === editor.request.recordVersion)));
  useEffect(() => {
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      panel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor]);
  if (!pending.length && !editor) return null;
  const open = (request: CampaignChangeRequest, decision: RequestDecision) => {
    if (disabled || !view.capabilities.decide || busy) return;
    if (hasUnsavedChanges()) { setError('Hãy hoàn tất hoặc hủy nội dung đang xử lý trước.'); return; }
    setError(''); setEditor({ request, decision, version: view.version });
  };
  return <Card className="overflow-hidden border-amber-200">
    <section aria-label="Yêu cầu mới đang chờ phê duyệt">
      <div className="border-b border-amber-100 bg-amber-50 px-5 py-4 lg:px-6"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CpmsIcon name="pending" />Yêu cầu mới đang chờ phê duyệt</h2><p className="mt-1 text-sm text-slate-600">Xem nội dung đề nghị và xác nhận quyết định cho từng yêu cầu.</p></div>
      <div className="space-y-4 p-5 lg:p-6">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {pending.map((request) => <article key={request.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-slate-950">{changeLabels[request.kind]}</h3><span className="text-xs font-semibold text-amber-800">Chờ phê duyệt</span></div>
          <p className="mt-2 text-sm text-slate-600">Người gửi: {actorName(request.requestedByActorId)} · {workflowTime(request.requestedAt)}</p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-800"><span className="font-semibold">Lý do:</span> {request.reason || 'Không nêu lý do.'}</p>
          {request.kind === 'EDIT' && <div className="mt-3"><EditComparison request={request} /></div>}
          {view.capabilities.decide ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={disabled || Boolean(editor)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => open(request, 'approve')}><CpmsIcon name="approve" />Phê duyệt yêu cầu</button>
            <button type="button" disabled={disabled || Boolean(editor)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-50" onClick={() => open(request, 'reject')}><CpmsIcon name="reject" />Từ chối yêu cầu</button>
          </div> : <p className="mt-3 text-sm text-slate-500">Đang chờ Lãnh đạo Phòng chủ trì xử lý yêu cầu này.</p>}
        </article>)}
        {editor && <div ref={panel} className={`scroll-mt-24 rounded-xl border p-5 ${editor.decision === 'approve' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
          <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{editor.decision === 'approve' ? 'Xác nhận phê duyệt' : 'Xác nhận từ chối'} · {changeLabels[editor.request.kind]}</h3><Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Hủy</Button></div>
          {stale && <p role="alert" className="mb-3 text-sm text-amber-800">Yêu cầu đã thay đổi. Hãy hủy thao tác và xem lại thông tin mới nhất.</p>}
          <OperationEditor key={`${editor.request.id}:${editor.decision}`} view={view} operation="DECIDE" request={editor.request} decision={editor.decision} disabled={disabled || stale} onBusyChange={setBusy} onSaved={() => {
            const message = `${editor.decision === 'approve' ? 'Đã phê duyệt' : 'Đã từ chối'} yêu cầu: ${changeLabels[editor.request.kind]}.`;
            setEditor(null); onSaved(message);
          }} />
        </div>}
      </div>
    </section>
  </Card>;
}

export function CampaignOperationsWorkspace({ campaignId, resourceVersion, section = 'all', onSaved, onEdit }: {
  campaignId: string; resourceVersion: number; section?: 'all' | 'information' | 'planning'; onSaved(): void; onEdit?(access: CampaignAccessCapabilities): void;
}) {
  const [view, setView] = useState<CampaignOperationsView | null>(null); const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ operation: string; request?: CampaignChangeRequest } | null>(null);
  const [busy, setBusy] = useState(false); const epoch = useRef(0);
  const load = useCallback(async () => { const token = ++epoch.current; try { const next = await requestJson<CampaignOperationsView>(`/campaign-operations/${campaignId}`); if (epoch.current === token) { setView(next); setError(''); } } catch (caught) { if (epoch.current === token) { setView(null); setError(caught instanceof Error ? caught.message : 'Không tải được yêu cầu xử lý.'); } } }, [campaignId]);
  useEffect(() => { if (!editor) void load(); return () => { epoch.current++; }; }, [load, resourceVersion, editor]);
  useEffect(() => { const refresh = () => { if (!editor) void load(); }; window.addEventListener('cpms:workflow-updated', refresh); return () => window.removeEventListener('cpms:workflow-updated', refresh); }, [editor, load]);
  const open = (next: NonNullable<typeof editor>) => { if (hasUnsavedChanges()) { setError('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); return; } setError(''); setEditor(next); };
  if (error && !view) return <div><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="ghost" onClick={() => void load()}>Thử lại</Button></div>;
  if (!view) return null;
  const pending = view.requests.filter((request) => request.state === 'PENDING');
  const showInformation = section !== 'planning';
  const showPlanning = section !== 'information';
  const visiblePending = pending.filter((request) => section === 'all' || (section === 'planning' ? request.kind === 'PLAN' : request.kind !== 'PLAN'));
  if (section === 'all' && !Object.values(view.capabilities).some(Boolean) && !view.requests.length && !view.plans.length) return null;
  if (section === 'information' && !view.capabilities.resume && !view.capabilities.restore && !(onEdit && view.capabilities.requestChange && view.proposalAccess?.canEditAnyField) && !visiblePending.length) return null;
  const saved = () => { setEditor(null); workflowChanged(); onSaved(); };
  return <Card className="mb-4 p-5"><section className="space-y-4" aria-label={showPlanning && !showInformation ? 'Kế hoạch chiến dịch' : 'Yêu cầu thay đổi chiến dịch'}>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {editor ? <div className="rounded-xl border border-cyan-200 bg-cyan-50/20 p-5"><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{editor.request ? changeLabels[editor.request.kind] : editor.operation === 'CREATE_PLAN' ? 'Lập kế hoạch chiến dịch' : editor.operation === 'REQUEST_RESUME' ? 'Nối lại triển khai' : editor.operation === 'REQUEST_RESTORE' ? 'Phục hồi chiến dịch' : editor.operation.endsWith('PAUSE') ? 'Tạm dừng chiến dịch' : 'Xóa chiến dịch'}</h3><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditor(null)}>Đóng</Button></div><OperationEditor key={`${editor.operation}:${editor.request?.id ?? ''}`} view={view} operation={editor.operation} request={editor.request} onSaved={saved} onBusyChange={setBusy} /></div>
      : <>
        <div className="flex flex-wrap gap-2">
          {showInformation && view.capabilities.resume && <Button size="sm" disabled={pending.some((r) => r.kind === 'RESUME')} onClick={() => open({ operation: 'REQUEST_RESUME' })}>Nối lại triển khai</Button>}
          {showInformation && view.capabilities.restore && <Button size="sm" disabled={pending.some((r) => r.kind === 'RESTORE')} onClick={() => open({ operation: 'REQUEST_RESTORE' })}>Phục hồi chiến dịch</Button>}
          {showInformation && onEdit && view.capabilities.requestChange && view.proposalAccess?.canEditAnyField && <Button size="sm" variant="secondary" disabled={pending.some((r) => r.kind === 'EDIT')} onClick={() => { if (hasUnsavedChanges()) { setError('Hãy lưu hoặc hủy thay đổi đang nhập.'); return; } onEdit(view.proposalAccess!); }}><CpmsIcon name="edit" />Đề nghị sửa đổi</Button>}
          {showPlanning && view.capabilities.plan && <Button size="sm" disabled={pending.some((r) => r.kind === 'PLAN')} onClick={() => open({ operation: 'CREATE_PLAN' })}><CpmsIcon name="add" />{view.plans.length ? 'Lập phiên bản kế hoạch mới' : 'Lập kế hoạch'}</Button>}
        </div>
        {visiblePending.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div><p className="text-sm font-semibold">{changeLabels[request.kind]} <span className="font-normal text-amber-800">· Chờ duyệt</span></p><p className="mt-1 text-xs text-slate-500">{workflowTime(request.requestedAt)}</p></div><Button size="sm" variant="secondary" onClick={() => open({ operation: 'DECIDE', request })}>Xem đề nghị</Button></div>)}
        {showPlanning && view.plans[0] && <details className="rounded-xl border border-slate-200 p-4" open><summary className="cursor-pointer text-sm font-semibold">Kế hoạch: {view.plans[0].title}</summary><PlanSummary plan={view.plans[0]} /></details>}
        {section === 'planning' && !view.plans.length && !view.capabilities.plan && !visiblePending.length && <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center"><CpmsIcon name="planning" className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-slate-700">Chưa có kế hoạch</p><p className="mt-1 text-sm text-slate-500">Kế hoạch sẽ xuất hiện tại đây khi được lập từ phân hệ liên quan.</p></div>}
      </>}
  </section></Card>;
}
function PlanSummary({ plan }: { plan: CampaignOperationsView['plans'][number] }) {
  return <div className="mt-3 space-y-3 text-sm"><p className="whitespace-pre-wrap">{plan.objective}</p><table className="w-full text-left"><thead><tr><th className="p-2">Công việc</th><th className="p-2">Bắt đầu</th><th className="p-2">Kết thúc</th></tr></thead><tbody>{plan.tasks.map((task, i) => <tr key={i} className="border-t border-slate-100"><td className="p-2">{task.title}</td><td className="p-2">{task.startDate}</td><td className="p-2">{task.endDate}</td></tr>)}</tbody></table></div>;
}
function EditComparison({ request }: { request: CampaignChangeRequest }) {
  const fields = Object.entries(request.payload).flatMap(([key, value]) => key === 'expectedVersion' ? [] : key === 'fieldValues' ? Object.entries(value as Record<string, unknown>) : [[key, value] as const]);
  const display = (value: unknown) => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const rows = fields.map(([key, value]) => ({ key: canonicalCampaignFieldKey(key), value, before: request.beforeSnapshot[canonicalCampaignFieldKey(key)] })).filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.value));
  return <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Thông tin</th><th className="p-2">Hiện tại</th><th className="p-2">Đề nghị thay đổi</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.key}:${i}`} className="border-t border-slate-100"><td className="p-2">{CAMPAIGN_FIELD_BY_KEY[row.key]?.label ?? row.key}</td><td className="max-w-72 break-words p-2">{display(row.before)}</td><td className="max-w-72 break-words p-2">{display(row.value)}</td></tr>)}</tbody></table></div>;
}
export function OperationEditor({ view, operation, request, decision, disabled = false, onSaved, onBusyChange }: { view: CampaignOperationsView; operation: string; request?: CampaignChangeRequest | undefined; decision?: RequestDecision; disabled?: boolean; onSaved(): void; onBusyChange(value: boolean): void }) {
  const [key] = useState(() => crypto.randomUUID()); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [title, setTitle] = useState(''); const [objective, setObjective] = useState(''); const [tasks, setTasks] = useState([{ title: '', startDate: '', endDate: '' }]);
  const submitting = useRef(false); useUnsavedChanges(!request || view.capabilities.decide);
  const send = async (approve = true) => {
    if (submitting.current || disabled || (request && (!view.capabilities.decide || request.state !== 'PENDING' || request.subjectRevision !== view.subjectRevision))) return;
    submitting.current = true; setBusy(true); onBusyChange(true); setError('');
    const body = { operation, idempotencyKey: key, expectedVersion: view.version, expectedSubjectRevision: view.subjectRevision,
      ...(operation === 'CREATE_PLAN' ? { plan: { title, objective, tasks } } : operation === 'DECIDE' ? { requestId: request!.id, expectedRequestVersion: request!.recordVersion, approve, reason } : { reason }) };
    try { await requestJson(`/campaign-operations/${view.campaignId}/commands`, { method: 'POST', body: JSON.stringify(body) }); onSaved(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không hoàn tất thao tác.'); }
    finally { submitting.current = false; setBusy(false); onBusyChange(false); }
  };
  const plan = request?.kind === 'PLAN' ? view.plans.find((p) => p.id === request.payload.planId) : null;
  const validPlan = title.trim() && objective.trim() && tasks.every((task) => task.title.trim() && task.startDate && task.endDate && task.endDate >= task.startDate);
  return <div className="space-y-4"><fieldset className="space-y-4" disabled={busy || disabled}>
    {(['REQUEST_RESUME','REQUEST_RESTORE'].includes(operation) || (request && ['RESUME','RESTORE'].includes(request.kind))) && <p className="text-sm text-slate-600">Chiến dịch sẽ chuyển sang Đang triển khai khi Lãnh đạo Phòng chủ trì phê duyệt.</p>}
    {request && <><p className="whitespace-pre-wrap text-sm">{request.reason}</p>{request.kind === 'EDIT' && <EditComparison request={request} />}{plan && <PlanSummary plan={plan} />}</>}
    {operation === 'CREATE_PLAN' && <><label className="block text-sm">Tên kế hoạch<input className={`${accessInput} mt-1 w-full`} value={title} maxLength={240} onChange={(e) => setTitle(e.target.value)} /></label><label className="block text-sm">Mục tiêu và cách thực hiện<textarea className={`${accessInput} mt-1 w-full`} value={objective} rows={3} maxLength={4000} onChange={(e) => setObjective(e.target.value)} /></label>
      <div className="space-y-2">{tasks.map((task, index) => <div className="grid gap-2 md:grid-cols-[1fr_150px_150px_auto]" key={index}><input aria-label={`Công việc ${index + 1}`} className={accessInput} placeholder="Công việc" value={task.title} maxLength={500} onChange={(e) => setTasks((rows) => rows.map((row, i) => i === index ? { ...row, title: e.target.value } : row))} /><input aria-label={`Bắt đầu công việc ${index + 1}`} type="date" className={accessInput} value={task.startDate} onChange={(e) => setTasks((rows) => rows.map((row, i) => i === index ? { ...row, startDate: e.target.value } : row))} /><input aria-label={`Kết thúc công việc ${index + 1}`} type="date" className={accessInput} value={task.endDate} onChange={(e) => setTasks((rows) => rows.map((row, i) => i === index ? { ...row, endDate: e.target.value } : row))} /><Button variant="ghost" size="sm" disabled={tasks.length === 1} onClick={() => setTasks((rows) => rows.filter((_, i) => i !== index))}>Bỏ</Button></div>)}<Button variant="secondary" size="sm" disabled={tasks.length >= 50} onClick={() => setTasks((rows) => [...rows, { title: '', startDate: '', endDate: '' }])}>Thêm công việc</Button></div></>}
    {operation !== 'CREATE_PLAN' && (!request || view.capabilities.decide) && <label className="block text-sm">{request ? 'Ý kiến xử lý (không bắt buộc)' : 'Lý do'}<textarea aria-label="Lý do xử lý yêu cầu" className={`${accessInput} mt-1 w-full`} value={reason} rows={3} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>}
  </fieldset>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="flex flex-wrap gap-2">{request ? view.capabilities.decide && (decision ? <button type="button" className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-50 ${decision === 'approve' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-700 hover:bg-rose-800'}`} disabled={busy || disabled || request.state !== 'PENDING' || request.subjectRevision !== view.subjectRevision} onClick={() => void send(decision === 'approve')}><CpmsIcon name={decision === 'approve' ? 'approve' : 'reject'} />{busy ? 'Đang xử lý…' : decision === 'approve' ? 'OK · Phê duyệt yêu cầu' : 'OK · Từ chối yêu cầu'}</button> : <><Button disabled={busy || disabled || request.state !== 'PENDING' || request.subjectRevision !== view.subjectRevision} onClick={() => void send(true)}><CpmsIcon name="approve" />Phê duyệt đề nghị</Button><Button variant="secondary" disabled={busy || disabled || request.state !== 'PENDING' || request.subjectRevision !== view.subjectRevision} onClick={() => void send(false)}>Từ chối đề nghị</Button></>)
      : <Button disabled={busy || (operation === 'CREATE_PLAN' ? !validPlan : !reason.trim())} onClick={() => void send()}>{operation === 'CREATE_PLAN' ? 'Lưu và trình duyệt kế hoạch' : operation.startsWith('REQUEST') ? 'Gửi đề nghị' : 'Xác nhận'}</Button>}</div>
  </div>;
}
