export type CampaignViewMode = 'table' | 'timeline';

// A new key makes Timeline the initial view even for browsers that previously
// saved the old automatic Table default.
const STORAGE_KEY = 'cpms.campaign.view-mode.v2';

const preferenceKey = (accountId: string) => `${STORAGE_KEY}.${accountId}`;

export function readCampaignViewMode(accountId = 'default'): CampaignViewMode {
  if (typeof window === 'undefined') return 'timeline';
  try {
    return window.localStorage.getItem(preferenceKey(accountId)) === 'table' ? 'table' : 'timeline';
  } catch {
    return 'timeline';
  }
}

export function saveCampaignViewMode(mode: CampaignViewMode, accountId = 'default') {
  try {
    window.localStorage.setItem(preferenceKey(accountId), mode);
  } catch {
    // The view still works when browser storage is unavailable.
  }
}
