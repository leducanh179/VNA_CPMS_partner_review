import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { campaignRequiredApprovals, CAMPAIGN_APPROVAL_ACTION_LABELS } from '@cpms/domain';
import { CampaignApprovalActionChoices } from './workflow-policy-editor';

describe('Campaign action approval controls', () => {
  it('labels all six actions and selects them plus select-all by default', () => {
    const html = renderToStaticMarkup(createElement(CampaignApprovalActionChoices, { value: campaignRequiredApprovals(), onChange: vi.fn() }));
    for (const label of Object.values(CAMPAIGN_APPROVAL_ACTION_LABELS)) expect(html).toContain(label);
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    expect(html.match(/checked=""/g)).toHaveLength(7);
    expect(html).toContain('Chọn/Bỏ chọn tất cả');
  });
  it('shows partial saved selection without checking the select-all control', () => {
    const html = renderToStaticMarkup(createElement(CampaignApprovalActionChoices, { value: { ...campaignRequiredApprovals(), PAUSE: false }, onChange: vi.fn() }));
    expect(html.match(/checked=""/g)).toHaveLength(5);
  });
});
