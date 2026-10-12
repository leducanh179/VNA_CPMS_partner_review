import type { CampaignSummary } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock, StatusBadge } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth-context';
import { requestJson } from '../lib/api';
import { CAMPAIGN_STATE_LABELS } from '../lib/campaign-presentation';
import { changeLabels, type CampaignOperationsView } from '../lib/campaign-operations';
import { useWorkflow, workflowChanged, workflowLabel, workflowTime, type WorkflowView } from '../lib/campaign-workflow';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { useCampaignOperations } from '../lib/use-campaign-operations';
import { CampaignPendingRequestReview } from './campaign-operations-workspace';
import { CampaignWorkflowWorkspace, WorkflowCommandEditor } from './campaign-workflow-workspace';

interface CampaignApprovalWorkspaceProps {
  campaign: CampaignSummary;
  onNavigateInformation(): void;
  onSaved(): void;
}

type ApprovalDecision = 'approve' | 'reject' | null;

interface ApprovalHistoryItem {
  id: string;
  at: string;
  title: string;
  actor: string;
  detail: string;
  tone: 'neutral' | 'approved' | 'rejected';
}

export function CampaignApprovalWorkspace({ campaign, onNavigateInformation, onSaved }: CampaignApprovalWorkspaceProps) {
  const { me } = useAuth();
  const { view, error, busy, load } = useWorkflow(campaign.id);
  const { view: operations, error: operationsError, loading: operationsLoading, load: loadOperations } = useCampaignOperations(campaign.id);
  const [decision, setDecision] = useState<ApprovalDecision>(null);
  const [lead, setLead] = useState('');
  const [coops, setCoops] = useState<string[]>([]);
  const [opinion, setOpinion] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const decisionPanel = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (!decision) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = decisionPanel.current;
      panel?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(() => panel?.querySelector<HTMLElement>('select, textarea, input, button')?.focus({ preventScroll: true }), 250);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [decision]);

  useUnsavedChanges(decision !== null && !saving);

  if (!view) return <Card className="p-6">{busy ? <LoadingBlock label="Đang mở nội dung phê duyệt…" /> : <div className="space-y-3"><p role="alert" className="text-sm text-rose-700">{error || 'Không tải được nội dung phê duyệt.'}</p><Button variant="secondary" onClick={() => void load()}>Thử lại</Button></div>}</Card>;

  const name = (id: string | null) => view.people.find((person) => person.id === id)?.displayName ?? (id === me.account.id ? me.account.displayName : 'Người dùng CPMS');
  const organizationName = (id: string | null) => view.organizations.find((organization) => organization.id === id)?.sourceName ?? 'Chưa xác định đơn vị';
  const pendingDivisionStep = view.tasks.find((step) => step.kind === 'DIVISION_ACCEPT_AND_ASSIGN' && step.state === 'PENDING');
  const actionableStep = pendingDivisionStep?.eligibility?.allowed || (me.directSuperadmin && pendingDivisionStep?.adminEligibility?.allowed) ? pendingDivisionStep : null;
  const adminDecision = Boolean(actionableStep && !actionableStep.eligibility?.allowed && me.directSuperadmin && actionableStep.adminEligibility?.allowed);
  const assignmentOrgId = actionableStep?.assignmentOrgId ?? actionableStep?.orgId ?? null;
  const candidates = view.people.filter((person) => person.isActive && view.candidates.some((candidate) => candidate.actorId === person.id && candidate.roles.includes('CAMPAIGN_MANAGER') && candidate.divisionId === assignmentOrgId));
  const activeAssignments = view.assignments.filter((assignment) => !assignment.endsAt);
  const staleResource = view.campaign.recordVersion !== campaign.recordVersion;
  const requestingUnits = campaign.requestingUnits.length ? campaign.requestingUnits.map((unit) => unit.displayName).join(', ') : campaign.requestingUnit || 'Chưa cập nhật';
  const requester = campaign.requestingEmployeeName || campaign.manualRequesterEmail || 'Chưa cập nhật';
  const currentStatus = campaign.qcttStatus || (view.revision?.state ? workflowLabel(view.revision.state) : CAMPAIGN_STATE_LABELS[campaign.lifecycleState]);
  const divisionLeads = activeAssignments.filter((assignment) => assignment.functionalRole === 'DIVISION_LEADER');
  const managers = activeAssignments.filter((assignment) => assignment.functionalRole === 'CAMPAIGN_MANAGER');
  const shouldShowExistingWorkflow = !actionableStep && (
    view.capabilities.submit || view.capabilities.withdraw || view.capabilities.policy ||
    view.tasks.some((step) => step.state === 'PENDING' && step.kind !== 'DIVISION_ACCEPT_AND_ASSIGN') ||
    (me.directSuperadmin && view.tasks.some((step) => step.state === 'PENDING'))
  );

  const resetDecision = () => {
    setDecision(null); setLead(''); setCoops([]); setOpinion(''); setActionError(''); setIdempotencyKey(crypto.randomUUID());
  };

  const submitDecision = async () => {
    if (!actionableStep || !decision || submitting.current || staleResource) return;
    if (decision === 'approve' && !adminDecision && !candidates.some((candidate) => candidate.id === lead)) {
      setActionError('Cần giao một chuyên viên phụ trách chính trước khi hoàn tất phê duyệt.');
      return;
    }
    submitting.current = true; setSaving(true); setActionError(''); setSuccess('');
    try {
      const members = decision === 'approve' && assignmentOrgId ? [
        { actorId: lead, orgId: assignmentOrgId, responsibility: 'LEAD' },
        ...coops.filter((id) => id !== lead && candidates.some((candidate) => candidate.id === id)).map((actorId) => ({ actorId, orgId: assignmentOrgId, responsibility: 'COOP' as const })),
      ] : undefined;
      await requestJson(`/campaign-workflow/${encodeURIComponent(campaign.id)}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          operation: decision === 'approve' ? 'APPROVE_ASSIGN' : 'REJECT',
          idempotencyKey,
          expectedVersion: view.version,
          expectedSubjectRevision: view.campaign.businessRevision,
          stepId: actionableStep.id,
          expectedStepVersion: actionableStep.stepVersion,
          reason: opinion,
          ...(members ? { members } : {}),
        }),
      });
      setSuccess(decision === 'approve' ? 'Đã phê duyệt và giao nhiệm vụ cho Chiến dịch.' : 'Đã từ chối Chiến dịch.');
      resetDecision();
      workflowChanged();
      await Promise.all([load(), loadOperations()]);
      onSaved();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể hoàn tất phê duyệt. Hãy tải lại và thử lại.');
    } finally {
      submitting.current = false; setSaving(false);
    }
  };

  const history = buildApprovalHistory(view, operations, name, organizationName);

  return <div className="space-y-4">
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CpmsIcon name="approve" />Tình trạng phê duyệt hiện tại</h2>
          <StatusBadge>{campaign.pendingChangeLabel || currentStatus}</StatusBadge>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-3 lg:p-6">
        <SummaryField label="Tình trạng" value={[currentStatus, campaign.pendingChangeLabel].filter(Boolean).join(' · ')} />
        <SummaryField label="Người yêu cầu" value={requester} />
        <SummaryField label="CQ, ĐV yêu cầu" value={requestingUnits} />
      </div>
      <div className="border-t border-slate-100 px-5 py-4 lg:px-6">
        <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-vna-blue hover:underline" onClick={onNavigateInformation}><CpmsIcon name="info" />Xem thông tin chi tiết của Chiến dịch</button>
      </div>
    </Card>

    {success && <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CpmsIcon name="success" />{success}</div>}
    {staleResource && <div role="alert" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><CpmsIcon name="warning" />Hồ sơ vừa thay đổi. Hãy tải lại trước khi phê duyệt.</div>}

    {operationsError ? <Card className="p-5"><p role="alert" className="text-sm text-rose-700">Không tải được yêu cầu phê duyệt: {operationsError}</p><Button className="mt-3" variant="secondary" onClick={() => void loadOperations()}>Tải lại yêu cầu</Button></Card>
      : !operations && operationsLoading ? <Card className="p-5"><LoadingBlock label="Đang tải yêu cầu chờ phê duyệt…" /></Card>
      : operations ? <CampaignPendingRequestReview view={operations} disabled={staleResource || operationsLoading || decision !== null} actorName={name} onSaved={(message) => {
        setSuccess(message); workflowChanged(); void load(); void loadOperations(); onSaved();
      }} /> : null}

    {actionableStep ? <Card className="p-5 lg:p-6">
      <h2 className="text-lg font-semibold text-slate-950">{adminDecision ? 'Quyết định của superadmin' : 'Quyết định của Lãnh đạo Phòng'}</h2>
      <p className="mt-1 text-sm text-slate-500">{adminDecision ? 'Phê duyệt thay thế được ghi riêng trong Nhật ký; vẫn phải phân công Lãnh đạo Phòng và chuyên viên phụ trách chính.' : 'Chọn hành động. Chỉ ghi nhận khi nhấn nút OK ở bước cuối.'}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={saving || staleResource} aria-pressed={decision === 'approve'} className={`min-h-14 rounded-xl border px-5 py-3 text-base font-bold transition ${decision === 'approve' ? 'border-emerald-700 bg-emerald-700 text-white ring-4 ring-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'} disabled:opacity-50`} onClick={() => { setDecision('approve'); setActionError(''); }}><span className="inline-flex items-center gap-2"><CpmsIcon name="approve" />Phê duyệt</span></button>
        <button type="button" disabled={saving || staleResource} aria-pressed={decision === 'reject'} className={`min-h-14 rounded-xl border px-5 py-3 text-base font-bold transition ${decision === 'reject' ? 'border-rose-700 bg-rose-700 text-white ring-4 ring-rose-100' : 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'} disabled:opacity-50`} onClick={() => { setDecision('reject'); setActionError(''); }}><span className="inline-flex items-center gap-2"><CpmsIcon name="reject" />Từ chối</span></button>
      </div>

      {adminDecision && decision && <fieldset ref={decisionPanel} className={`mt-5 space-y-5 rounded-2xl border p-5 ${decision === 'approve' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}><WorkflowCommandEditor key={`${actionableStep.id}:${decision}`} view={view} editor={{ operation: decision === 'approve' ? 'ADMIN_SKIP_ASSIGN' : 'ADMIN_REJECT', stepId: actionableStep.id }} onDirtyChange={() => undefined} onBusyChange={setSaving} onSaved={() => { setSuccess(decision === 'approve' ? 'Superadmin đã phê duyệt và giao việc.' : 'Superadmin đã từ chối Chiến dịch.'); resetDecision(); workflowChanged(); void load(); void loadOperations(); onSaved(); }} /></fieldset>}

      {!adminDecision && decision === 'approve' && <fieldset ref={decisionPanel} disabled={saving} className="mt-5 space-y-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
        <div><h3 className="font-semibold text-slate-950">Giao nhiệm vụ sau phê duyệt</h3><p className="mt-1 text-sm text-slate-600">Chuyên viên phụ trách chính là thông tin bắt buộc.</p></div>
        <label className="block text-sm font-semibold text-slate-700">Giao nhiệm vụ phụ trách chính Chiến dịch cho *
          <select className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={lead} onChange={(event) => { setLead(event.target.value); setCoops((ids) => ids.filter((id) => id !== event.target.value)); }}>
            <option value="">Chọn chuyên viên của Phòng</option>
            {candidates.map((person) => <option key={person.id} value={person.id}>{person.displayName}{person.jobTitle ? ` · ${person.jobTitle}` : ''}</option>)}
          </select>
        </label>
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Giao nhiệm vụ phối hợp Chiến dịch cho <span className="font-normal text-slate-500">({coops.length ? `${coops.length} người` : 'tùy chọn'})</span></summary>
          <div className="mt-3 max-h-52 space-y-2 overflow-auto">{candidates.filter((person) => person.id !== lead).map((person) => <label key={person.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-cyan-50"><input className="mt-0.5" type="checkbox" checked={coops.includes(person.id)} onChange={(event) => setCoops((ids) => event.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id))} /><span><span className="block font-medium">{person.displayName}</span>{person.jobTitle && <span className="text-xs text-slate-500">{person.jobTitle}</span>}</span></label>)}{!candidates.length && <p className="text-sm text-amber-800">Chưa có chuyên viên phù hợp trong danh bạ của Phòng.</p>}</div>
        </details>
        <OpinionField label="Ý kiến bổ sung" value={opinion} onChange={setOpinion} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-emerald-200 pt-4"><Button variant="secondary" disabled={saving} onClick={resetDecision}>Hủy</Button><button type="button" disabled={saving || !lead || staleResource} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void submitDecision()}><CpmsIcon name="approve" />{saving ? 'Đang phê duyệt…' : 'OK · Phê duyệt và giao việc'}</button></div>
      </fieldset>}

      {!adminDecision && decision === 'reject' && <fieldset ref={decisionPanel} disabled={saving} className="mt-5 space-y-5 rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
        <div><h3 className="font-semibold text-slate-950">Xác nhận từ chối</h3><p className="mt-1 text-sm text-slate-600">Ý kiến từ chối không bắt buộc; có thể bổ sung để người yêu cầu dễ chỉnh sửa.</p></div>
        <OpinionField label="Ý kiến từ chối" value={opinion} onChange={setOpinion} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-rose-200 pt-4"><Button variant="secondary" disabled={saving} onClick={resetDecision}>Hủy</Button><button type="button" disabled={saving || staleResource} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void submitDecision()}><CpmsIcon name="reject" />{saving ? 'Đang xử lý…' : 'OK · Từ chối Chiến dịch'}</button></div>
      </fieldset>}
      {actionError && <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-rose-700"><CpmsIcon name="error" />{actionError}</p>}
    </Card> : null}

    {!actionableStep && pendingDivisionStep && !shouldShowExistingWorkflow ? <Card className="p-5"><div className="flex items-start gap-3"><CpmsIcon name="pending" className="mt-0.5 text-amber-600" /><div><h2 className="font-semibold">Đang chờ Lãnh đạo Phòng xử lý</h2><p className="mt-1 text-sm text-slate-500">Nhiệm vụ phê duyệt đã được giao đúng phạm vi. Tài khoản hiện tại chỉ có thể theo dõi.</p></div></div></Card> : null}
    {shouldShowExistingWorkflow ? <Card className="p-5"><CampaignWorkflowWorkspace campaignId={campaign.id} resourceVersion={campaign.recordVersion} section="approval" onSaved={() => { void loadOperations(); onSaved(); }} /></Card> : null}

    {activeAssignments.length > 0 && <Card className="p-5 lg:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CpmsIcon name="users" />Nhóm phụ trách QCTT</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <GovernanceGroup title="Lãnh đạo Phòng chủ trì" assignments={divisionLeads} view={view} />
        <GovernanceGroup title="Chuyên viên phụ trách chính" assignments={managers.filter((assignment) => assignment.responsibility === 'LEAD')} view={view} />
        <GovernanceGroup title="Chuyên viên phối hợp" assignments={managers.filter((assignment) => assignment.responsibility === 'COOP')} view={view} />
      </div>
    </Card>}

    <Card className="p-5 lg:p-6">
      <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CpmsIcon name="history" />Lịch sử yêu cầu và phê duyệt</h2><Button size="sm" variant="ghost" disabled={busy} onClick={() => { void load(); void loadOperations(); }}><CpmsIcon name="refresh" />Tải lại</Button></div>
      {operationsError && <p className="mt-3 text-xs text-amber-700">Phần lịch sử yêu cầu chưa tải được: {operationsError}</p>}
      {history.length ? <ol className="mt-4 space-y-0">{history.map((item) => <li key={item.id} className="relative border-l border-slate-200 pb-5 pl-6 last:pb-0"><span className={`absolute -left-1.5 top-1 size-3 rounded-full ring-4 ring-white ${item.tone === 'approved' ? 'bg-emerald-500' : item.tone === 'rejected' ? 'bg-rose-500' : 'bg-vna-blue'}`} /><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{item.title}</p><time className="text-xs text-slate-500">{workflowTime(item.at)}</time></div><p className="mt-1 text-xs text-slate-500">{item.actor}</p>{item.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.detail}</p>}</li>)}</ol> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Chưa có yêu cầu hoặc quyết định phê duyệt.</p>}
    </Card>
  </div>;
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function OpinionField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label className="block text-sm font-semibold text-slate-700">{label} <span className="font-normal text-slate-500">(không bắt buộc)</span><textarea aria-label={label} className="mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-vna-blue focus:ring-4 focus:ring-cyan-100" maxLength={1000} rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function GovernanceGroup({ title, assignments, view }: { title: string; assignments: WorkflowView['assignments']; view: WorkflowView }) {
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>{assignments.length ? <div className="mt-3 space-y-2">{assignments.map((assignment) => { const person = view.people.find((item) => item.id === assignment.actorId); return <div key={assignment.id}><p className="text-sm font-semibold text-slate-900">{person?.displayName ?? 'Người dùng CPMS'}</p>{person?.jobTitle && <p className="text-xs text-slate-500">{person.jobTitle}</p>}</div>; })}</div> : <p className="mt-3 text-sm text-slate-500">Chưa phân công</p>}</section>;
}

function buildApprovalHistory(view: WorkflowView, operations: CampaignOperationsView | null, name: (id: string | null) => string, organizationName: (id: string | null) => string) {
  const items: ApprovalHistoryItem[] = [];
  for (const revision of view.history) {
    items.push({ id: `revision:${revision.id}`, at: revision.createdAt, title: `Gửi yêu cầu phê duyệt lần ${revision.number}`, actor: name(revision.submittedByActorId), detail: revision.reason, tone: 'neutral' });
    for (const step of revision.steps) {
      if (!step.decision) continue;
      const rejected = step.decision.kind === 'REJECTED' || step.decision.kind === 'RETURNED';
      items.push({ id: `decision:${step.decision.id}`, at: step.decision.decidedAt, title: `${workflowLabel(step.decision.kind)} · ${organizationName(step.orgId)}`, actor: name(step.decision.actorId), detail: step.decision.reason, tone: rejected ? 'rejected' : 'approved' });
    }
  }
  for (const request of operations?.requests ?? []) {
    items.push({ id: `request:${request.id}`, at: request.requestedAt, title: `Yêu cầu: ${changeLabels[request.kind]}`, actor: name(request.requestedByActorId), detail: request.reason, tone: 'neutral' });
    if (request.decidedAt) items.push({ id: `request-decision:${request.id}`, at: request.decidedAt, title: `${request.state === 'APPROVED' ? 'Phê duyệt' : request.state === 'REJECTED' ? 'Từ chối' : 'Cập nhật'} · ${changeLabels[request.kind]}`, actor: name(request.decidedByActorId), detail: request.decisionReason ?? '', tone: request.state === 'APPROVED' ? 'approved' : request.state === 'REJECTED' ? 'rejected' : 'neutral' });
  }
  return items.sort((left, right) => new Date(right.at).valueOf() - new Date(left.at).valueOf());
}
