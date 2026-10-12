import type { CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import { isSafeHttpsUrl, richTextToHtml } from './campaign-rich-text';
import { campaignCommunicationDates, campaignDateToday, campaignRecordValue, canSaveCampaignRecord, shiftCampaignDate, toCreateCommand, toUpdateCommand, validateCampaignRecord } from './campaign-v2-form';

const legacyCampaign: CampaignSummary = {
  id: '10000000-0000-4000-8000-000000000123',
  code: 'CPG-LEGACY-01',
  name: 'Chiến dịch legacy',
  requestingUnit: 'Đơn vị cũ',
  lifecycleState: 'DRAFT',
  startDate: null,
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
  normalizationWarnings: [
    { code: 'MISSING_LEVEL', fieldKey: 'campaign_level_code', message: 'Thiếu cấp.' },
    { code: 'LEGACY_MARKET', fieldKey: 'market', message: 'Thị trường legacy.' },
  ],
  markets: [], provinces: [],
  requestingUnits: [],
  fieldValues: { market: 'Thị trường cũ', unknown_legacy_key: { nested: ['A', 2, true] } },
  recordVersion: 7,
  isDeleted: false,
  deletedAt: null,
  deletedByActorId: null,
  updatedAt: '2026-09-02T00:00:00.000Z',
};

describe('Campaign V2 form commands', () => {
  it('keeps explicit Save draft available after a valid unfinished form was auto-saved', () => {
    const draft = { existingCampaign: false, dirty: false, saving: false, authorized: true, name: 'Mở bán vé Tết Đinh Mùi 2027', levelCode: 'CLV_01' as const };
    expect(canSaveCampaignRecord(draft)).toBe(true);
    expect(canSaveCampaignRecord({ ...draft, name: ' ' })).toBe(false);
    expect(canSaveCampaignRecord({ ...draft, authorized: false })).toBe(false);
    expect(canSaveCampaignRecord({ ...draft, existingCampaign: true })).toBe(false);
    expect(canSaveCampaignRecord({ ...draft, existingCampaign: true, dirty: true })).toBe(true);
    expect(canSaveCampaignRecord({ ...draft, existingCampaign: true, dirty: true, saving: true })).toBe(false);
  });
  it('derives QCTT dates without timezone drift and defaults new records to automatic mode', () => {
    expect(campaignCommunicationDates('2026-10-15', '2026-12-31')).toEqual({ startDate: '2026-09-15', endDate: '2026-12-31' });
    expect(shiftCampaignDate('2026-03-01', -30)).toBe('2026-01-30');
    expect(campaignDateToday(new Date('2026-09-09T17:30:00.000Z'))).toBe('2026-09-10');
    expect(campaignRecordValue().communicationDatesAuto).toBe(true);
  });

  it('permits past Campaign dates, including the automatic QCTT offset, and retains range validation', () => {
    const value = { ...campaignRecordValue(), name: 'Kiểm tra ngày', levelCode: 'CLV_01' as const, communicationDatesAuto: false, startDate: '2000-01-01', endDate: '2000-02-01' };
    expect(validateCampaignRecord(value, false)).toBeNull();
    expect(validateCampaignRecord({ ...value, communicationDatesAuto: true, effectiveStartDate: '2000-01-31', effectiveEndDate: '2000-02-01' }, false)).toBeNull();
    expect(validateCampaignRecord({ ...value, endDate: '1999-12-31' }, false)).toContain('sau ngày kết thúc');
    const old = { ...legacyCampaign, startDate: '2000-01-01' };
    expect(validateCampaignRecord({ ...campaignRecordValue(old), name: 'Sửa tên' }, true, old)).toBeNull();
  });

  it('creates a minimal draft with only name and level', () => {
    const value = { ...campaignRecordValue(), name: '  Bản nháp tối giản  ', levelCode: 'CLV_01' as const };

    expect(validateCampaignRecord(value, false)).toBeNull();
    expect(toCreateCommand(value)).toMatchObject({
      name: 'Bản nháp tối giản',
      levelCode: 'CLV_01',
      lifecycleState: 'DRAFT',
      requestingUnits: [],
    });
  });

  it('keeps unfinished region choices in form state but not in Campaign commands', () => {
    const value = { ...campaignRecordValue(), name: 'Bản nhập dở', levelCode: 'CLV_01' as const, draftInternationalSelected: true, draftRegionCodes: ['NE_ASIA'], draftVietnamSpecific: true, draftInternationalSpecific: true };
    expect(value.draftInternationalSelected).toBe(true);
    expect(value.draftRegionCodes).toEqual(['NE_ASIA']);
    expect(toCreateCommand(value)).not.toHaveProperty('draftInternationalSelected');
    expect(toCreateCommand(value)).not.toHaveProperty('draftRegionCodes');
    expect(toCreateCommand(value)).not.toHaveProperty('draftVietnamSpecific');
    expect(toCreateCommand(value)).not.toHaveProperty('draftInternationalSpecific');
  });

  it('keeps Global markets and requesting units as structured arrays', () => {
    const globalCodes = Array.from({ length: 27 }, (_, index) => `M${String(index + 1).padStart(2, '0')}`);
    const value = {
      ...campaignRecordValue(),
      name: 'Chiến dịch đầy đủ',
      levelCode: 'CLV_03' as const,
      effectiveStartDate: '2026-09-01',
      effectiveEndDate: '2026-12-31',
      startDate: '2026-09-15',
      endDate: '2026-11-30',
      marketMode: 'GLOBAL' as const,
      marketCodes: globalCodes,
      marketsTouched: true,
      requestingUnits: [
        { unitCode: 'BAN_TT', displayName: 'Ban Truyền thông', category: 'QUICK_SELECT' as const },
        { customName: 'Đơn vị phối hợp', displayName: 'Đơn vị phối hợp', category: 'CUSTOM' as const },
      ],
      requestingUnitsTouched: true,
      fieldValues: { unknown_legacy_key: { nested: ['A', 2, true] } },
    };

    const command = toCreateCommand(value);

    expect(command.marketCodes).toHaveLength(27);
    expect(command.marketSelectionOrigin).toBe('GLOBAL');
    expect(command).toMatchObject({
      effectiveStartDate: '2026-09-01', effectiveEndDate: '2026-12-31',
      startDate: '2026-09-15', endDate: '2026-11-30',
    });
    expect(command.requestingUnits).toEqual([{ unitCode: 'BAN_TT' }, { customName: 'Đơn vị phối hợp' }]);
    expect(typeof command.marketCodes).not.toBe('string');
    expect(typeof command.requestingUnits).not.toBe('string');
    expect(command.fieldValues?.unknown_legacy_key).toEqual({ nested: ['A', 2, true] });
  });

  it('saves Vietnamese provinces alongside international markets without flattening either selection', () => {
    const value = { ...campaignRecordValue(), name: 'Việt Nam và Nhật Bản', levelCode: 'CLV_01' as const, marketMode: 'CUSTOM' as const, marketCodes: ['VN', 'JP'], marketsTouched: true, provinceCodes: ['01', '79'], provincesTouched: true };
    expect(validateCampaignRecord(value, false)).toBeNull();
    expect(toCreateCommand(value)).toMatchObject({ marketCodes: ['VN', 'JP'], provinceCodes: ['01', '79'] });
    expect(toUpdateCommand(value, 2)).toMatchObject({ marketCodes: ['VN', 'JP'], provinceCodes: ['01', '79'] });
    expect(validateCampaignRecord({ ...value, marketCodes: ['JP'] }, false)).toContain('Việt Nam');
  });

  it('keeps unmapped legacy values read-only and untouched on a versioned patch', () => {
    const value = { ...campaignRecordValue(legacyCampaign), name: 'Chiến dịch legacy đã sửa' };

    expect(validateCampaignRecord(value, true)).toBeNull();
    const command = toUpdateCommand(value, legacyCampaign.recordVersion);

    expect(command.expectedVersion).toBe(7);
    expect(command.levelCode).toBeNull();
    expect(command).not.toHaveProperty('marketCodes');
    expect(command).not.toHaveProperty('requestingUnits');
    expect(command.fieldValues?.unknown_legacy_key).toEqual({ nested: ['A', 2, true] });
  });

  it('accepts HTTPS rich text URLs and refuses unsafe schemes', () => {
    expect(isSafeHttpsUrl('https://example.com/image.png')).toBe(true);
    expect(isSafeHttpsUrl('data:image/png;base64,abc')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(richTextToHtml({
      schemaVersion: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>', marks: [{ type: 'bold' }] }] }],
    })).toBe('<p><strong>&lt;script&gt;</strong></p>');
  });
  it('does not introduce unrelated null fields on a name-only edit but retains explicit clearing', () => {
    const source = { ...legacyCampaign, fieldValues: { content_pillar_l1_code: 'P1', content_pillar_l1_label: null, unknown_legacy_key: { retained: true } } };
    const value = { ...campaignRecordValue(source), name: 'Only the name changes' };
    expect(toUpdateCommand(value, 7).fieldValues).toEqual(source.fieldValues);
    expect(toUpdateCommand({ ...value, contentPillarL1Code: '' }, 7).fieldValues).toEqual({ ...source.fieldValues, content_pillar_l1_code: null });
  });
});
