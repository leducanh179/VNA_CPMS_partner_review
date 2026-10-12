import { normalizeDirectorySearch } from '@cpms/domain';
import { Button, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth-context';
import { requestJson } from '../lib/api';
import { useWorkflow, workflowChanged, workflowLabel, workflowTime, type WorkflowView } from '../lib/campaign-workflow';
import { hasUnsavedChanges, useUnsavedChanges } from '../lib/unsaved-changes';
import { accessInput } from './access-editor-controls';
import { CampaignApprovalWizard } from './campaign-approval-wizard';

export const operationLabels: Record<string, string> = { SUBMIT: 'Gửi Ban TT', APPROVE_ASSIGN: 'Phê duyệt & giao việc', ADMIN_SKIP_ASSIGN: 'Superadmin phê duyệt và phân công',
  RETURN: 'Trả lại để sửa', REJECT: 'Từ chối', ADMIN_REJECT: 'Superadmin từ chối', WITHDRAW: 'Rút về nháp', REVISE_POLICY: 'Đổi luồng cho lần trình mới',
  REASSIGN: 'Thay đổi phân công', REQUEST_COOPERATION: 'Đề nghị phối hợp', ACCEPT_COOPERATION: 'Chấp nhận phối hợp', DECLINE_COOPERATION: 'Từ chối phối hợp', CANCEL_COOPERATION: 'Hủy đề nghị' };
type Editor = { operation: string; stepId?: string; orgId?: string; functionalRole?: string; requestId?: string; expectedRequestVersion?: number };

export function CampaignWorkflowWorkspace({ campaignId, resourceVersion, section = 'all', onSaved, onDirtyChange, onBusyChange }: { campaignId: string; resourceVersion?: number; section?: 'all' | 'approval' | 'participants'; onSaved?(): void; onDirtyChange?(value: boolean): void; onBusyChange?(value: boolean): void }) {
  const { me } = useAuth(); const { view, error, busy, load } = useWorkflow(campaignId); const [editor, setEditor] = useState<Editor | null>(null);
  const [dirty, setDirty] = useState(false); const [message, setMessage] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const staleResource = resourceVersion !== undefined && view?.campaign.recordVersion !== resourceVersion;
  useEffect(() => { if (resourceVersion !== undefined && !dirty) void load(); }, [resourceVersion, dirty, load]);
  const openEditor = (value: Editor) => {
    if (busy || staleResource) { setMessage('Đang cập nhật hồ sơ. Vui lòng chờ tải xong.'); return; }
    if (hasUnsavedChanges()) { setMessage('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); return; }
    setMessage(''); setEditor(value);
  };
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(commandBusy); return () => onBusyChange?.(false); }, [commandBusy, onBusyChange]);
  useEffect(() => { const refresh = () => { if (!dirty) void load(); }; window.addEventListener('focus', refresh); window.addEventListener('cpms:workflow-updated', refresh); window.addEventListener('cpms:policy-version-changed', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('cpms:workflow-updated', refresh); window.removeEventListener('cpms:policy-version-changed', refresh); }; }, [dirty, load]);
  const close = () => { if (!commandBusy && (!dirty || window.confirm('Bỏ nội dung chưa xác nhận?'))) { setEditor(null); setDirty(false); } };
  const saved = () => { setMessage(editor?.operation === 'SUBMIT' ? 'Chiến dịch đã được gửi đến Ban TT' : 'Đã hoàn tất thao tác.'); setEditor(null); setDirty(false); void load(); onSaved?.(); };
  if (!view) return <div className="space-y-2"><p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-700' : 'text-slate-500'}`}>{error || 'Đang tải luồng phê duyệt…'}</p>{error && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>Thử tải lại</Button>}</div>;
  const name = (id: string | null) => view.people.find((p) => p.id === id)?.displayName ?? 'Lãnh đạo Ban TT';
  const org = (id: string | null) => view.organizations.find((o) => o.id === id)?.sourceName ?? 'Chưa chọn đơn vị';
  const active = view.assignments.filter((a) => !a.endsAt); const revision = view.revision;
  const showApproval = section !== 'participants'; const showPeople = section !== 'approval';
  return <section className="space-y-4" aria-label={showApproval ? 'Luồng phê duyệt Campaign' : 'Người tham gia Campaign'}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><CpmsIcon name={showApproval ? 'approve' : 'users'} />{showApproval ? 'Phê duyệt & giao việc' : 'Người tham gia'}</h2>{revision && <p className="mt-1 text-xs text-slate-500">Người gửi: {name(revision.submittedByActorId)} · {workflowTime(revision.createdAt)}</p>}</div><div className="flex items-center gap-2"><StatusBadge>{workflowLabel(revision?.state ?? 'DRAFT')}</StatusBadge><Button size="sm" variant="ghost" disabled={busy || dirty} onClick={() => void load()}><CpmsIcon name="refresh" />Tải lại</Button></div></header>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {editor ? <div className="rounded-xl border border-cyan-200 bg-cyan-50/30 p-4"><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{editor.operation === 'POLICY' ? 'Chế độ phê duyệt riêng' : operationLabels[editor.operation]}</h3><Button size="sm" variant="ghost" disabled={commandBusy} onClick={close}>Đóng phần thay đổi</Button></div>
      {['APPROVE_ASSIGN','REJECT'].includes(editor.operation) && view.tasks.find((task) => task.id === editor.stepId)?.kind === 'DIVISION_ACCEPT_AND_ASSIGN'
          ? <CampaignApprovalWizard entries={[{ view, stepId: editor.stepId! }]} initialDecision={editor.operation === 'REJECT' ? 'reject' : 'approve'} onSaved={saved} onDirtyChange={setDirty} onBusyChange={setCommandBusy} />
          : <WorkflowCommandEditor key={JSON.stringify(editor)} view={view} editor={editor} onSaved={saved} onDirtyChange={setDirty} onBusyChange={setCommandBusy} />}
    </div> : <fieldset className="min-w-0 space-y-4" disabled={busy || staleResource}>
      {showApproval && <>
        <div className="flex flex-wrap gap-2">
          {view.capabilities.submit && (!revision || ['DRAFT','RETURNED','REJECTED','NEEDS_ROUTING','NEEDS_ASSIGNEE','CANCELLED'].includes(revision.state)) && <Button size="sm" onClick={() => openEditor({ operation: 'SUBMIT' })}><CpmsIcon name="approve" />Gửi Ban TT</Button>}
          {view.capabilities.withdraw && revision && !['DRAFT','SUPERSEDED','APPROVED'].includes(revision.state) && <Button size="sm" variant="secondary" onClick={() => openEditor({ operation: 'WITHDRAW' })}><CpmsIcon name="edit" />Rút về nháp</Button>}
        </div>
        {view.tasks.filter((task) => task.state === 'PENDING').map((task) => <article className="rounded-xl border border-slate-200 p-4" key={task.id}><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{workflowLabel(task.kind)} · {org(task.orgId)}</h3><StatusBadge>{workflowLabel(task.decision?.kind ?? task.state)}</StatusBadge></div><p className="mt-2 text-xs text-slate-500">{task.assigneeActorId ? `Giao đích danh: ${name(task.assigneeActorId)}` : 'Lãnh đạo Phòng tiếp nhận xử lý'} · {task.mandatory ? 'Bước bắt buộc' : 'Phần phối hợp tùy chọn'} · {workflowTime(task.createdAt)}</p>
          {task.decision && <p className="mt-2 text-sm">{name(task.decision.actorId)} · {workflowTime(task.decision.decidedAt)}{task.decision.reason && ` · ${task.decision.reason}`}</p>}
          {task.state === 'PENDING' && <div className="mt-3 flex flex-wrap gap-2">{task.eligibility?.allowed ? <><Button size="sm" onClick={() => openEditor({ operation: 'APPROVE_ASSIGN', stepId: task.id })}><CpmsIcon name="approve" />Xử lý phê duyệt</Button><Button size="sm" variant="secondary" onClick={() => openEditor({ operation: 'RETURN', stepId: task.id })}>Trả lại để sửa</Button><Button size="sm" variant="ghost" onClick={() => openEditor({ operation: 'REJECT', stepId: task.id })}>Từ chối</Button></> : <p className="text-xs text-slate-500">{workflowLabel(task.eligibility?.reason)}</p>}{me.directSuperadmin && task.adminEligibility?.allowed && <><Button size="sm" variant="secondary" onClick={() => openEditor({ operation: 'ADMIN_SKIP_ASSIGN', stepId: task.id })}>Superadmin phê duyệt và phân công</Button><Button size="sm" variant="ghost" onClick={() => openEditor({ operation: 'ADMIN_REJECT', stepId: task.id })}>Superadmin từ chối</Button></>}</div>}
        </article>)}
        {!view.tasks.length && <p className="text-sm text-slate-500">{revision?.state === 'NO_APPROVAL' ? 'Không tạo nhiệm vụ duyệt nội bộ cho chế độ này.' : 'Chiến dịch chưa được gửi đến Ban TT.'}</p>}
      </>}
      {showPeople && <><div className="flex flex-wrap gap-2">{view.reassignableScopes.map((scope) => <Button key={`${scope.orgId}:${scope.functionalRole}`} size="sm" variant="secondary" onClick={() => openEditor({ operation: 'REASSIGN', ...scope })}><CpmsIcon name="users" />Thay {workflowLabel(scope.functionalRole)} · {org(scope.orgId)}</Button>)}{view.cooperationSourceOrgIds.length > 0 && <Button size="sm" variant="secondary" onClick={() => openEditor({ operation: 'REQUEST_COOPERATION' })}><CpmsIcon name="add" />Đề nghị phối hợp</Button>}</div>
        {active.length > 0 && <div className="grid gap-3 md:grid-cols-2">{active.map((assignment) => <div className="rounded-lg bg-slate-50 p-3 text-sm" key={assignment.id}><p className="text-xs text-slate-500">{workflowLabel(assignment.functionalRole)} · {workflowLabel(assignment.responsibility)}</p><p className="mt-1 font-semibold">{name(assignment.actorId)}</p></div>)}</div>}
        {active.length > 0 && <details><summary className="cursor-pointer text-xs text-slate-500">Chi tiết phân công</summary><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Người tham gia', 'Phòng / Ban', 'Trách nhiệm', 'Người giao', 'Hiệu lực từ'].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{active.map((assignment) => <tr className="border-t border-slate-100" key={assignment.id}><td className="p-3 font-medium">{name(assignment.actorId)}</td><td className="p-3">{org(assignment.orgId)}</td><td className="p-3">{workflowLabel(assignment.functionalRole)}<p className="text-xs text-slate-500">{workflowLabel(assignment.responsibility)}</p></td><td className="p-3">{name(assignment.assignedByActorId)}</td><td className="p-3 text-xs">{workflowTime(assignment.startsAt)}</td></tr>)}</tbody></table></div></details>}{!active.length && <p className="text-sm text-slate-500">Chưa có phân công.</p>}
        {view.cooperations.map((request) => <div className="rounded-lg border border-slate-200 p-3 text-sm" key={request.id}><strong>{org(request.sourceOrgId)} → {org(request.targetOrgId)}</strong><p className="mt-1">{workflowLabel(request.state)} · {request.reason}</p>{request.responseReason && <p className="mt-1 text-xs">Phản hồi: {request.responseReason}</p>}{request.state === 'PENDING' && (request.requestedByActorId === me.account.id || me.directSuperadmin) && <Button size="sm" variant="ghost" className="mt-2" onClick={() => openEditor({ operation: 'CANCEL_COOPERATION', requestId: request.id, expectedRequestVersion: request.recordVersion })}>Hủy đề nghị</Button>}</div>)}
      </>}
      {view.history.length > 0 && <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Lịch sử phê duyệt ({view.history.length})</summary><div className="mt-3 space-y-3">{view.history.map((row) => <div className="border-t border-slate-100 pt-3 text-xs" key={row.id}><strong>Lần trình {row.number} · {workflowLabel(row.state)}</strong><p className="mt-1">{workflowTime(row.createdAt)} · {row.reason || 'Không có ghi chú'}</p>{row.steps.filter((s) => s.decision).map((step) => <p className="mt-1" key={step.id}>{org(step.orgId)} · {workflowLabel(step.decision!.kind)} · {name(step.decision!.actorId)} · {step.decision!.reason}</p>)}</div>)}</div></details>}

    </fieldset>}
  </section>;
}

export function WorkflowCommandEditor({ view, editor, onSaved, onDirtyChange, onBusyChange }: { view: WorkflowView; editor: Editor; onSaved(): void; onDirtyChange(value: boolean): void; onBusyChange(value: boolean): void }) {
  const [key] = useState(() => crypto.randomUUID()); const [reason, setReason] = useState(''); const [lead, setLead] = useState(''); const [coops, setCoops] = useState<string[]>([]);
  const [leaderActorId, setLeaderActorId] = useState('');
  const [source, setSource] = useState(view.cooperationSourceOrgIds[0] ?? ''); const [target, setTarget] = useState(''); const [targetActor, setTargetActor] = useState('');
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false);
  useUnsavedChanges(true);
  useEffect(() => { onDirtyChange(true); return () => onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const step = view.tasks.find((s) => s.id === editor.stepId);
  const assignment = ['APPROVE_ASSIGN','ADMIN_SKIP_ASSIGN','REASSIGN'].includes(editor.operation);
  const role = editor.operation === 'REASSIGN' ? editor.functionalRole : step?.kind === 'DEPARTMENT_APPROVAL' ? 'DIVISION_LEADER' : 'CAMPAIGN_MANAGER';
  const pooled = editor.operation === 'ADMIN_SKIP_ASSIGN' && view.revision?.route === 'DIVISION' && !view.revision.receivingDivisionId && step?.orgId === view.revision.receivingDepartmentId;
  const selectedLeader = view.candidates.find((candidate) => candidate.actorId === leaderActorId);
  const orgId = editor.operation === 'REASSIGN' ? editor.orgId : role === 'CAMPAIGN_MANAGER' ? (pooled ? selectedLeader?.divisionId : step?.assignmentOrgId ?? step?.orgId) : null;
  const candidates = view.candidates.filter((p) => p.roles.includes(role ?? '') && (!orgId || p.divisionId === orgId));
  const person = (id: string) => view.people.find((p) => p.id === id);
  const label = (id: string) => { const p = person(id); return p ? `${p.displayName}${p.jobTitle ? ` · ${p.jobTitle}` : ''}` : 'Người được chọn'; };
  const chosen = candidates.find((p) => p.actorId === lead);
  const fixed = editor.operation === 'REASSIGN' && role === 'DIVISION_LEADER' ? view.assignments.find((a) => !a.endsAt && a.orgId === orgId && a.functionalRole === role)?.responsibility : undefined;
  const members = lead && chosen?.divisionId ? [{ actorId: lead, orgId: chosen.divisionId, responsibility: fixed ?? 'LEAD' }, ...coops.flatMap((id) => {
    const candidate = candidates.find((p) => p.actorId === id); return candidate?.divisionId ? [{ actorId: id, orgId: candidate.divisionId, responsibility: 'COOP' }] : [];
  })] : [];
  const body = { operation: editor.operation, idempotencyKey: key, expectedVersion: view.version, expectedSubjectRevision: view.campaign.businessRevision, reason,
    ...(['SUBMIT','REVISE_POLICY'].includes(editor.operation) ? { receivingDivisionId: null } : {}),
    ...(step ? { stepId: step.id, expectedStepVersion: step.stepVersion } : {}), ...(assignment ? { members } : {}),
    ...(editor.operation === 'ADMIN_SKIP_ASSIGN' ? { leaderActorId } : {}),
    ...(editor.operation === 'REASSIGN' ? { orgId: editor.orgId, functionalRole: editor.functionalRole } : {}),
    ...(editor.operation === 'REQUEST_COOPERATION' ? { sourceOrgId: source, targetOrgId: target, targetActorId: targetActor || null } : {}),
    ...(editor.requestId ? { requestId: editor.requestId, expectedRequestVersion: editor.expectedRequestVersion } : {}) };
  const valid = (['SUBMIT','APPROVE_ASSIGN','REJECT','ADMIN_REJECT','DECLINE_COOPERATION'].includes(editor.operation) || Boolean(reason.trim())) && (!assignment || Boolean(lead)) &&
    (editor.operation !== 'ADMIN_SKIP_ASSIGN' || Boolean(leaderActorId)) && (editor.operation !== 'REQUEST_COOPERATION' || Boolean(source && target));
  const shown = candidates.filter((p) => p.actorId === lead || normalizeDirectorySearch(label(p.actorId)).includes(normalizeDirectorySearch(query)));
  return <div className="space-y-4"><fieldset className="space-y-4" disabled={busy}>
    {['SUBMIT','REVISE_POLICY'].includes(editor.operation) && <p className="text-sm">Gửi chiến dịch đến Ban TT để tiếp nhận và phân công.</p>}
    {editor.operation === 'ADMIN_SKIP_ASSIGN' && <label className="block text-sm">Lãnh đạo Phòng chịu trách nhiệm sau phê duyệt<select aria-label="Lãnh đạo sau phê duyệt của superadmin" className={`${accessInput} mt-1 w-full`} value={leaderActorId} onChange={(e) => { setLeaderActorId(e.target.value); setLead(''); setCoops([]); }}><option value="">Chọn Lãnh đạo đúng phạm vi</option>{view.candidates.filter((p) => p.roles.includes(step?.kind === 'DEPARTMENT_APPROVAL' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER') && (step?.kind === 'DEPARTMENT_APPROVAL' || pooled || p.divisionId === step?.orgId)).map((p) => <option value={p.actorId} key={p.actorId}>{label(p.actorId)}</option>)}</select></label>}
    {assignment && <><input aria-label="Tìm người phân công" className={`${accessInput} w-full`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên, email, mã nhân viên, phòng…" /><label className="block text-sm">{fixed === 'COOP' ? 'Leader phối hợp' : `Người chủ trì · ${workflowLabel(role)}`}<select aria-label="Người chủ trì workflow" className={`${accessInput} mt-1 w-full`} value={lead} onChange={(e) => { setLead(e.target.value); setCoops([]); }}><option value="">Chọn người</option>{shown.map((p) => <option key={p.actorId} value={p.actorId}>{label(p.actorId)}</option>)}</select></label>
      {!fixed && <div><p className="mb-2 text-sm">Người phối hợp (tùy chọn)</p><div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-white p-3">{shown.filter((p) => p.actorId !== lead && (role !== 'DIVISION_LEADER' || p.divisionId !== chosen?.divisionId)).map((p) => <label key={p.actorId} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={coops.includes(p.actorId)} disabled={!lead || (role === 'DIVISION_LEADER' && !coops.includes(p.actorId) && coops.some((id) => candidates.find((c) => c.actorId === id)?.divisionId === p.divisionId))} onChange={(e) => setCoops((ids) => e.target.checked ? [...ids, p.actorId] : ids.filter((id) => id !== p.actorId))} />{label(p.actorId)}</label>)}{!shown.length && <p className="text-xs text-slate-500">Chưa có người phù hợp. Cần kiểm tra role, đơn vị và trạng thái đăng nhập.</p>}</div></div>}
    </>}
    {editor.operation === 'REQUEST_COOPERATION' && <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Phòng gửi<select className={`${accessInput} mt-1 w-full`} value={source} onChange={(e) => setSource(e.target.value)}>{view.organizations.filter((o) => view.cooperationSourceOrgIds.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.sourceName}</option>)}</select></label><label className="text-sm">Phòng được đề nghị<select aria-label="Phòng được đề nghị phối hợp" className={`${accessInput} mt-1 w-full`} value={target} onChange={(e) => { setTarget(e.target.value); setTargetActor(''); }}><option value="">Chọn phòng khác</option>{view.organizations.filter((o) => o.kind === 'DIVISION' && o.id !== source && !view.tasks.some((t) => t.orgId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.sourceName}</option>)}</select></label><label className="text-sm md:col-span-2">Người nhận<select aria-label="Lãnh đạo Phòng nhận đề nghị phối hợp" className={`${accessInput} mt-1 w-full`} value={targetActor} onChange={(e) => setTargetActor(e.target.value)}><option value="">Lãnh đạo Phòng tiếp nhận</option>{view.candidates.filter((p) => p.divisionId === target && p.roles.includes('DIVISION_LEADER')).map((p) => <option key={p.actorId} value={p.actorId}>{label(p.actorId)}</option>)}</select></label><p className="text-xs text-slate-500 md:col-span-2">Đây là lời đề nghị ngang cấp. Người nhận có thể từ chối; quyền và trách nhiệm chỉ được tạo khi chấp nhận.</p></div>}
    <label className="block text-sm">{['SUBMIT','APPROVE_ASSIGN','REJECT','ADMIN_REJECT','DECLINE_COOPERATION'].includes(editor.operation) ? 'Ghi chú (tùy chọn)' : 'Lý do (bắt buộc)'}<textarea aria-label="Lý do thao tác workflow" className={`${accessInput} mt-1 w-full`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} /></label>
  </fieldset><WorkflowCommandReview campaignId={view.campaign.id} body={body} valid={valid} onSaved={onSaved} onBusyChange={setBusy} /></div>;
}

export function WorkflowCommandReview({ campaignId, body, valid, onSaved, onBusyChange }: { campaignId: string; body: Record<string, unknown>; valid: boolean; onSaved(): void; onBusyChange?(value: boolean): void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const serialized = JSON.stringify(body);
  useEffect(() => { setError(''); }, [serialized]);
  const run = async () => {
    if (!valid || busy) return; setBusy(true); onBusyChange?.(true); setError('');
    try {
      await requestJson(`/campaign-workflow/${encodeURIComponent(campaignId)}/commands`, { method: 'POST', body: serialized });
      workflowChanged(); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không hoàn tất thao tác.'); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<Button size="sm" disabled={busy || !valid} onClick={() => void run()}><CpmsIcon name="save" />{busy ? 'Đang xử lý…' : 'Xác nhận'}</Button>
  </div>;
}
