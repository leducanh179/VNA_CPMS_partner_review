import {
  CAMPAIGN_FIELD_DEFINITIONS,
  type CampaignFieldDefinition,
} from '@cpms/domain';

export const CAMPAIGN_APPROVAL_STATUS_FIELD = {
  key: 'campaign_approval_status',
  label: 'Tình trạng phê duyệt',
  group: 'Phê duyệt & phân công',
  kind: 'choice',
  editable: false,
  width: 210,
  status: 'ACTIVE_V2',
} as const satisfies CampaignFieldDefinition;

// Legacy definitions remain in the domain for imported data and audit history.
// Only current form fields and useful operational projections appear in the table.
export const CAMPAIGN_GRID_FIELDS = new Set([
  'campaign_code', 'campaign_name', 'campaign_lifecycle_state', 'plan_status',
  'campaign_level_code', 'requesting_unit', 'requesting_person',
  'campaign_comm_start_date', 'campaign_comm_end_date',
  'campaign_effect_start_date', 'campaign_effect_end_date',
  'campaign_objective', 'kpi_primary', 'market', 'additional_information',
  'content_pillar_l1_code', 'content_pillar_l2_code',
  'lead_campaign_manager_summary', 'supporting_campaign_managers_summary',
  'division_approver_summary', 'department_approver_summary',
  'created_at', 'last_updated_at', 'campaign_folder_link',
]);

export const CAMPAIGN_GRID_FIELD_DEFINITIONS: readonly CampaignFieldDefinition[] = [
  ...CAMPAIGN_FIELD_DEFINITIONS.filter((definition) => CAMPAIGN_GRID_FIELDS.has(definition.key)),
  CAMPAIGN_APPROVAL_STATUS_FIELD,
];

export const CAMPAIGN_GRID_FIELD_BY_KEY: Readonly<Record<string, CampaignFieldDefinition>> = {
  ...Object.fromEntries(CAMPAIGN_FIELD_DEFINITIONS.filter((definition) => CAMPAIGN_GRID_FIELDS.has(definition.key)).map((definition) => [definition.key, definition])),
  [CAMPAIGN_APPROVAL_STATUS_FIELD.key]: CAMPAIGN_APPROVAL_STATUS_FIELD,
};
