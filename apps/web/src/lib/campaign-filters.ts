import {
  normalizeDirectorySearch,
  type CampaignJsonValue,
  type CampaignFieldDefinition,
  type CampaignSummary,
} from '@cpms/domain';
import { CAMPAIGN_STATE_LABELS } from './campaign-presentation';

export type CampaignTextFilterOperator = 'contains' | 'startsWith' | 'equals' | 'notContains';

export interface CampaignSetColumnFilter {
  type: 'set';
  values: string[];
  includeBlank: boolean;
}

export interface CampaignTextColumnFilter {
  type: 'text';
  operator: CampaignTextFilterOperator;
  query: string;
}

export interface CampaignDateColumnFilter {
  type: 'date';
  mode: 'months' | 'range';
  months: string[];
  includeBlank: boolean;
  from: string;
  to: string;
}

export type CampaignColumnFilter = CampaignSetColumnFilter | CampaignTextColumnFilter | CampaignDateColumnFilter;
export type CampaignColumnFilterModel = Record<string, CampaignColumnFilter>;

export interface CampaignColumnFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface CampaignDateMonthOption {
  key: string;
  year: string;
  month: string;
  count: number;
}

export interface CampaignCommunicationRange {
  from: string;
  to: string;
}

const EXPLICIT_FILTERABLE_FIELDS = new Set([
  'campaign_code',
  'campaign_name',
  'campaign_lifecycle_state',
  'campaign_effective_status',
  'campaign_approval_status',
  'requesting_unit',
  'requesting_person',
  'department_approver_summary',
  'division_approver_summary',
]);

const viCollator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function displayJsonValue(value: CampaignJsonValue | undefined) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isoDate(value: string | null | undefined) {
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? '');
  return matched?.[1] ?? '';
}

