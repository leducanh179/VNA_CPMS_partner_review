import type {
  CampaignAdditionalInformationItem,
  CampaignFieldValues,
  CampaignLevelCode,
  CampaignLifecycleState,
  CampaignMarketSelectionOrigin,
  CampaignObjectiveCode,
  CampaignRequestingUnitInput,
  CampaignRichTextDocument,
  CampaignSummary,
  CreateCampaignCommand,
  UpdateCampaignCommand,
} from '@cpms/domain';
import { isRichTextEmpty } from './campaign-rich-text';

export type CampaignMarketMode = 'NONE' | 'GLOBAL' | 'REGION' | 'CUSTOM' | 'LEGACY';

export interface CampaignSelectedUnit extends CampaignRequestingUnitInput {
  displayName: string;
  category: 'QUICK_SELECT' | 'FOREIGN_BRANCH' | 'CUSTOM';
}

export interface CampaignRecordValue {
  name: string;
  lifecycleState: CampaignLifecycleState;
  levelCode: CampaignLevelCode | null;
  effectiveStartDate: string;
  effectiveEndDate: string;
  startDate: string;
  endDate: string;
  communicationDatesAuto: boolean;
  primaryObjectiveCode: CampaignObjectiveCode | null;
  primaryObjectiveOther: string;
  kpiText: string;
  descriptionRichText: CampaignRichTextDocument | null;
  contentPillarL1Code: string;
  contentPillarL1Label: string;
  contentPillarL2Code: string;
  contentPillarL2Label: string;
  marketMode: CampaignMarketMode;
  marketRegionCode: string;
  marketCodes: string[];
  draftInternationalSelected: boolean;
  draftRegionCodes: string[];
  draftVietnamSpecific: boolean;
  draftInternationalSpecific: boolean;
  provinceCodes: string[];
  provincesTouched: boolean;
  marketsTouched: boolean;
  requestingUnits: CampaignSelectedUnit[];
  requestingUnitsTouched: boolean;
  requestingEmployeeCode: string;
  manualRequesterEmail: string;
  additionalInformation: CampaignAdditionalInformationItem[];
  fieldValues: CampaignFieldValues;
}

/** Auto-save of an unfinished form must not disable the user's explicit Save draft action. */
export function canSaveCampaignRecord(input: { existingCampaign: boolean; dirty: boolean; saving: boolean; authorized: boolean; name: string; levelCode: CampaignLevelCode | null }) {
  return !input.saving && input.authorized && (input.existingCampaign ? input.dirty : Boolean(input.name.trim() && input.levelCode));
}

const DAY_MS = 86_400_000;

export function campaignDateToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function shiftCampaignDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year!, month! - 1, day!) + days * DAY_MS;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function campaignCommunicationDates(effectiveStartDate: string, effectiveEndDate: string) {
  return {
    startDate: effectiveStartDate ? shiftCampaignDate(effectiveStartDate, -30) : '',
    endDate: effectiveEndDate,
  };
}

function communicationDatesAreAutomatic(campaign?: CampaignSummary) {
  if (!campaign) return true;
  if (!campaign.effectiveStartDate && !campaign.effectiveEndDate && !campaign.startDate && !campaign.endDate) return true;
  const expected = campaignCommunicationDates(campaign.effectiveStartDate ?? '', campaign.effectiveEndDate ?? '');
  return expected.startDate === (campaign.startDate ?? '') && expected.endDate === (campaign.endDate ?? '');
}

function textField(fieldValues: CampaignFieldValues, key: string) {
  const value = fieldValues[key];
  return typeof value === 'string' ? value : '';
}

function marketMode(campaign?: CampaignSummary): CampaignMarketMode {
  if (!campaign) return 'NONE';
  if (campaign.markets.some((market) => market.selectionOrigin === 'LEGACY')) return 'LEGACY';
  if (campaign.normalizationWarnings.some((warning) => warning.code === 'LEGACY_MARKET')) return 'LEGACY';
  if (campaign.markets.length === 0) return 'NONE';
  if (campaign.markets.every((market) => market.selectionOrigin === 'GLOBAL')) return 'GLOBAL';
  if (campaign.markets.every((market) => market.selectionOrigin === 'REGION')) return 'REGION';
  return 'CUSTOM';
}

