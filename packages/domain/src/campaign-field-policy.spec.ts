import { describe, expect, it } from 'vitest';
import { CAMPAIGN_FIELD_DEFINITIONS } from './campaign-fields';
import { canonicalCampaignFieldKey, evaluateCampaignFieldChanges, inspectCampaignFieldChanges } from './campaign-field-policy';
import type { AccessRequest, AccessRule } from './access-policy';
const request: AccessRequest = { permission: 'campaign.update', now: 1,
  identity: { effectiveActorId: 'user', originalActorId: 'user', mode: 'DIRECT', sessionValid: true, effectiveActive: true, originalActive: true, profileComplete: true, effectiveSuperadmin: false, orgIds: [] },
  resource: { type: 'CAMPAIGN', id: 'qa-a', exists: true, deleted: false, createdByActorId: 'other', state: 'DRAFT', orgIds: [], assignedActorIds: [] },
};
const read: AccessRule = { id: 'read', actorId: 'user', permission: 'campaign.read', effect: 'ALLOW', scope: { tier: 'MODULE', module: 'campaign' }, relation: 'ALL', source: 'ROLE_BINDING' };
const update: AccessRule = { ...read, id: 'update', permission: 'campaign.update' };
const denyName: AccessRule = { ...update, id: 'name-deny', effect: 'DENY', scope: { tier: 'FIELD', module: 'campaign', resourceType: 'CAMPAIGN', resourceId: 'qa-a', fieldKey: 'campaign_name' } };
describe('canonical Campaign field policy (adapter integration pending)', () => {
  it.each([
    ['name', 'campaign_name'], ['fieldValues.campaign_name', 'campaign_name'], ['levelCode', 'campaign_level_code'],
    ['startDate', 'campaign_comm_start_date'], ['kpi_text', 'kpi_primary'], ['primary_objective_code', 'campaign_objective'],
  ])('canonicalizes %s to %s', (alias, fieldKey) => expect(canonicalCampaignFieldKey(alias)).toBe(fieldKey));
  it('preserves all 87 registry definitions and an unchanged unknown legacy object', () => {
    expect(CAMPAIGN_FIELD_DEFINITIONS).toHaveLength(87);
    expect(inspectCampaignFieldChanges({ mystery: { b: 2, a: 1 } }, { fieldValues: { mystery: { a: 1, b: 2 } } })).toEqual({ fields: [], errors: [] });
  });
  it('ignores unchanged locked fields in full payloads after normalization', () => {
    const changes = inspectCampaignFieldChanges({ campaign_name: 'Synthetic', campaign_comm_start_date: '2026-09-01', kpi_primary: 'Old' },
      { name: ' Synthetic ', startDate: '2026-09-01T00:00:00.000Z', kpiText: 'New' });
    expect(changes.fields.map((field) => field.fieldKey)).toEqual(['kpi_primary']);
    expect(evaluateCampaignFieldChanges(request, changes, [read, update, denyName]).allowed).toBe(true);
  });
  it.each([{ name: 'Changed', kpiText: 'New' }, { fieldValues: { campaign_name: 'Changed', kpi_primary: 'New' } }])('rejects the entire record if a changed field is denied through either path', (patch) => {
    const changes = inspectCampaignFieldChanges({ campaign_name: 'Old', kpi_primary: 'Old' }, patch);
    expect(evaluateCampaignFieldChanges(request, changes, [read, update, denyName])).toMatchObject({ allowed: false, deniedFields: ['campaign_name'] });
  });
  it('permits precisely one field over a record deny and still requires read', () => {
    const allowName = { ...denyName, effect: 'ALLOW' as const };
    const denyRecord = { ...update, effect: 'DENY' as const };
    const changes = inspectCampaignFieldChanges({ campaign_name: 'Old' }, { name: 'New' });
    expect(evaluateCampaignFieldChanges(request, changes, [read, denyRecord, allowName]).allowed).toBe(true);
    expect(evaluateCampaignFieldChanges(request, changes, [denyRecord, allowName]).allowed).toBe(false);
  });
  it('rejects conflicting aliases instead of choosing whichever path ran last', () => {
    expect(inspectCampaignFieldChanges({ campaign_name: 'Old' }, { name: 'Old', fieldValues: { campaign_name: 'New' } }).errors[0]?.code).toBe('CONFLICTING_FIELD_ALIASES');
  });
  it.each(['actorId', 'createdByActorId', 'policy', 'approval_policy', 'campaign_lifecycle_state', 'department_approval_state', 'campaign_manager_acceptance_state', 'plan_status', 'campaign_folder_id'])('blocks mass assignment of %s, also in fieldValues', (key) => {
    for (const patch of [{ [key]: 'forged' }, { fieldValues: { [key]: 'forged' } }]) {
      expect(inspectCampaignFieldChanges({}, patch).errors[0]?.code).toBe('PROTECTED_FIELD_COMMAND_REQUIRED');
    }
  });
  it('blocks nested object keys and changing unknown legacy fields', () => {
    const poisoned = JSON.parse('{"constructor":{"roles":["ADMIN"]}}') as unknown;
    expect(inspectCampaignFieldChanges({}, { additionalInformation: poisoned }).errors[0]?.code).toBe('UNSAFE_JSON_KEY');
    expect(inspectCampaignFieldChanges({}, { fieldValues: { mystery: 'New' } }).errors[0]?.code).toBe('UNKNOWN_LEGACY_FIELD_CHANGED');
  });
  it('lets a registered legacy field inherit record update', () => {
    const changes = inspectCampaignFieldChanges({ customer_facing_summary: 'Old' }, { fieldValues: { customer_facing_summary: 'New' } });
    expect(evaluateCampaignFieldChanges(request, changes, [read, update]).allowed).toBe(true);
  });
  it('detects whitespace edits inside rich content and legacy text rather than masking actual writes', () => {
    expect(inspectCampaignFieldChanges({ request_campaign_description: { text: 'Original' } }, { descriptionRichText: { text: ' Original ' } }).fields).toHaveLength(1);
    expect(inspectCampaignFieldChanges({ customer_facing_summary: 'Original' }, { fieldValues: { customer_facing_summary: 'Original ' } }).fields).toHaveLength(1);
    expect(inspectCampaignFieldChanges({ mystery: { value: null } }, { fieldValues: { mystery: { value: '' } } }).errors[0]?.code).toBe('UNKNOWN_LEGACY_FIELD_CHANGED');
    expect(inspectCampaignFieldChanges({}, { fieldValues: { mystery: null } }).errors[0]?.code).toBe('UNKNOWN_LEGACY_FIELD_CHANGED');
  });
  it('merges structured market components into one field decision without alias conflicts', () => {
    const changes = inspectCampaignFieldChanges({ market: { marketCodes: ['OLD'], marketSelectionOrigin: 'CUSTOM', marketSelectionCode: null } },
      { marketCodes: ['NEW'], marketSelectionOrigin: 'REGION', marketSelectionCode: 'region-synthetic' });
    expect(changes.errors).toEqual([]);
    expect(changes.fields.map((field) => field.fieldKey)).toEqual(['market']);
  });
});
