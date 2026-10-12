import { useAuth } from '../auth-context';
import { MaterialPortalPage } from '../pages/material-portal-page';

export function CampaignMaterialsTable({
  campaign,
  notify,
}: {
  campaign: { id: string; code: string; name: string };
  notify(message: string): void;
}) {
  const { me } = useAuth();
  return <MaterialPortalPage key={`${me.account.id}:${campaign.id}`} campaignScope={campaign} embedded notify={notify} />;
}
