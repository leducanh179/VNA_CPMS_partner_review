import type { CampaignSummary } from '@cpms/domain';
import { LoadingBlock, StatusBadge } from '@cpms/ui';
import { CAMPAIGN_STATE_LABELS, formatDate } from '../lib/campaign-presentation';
import { AppLink, campaignDetailPath } from '../lib/router';

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
              <td className="whitespace-nowrap px-6 py-4 font-mono text-xs font-semibold text-vna-blue">
                <AppLink className="rounded underline-offset-4 group-hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vna-gold" to={campaignDetailPath(campaign.id)}>
                  {campaign.code}
                </AppLink>
              </td>
              <td className="min-w-64 px-6 py-4">
                <AppLink className="font-semibold text-slate-900 underline-offset-4 group-hover:text-vna-blue group-hover:underline" to={campaignDetailPath(campaign.id)}>
                  {campaign.name}
                </AppLink>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-slate-600">{campaign.requestingUnit}</td>
              <td className="whitespace-nowrap px-6 py-4 text-slate-600">{formatDate(campaign.startDate)} – {formatDate(campaign.endDate)}</td>
              <td className="whitespace-nowrap px-6 py-4"><StatusBadge>{CAMPAIGN_STATE_LABELS[campaign.lifecycleState]}</StatusBadge></td>
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
