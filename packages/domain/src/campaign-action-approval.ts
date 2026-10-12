/** Stable operation codes. Missing legacy settings fail closed (all gates enabled). */
export const CAMPAIGN_APPROVAL_ACTIONS = ['DEPLOY', 'EDIT', 'PAUSE', 'RESUME', 'CANCEL', 'PURGE'] as const;
export type CampaignApprovalAction = typeof CAMPAIGN_APPROVAL_ACTIONS[number];
export type CampaignRequiredApprovals = Record<CampaignApprovalAction, boolean>;
export const CAMPAIGN_APPROVAL_ACTION_LABELS: Record<CampaignApprovalAction, string> = {
  DEPLOY: 'Phê duyệt triển khai', EDIT: 'Sửa đổi', PAUSE: 'Tạm dừng', RESUME: 'Nối lại', CANCEL: 'Xóa', PURGE: 'Xóa vĩnh viễn',
};
export function campaignRequiredApprovals(value?: unknown): CampaignRequiredApprovals {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { DEPLOY: source.DEPLOY !== false, EDIT: source.EDIT !== false, PAUSE: source.PAUSE !== false,
    RESUME: source.RESUME !== false, CANCEL: source.CANCEL !== false, PURGE: source.PURGE !== false };
}
export function requiresCampaignApproval(policy: { preset?: string | null; requiredApprovals?: unknown } | null | undefined, levelCode: string | null, action: string): boolean {
  if (!policy?.preset) return true;
  if (policy.preset === 'NO_APPROVAL' || (policy.preset === 'NO_APPROVAL_LEVEL_1_ONLY' && levelCode === 'CLV_01') ||
    (policy.preset === 'DIVISION_LEVEL_1_ONLY' && levelCode !== 'CLV_01')) return false;
  // Per-action exemptions belong only to the Division policy; other routes retain their gates.
  if (!['DIVISION_ONLY', 'DIVISION_LEVEL_1_ONLY'].includes(policy.preset)) return true;
  return !CAMPAIGN_APPROVAL_ACTIONS.includes(action as CampaignApprovalAction) || campaignRequiredApprovals(policy.requiredApprovals)[action as CampaignApprovalAction];
}