export function currentDateInVietnam(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function campaignEffectiveStatus(campaign: CampaignSummary, today = currentDateInVietnam()) {
  const start = isoDate(campaign.effectiveStartDate);
  const end = isoDate(campaign.effectiveEndDate);
  if (!start && !end) return 'Chưa xác định';
  if (start && today < start) return 'Chưa hiệu lực';
  if (end && today > end) return 'Hết hiệu lực';
  return 'Đang hiệu lực';
}

export function campaignApprovalStatus(campaign: CampaignSummary) {
  if (campaign.approvalStatus) return campaign.approvalStatus;
  if (campaign.qcttStatus === 'Chờ phê duyệt') return 'Chờ duyệt';
  if (campaign.qcttStatus === 'Đã phê duyệt' || campaign.qcttStatus === 'Đã lên kế hoạch' || campaign.qcttStatus === 'Đang triển khai') return 'Đã duyệt';
  if (campaign.qcttStatus === 'Bị từ chối') return 'Từ chối';
  return 'Chưa trình';
}

export function campaignColumnValues(campaign: CampaignSummary, fieldKey: string): string[] {
  if (fieldKey === 'campaign_code') return [campaign.code];
  if (fieldKey === 'campaign_name') return [campaign.name];
  if (fieldKey === 'campaign_lifecycle_state') return [campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? CAMPAIGN_STATE_LABELS[campaign.lifecycleState]];
  if (fieldKey === 'campaign_effective_status') return [campaignEffectiveStatus(campaign)];
  if (fieldKey === 'campaign_approval_status') return [campaignApprovalStatus(campaign)];
  if (fieldKey === 'campaign_comm_start_date') return [isoDate(campaign.startDate)];
  if (fieldKey === 'campaign_comm_end_date') return [isoDate(campaign.endDate)];
  if (fieldKey === 'campaign_effect_start_date') return [isoDate(campaign.effectiveStartDate)];
  if (fieldKey === 'campaign_effect_end_date') return [isoDate(campaign.effectiveEndDate)];
  if (fieldKey === 'requesting_unit') {
    return unique(campaign.requestingUnits.length
      ? campaign.requestingUnits.map((unit) => unit.displayName)
      : [campaign.requestingUnit]);
  }
  if (fieldKey === 'requesting_person') {
    const legacy = typeof campaign.fieldValues.requesting_person === 'string' ? campaign.fieldValues.requesting_person : '';
    return unique([campaign.requestingEmployeeName ?? '', campaign.manualRequesterEmail ?? '', legacy]);
  }
  if (fieldKey === 'department_approver_summary') {
    return unique(campaign.departmentApprovers?.map((person) => person.displayName) ?? []);
  }
  if (fieldKey === 'division_approver_summary') {
    return unique(campaign.divisionApprovers?.map((person) => person.displayName) ?? []);
  }
  return unique([campaignGridDisplayValue(campaign, fieldKey)]);
}

export function campaignGridDisplayValue(campaign: CampaignSummary, fieldKey: string) {
  if (fieldKey === 'campaign_code') return campaign.code;
  if (fieldKey === 'campaign_name') return campaign.name;
  if (fieldKey === 'requesting_unit') return campaign.requestingUnits.length
    ? campaign.requestingUnits.map((unit) => unit.displayName).join('; ')
    : campaign.requestingUnit;
  if (fieldKey === 'campaign_lifecycle_state') return campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? CAMPAIGN_STATE_LABELS[campaign.lifecycleState];
  if (fieldKey === 'campaign_effective_status') return campaignEffectiveStatus(campaign);
  if (fieldKey === 'campaign_approval_status') return campaignApprovalStatus(campaign);
  if (fieldKey === 'campaign_comm_start_date') return isoDate(campaign.startDate);
  if (fieldKey === 'campaign_comm_end_date') return isoDate(campaign.endDate);
  if (fieldKey === 'campaign_effect_start_date') return isoDate(campaign.effectiveStartDate);
  if (fieldKey === 'campaign_effect_end_date') return isoDate(campaign.effectiveEndDate);
  if (fieldKey === 'requesting_person') return campaignColumnValues(campaign, fieldKey).join('; ');
  if (fieldKey === 'department_approver_summary' || fieldKey === 'division_approver_summary') {
    return campaignColumnValues(campaign, fieldKey).join('; ');
  }
  if (fieldKey === 'last_updated_at') return displayJsonValue(campaign.fieldValues[fieldKey]) || campaign.updatedAt;
  return displayJsonValue(campaign.fieldValues[fieldKey]);
}

export function isCampaignColumnFilterable(definition: CampaignFieldDefinition) {
  return EXPLICIT_FILTERABLE_FIELDS.has(definition.key)
    || definition.kind === 'date'
    || definition.kind === 'dateTime';
}

export function campaignMatchesCommunicationRange(campaign: CampaignSummary, range: CampaignCommunicationRange) {
  if (!range.from && !range.to) return true;
  const start = isoDate(campaign.startDate) || isoDate(campaign.endDate);
  const end = isoDate(campaign.endDate) || isoDate(campaign.startDate);
  if (!start || !end) return false;
  return (!range.from || end >= range.from) && (!range.to || start <= range.to);
}

function matchesText(values: readonly string[], filter: CampaignTextColumnFilter) {
  const query = normalizeDirectorySearch(filter.query);
  if (!query) return true;
  return values.some((value) => {
    const normalized = normalizeDirectorySearch(value);
    if (filter.operator === 'startsWith') return normalized.startsWith(query);
    if (filter.operator === 'equals') return normalized === query;
    if (filter.operator === 'notContains') return !normalized.includes(query);
    return normalized.includes(query);
  });
}

function matchesDate(values: readonly string[], filter: CampaignDateColumnFilter) {
  const dates = values.map(isoDate).filter(Boolean);
  if (!dates.length) return filter.includeBlank;
  if (filter.mode === 'range') {
    return dates.some((date) => (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to));
  }
  return dates.some((date) => filter.months.includes(date.slice(0, 7)));
}

export function campaignMatchesColumnFilter(campaign: CampaignSummary, fieldKey: string, filter: CampaignColumnFilter) {
  const values = campaignColumnValues(campaign, fieldKey);
  if (filter.type === 'text') return matchesText(values, filter);
  if (filter.type === 'date') return matchesDate(values, filter);
  if (!values.length) return filter.includeBlank;
  return values.some((value) => filter.values.includes(value));
}

export function applyCampaignColumnFilters(campaigns: readonly CampaignSummary[], filters: CampaignColumnFilterModel) {
  const entries = Object.entries(filters);
  if (!entries.length) return [...campaigns];
  return campaigns.filter((campaign) => entries.every(([fieldKey, filter]) => campaignMatchesColumnFilter(campaign, fieldKey, filter)));
}

function campaignsAfterOtherFilters(campaigns: readonly CampaignSummary[], filters: CampaignColumnFilterModel, fieldKey: string) {
  return applyCampaignColumnFilters(campaigns, Object.fromEntries(Object.entries(filters).filter(([key]) => key !== fieldKey)));
}

export function campaignColumnFilterOptions(
  campaigns: readonly CampaignSummary[],
  filters: CampaignColumnFilterModel,
  fieldKey: string,
): { options: CampaignColumnFilterOption[]; blankCount: number } {
  const counts = new Map<string, number>();
  let blankCount = 0;
  campaignsAfterOtherFilters(campaigns, filters, fieldKey).forEach((campaign) => {
    const values = campaignColumnValues(campaign, fieldKey);
    if (!values.length) blankCount += 1;
    else values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  const selected = filters[fieldKey]?.type === 'set' ? filters[fieldKey].values : [];
  selected.forEach((value) => { if (!counts.has(value)) counts.set(value, 0); });
  return {
    options: [...counts].map(([value, count]) => ({ value, label: value, count })).sort((left, right) => viCollator.compare(left.label, right.label)),
    blankCount,
  };
}

export function campaignDateMonthOptions(
  campaigns: readonly CampaignSummary[],
  filters: CampaignColumnFilterModel,
  fieldKey: string,
): { options: CampaignDateMonthOption[]; blankCount: number } {
  const counts = new Map<string, number>();
  let blankCount = 0;
  campaignsAfterOtherFilters(campaigns, filters, fieldKey).forEach((campaign) => {
    const dates = campaignColumnValues(campaign, fieldKey).map(isoDate).filter(Boolean);
    if (!dates.length) blankCount += 1;
    else unique(dates.map((date) => date.slice(0, 7))).forEach((month) => counts.set(month, (counts.get(month) ?? 0) + 1));
  });
  const selected = filters[fieldKey]?.type === 'date' ? filters[fieldKey].months : [];
  selected.forEach((month) => { if (!counts.has(month)) counts.set(month, 0); });
  return {
    options: [...counts].map(([key, count]) => ({ key, year: key.slice(0, 4), month: key.slice(5, 7), count })).sort((left, right) => right.key.localeCompare(left.key)),
    blankCount,
  };
}

export function campaignGlobalSearchText(campaign: CampaignSummary) {
  return normalizeDirectorySearch([
    campaign.code,
    campaign.name,
    campaign.requestingUnit,
    ...campaign.requestingUnits.map((unit) => unit.displayName),
    campaign.requestingEmployeeName ?? '',
    campaign.manualRequesterEmail ?? '',
    ...Object.values(campaign.fieldValues).filter((value): value is string => typeof value === 'string'),
  ].join(' '));
}

export function campaignMatchesGlobalSearch(campaign: CampaignSummary, query: string) {
  const normalized = normalizeDirectorySearch(query);
  return !normalized || campaignGlobalSearchText(campaign).includes(normalized);
}

export function defaultColumnFilter(definition: CampaignFieldDefinition): CampaignColumnFilter {
  if (definition.kind === 'date' || definition.kind === 'dateTime') {
    return { type: 'date', mode: 'months', months: [], includeBlank: false, from: '', to: '' };
  }
  if (definition.key === 'campaign_code' || definition.key === 'campaign_name') {
    return { type: 'text', operator: 'contains', query: '' };
  }
  return { type: 'set', values: [], includeBlank: false };
}
