import type { CampaignSummary } from '@cpms/domain';

type StatusSource = { isDeleted?: boolean; lifecycleState?: string };

type Tone = 'draft' | 'pending' | 'approved' | 'planned' | 'running' | 'paused' | 'stopped' | 'completed';

const APPEARANCE: Record<Tone, { panel: string; dot: string; label: string; value: string; badge: string; chip: string }> = {
  draft: { panel: 'border-slate-300 bg-slate-50', dot: 'bg-slate-500', label: 'text-slate-600', value: 'text-slate-900', badge: 'border-slate-300 bg-white text-slate-700', chip: 'border-slate-300 bg-slate-100 text-slate-800' },
  pending: { panel: 'border-amber-500 bg-amber-50', dot: 'bg-amber-500', label: 'text-amber-800', value: 'text-amber-950', badge: 'border-amber-300 bg-white text-amber-900', chip: 'border-amber-400 bg-amber-100 text-amber-950' },
  approved: { panel: 'border-emerald-600 bg-emerald-50', dot: 'bg-emerald-600', label: 'text-emerald-800', value: 'text-emerald-950', badge: 'border-emerald-300 bg-white text-emerald-900', chip: 'border-emerald-400 bg-emerald-100 text-emerald-950' },
  planned: { panel: 'border-cyan-600 bg-cyan-50', dot: 'bg-cyan-600', label: 'text-cyan-800', value: 'text-cyan-950', badge: 'border-cyan-300 bg-white text-cyan-900', chip: 'border-cyan-400 bg-cyan-100 text-cyan-950' },
  running: { panel: 'border-blue-600 bg-blue-50', dot: 'bg-blue-600', label: 'text-blue-800', value: 'text-blue-950', badge: 'border-blue-300 bg-white text-blue-900', chip: 'border-blue-400 bg-blue-100 text-blue-950' },
  paused: { panel: 'border-orange-600 bg-orange-50', dot: 'bg-orange-600', label: 'text-orange-800', value: 'text-orange-950', badge: 'border-orange-300 bg-white text-orange-900', chip: 'border-orange-400 bg-orange-100 text-orange-950' },
  stopped: { panel: 'border-rose-600 bg-rose-50', dot: 'bg-rose-600', label: 'text-rose-800', value: 'text-rose-950', badge: 'border-rose-300 bg-white text-rose-900', chip: 'border-rose-400 bg-rose-100 text-rose-950' },
  completed: { panel: 'border-violet-600 bg-violet-50', dot: 'bg-violet-600', label: 'text-violet-800', value: 'text-violet-950', badge: 'border-violet-300 bg-white text-violet-900', chip: 'border-violet-400 bg-violet-100 text-violet-950' },
};

export function campaignStatusTone(campaign: StatusSource | undefined, status: string): Tone {
  if (campaign?.isDeleted) return 'stopped';
  switch (status) {
    case 'Nháp': case 'Dự thảo': return 'draft';
    case 'Chờ phê duyệt': case 'Đã gửi cấp ban': case 'Ban đã phân công': case 'Phòng đã phân công':
    case 'Campaign Manager đã tiếp nhận': case 'Đề nghị tạm dừng': case 'Đề nghị tiếp tục': case 'Chờ duyệt xóa': return 'pending';
    case 'Bị từ chối': case 'Ngừng triển khai (dữ liệu cũ)': return 'stopped';
    case 'Đã phê duyệt': return 'approved';
    case 'Đã lên kế hoạch': case 'Đang lập kế hoạch': return 'planned';
    case 'Đang triển khai': case 'Sẵn sàng triển khai': return 'running';
    case 'Đã tạm dừng': return 'paused';
    case 'Hoàn thành': case 'Đã lưu trữ': return 'completed';
  }
  switch (campaign?.lifecycleState) {
    case 'DRAFT': return 'draft';
    case 'SUBMITTED_TO_DEPARTMENT': case 'DEPARTMENT_ASSIGNED': case 'DIVISION_ASSIGNED': case 'CM_ACCEPTED':
    case 'PAUSE_REQUESTED': case 'RESUME_REQUESTED': case 'CANCEL_REQUESTED': return 'pending';
    case 'PAUSED': return 'paused';
    case 'CANCELLED': return 'stopped';
    case 'COMPLETED': case 'ARCHIVED': return 'completed';
    case 'PLANNING': return 'planned';
    case 'RUNNING': case 'READY_TO_LAUNCH': return 'running';
    default: return campaign ? 'approved' : 'draft';
  }
}

export function campaignStatusBarClass(campaign: StatusSource | undefined, status: string) {
  return APPEARANCE[campaignStatusTone(campaign, status)].chip;
}

export function CampaignStatusChip({ campaign, status }: { campaign?: StatusSource | undefined; status: string }) {
  const appearance = APPEARANCE[campaignStatusTone(campaign, status)];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${appearance.chip}`}>
    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${appearance.dot}`} />{status}
  </span>;
}

export function CampaignStatusHighlight({ campaign, status, label }: { campaign: CampaignSummary; status: string; label: string }) {
  const appearance = APPEARANCE[campaignStatusTone(campaign, status)];
  return <div className={`flex min-h-24 flex-wrap items-center justify-between gap-3 rounded-xl border border-l-4 px-5 py-4 shadow-sm ${appearance.panel}`}>
    <div className="min-w-0">
      <p className={`text-xs font-bold uppercase tracking-wider ${appearance.label}`}>{label}</p>
      <p className={`mt-2 flex items-center gap-3 text-xl font-bold sm:text-2xl ${appearance.value}`}><span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${appearance.dot}`} />{status}</p>
    </div>
    {campaign.pendingChangeLabel && <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${appearance.badge}`}>{campaign.pendingChangeLabel}</span>}
  </div>;
}
