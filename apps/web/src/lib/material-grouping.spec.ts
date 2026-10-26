import { MATERIAL_CAMPAIGN_DATE_COLUMNS } from './material-campaign-dates';
import { describe, expect, it } from 'vitest';
import { gridSections, uniqueGridPatches, uniqueGridRows } from './grid-grouping';
import { defaultMaterialGroupMode, materialGrouping, materialGroupPage, readMaterialGroupMode } from './material-grouping';
import { defaultMaterialLayout, materialSheetRow, migrateMaterialLayout } from './material-spreadsheet';
import { DEFAULT_MATERIAL_COLUMNS, newMaterialRow } from './material-grid';

const a = { kind: 'SYSTEM', id: 'a', name: 'Chiến dịch A' }, b = { kind: 'SYSTEM', id: 'b', name: 'Chiến dịch B' };
const row = (id: string, refs = [a]) => ({ id, materialId: id, campaign_refs: JSON.stringify(refs), material_update_date: '2026-10-24', material_type: 'Key Visual' });
describe('Material view defaults and grouping', () => {
  it('uses new defaults only for a fresh view and keeps an existing layout intact', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const fresh = migrateMaterialLayout(storage, 'a', 'a', '', false);
    expect(fresh.order.filter(key => !fresh.hidden.includes(key))).toEqual([...DEFAULT_MATERIAL_COLUMNS, ...MATERIAL_CAMPAIGN_DATE_COLUMNS.map(column => column.key)]);
    expect(fresh.pinned).toEqual(['material_update_date', 'campaign', 'material_name']);
    const custom = { ...fresh, hidden: [...fresh.hidden, 'campaign_effect_start_date'], pinned: ['note'], hiddenRows: ['secret'], widths: { note: 450 } };
    storage.setItem('a', JSON.stringify(custom));
    expect(migrateMaterialLayout(storage, 'a', 'a', '', false)).toEqual(custom);
    expect(defaultMaterialLayout()).not.toHaveProperty('hiddenRows');
    expect(defaultMaterialLayout(true).hidden).toContain('campaign');
    expect(defaultMaterialLayout(true).pinned).toEqual(['material_update_date', 'material_name']);
    expect(defaultMaterialGroupMode(true)).toBe('NONE');
    expect(readMaterialGroupMode(storage, 'a', false)).toBe('CAMPAIGN');
    storage.setItem('a:grouping', 'NONE');
    expect(readMaterialGroupMode(storage, 'a', false)).toBe('NONE');
    expect(readMaterialGroupMode(storage, 'b', false)).toBe('CAMPAIGN');
  });
  it('places a shared material in each campaign, counts it once per group, and leaves drafts outside groups', () => {
    const multi = row('both', [a, b, a]);
    const grouping = materialGrouping('CAMPAIGN')!;
    const sections = gridSections([multi, row('onlyA'), { ...row('draft'), materialId: null }], grouping);
    expect(sections.map(group => [group.key, group.rows.map(record => record.id)])).toEqual([
      ['campaign:a', ['both', 'onlyA']], ['campaign:b', ['both']],
    ]);
    expect(uniqueGridRows(sections.flatMap(section => section.rows)).map(record => record.id)).toEqual(['both', 'onlyA']);
    expect(grouping.initiallyCollapsed).toBe(true);
  });
  it('paginates complete groups, includes the draft on every page and limits memberships to the current page', () => {
    const rows = [row('both', [a, b]), row('oneA'), row('twoA'), { ...row('draft'), materialId: null }];
    const grouping = materialGrouping('CAMPAIGN')!;
    const page = materialGroupPage(rows, grouping, 1, 1);
    expect(page.pages).toBe(2); expect(page.rows).toHaveLength(4);
    expect(gridSections(page.rows, { ...grouping, pageKeys: page.keys })).toHaveLength(1);
    const next = materialGroupPage(rows, grouping, 2, 1);
    expect(next.rows.map(record => record.id)).toEqual(['both', 'draft']);
  });
  it('groups projected persisted rows by canonical links even when campaign stores a display label', () => {
    const toSheet = (id: string, refs: typeof a[]) => {
      const value = newMaterialRow(id);
      value.materialId = id;
      value.fields = { ...value.fields, campaign: refs.map(ref => ref.name).join('; '), campaign_refs: JSON.stringify(refs) };
      return materialSheetRow(value, 1);
    };
    const shared = toSheet('shared', [a, b]);
    const single = toSheet('single', [a]);
    const unassigned = toSheet('none', []);
    const grouping = materialGrouping('CAMPAIGN')!;
    const page = materialGroupPage([shared, single, unassigned], grouping, 1, 10);
    const groups = gridSections(page.rows, { ...grouping, pageKeys: page.keys });
    expect(groups.find(group => group.key === 'campaign:a')?.rows.map(value => value.id)).toEqual(['shared', 'single']);
    expect(groups.find(group => group.key === 'campaign:b')?.rows.map(value => value.id)).toEqual(['shared']);
    expect(groups.find(group => group.key === 'unassigned')?.rows.map(value => value.id)).toEqual(['none']);
    expect(grouping.resolve({ ...shared, campaign: JSON.stringify([b]) })).toEqual([{ key: 'campaign:a', label: a.name }, { key: 'campaign:b', label: b.name }]);
  });
  it('separates months by year and uses custom types and campaign names', () => {
    expect(gridSections([row('a'), { ...row('old'), material_update_date: '2025-10-01' }], materialGrouping('MONTH')!).map(group => group.key)).toEqual(['2026-10', '2025-10']);
    expect(materialGrouping('TYPE')!.resolve({ material_type: 'Khác', material_type_other: 'Poster' })).toEqual({ key: 'type:poster', label: 'Poster' });
    expect(materialGrouping('CAMPAIGN')!.resolve({ campaign_refs: JSON.stringify([{ kind: 'TEMPORARY', id: 'custom-a', name: 'Chiến dịch A' }]) })).toEqual([{ key: 'custom:chiến dịch a', label: 'Chiến dịch A' }]);
    expect(materialGrouping('CAMPAIGN')!.resolve({})).toEqual({ key: 'unassigned', label: 'Chưa gắn chiến dịch' });
  });
  it('retains the edited occurrence and rejects conflicting paste into one record', () => {
    expect(materialGrouping('MONTH')!.resolve({ material_update_date: '2020-01-01', __groupingSource: { material_update_date: '2026-10-24' } })).toEqual({ key: '2026-10', label: 'Tháng 10/2026' });
    expect(uniqueGridPatches([{ id: 'a', fields: { title: 'A' } }, { id: 'a', fields: { title: 'A', note: 'N' } }])).toEqual([{ id: 'a', fields: { title: 'A', note: 'N' } }]);
    expect(() => uniqueGridPatches([{ id: 'a', fields: { title: 'A' } }, { id: 'a', fields: { title: 'B' } }])).toThrow('nhiều nhóm');
  });
});
