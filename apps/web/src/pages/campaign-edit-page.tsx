import { CampaignDetailPage } from './campaign-detail-page';

export function CampaignEditPage({ id, notify }: { id: string; notify(message: string): void }) {
  return <CampaignDetailPage id={id} notify={notify} />;
}
