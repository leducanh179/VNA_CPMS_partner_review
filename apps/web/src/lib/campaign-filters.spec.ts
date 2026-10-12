import type { CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import {
  applyCampaignColumnFilters,
  campaignColumnFilterOptions,
  campaignColumnValues,
  campaignDateMonthOptions,
  campaignEffectiveStatus,
  campaignMatchesCommunicationRange,
  campaignMatchesGlobalSearch,
  type CampaignColumnFilterModel,
} from './campaign-filters';

function campaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: 'campaign-1',
    code: 'CPG-202609-TEST',
    name: 'Khai trương đường bay mới',
    requestingUnit: 'Ban Truyền thông',
    lifecycleState: 'DRAFT',
    startDate: '2026-09-10',
    endDate: '2026-10-15',
    effectiveStartDate: '2026-09-01',
    effectiveEndDate: '2026-12-31',
    levelCode: null,
    levelLabel: null,
    levelRuleDescription: null,
    requestingEmployeeCode: 'DEMO001',
    requestingEmployeeName: 'Nhân sự Demo 01',
    manualRequesterEmail: null,
    primaryObjectiveCode: null,
    primaryObjectiveLabel: null,
    primaryObjectiveOther: null,
    kpiText: null,
    descriptionRichText: null,
    additionalInformation: [],
    dataSchemaVersion: 2,
    normalizationStatus: 'CURRENT',
    normalizationWarnings: [],
    markets: [], provinces: [],
    requestingUnits: [
      { unitCode: 'TT', displayName: 'Ban Truyền thông', customName: null, category: 'QUICK_SELECT', order: 0 },
      { unitCode: 'CNMN', displayName: 'Chi nhánh miền Nam', customName: null, category: 'FOREIGN_BRANCH', order: 1 },
    ],
    fieldValues: {},
    recordVersion: 1,
    isDeleted: false,
    deletedAt: null,
    deletedByActorId: null,
    updatedAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('Campaign filters', () => {
  it('matches instant search without accents and communication intervals by overlap', () => {
    const item = campaign();
    expect(campaignMatchesGlobalSearch(item, 'khai truong')).toBe(true);
    expect(campaignMatchesGlobalSearch(item, 'chi nhanh mien nam')).toBe(true);
    expect(campaignMatchesCommunicationRange(item, { from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(campaignMatchesCommunicationRange(item, { from: '2026-11-01', to: '2026-11-30' })).toBe(false);
  });

  it('derives effective status from the typed effective period', () => {
    expect(campaignEffectiveStatus(campaign(), '2026-08-31')).toBe('Chưa hiệu lực');
    expect(campaignEffectiveStatus(campaign(), '2026-10-01')).toBe('Đang hiệu lực');
    expect(campaignEffectiveStatus(campaign(), '2027-01-01')).toBe('Hết hiệu lực');
    expect(campaignEffectiveStatus(campaign({ effectiveStartDate: null, effectiveEndDate: null }), '2026-10-01')).toBe('Chưa xác định');
  });

  it('uses the Trash state instead of a stale lifecycle label for deleted Campaigns', () => {
    const deleted = campaign({ isDeleted: true, deletedAt: '2026-09-09T01:00:00.000Z', qcttStatus: 'Đã xóa' });
    expect(campaignColumnValues(deleted, 'campaign_lifecycle_state')).toEqual(['Trong Thùng rác']);
  });

  it('keeps the retired cancellation state visibly distinct from Trash', () => {
    const legacy = campaign({ lifecycleState: 'CANCELLED', qcttStatus: 'Ngừng triển khai (dữ liệu cũ)' });
    expect(campaignColumnValues(legacy, 'campaign_lifecycle_state')).toEqual(['Ngừng triển khai (dữ liệu cũ)']);
  });

  it('filters text, multi-value catalog fields, approval state and date months', () => {
    const matching = campaign({
      approvalStatus: 'Đã duyệt',
      departmentApprovers: [{ actorId: 'actor-1', displayName: 'Lãnh đạo Ban Demo' }],
      divisionApprovers: [{ actorId: 'actor-2', displayName: 'Lãnh đạo Phòng Demo' }],
    });
    const other = campaign({ id: 'campaign-2', code: 'CPG-202608-OTHER', name: 'Chiến dịch khác', startDate: '2026-08-01', requestingUnits: [] });
    const filters: CampaignColumnFilterModel = {
      campaign_name: { type: 'text', operator: 'contains', query: 'khai trương' },
      requesting_unit: { type: 'set', values: ['Chi nhánh miền Nam'], includeBlank: false },
      campaign_approval_status: { type: 'set', values: ['Đã duyệt'], includeBlank: false },
      campaign_comm_start_date: { type: 'date', mode: 'months', months: ['2026-09'], includeBlank: false, from: '', to: '' },
      department_approver_summary: { type: 'set', values: ['Lãnh đạo Ban Demo'], includeBlank: false },
    };
    expect(applyCampaignColumnFilters([matching, other], filters).map((item) => item.id)).toEqual(['campaign-1']);
    expect(campaignColumnValues(matching, 'requesting_unit')).toEqual(['Ban Truyền thông', 'Chi nhánh miền Nam']);
    expect(campaignColumnValues(matching, 'division_approver_summary')).toEqual(['Lãnh đạo Phòng Demo']);
  });

  it('builds faceted options from other filters and preserves unavailable selections', () => {
    const september = campaign({ id: 'september', approvalStatus: 'Đã duyệt' });
    const october = campaign({ id: 'october', startDate: '2026-10-01', approvalStatus: 'Chờ duyệt' });
    const filters: CampaignColumnFilterModel = {
      campaign_approval_status: { type: 'set', values: ['Đã duyệt'], includeBlank: false },
      requesting_unit: { type: 'set', values: ['Đơn vị không còn trong kết quả'], includeBlank: false },
    };
    const unitOptions = campaignColumnFilterOptions([september, october], filters, 'requesting_unit');
    expect(unitOptions.options.find((option) => option.value === 'Đơn vị không còn trong kết quả')?.count).toBe(0);
    const monthOptions = campaignDateMonthOptions([september, october], {
      campaign_approval_status: filters.campaign_approval_status!,
    }, 'campaign_comm_start_date');
    expect(monthOptions.options.map((option) => option.key)).toEqual(['2026-09']);
  });
});
