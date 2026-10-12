import { Button, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { inboxDecisionKind, type InboxDecision, type InboxItem } from '../lib/my-work';
import { useWorkflow, type WorkflowView } from '../lib/campaign-workflow';
import { useCampaignOperations } from '../lib/use-campaign-operations';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import type { CampaignChangeRequest, CampaignOperationsView } from '../lib/campaign-operations';
import { CampaignApprovalWizard } from './campaign-approval-wizard';
import { OperationEditor } from './campaign-operations-workspace';
import { WorkflowCommandEditor } from './campaign-workflow-workspace';
import { AppLink, campaignDetailPath } from '../lib/router';

export function InboxDecisionButtons({ item, disabled, onSelect }: { item: InboxItem; disabled: boolean; onSelect(decision: InboxDecision): void }) {
  if (!inboxDecisionKind(item)) return null;
  return <div className="mt-4 flex flex-wrap gap-3" role="group" aria-label="Quyết định phê duyệt">
    <button type="button" disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => onSelect('approve')}><CpmsIcon name="approve" />Phê duyệt</button>
    <button type="button" disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-2 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50" onClick={() => onSelect('reject')}><CpmsIcon name="reject" />Từ chối</button>
    <AppLink to={`${campaignDetailPath(item.campaignId)}?tab=approval`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-vna-blue/30 bg-white px-5 py-2 text-sm font-bold text-vna-blue hover:bg-cyan-50"><CpmsIcon name="info" />XEM CHI TIẾT…</AppLink>
  </div>;
}

export function MyWorkDecisionPanel({ item, decision, onClose, onSaved }: {
  item: InboxItem; decision: InboxDecision; onClose(): void; onSaved(): void;
}) {
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useUnsavedChanges(true);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    panel.current?.focus({ preventScroll: true });
  }, []);
  const kind = inboxDecisionKind(item);
  return <section ref={panel} tabIndex={-1} aria-label="Xử lý ngay tại Việc của tôi" className={`mt-4 space-y-4 rounded-xl border p-4 outline-none sm:p-5 ${decision === 'approve' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{decision === 'approve' ? 'Phê duyệt' : 'Từ chối'} · {item.campaign?.code}</h2><Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>Hủy</Button></div>
    <p className="text-sm text-slate-600">Chỉ ghi nhận khi bạn xác nhận ở bước cuối. Ý kiến từ chối không bắt buộc.</p>
    {kind === 'workflow' ? <WorkflowInboxDecision item={item} decision={decision} onSaved={onSaved} onBusyChange={setBusy} />
      : kind === 'change' ? <ChangeInboxDecision item={item} decision={decision} onSaved={onSaved} onBusyChange={setBusy} />
      : <StaleDecision />}
  </section>;
}

type DecisionProps = { item: InboxItem; decision: InboxDecision; onSaved(): void; onBusyChange(value: boolean): void };
const ignoreDirtyChange = () => undefined;
function StaleDecision() { return <p role="alert" className="text-sm text-amber-800">Yêu cầu đã thay đổi hoặc bạn không còn quyền xử lý. Hãy hủy và tải lại danh sách.</p>; }

function WorkflowInboxDecision(props: DecisionProps) {
  const { view, error, busy, load } = useWorkflow(props.item.campaignId);
  if (error) return <div><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="secondary" onClick={() => void load()}>Thử lại</Button></div>;
  if (!view || busy) return <LoadingBlock label="Đang kiểm tra quyền và bước phê duyệt…" />;
  const step = view.tasks.find((candidate) => candidate.id === props.item.id && candidate.kind === props.item.kind);
  const allowed = props.item.adminIntervention ? step?.adminEligibility?.allowed : step?.eligibility?.allowed;
  if (!allowed || step?.state !== 'PENDING' || view.campaign.id !== props.item.campaignId) return <StaleDecision />;
  return <LoadedWorkflowDecision {...props} view={view} />;
}

function LoadedWorkflowDecision({ view, item, decision, onSaved, onBusyChange }: DecisionProps & { view: WorkflowView }) {
  if (item.adminIntervention) return <WorkflowCommandEditor view={view} editor={{ operation: decision === 'approve' ? 'ADMIN_SKIP_ASSIGN' : 'ADMIN_REJECT', stepId: item.id }} onSaved={onSaved} onBusyChange={onBusyChange} onDirtyChange={ignoreDirtyChange} />;
  if (item.kind === 'DIVISION_ACCEPT_AND_ASSIGN') return <CampaignApprovalWizard entries={[{ view, stepId: item.id }]} initialDecision={decision} skipDecisionStep onSaved={onSaved} onBusyChange={onBusyChange} />;
  return <WorkflowCommandEditor view={view} editor={{ operation: decision === 'approve' ? 'APPROVE_ASSIGN' : 'REJECT', stepId: item.id }} onSaved={onSaved} onBusyChange={onBusyChange} onDirtyChange={ignoreDirtyChange} />;
}

function ChangeInboxDecision(props: DecisionProps) {
  const { view, error, loading, load } = useCampaignOperations(props.item.campaignId);
  if (error) return <div><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="secondary" onClick={() => void load()}>Thử lại</Button></div>;
  if (!view) return <LoadingBlock label="Đang kiểm tra yêu cầu phê duyệt…" />;
  const request = view.requests.find((candidate) => candidate.id === props.item.id && `CHANGE_${candidate.kind}` === props.item.kind);
  if (!view.capabilities.decide || request?.state !== 'PENDING' || request.subjectRevision !== view.subjectRevision) return <StaleDecision />;
  return <LoadedChangeDecision {...props} view={view} request={request} loading={loading} />;
}

function LoadedChangeDecision({ view, request, loading, decision, onSaved, onBusyChange }: DecisionProps & { view: CampaignOperationsView; request: CampaignChangeRequest; loading: boolean }) {
  const openedVersion = useRef(view.version);
  const stale = openedVersion.current !== view.version;
  return <>{stale && <StaleDecision />}<OperationEditor view={view} request={request} operation="DECIDE" decision={decision} disabled={loading || stale} onSaved={onSaved} onBusyChange={onBusyChange} /></>;
}
