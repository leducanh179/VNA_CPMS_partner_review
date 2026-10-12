import { BadRequestException } from '@nestjs/common';
import { CAMPAIGN_LEVEL_CODES, CAMPAIGN_OBJECTIVE_CODES, canonicalCampaignFieldKey, type CampaignSummary, type UpdateCampaignCommand } from '@cpms/domain';

const editableAliases: Record<string, keyof UpdateCampaignCommand> = {
  campaign_name: 'name', campaign_level_code: 'levelCode', campaign_comm_start_date: 'startDate', campaign_comm_end_date: 'endDate',
  campaign_effect_start_date: 'effectiveStartDate', campaign_effect_end_date: 'effectiveEndDate', campaign_objective: 'primaryObjectiveCode', kpi_primary: 'kpiText',
};
const typedToCanonical = Object.fromEntries(Object.entries(editableAliases).map(([key, value]) => [value, key]));
const dateFields = new Set(['startDate','endDate','effectiveStartDate','effectiveEndDate']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function campaignAccessSnapshot(current: CampaignSummary): Record<string, unknown> {
  return { ...current.fieldValues, id: current.id, campaign_code: current.code, campaign_name: current.name, campaign_lifecycle_state: current.lifecycleState,
    campaign_level_code: current.levelCode, campaign_comm_start_date: current.startDate, campaign_comm_end_date: current.endDate,
    campaign_effect_start_date: current.effectiveStartDate, campaign_effect_end_date: current.effectiveEndDate,
    campaign_objective: current.primaryObjectiveCode, primary_objective_other: current.primaryObjectiveOther, kpi_primary: current.kpiText,
    requesting_unit: current.requestingUnit, requesting_employee_code: current.requestingEmployeeCode, manual_requester_email: current.manualRequesterEmail,
    requesting_units: current.requestingUnits.map((unit) => unit.unitCode ? { unitCode: unit.unitCode } : { customName: unit.customName }),
    request_campaign_description: current.descriptionRichText, additional_information: current.additionalInformation,
    market: { marketCodes: current.markets.map((market) => market.marketCode), provinceCodes: current.provinces.map((province) => province.provinceCode), marketSelectionOrigin: current.markets[0]?.selectionOrigin ?? 'CUSTOM', marketSelectionCode: current.markets[0]?.selectionCode ?? null } };
}

/** Reconcile supported legacy aliases before diffing and persistence; neither representation creates a second permission path. */
export function prepareCampaignAccessUpdate(current: CampaignSummary, input: UpdateCampaignCommand, objectives: readonly { code: string; label: string }[]) {
  const before = campaignAccessSnapshot(current);
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const legacy: Record<string, unknown> = { ...(input.fieldValues ?? {}) };
  const canonicalValues = new Map<string, unknown>();
  function normalize(key: string, value: unknown): unknown {
    if (key === 'name') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 240) throw new BadRequestException('Tên chiến dịch không hợp lệ.');
      return value.trim();
    }
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('Alias Campaign cần giá trị đúng kiểu.');
    if (dateFields.has(key)) {
      if (!/^\d{4}-\d{2}-\d{2}(T00:00:00(?:\.000)?Z)?$/.test(value)) throw new BadRequestException('Ngày Campaign cần định dạng YYYY-MM-DD.');
      const day = value.slice(0, 10); const parsed = new Date(day);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new BadRequestException('Ngày Campaign không tồn tại.');
      return day;
    }
    if (key === 'levelCode' && !(CAMPAIGN_LEVEL_CODES as readonly string[]).includes(value)) throw new BadRequestException('Cấp Campaign không hợp lệ.');
    if (key === 'primaryObjectiveCode') {
      if ((CAMPAIGN_OBJECTIVE_CODES as readonly string[]).includes(value)) return value;
      const candidates = objectives.filter((objective) => objective.label === value);
      if (candidates.length !== 1) throw new BadRequestException('Mục tiêu legacy cần khớp duy nhất danh mục mục tiêu.');
      return candidates[0]!.code;
    }
    return value.trim();
  }
  for (const [typed, canonical] of Object.entries(typedToCanonical)) {
    if (Object.hasOwn(patch, typed)) { const value = normalize(typed, patch[typed]); patch[typed] = value; canonicalValues.set(canonical, value); }
  }
  for (const [legacyKey, raw] of Object.entries(legacy)) {
    const canonical = canonicalCampaignFieldKey(legacyKey); const typed = editableAliases[canonical];
    const unchangedProjection = same(raw, current.fieldValues[legacyKey]);
    if (!typed) {
      if (unchangedProjection && (!same(before[canonical], raw) || Object.keys(input).some((key) => key !== 'fieldValues' && canonicalCampaignFieldKey(key) === canonical))) delete legacy[legacyKey];
      continue;
    }
    // A retained read projection (e.g. objective label) is not a conflicting user edit alongside a changed typed value.
    if (unchangedProjection && Object.hasOwn(input, typed)) { delete legacy[legacyKey]; continue; }
    const value = unchangedProjection ? before[canonical] : normalize(typed, raw);
    if (canonicalValues.has(canonical) && !same(canonicalValues.get(canonical), value)) throw new BadRequestException('Hai alias cùng field có giá trị xung đột.');
    canonicalValues.set(canonical, value); patch[typed] = value; legacy[legacyKey] = value;
  }
  if (input.fieldValues !== undefined) patch.fieldValues = legacy;
  return { before, patch, command: patch as UpdateCampaignCommand };
}
