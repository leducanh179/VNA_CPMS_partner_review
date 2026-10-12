import { CAMPAIGN_FIELD_BY_KEY } from './campaign-fields';
import { evaluateAccess, type AccessRequest, type AccessRule } from './access-policy';

/** Aliases shared by transport adapters before the ordinary Campaign validator runs. */
export const CAMPAIGN_ACCESS_FIELD_ALIASES: Readonly<Record<string, string>> = {
  name: 'campaign_name', code: 'campaign_code', levelCode: 'campaign_level_code',
  startDate: 'campaign_comm_start_date', endDate: 'campaign_comm_end_date',
  effectiveStartDate: 'campaign_effect_start_date', effectiveEndDate: 'campaign_effect_end_date',
  primaryObjectiveCode: 'campaign_objective', primary_objective_code: 'campaign_objective',
  primaryObjectiveOther: 'primary_objective_other',
  kpiText: 'kpi_primary', kpi_text: 'kpi_primary',
  descriptionRichText: 'request_campaign_description', description_rich_text_json: 'request_campaign_description',
  additionalInformation: 'additional_information', additional_information_json: 'additional_information',
  requestingEmployeeCode: 'requesting_employee_code', manualRequesterEmail: 'manual_requester_email',
  requestingUnit: 'requesting_unit', requestingUnits: 'requesting_units',
  marketCodes: 'market', provinceCodes: 'market', marketSelectionOrigin: 'market', marketSelectionCode: 'market',
  lifecycleState: 'campaign_lifecycle_state',
};

const reservedTopLevel = new Set(['id', 'actorId', 'authorId', 'createdByActorId', 'deletedByActorId', 'orgId', 'organizationId',
  'roles', 'role', 'grants', 'policy', 'policyVersion', 'workflow', 'workflowState', 'approval', 'approvalDecision', 'businessRevision',
  'recordVersion', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt', 'originalActorId', 'effectiveActorId']);
const protectedFields = new Set([
  'campaign_code', 'campaign_lifecycle_state', 'campaign_effective_status',
  'campaign_level_source', 'campaign_level_selected_by', 'campaign_level_selected_at', 'campaign_level_rule_version',
  'department_approval_state', 'department_approval_required', 'department_approver_summary', 'department_approved_at',
  'department_assignment_summary', 'lead_division_summary', 'supporting_divisions_summary', 'division_approval_state',
  'division_approval_required', 'division_approver_summary', 'division_approved_at', 'division_assignment_summary',
  'lead_campaign_manager_summary', 'supporting_campaign_managers_summary', 'campaign_manager_acceptance_state',
  'campaign_manager_accepted_at', 'assignment_records_link', 'approval_note', 'plan_status',
]);
const extraFields = new Set(['primary_objective_other', 'requesting_employee_code', 'manual_requester_email', 'requesting_units']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const trimmedCanonicalText = new Set(['campaign_name', 'kpi_primary', 'primary_objective_other', 'requesting_employee_code', 'manual_requester_email', 'requesting_unit']);
const marketComponents = ['marketCodes', 'provinceCodes', 'marketSelectionOrigin', 'marketSelectionCode'] as const;

export function canonicalCampaignFieldKey(key: string): string {
  const stripped = key.startsWith('fieldValues.') ? key.slice('fieldValues.'.length) : key;
  return CAMPAIGN_ACCESS_FIELD_ALIASES[stripped] ?? stripped;
}
export function isProtectedCampaignField(key: string): boolean {
  const canonical = canonicalCampaignFieldKey(key);
  return reservedTopLevel.has(key) || reservedTopLevel.has(canonical) || protectedFields.has(canonical) || canonical.startsWith('approval_') ||
    CAMPAIGN_FIELD_BY_KEY[canonical]?.editable === false;
}
function normalize(value: unknown, key: string): unknown {
  const normalizedText = trimmedCanonicalText.has(key);
  const normalizedDate = CAMPAIGN_FIELD_BY_KEY[key]?.kind === 'date';
  if (value === undefined || value === null) return normalizedText || normalizedDate ? null : value;
  if (typeof value === 'string') {
    const text = normalizedText ? value.trim() : value;
    if (normalizedDate && /^\d{4}-\d{2}-\d{2}(T00:00:00(?:\.000)?Z)?$/.test(text)) return text.slice(0, 10);
    return normalizedText || normalizedDate ? text || null : text;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, ''));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([nestedKey, item]) => {
    if (unsafeKeys.has(nestedKey)) throw new Error('UNSAFE_JSON_KEY');
    return [nestedKey, normalize(item, '')];
  }));
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_NUMBER');
  return value;
}
const equal = (left: unknown, right: unknown, key: string) => JSON.stringify(normalize(left, key)) === JSON.stringify(normalize(right, key));