export function campaignRecordValue(campaign?: CampaignSummary): CampaignRecordValue {
  const fieldValues = { ...(campaign?.fieldValues ?? {}) };
  const mode = marketMode(campaign);
  return {
    name: campaign?.name ?? '',
    lifecycleState: campaign?.lifecycleState ?? 'DRAFT',
    levelCode: campaign?.levelCode ?? null,
    effectiveStartDate: campaign?.effectiveStartDate ?? '',
    effectiveEndDate: campaign?.effectiveEndDate ?? '',
    startDate: campaign?.startDate ?? '',
    endDate: campaign?.endDate ?? '',
    communicationDatesAuto: communicationDatesAreAutomatic(campaign),
    primaryObjectiveCode: campaign?.primaryObjectiveCode ?? null,
    primaryObjectiveOther: campaign?.primaryObjectiveOther ?? '',
    kpiText: campaign?.kpiText ?? '',
    descriptionRichText: campaign?.descriptionRichText ?? null,
    contentPillarL1Code: textField(fieldValues, 'content_pillar_l1_code'),
    contentPillarL1Label: textField(fieldValues, 'content_pillar_l1_label'),
    contentPillarL2Code: textField(fieldValues, 'content_pillar_l2_code'),
    contentPillarL2Label: textField(fieldValues, 'content_pillar_l2_label'),
    marketMode: mode,
    marketRegionCode: mode === 'REGION' ? campaign?.markets[0]?.selectionCode ?? '' : '',
    marketCodes: campaign?.markets.map((market) => market.marketCode) ?? [],
    draftInternationalSelected: campaign?.markets.some((market) => market.marketCode !== 'VN') ?? false,
    draftRegionCodes: [...new Set(campaign?.markets.filter((market) => market.marketCode !== 'VN').map((market) => market.regionCode) ?? [])],
    draftVietnamSpecific: Boolean(campaign?.provinces.length),
    draftInternationalSpecific: false,
    provinceCodes: campaign?.provinces.map((province) => province.provinceCode) ?? [],
    provincesTouched: false,
    marketsTouched: false,
    requestingUnits: campaign?.requestingUnits.map((unit) => ({
      ...(unit.unitCode ? { unitCode: unit.unitCode } : {}),
      ...(unit.customName ? { customName: unit.customName } : {}),
      displayName: unit.displayName,
      category: unit.category,
    })) ?? [],
    requestingUnitsTouched: false,
    requestingEmployeeCode: campaign?.requestingEmployeeCode ?? '',
    manualRequesterEmail: campaign?.manualRequesterEmail ?? '',
    additionalInformation: campaign?.additionalInformation.map((item, index) => ({ ...item, order: index })) ?? [],
    fieldValues,
  };
}

export function campaignRecordSnapshot(value: CampaignRecordValue) {
  return JSON.stringify(value);
}

export function selectedUnitLegacyLabel(value: CampaignRecordValue) {
  return value.requestingUnits[0]?.displayName.trim() || null;
}

function fieldsForSave(value: CampaignRecordValue): CampaignFieldValues {
  const fields = { ...value.fieldValues };
  for (const [key, next] of [
    ['content_pillar_l1_code', value.contentPillarL1Code], ['content_pillar_l1_label', value.contentPillarL1Label],
    ['content_pillar_l2_code', value.contentPillarL2Code], ['content_pillar_l2_label', value.contentPillarL2Label],
  ] as const) {
    // Preserve absent/null/legacy projections when the user did not change this input.
    // Otherwise a name-only edit would silently introduce unrelated null fields.
    if (next !== textField(value.fieldValues, key)) fields[key] = next || null;
  }
  return fields;
}

function marketFields(value: CampaignRecordValue, create: boolean): Pick<
  CreateCampaignCommand,
  'marketCodes' | 'marketSelectionOrigin' | 'marketSelectionCode'
> {
  if (!create && !value.marketsTouched) return {};
  if (value.marketMode === 'GLOBAL') {
    return { marketCodes: [...value.marketCodes], marketSelectionOrigin: 'GLOBAL', marketSelectionCode: 'GLOBAL' };
  }
  if (value.marketMode === 'REGION') {
    return { marketCodes: [...value.marketCodes], marketSelectionOrigin: 'REGION', marketSelectionCode: value.marketRegionCode };
  }
  if (value.marketMode === 'CUSTOM') {
    return { marketCodes: [...value.marketCodes], marketSelectionOrigin: 'CUSTOM', marketSelectionCode: null };
  }
  if (!create && value.marketMode !== 'LEGACY') return { marketCodes: [] };
  return {};
}

function optionalText(value: string) {
  return value.trim() || null;
}

