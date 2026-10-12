import type { CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import { campaignPageSize, compareCampaigns, nextSortDirection, sortDirectionLabel } from './campaign-grid';
import { CAMPAIGN_FIELD_BY_KEY } from '@cpms/domain';

const campaign = (name: string, startDate: string, revenue: string): CampaignSummary => ({
  id: name,
  code: `CPG-${name}`,
  name,
  requestingUnit: 'Ban TT',
  lifecycleState: 'DRAFT',
  startDate,
  endDate: null,
  effectiveStartDate: null,
  effectiveEndDate: null,
  levelCode: null,
  levelLabel: null,
  levelRuleDescription: null,
  requestingEmployeeCode: null,
  requestingEmployeeName: null,
  manualRequesterEmail: null,
  primaryObjectiveCode: null,
  primaryObjectiveLabel: null,
  primaryObjectiveOther: null,
  kpiText: null,
  descriptionRichText: null,
  additionalInformation: [],
  dataSchemaVersion: 1,
  normalizationStatus: 'NEEDS_NORMALIZATION',
  normalizationWarnings: [],
  markets: [], provinces: [],
  requestingUnits: [],
  fieldValues: { kpi_revenue: revenue },
  recordVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedByActorId: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('Campaign grid sorting', () => {
  it('sorts text, dates and numeric fields according to their field type', () => {
    const late = campaign('Zeta', '2026-10-01', '2.000');
    const early = campaign('Alpha', '2026-01-01', '100');
    expect([late, early].sort((a, b) => compareCampaigns(a, b, 'campaign_name', 'asc'))[0]?.name).toBe('Alpha');
    expect([late, early].sort((a, b) => compareCampaigns(a, b, 'campaign_comm_start_date', 'asc'))[0]?.name).toBe('Alpha');
    expect([early, late].sort((a, b) => compareCampaigns(a, b, 'kpi_revenue', 'desc'))[0]?.name).toBe('Zeta');
  });

  it('cycles direction and provides Vietnamese sort semantics', () => {
    expect(nextSortDirection('campaign_name', 'asc', 'campaign_name')).toBe('desc');
    expect(nextSortDirection('campaign_name', 'desc', 'campaign_comm_start_date')).toBe('asc');
    expect(sortDirectionLabel(CAMPAIGN_FIELD_BY_KEY.campaign_name!, 'asc')).toBe('A tới Z');
    expect(sortDirectionLabel(CAMPAIGN_FIELD_BY_KEY.campaign_comm_start_date!, 'desc')).toBe('Mới tới cũ');
  });

  it('defaults to 10 rows while preserving valid stored page sizes', () => {
    expect(campaignPageSize(null)).toBe(10);
    expect(campaignPageSize('invalid')).toBe(10);
    expect(campaignPageSize('20')).toBe(20);
    expect(campaignPageSize('50')).toBe(50);
  });
});
