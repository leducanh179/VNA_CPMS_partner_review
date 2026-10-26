import { describe, expect, it } from 'vitest';
import { materialCampaignDates, materialCampaignDateProjection } from './material-campaign-dates';
import { materialSheetPatch } from './material-spreadsheet';
import { materialColumnValues } from './material-column-filters';
import { newMaterialRow } from './material-grid';

describe('Material linked Campaign validity dates', () => {
  const campaigns = [{ campaign_id: 'a', campaign_name: 'Current A', campaign_code: 'A', market_codes: [], effectiveStartDate: '2026-10-01', effectiveEndDate: '2026-10-31', departureStartDate: '2026-12-01', departureEndDate: '2027-02-02' }];
  const fields = { campaign_refs: JSON.stringify([{ kind: 'SYSTEM', id: 'a', name: 'Old A' }, { kind: 'SYSTEM', id: 'hidden', name: 'Hidden' }, { kind: 'TEMPORARY', id: 'other:1', name: 'Temporary' }]) };
  it('keeps program and departure dates distinct; missing or inaccessible campaigns have no inferred dates', () => {
    const entries = materialCampaignDates(fields, 'campaign_effect_start_date', campaigns);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ id: 'a', name: 'Current A', date: '2026-10-01' });
    expect(entries.slice(1).every(entry => entry.date === '')).toBe(true);
    expect(materialCampaignDateProjection(fields, campaigns)).toMatchObject({ campaign_effect_end_date: '2026-10-31', campaign_departure_start_date: '2026-12-01', campaign_departure_end_date: '2027-02-02' });
    expect(materialSheetPatch(materialCampaignDateProjection(fields, campaigns))).toEqual({});
  });
  it('derives date facets from all linked visible campaigns without duplicating source dates', () => {
    const row = { ...newMaterialRow('qa'), fields, materialId: 'qa' };
    expect(materialColumnValues(row, 'campaign_effect_start_date', campaigns)).toEqual(['2026-10-01']);
    expect(materialColumnValues(row, 'campaign_effect_start_date', [])).toEqual([]);
    expect(materialCampaignDates({ campaign: fields.campaign_refs }, 'campaign_departure_end_date', campaigns)[0]?.date).toBe('2027-02-02');
  });
});
