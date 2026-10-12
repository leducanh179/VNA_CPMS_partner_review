import { useEffect, useState } from 'react';
import { LoadingBlock } from '@cpms/ui';
import { requestJson } from '../lib/api';
import { QcttPlanWorkspace } from '../components/qctt-plan-workspace';

type CampaignOption = { id: string; code: string; name: string; hasPlan: boolean };
export function QcttPlansPage({ campaignId }: { campaignId?: string }) {
  const [campaigns, setCampaigns] = useState<CampaignOption[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (campaignId) return; let active = true;
    requestJson<CampaignOption[]>('/qctt-plans/campaigns').then(result => { if (active) setCampaigns(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được chiến dịch.'); });
    return () => { active = false; }; }, [campaignId]);
  if (campaignId) return <QcttPlanWorkspace campaignId={campaignId}/>;
  if (error) return <p role="alert" className="rounded-xl border p-5 text-rose-700">{error}</p>;
  if (!campaigns) return <LoadingBlock label="Đang tải danh sách chiến dịch…"/>;
  if (!campaigns.length) return <p className="rounded-xl border bg-white p-8 text-center text-slate-500">Chưa có chiến dịch để lập kế hoạch QCTT.</p>;
  return <QcttPlanWorkspace campaignId={campaigns[0]!.id}/>;
}