export interface CampaignChangedField { fieldKey: string; before: unknown; after: unknown; known: boolean }
export interface CampaignFieldChanges { fields: CampaignChangedField[]; errors: { fieldKey: string; code: string }[] }

/** Accept a canonical before snapshot plus proposed raw PATCH. Business validation still runs separately.
 * Unknown legacy values may round-trip unchanged, but cannot be introduced or mutated by this editor. */
export function inspectCampaignFieldChanges(before: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): CampaignFieldChanges {
  const output: CampaignFieldChanges = { fields: [], errors: [] };
  const proposed = new Map<string, unknown>();
  const add = (rawKey: string, value: unknown, legacy = false) => {
    const key = canonicalCampaignFieldKey(rawKey);
    try {
      if (unsafeKeys.has(rawKey) || rawKey.includes('.') || rawKey.includes('[')) throw new Error('UNSAFE_FIELD_KEY');
      if (proposed.has(key) && !equal(proposed.get(key), value, key)) throw new Error('CONFLICTING_FIELD_ALIASES');
      proposed.set(key, value);
      // Canonical state should be built by the adapter; typed keys are accepted for convenience.
      const previous = Object.hasOwn(before, key) ? before[key] : Object.entries(before).find(([name]) => canonicalCampaignFieldKey(name) === key)?.[1];
      if (equal(previous, value, key)) return;
      if (isProtectedCampaignField(rawKey)) throw new Error('PROTECTED_FIELD_COMMAND_REQUIRED');
      const known = Boolean(CAMPAIGN_FIELD_BY_KEY[key]) || extraFields.has(key);
      if (!known) throw new Error(legacy ? 'UNKNOWN_LEGACY_FIELD_CHANGED' : 'UNKNOWN_FIELD');
      if (!output.fields.some((field) => field.fieldKey === key)) output.fields.push({ fieldKey: key, before: previous, after: value, known });
    } catch (error) {
      output.errors.push({ fieldKey: key, code: error instanceof Error ? error.message : 'INVALID_FIELD' });
    }
  };
  if (marketComponents.some((key) => Object.hasOwn(patch, key))) {
    // Partial structured changes combine once; origin and codes are components, not competing aliases.
    const prior = before.market;
    const combined: Record<string, unknown> = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...prior } : {};
    for (const key of marketComponents) if (Object.hasOwn(patch, key)) combined[key] = patch[key];
    add('market', combined);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'expectedVersion' || key === 'clientKey') continue;
    if ((marketComponents as readonly string[]).includes(key)) continue;
    if (key !== 'fieldValues') add(key, value);
    else if (!value || typeof value !== 'object' || Array.isArray(value)) output.errors.push({ fieldKey: key, code: 'INVALID_FIELD_VALUES' });
    else for (const [legacyKey, legacyValue] of Object.entries(value)) add(legacyKey, legacyValue, true);
  }
  return output;
}

export function evaluateCampaignFieldChanges(request: AccessRequest, changes: CampaignFieldChanges, rules: readonly AccessRule[]) {
  const read = evaluateAccess({ ...request, permission: 'campaign.read' }, rules);
  const deniedFields = changes.fields.filter((field) => !evaluateAccess({ ...request, permission: 'campaign.update', fieldKey: field.fieldKey }, rules).allowed).map((field) => field.fieldKey);
  return { allowed: read.allowed && changes.errors.length === 0 && deniedFields.length === 0, deniedFields, errors: changes.errors, canRead: read.allowed };
}