function commonFields(value: CampaignRecordValue) {
  return {
    name: value.name.trim(),
    lifecycleState: value.lifecycleState,
    startDate: optionalText(value.startDate),
    endDate: optionalText(value.endDate),
    effectiveStartDate: optionalText(value.effectiveStartDate),
    effectiveEndDate: optionalText(value.effectiveEndDate),
    levelCode: value.levelCode,
    requestingEmployeeCode: optionalText(value.requestingEmployeeCode),
    manualRequesterEmail: optionalText(value.manualRequesterEmail),
    primaryObjectiveCode: value.primaryObjectiveCode,
    primaryObjectiveOther: value.primaryObjectiveCode === 'OTHER' ? optionalText(value.primaryObjectiveOther) : null,
    kpiText: optionalText(value.kpiText),
    descriptionRichText: isRichTextEmpty(value.descriptionRichText) ? null : value.descriptionRichText,
    additionalInformation: value.additionalInformation.map((item, order) => ({
      id: item.id,
      label: item.label.trim(),
      value: item.value.trim(),
      order,
    })),
    fieldValues: fieldsForSave(value),
  };
}

export function toCreateCommand(value: CampaignRecordValue): CreateCampaignCommand {
  if (!value.levelCode) throw new Error('Cấp chiến dịch là bắt buộc.');
  return {
    ...commonFields(value),
    levelCode: value.levelCode,
    lifecycleState: 'DRAFT',
    requestingUnit: selectedUnitLegacyLabel(value),
    requestingUnits: value.requestingUnits.map(({ unitCode, customName }) => ({
      ...(unitCode ? { unitCode } : {}),
      ...(customName ? { customName } : {}),
    })),
    ...marketFields(value, true),
    provinceCodes: [...value.provinceCodes],
  };
}

export function toUpdateCommand(value: CampaignRecordValue, recordVersion: number): UpdateCampaignCommand {
  return {
    ...commonFields(value),
    expectedVersion: recordVersion,
    ...(value.requestingUnitsTouched ? {
      requestingUnit: selectedUnitLegacyLabel(value),
      requestingUnits: value.requestingUnits.map(({ unitCode, customName }) => ({
        ...(unitCode ? { unitCode } : {}),
        ...(customName ? { customName } : {}),
      })),
    } : {}),
    ...marketFields(value, false),
    ...(value.provincesTouched ? { provinceCodes: [...value.provinceCodes] } : {}),
  };
}

export function validateCampaignRecord(value: CampaignRecordValue, allowLegacyMissingLevel: boolean, _original?: CampaignSummary) {
  if (!value.name.trim()) return 'Tên chiến dịch là bắt buộc.';
  if (!value.levelCode && !allowLegacyMissingLevel) return 'Cấp chiến dịch là bắt buộc.';
  if (value.effectiveStartDate && value.effectiveEndDate && value.effectiveStartDate > value.effectiveEndDate) {
    return 'Thời gian hiệu lực: ngày bắt đầu không được sau ngày kết thúc.';
  }
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    return 'Thời gian QCTT: ngày bắt đầu không được sau ngày kết thúc.';
  }
  if (value.primaryObjectiveCode === 'OTHER' && !value.primaryObjectiveOther.trim()) {
    return 'Hãy nhập nội dung mục tiêu khi chọn “Khác”.';
  }
  if (value.manualRequesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.manualRequesterEmail.trim())) {
    return 'Email người yêu cầu không hợp lệ.';
  }
  if (value.requestingEmployeeCode && value.manualRequesterEmail) {
    return 'Chỉ chọn người yêu cầu trong danh bạ hoặc nhập email thủ công.';
  }
  if (value.marketMode === 'REGION' && !value.marketRegionCode) return 'Hãy chọn một khu vực thị trường.';
  if (value.provinceCodes.length > 0 && !value.marketCodes.includes('VN')) return 'Hãy chọn Việt Nam trước khi chọn tỉnh, thành phố.';
  if (value.additionalInformation.length > 10) return 'Thông tin bổ sung không được vượt quá 10 dòng.';
  if (value.additionalInformation.some((item) => !item.label.trim())) return 'Mỗi dòng thông tin bổ sung cần có tên trường.';
  return null;
}

export function marketSelectionOrigin(mode: CampaignMarketMode): CampaignMarketSelectionOrigin | null {
  if (mode === 'GLOBAL' || mode === 'REGION' || mode === 'CUSTOM' || mode === 'LEGACY') return mode;
  return null;
}
