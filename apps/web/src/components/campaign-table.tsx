import type { CampaignSummary } from '@cpms/domain';
import { LoadingBlock } from '@cpms/ui';
import { CAMPAIGN_STATE_LABELS, formatDate } from '../lib/campaign-presentation';
import { AppLink, campaignDetailPath } from '../lib/router';
import { CampaignStatusChip, campaignStatusBarClass } from './campaign-status-highlight';


const DAY_MS = 86_400_000;
type TimelineCampaign = Pick<CampaignSummary, 'id' | 'code' | 'name' | 'startDate' | 'endDate'>
  & { lifecycleState?: string; qcttStatus?: string | null; isDeleted?: boolean };

function utcDay(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function CampaignTimeline({ campaigns, loading = false, emptyMessage = 'Chưa có chiến dịch phù hợp.' }: {
  campaigns: readonly TimelineCampaign[];
  loading?: boolean;
  emptyMessage?: string;
}) {
  if (loading && campaigns.length === 0) return <LoadingBlock label="Đang tải chiến dịch từ API…" />;
  if (campaigns.length === 0) return <p className="px-6 py-12 text-center text-sm text-slate-500">{emptyMessage}</p>;

  const dates = campaigns.flatMap((campaign) => [utcDay(campaign.startDate), utcDay(campaign.endDate)]).filter((date): date is number => date !== null);
  const now = new Date();
  const minimum = dates.length ? Math.min(...dates) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const maximum = dates.length ? Math.max(...dates) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 5, 1);
  const first = new Date(minimum);
  const last = new Date(maximum);
  const axisStart = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  const axisEnd = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
  const monthCount = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
  const width = Math.max(720, monthCount * 120);
  const months = Array.from({ length: monthCount }, (_, index) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1)));
  const position = (date: number) => ((date - axisStart) / (axisEnd - axisStart)) * 100;
  const today = position(Date.now());

  return <div className="overflow-x-auto" role="region" aria-label="Timeline các chiến dịch gần đây" tabIndex={0}>
    <div style={{ minWidth: width + 320 }}>
      <div className="flex h-12 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
        <div className="sticky left-0 z-20 flex w-80 shrink-0 items-center border-r border-slate-200 bg-slate-50 px-5">Chiến dịch</div>
        <div className="flex-1" style={{ minWidth: width }}>
          <div className="flex h-full">{months.map((month) => <div key={month.toISOString()} className="flex items-center border-r border-slate-200 px-3" style={{ width: `${100 / monthCount}%` }}>T{month.getUTCMonth() + 1}/{month.getUTCFullYear()}</div>)}</div>
        </div>
      </div>
      {campaigns.map((campaign) => {
        const start = utcDay(campaign.startDate);
        const end = utcDay(campaign.endDate);
        const valid = start !== null && end !== null && end >= start;
        const status = campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? (campaign.lifecycleState ? CAMPAIGN_STATE_LABELS[campaign.lifecycleState as CampaignSummary['lifecycleState']] ?? 'Chưa xác định' : 'Dự thảo');
        const identity = campaign.lifecycleState ? { lifecycleState: campaign.lifecycleState, isDeleted: Boolean(campaign.isDeleted) } : undefined;
        return <div key={campaign.id} className="group flex h-[68px] border-b border-slate-100 last:border-b-0 hover:bg-cyan-50/50">
          <div className="sticky left-0 z-20 flex w-80 shrink-0 flex-col justify-center gap-1 border-r border-slate-200 bg-white px-5 group-hover:bg-cyan-50">
            <AppLink className="truncate text-sm font-semibold text-vna-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-vna-blue" to={campaignDetailPath(campaign.id)} title={campaign.name}>{campaign.name}</AppLink>
            <div className="flex items-center gap-2 overflow-hidden"><span className="truncate font-mono text-[11px] text-slate-500">{campaign.code}</span><CampaignStatusChip campaign={identity} status={status} /></div>
          </div>
          <div className="relative flex-1" style={{ minWidth: width }}>
            {months.map((month) => <span key={month.toISOString()} aria-hidden="true" className="absolute inset-y-0 border-r border-slate-100" style={{ left: `${(months.indexOf(month) + 1) * 100 / monthCount}%` }} />)}
            {today >= 0 && today <= 100 ? <span aria-hidden="true" className="absolute inset-y-0 border-l-2 border-rose-400/70" style={{ left: `${today}%` }} /> : null}
            {valid ? <AppLink to={campaignDetailPath(campaign.id)} aria-label={`${campaign.name}: ${formatDate(campaign.startDate)} đến ${formatDate(campaign.endDate)}`} title={`${campaign.name} · ${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)} · ${status}`} className={`absolute top-[19px] flex h-8 items-center overflow-hidden rounded-lg px-2 text-[11px] font-semibold shadow-sm hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vna-blue border ${campaignStatusBarClass(identity, status)}`} style={{ left: `${position(start)}%`, width: `max(12px, ${position(end + DAY_MS) - position(start)}%)` }}><span className="truncate">{campaign.name}</span></AppLink> : <span className="absolute left-3 top-6 text-xs text-slate-400">Chưa xác định thời gian</span>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

export function CampaignTable({
  campaigns,
  loading = false,
  emptyMessage = 'Chưa có chiến dịch phù hợp.',
}: {
  campaigns: readonly CampaignSummary[];
  loading?: boolean;
  emptyMessage?: string;
}) {
  if (loading && campaigns.length === 0) return <LoadingBlock label="Đang tải chiến dịch từ API…" />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50/90 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-6 py-3 font-semibold">Mã</th>
            <th className="px-6 py-3 font-semibold">Chiến dịch</th>
            <th className="px-6 py-3 font-semibold">Đơn vị yêu cầu</th>
            <th className="px-6 py-3 font-semibold">Thời gian</th>
            <th className="px-6 py-3 font-semibold">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="group transition hover:bg-cyan-50/45">
              <td className="whitespace-nowrap px-6 py-4 font-mono text-xs font-medium text-slate-600">
                <AppLink className="rounded underline-offset-4 group-hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vna-gold" to={campaignDetailPath(campaign.id)}>
                  {campaign.code}
                </AppLink>
              </td>
              <td className="min-w-64 px-6 py-4">
                <AppLink className="font-semibold text-vna-blue underline-offset-4 group-hover:underline" to={campaignDetailPath(campaign.id)}>
                  {campaign.name}
                </AppLink>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-slate-600">{campaign.requestingUnit}</td>
              <td className="whitespace-nowrap px-6 py-4 text-slate-600">{formatDate(campaign.startDate)} – {formatDate(campaign.endDate)}</td>
              <td className="whitespace-nowrap px-6 py-4"><CampaignStatusChip campaign={campaign} status={campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? CAMPAIGN_STATE_LABELS[campaign.lifecycleState as CampaignSummary['lifecycleState']] ?? 'Chưa xác định'} /></td>
            </tr>
          ))}
          {!loading && campaigns.length === 0 ? (
            <tr><td className="px-6 py-12 text-center text-slate-500" colSpan={5}>{emptyMessage}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
