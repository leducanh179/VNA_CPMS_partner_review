export { CAMPAIGN_SHARE_TAB_LABELS as campaignShareLabels } from '@cpms/domain';

export function campaignSharePath(id: string) {
  return `/share/campaigns/${encodeURIComponent(id)}`;
}

export function sharedCampaignId(pathname: string) {
  return /^\/share\/campaigns\/([a-f0-9-]{36})$/i.exec(pathname)?.[1];
}
