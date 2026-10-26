import { describe, expect, it } from 'vitest';
import type { MaterialPortalBootstrap } from '@cpms/domain';
import { materialClipboardValue, materialContent, materialDraftReason, materialLayoutKey, materialSheetPatch, migrateMaterialLayout, normalizeMaterialSheetPatch } from './material-spreadsheet';
import { materialGridPreferenceKeys } from './material-grid-preferences';
import { MATERIAL_CAMPAIGN_DATE_COLUMNS } from './material-campaign-dates';
import { bookingClipboardRows } from './booking-grid';

const bootstrap = { campaigns: [{ campaign_id: 'c1', campaign_name: 'Campaign A', campaign_code: 'C1', market_codes: ['VN'] }, { campaign_id: 'c2', campaign_name: 'Campaign B', campaign_code: 'C2', market_codes: ['JP'] }], settings: {}, users: [], fieldRules: [], roleRules: [], options: { markets: [], statuses: [], materialTypes: [] } } satisfies MaterialPortalBootstrap;
describe('Material spreadsheet adapter', () => {
  it('only writes content, preserves target identity/publication/audit and maps Campaign references by key', () => {
    const patch = materialSheetPatch({ material_name: 'Changed', campaign: '[{"kind":"SYSTEM","id":"c1","name":"A"}]', publish_status: 'PUBLISHED', material_id: 'source', updated_by: 'someone', contract_ids: 'legacy', supplementary_links: '[]', __sheetBlank: 'true' });
    expect(patch).toEqual({ material_name: 'Changed', campaign_refs: '[{"kind":"SYSTEM","id":"c1","name":"A"}]' });
    expect(materialContent({ material_name: 'A', publish_status: 'PUBLISHED', material_id: 'source', supplementary_link: 'https://example.test' })).not.toHaveProperty('publish_status');
  });
  it('keeps a title-only row private until a valid link and dependent Other type are supplied', () => {
    expect(materialDraftReason({ material_name: 'Vietnamese title' }, false)).toContain('Link');
    expect(materialDraftReason({ material_link: 'javascript:alert(1)' }, false)).toContain('Link');
    expect(materialDraftReason({ material_link: 'https://example.test', material_type: 'Khác' }, false)).toContain('Loại');
    expect(materialDraftReason({ material_link: 'https://example.test', material_type: 'Khác', material_type_other: 'Poster' }, false)).toBeNull();
    expect(normalizeMaterialSheetPatch({ material_group: 'Video', material_type: 'TVC quảng cáo' }, { material_group: 'Trang web' })).toEqual({ material_group: 'Trang web', material_type: '', material_type_other: '' });
  });
  it('parses multiple canonical Campaigns, language JSON, rich text and strict backdated dates', () => {
    expect(JSON.parse(materialClipboardValue('campaign', 'C1; Campaign B', bootstrap)).map((row: {id: string}) => row.id)).toEqual(['c1', 'c2']);
    expect(() => materialClipboardValue('campaign', 'Unknown', bootstrap)).toThrow();
    expect(materialClipboardValue('material_languages', 'Tiếng Việt; Tiếng Anh', bootstrap)).toBe('["Tiếng Việt","Tiếng Anh"]');
    expect(() => materialClipboardValue('material_languages', 'Invalid', bootstrap)).toThrow();
    expect(materialClipboardValue('material_update_date', '02/01/2020', bootstrap)).toBe('2020-01-02');
    expect(() => materialClipboardValue('material_update_date', '31/02/2026', bootstrap)).toThrow();
    expect(JSON.parse(materialClipboardValue('material_description_rich_text', 'A\nB', bootstrap)).type).toBe('doc');
    expect(bookingClipboardRows('"A\nB"\t\tC\nD\tE\t')).toEqual([['A\nB', '', 'C'], ['D', 'E', '']]);
  });
  it('migrates deliberate pins and widths once and isolates actors and contexts', () => {
    const values = new Map<string,string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const legacy = materialGridPreferenceKeys();
    storage.setItem(legacy.columns, '["note","material_name","contract_ids"]'); storage.setItem(legacy.pinned, '["note"]'); storage.setItem(legacy.widths, '{"note":333,"contract_ids":200}');
    const key = materialLayoutKey('a', '', false), layout = migrateMaterialLayout(storage, key, 'a', '', false);
    expect(layout.pinned).toEqual(['note']); expect(layout.widths).toEqual({ note: 333 }); expect(layout.order[0]).toBe('note'); expect(layout.pinningVersion).toBe(1);
    storage.setItem(legacy.pinned, '[]'); expect(migrateMaterialLayout(storage, key, 'a', '', false).pinned).toEqual(['note']);
    expect(new Set([key, materialLayoutKey('b', '', false), materialLayoutKey('a', 'c1', false), materialLayoutKey('a', 'c1', true)]).size).toBe(4);
  });
  it('hides Campaign once in embedded views without changing the portal or later user choices', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const portalKey = materialLayoutKey('actor', '', false);
    const embeddedKey = materialLayoutKey('actor', 'campaign-1', true);
    expect(migrateMaterialLayout(storage, portalKey, 'actor', '', false).hidden).not.toContain('campaign');
    const embedded = migrateMaterialLayout(storage, embeddedKey, 'actor', 'campaign-1', true);
    expect(embedded.hidden).toContain('campaign');
    expect(embedded.pinned).not.toContain('campaign');
    const shownAgain = { ...embedded, hidden: embedded.hidden.filter(field => field !== 'campaign') };
    storage.setItem(embeddedKey, JSON.stringify(shownAgain));
    expect(migrateMaterialLayout(storage, embeddedKey, 'actor', 'campaign-1', true).hidden).not.toContain('campaign');
    expect(migrateMaterialLayout(storage, portalKey, 'actor', '', false).hidden).not.toContain('campaign');
  });
  it('updates an existing embedded layout without disturbing other column preferences', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const key = materialLayoutKey('actor', 'campaign-1', true);
    const saved = { order: ['note', 'campaign', 'material_name'], hidden: ['material_type'], pinned: ['note', 'campaign'], pinningVersion: 1, widths: { note: 320 } };
    storage.setItem(key, JSON.stringify(saved));
    const migrated = migrateMaterialLayout(storage, key, 'actor', 'campaign-1', true);
    expect(migrated).toEqual({ ...saved, order: [...saved.order, ...MATERIAL_CAMPAIGN_DATE_COLUMNS.map(column => column.key)], hidden: ['material_type', 'campaign'], pinned: ['note'] });
    expect(JSON.parse(storage.getItem(key)!)).toEqual(migrated);
    expect(migrateMaterialLayout(storage, key, 'actor', 'campaign-1', true)).toEqual(migrated);
  });
});
