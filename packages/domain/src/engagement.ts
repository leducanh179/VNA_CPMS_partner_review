export const FIRST_CAMPAIGN_MISSION = 'FIRST_CAMPAIGN';
export const PAPER_PLANE_ITEM = 'PAPER_PLANE';
export type MissionMode = 'REAL' | 'DEMO';
export type MissionStage = 'ACTIVE' | 'DRAFT_SAVED' | 'COMPLETED';
export interface MissionProgressView {
  runNumber: number; mode: MissionMode; stage: MissionStage; startedAt: string;
  campaignId: string | null; campaignName: string | null; completedAt: string | null;
  rewardSeenAt: string | null; completedCount: number;
}
export interface EngagementView {
  enabled: boolean; canCreateCampaign: boolean; progress: MissionProgressView | null;
  inventory: { key: string; earnedAt: string }[];
}
