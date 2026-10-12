import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMPAIGN_VISIBLE_FIELDS, CAMPAIGN_FIELD_BY_KEY } from '@cpms/domain';
import { CAMPAIGN_GRID_FIELD_BY_KEY, CAMPAIGN_GRID_FIELD_DEFINITIONS } from './campaign-grid-fields';

describe('Campaign table field curation', () => {
  it('places plan status directly after campaign status with requested label', () => {
    expect(DEFAULT_CAMPAIGN_VISIBLE_FIELDS.slice(0, 4)).toEqual(['campaign_code', 'campaign_name', 'campaign_lifecycle_state', 'plan_status']);
    expect(CAMPAIGN_GRID_FIELD_BY_KEY.plan_status?.label).toBe('Tình trạng Kế hoạch');
  });

  it('keeps historical data definitions but removes legacy-only fields from the interactive table', () => {
    for (const key of ['campaign_short_name', 'campaign_priority', 'sort_order', 'ai_note']) {
      expect(CAMPAIGN_FIELD_BY_KEY[key]).toBeDefined();
      expect(CAMPAIGN_GRID_FIELD_BY_KEY[key]).toBeUndefined();
    }
    expect(CAMPAIGN_GRID_FIELD_DEFINITIONS.some((field) => field.key === 'campaign_approval_status')).toBe(true);
  });
});
