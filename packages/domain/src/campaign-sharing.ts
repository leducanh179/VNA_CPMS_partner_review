export const CAMPAIGN_SHARE_TABS = ['approval', 'information', 'documents', 'planning', 'results'] as const;
export const CAMPAIGN_SHARE_MODES = ['RESTRICTED', 'ACCOUNTS', 'PUBLIC'] as const;
export type CampaignShareTab = typeof CAMPAIGN_SHARE_TABS[number];
export type CampaignShareMode = typeof CAMPAIGN_SHARE_MODES[number];

export const CAMPAIGN_SHARE_TAB_LABELS: Record<CampaignShareTab, string> = {
  approval: 'Phê duyệt', information: 'Thông tin', documents: 'Tư liệu', planning: 'Kế hoạch', results: 'Kết quả',
};

export interface CampaignShareSpreadsheet {
  enabled: boolean;
  unavailableReason?: string;
  url: string | null;
  exportedAt: string | null;
  sharingChanged: boolean;
}

export interface CampaignShareSettings {
  mode: CampaignShareMode;
  tabs: Record<CampaignShareMode, CampaignShareTab[]>;
  version: number;
}

export function defaultCampaignShare(): CampaignShareSettings {
  return {
    mode: 'RESTRICTED', version: 0,
    tabs: {
      RESTRICTED: [...CAMPAIGN_SHARE_TABS],
      ACCOUNTS: ['approval', 'information', 'documents', 'planning'],
      PUBLIC: ['approval', 'information', 'documents'],
    },
  };
}

export function campaignShareAudience(mode: CampaignShareMode, restricted: boolean, signedIn: boolean): CampaignShareMode | null {
  if (restricted) return 'RESTRICTED';
  if (signedIn && mode !== 'RESTRICTED') return 'ACCOUNTS';
  return mode === 'PUBLIC' ? 'PUBLIC' : null;
}

export interface SharedCampaign {
  id: string;
  code: string;
  name: string;
  audience: CampaignShareMode;
  tabs: CampaignShareTab[];
  information?: { label: string; value: string }[];
  approval?: {
    status: string;
    tasks: { kind: string; state: string; completedAt: string | null }[];
    history: { number: number; state: string; createdAt: string }[];
  };
  documents?: {
    driveUrl: string | null;
    materials: { id: string; title: string; type: string; url: string }[];
  };
  planning?: { id: string; activity: string; channel: string | null; start: string | null; end: string | null; content: string; progress: string }[];
}
