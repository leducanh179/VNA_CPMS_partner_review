import type { CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import {
  campaignToRowDraft,
  campaignRowDraftEquals,
  emptyCampaignRow,
  toBatchSaveItem,
  toCreateCampaignCommand,
  toUpdateCampaignCommand,
  validateCampaignRow,
} from './campaign-inline-edit';

const campaign: CampaignSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  code: 'CPG-202608-DEMO',
  name: 'Campaign demo',
  requestingUnit: 'Ban Truyền thông',
  lifecycleState: 'PLANNING',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-09-30T00:00:00.000Z',
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
  fieldValues: {},
  recordVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedByActorId: null,
  updatedAt: '2026-08-30T00:00:00.000Z',
};

describe('Campaign inline editing', () => {
  it('maps a canonical Campaign into editable row values', () => {
    expect(campaignToRowDraft(campaign)).toEqual({
      name: 'Campaign demo',
      requestingUnit: 'Ban Truyền thông',
      lifecycleState: 'PLANNING',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      fieldValues: {},
    });
  });

  it('validates required cells and the date range before a row is saved', () => {
    const draft = emptyCampaignRow();
    draft.startDate = '2026-10-02';
    draft.endDate = '2026-10-01';

    expect(validateCampaignRow(draft)).toEqual({
      name: 'Tên chiến dịch là bắt buộc.',
      endDate: 'Ngày kết thúc không được trước ngày bắt đầu.',
    });
  });

  it('builds create and update commands for the existing audited API', () => {
    const draft = campaignToRowDraft(campaign);
    draft.name = '  Campaign đã sửa  ';
    draft.endDate = '';

    expect(toCreateCampaignCommand(draft)).toEqual({
      name: 'Campaign đã sửa',
      requestingUnit: 'Ban Truyền thông',
      startDate: '2026-09-01',
      fieldValues: {},
    });
    expect(toUpdateCampaignCommand(draft)).toEqual({
      name: 'Campaign đã sửa',
      requestingUnit: 'Ban Truyền thông',
      lifecycleState: 'PLANNING',
      startDate: '2026-09-01',
      endDate: null,
      fieldValues: {},
    });
  });

  it('tracks spreadsheet-style dirty rows and creates a batch payload', () => {
    const baseline = campaignToRowDraft(campaign);
    const changed = { ...baseline, name: 'Campaign sửa hàng loạt' };

    expect(campaignRowDraftEquals(baseline, { ...baseline })).toBe(true);
    expect(campaignRowDraftEquals(baseline, changed)).toBe(false);
    expect(toBatchSaveItem('row-1', changed, campaign.id)).toMatchObject({
      clientKey: 'row-1',
      id: campaign.id,
      name: 'Campaign sửa hàng loạt',
      lifecycleState: 'PLANNING',
    });
  });
});
