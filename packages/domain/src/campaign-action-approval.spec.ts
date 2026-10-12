import { describe, expect, it } from 'vitest';
import { CAMPAIGN_APPROVAL_ACTIONS, campaignRequiredApprovals, requiresCampaignApproval } from './campaign-action-approval';

describe('Campaign operation approval gates', () => {
  it('defaults legacy or malformed settings to all required', () => {
    for (const value of [undefined, null, {}, 'false', { EDIT: 'false', PURGE: 0 }]) expect(Object.values(campaignRequiredApprovals(value))).toEqual([true,true,true,true,true,true]);
  });
  it.each(CAMPAIGN_APPROVAL_ACTIONS)('exempts only the unchecked %s gate', action => {
    const policy = { preset: 'DIVISION_ONLY', requiredApprovals: { ...campaignRequiredApprovals(), [action]: false } };
    for (const other of CAMPAIGN_APPROVAL_ACTIONS) expect(requiresCampaignApproval(policy, 'CLV_01', other)).toBe(other !== action);
    expect(requiresCampaignApproval(policy, 'CLV_01', 'PLAN')).toBe(true);
    expect(requiresCampaignApproval(policy, 'CLV_01', 'RESTORE')).toBe(true);
  });
  it('respects level applicability without treating NONE enforcement as a wildcard', () => {
    expect(requiresCampaignApproval({ preset: 'NO_APPROVAL_LEVEL_1_ONLY' }, 'CLV_02', 'PAUSE')).toBe(true);
    expect(requiresCampaignApproval({ preset: 'NO_APPROVAL_LEVEL_1_ONLY' }, 'CLV_01', 'PAUSE')).toBe(false);
    expect(requiresCampaignApproval({ preset: 'DIVISION_LEVEL_1_ONLY' }, 'CLV_02', 'PAUSE')).toBe(false);
    expect(requiresCampaignApproval({ preset: 'NO_APPROVAL' }, 'CLV_03', 'PAUSE')).toBe(false);
  });
  it('never changes other routes or bypasses missing configuration', () => {
    expect(requiresCampaignApproval(null, 'CLV_01', 'EDIT')).toBe(true);
    expect(requiresCampaignApproval({ preset: 'DEPARTMENT_REQUIRED', requiredApprovals: { EDIT: false } }, 'CLV_01', 'EDIT')).toBe(true);
  });
});
