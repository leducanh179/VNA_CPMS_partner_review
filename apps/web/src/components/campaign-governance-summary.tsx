import type { CampaignSummary } from '@cpms/domain';
import { Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { CAMPAIGN_STATE_LABELS } from '../lib/campaign-presentation';
import { useWorkflow, workflowLabel, type WorkflowAssignment, type WorkflowView } from '../lib/campaign-workflow';

export function CampaignGovernanceSummary({ campaign }: { campaign: CampaignSummary }) {
  const { view } = useWorkflow(campaign.id);
  const status = campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? CAMPAIGN_STATE_LABELS[campaign.lifecycleState];
  const revisionState = view?.revision?.state;
  const showTeam = Boolean(revisionState && !['DRAFT', 'RETURNED', 'REJECTED', 'LEGACY_UNASSESSED', 'SUPERSEDED'].includes(revisionState));
  const approved = revisionState === 'APPROVED';
  const active = view?.assignments.filter((assignment) => !assignment.endsAt) ?? [];

  return <Card className="mb-4 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tình trạng Chiến dịch</p><p className="mt-1 text-lg font-semibold text-slate-950">{status}</p></div>
      <StatusBadge>{campaign.pendingChangeLabel || workflowLabel(revisionState ?? campaign.lifecycleState)}</StatusBadge>
    </div>
    {showTeam ? <div className="px-5 py-5 lg:px-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><CpmsIcon name="users" />Nhóm phụ trách QCTT</h2>
      <p className="mt-1 text-sm text-slate-500">{approved ? 'Những người đang chịu trách nhiệm chính và phối hợp cho Chiến dịch.' : 'Chiến dịch đang chờ tiếp nhận, phê duyệt và phân công.'}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <RoleSummary title="Lãnh đạo Phòng Ban TT chủ trì" assignments={approved ? active.filter((assignment) => assignment.functionalRole === 'DIVISION_LEADER') : []} view={view} fallback="Chưa tiếp nhận" />
        <RoleSummary title="Chuyên viên Ban TT phụ trách chính" assignments={approved ? active.filter((assignment) => assignment.functionalRole === 'CAMPAIGN_MANAGER' && assignment.responsibility === 'LEAD') : []} view={view} fallback="Chưa phân công" />
        <RoleSummary title="Chuyên viên Ban TT phối hợp" assignments={approved ? active.filter((assignment) => assignment.functionalRole === 'CAMPAIGN_MANAGER' && assignment.responsibility === 'COOP') : []} view={view} fallback="Chưa phân công" />
      </div>
    </div> : null}
  </Card>;
}

function RoleSummary({ title, assignments, view, fallback }: { title: string; assignments: WorkflowAssignment[]; view: WorkflowView | null; fallback: string }) {
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    {assignments.length ? <div className="mt-3 space-y-2">{assignments.map((assignment) => { const person = view?.people.find((candidate) => candidate.id === assignment.actorId); return <div key={assignment.id}><p className="text-sm font-semibold text-slate-900">{person?.displayName ?? 'Người dùng CPMS'}</p>{person?.jobTitle ? <p className="text-xs text-slate-500">{person.jobTitle}</p> : null}</div>; })}</div> : <p className="mt-3 text-sm text-slate-500">{fallback}</p>}
  </section>;
}
