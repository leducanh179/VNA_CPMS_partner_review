import { describe, expect, it } from 'vitest';
import { applyMaterialColumnFilters, materialColumnFilterOptions, materialColumnValues } from './material-column-filters';
import { columnValuesMatchFilter, defaultColumnFilter, type CampaignColumnFilterModel } from './campaign-filters';
import { newMaterialRow, type MaterialGridRow } from './material-grid';

const row = (id: string, fields: MaterialGridRow['fields'] = {}): MaterialGridRow => ({
  ...newMaterialRow(id), materialId: id, recordVersion: 3,
  fields: { material_name: id, material_update_date: '2026-10-19', ...fields },
});
const select = (values: string[], includeBlank = false) => ({ type: 'set' as const, values, includeBlank });

describe('shared Campaign / Material column filters', () => {
  it('starts text columns in value selection and dates in month selection', () => {
    for (const key of ['campaign_code', 'campaign_name', 'material_name']) {
      expect(defaultColumnFilter({ key, kind: 'text' })).toEqual(select([]));
    }
    expect(defaultColumnFilter({ key: 'material_update_date', kind: 'date' })).toMatchObject({ type: 'date', mode: 'months' });
  });
  it('filters all scoped records before pagination, not just the current ten', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row('M' + i, { publish_status: i === 14 ? 'PUBLISHED' : 'NOT_PUBLISHED' }));
    const filters = { publish_status: select(['Đã xuất bản']) };
    expect(materialColumnFilterOptions(rows, {}, 'publish_status').valueOptions.options.find(option => option.value === 'Đã xuất bản')?.count).toBe(1);
    expect(applyMaterialColumnFilters(rows, filters).slice(0, 10).map(value => value.materialId)).toEqual(['M14']);
  });
  it('uses readable values, individual multi-values and plain rich text', () => {
    const item = row('M', { campaign_refs: JSON.stringify([{ kind: 'SYSTEM', id: 'c1', name: 'Chiến dịch A' }, { kind: 'TEMPORARY', id: 'c2', name: 'Chiến dịch B' }]),
      material_languages: '["Tiếng Việt","Tiếng Anh"]', market_codes: 'VN,JP', material_type: 'Khác', material_type_other: 'Poster',
      material_description_rich_text: '{"schemaVersion":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Thông tin mới"}]}]}' });
    expect(materialColumnValues(item, 'campaign')).toEqual(['Chiến dịch A', 'Chiến dịch B']);
    expect(materialColumnValues(item, 'material_languages')).toEqual(['Tiếng Việt', 'Tiếng Anh']);
    expect(materialColumnValues(item, 'material_type')).toEqual(['Poster']);
    expect(materialColumnValues(item, 'material_description_rich_text')).toEqual(['Thông tin mới']);
    expect(applyMaterialColumnFilters([item], { campaign: select(['Chiến dịch B']), material_languages: select(['Tiếng Anh']), market_codes: select(['JP']) })).toHaveLength(1);
    expect(applyMaterialColumnFilters([item], { material_description_rich_text: { type: 'text', operator: 'contains', query: 'thong tin' } })).toHaveLength(1);
  });
  it('facets respect other filters, ignore their own and retain zero-count choices', () => {
    const rows = [row('a', { material_type: 'Key Visual', publish_status: 'PUBLISHED' }), row('b', { material_type: 'Landing Page', publish_status: 'PUBLISHED' }), row('c', { material_type: 'Clip', publish_status: 'PAUSED' })];
    const filters: CampaignColumnFilterModel = { publish_status: select(['Đã xuất bản']), material_type: select(['Old']) };
    expect(materialColumnFilterOptions(rows, filters, 'material_type').valueOptions.options).toEqual([
      { value: 'Key Visual', label: 'Key Visual', count: 1 }, { value: 'Landing Page', label: 'Landing Page', count: 1 }, { value: 'Old', label: 'Old', count: 0 },
    ]);
  });
  it('supports empty selection, blank values and private incomplete input without fake facets', () => {
    const rows = [row('a', { note: '' }), row('b', { note: 'Visible' }), newMaterialRow('private')];
    expect(applyMaterialColumnFilters(rows, { note: select([]) }).map(item => item.clientKey)).toEqual(['private']);
    expect(applyMaterialColumnFilters(rows, { note: select([], true) }).map(item => item.clientKey)).toEqual(['a', 'private']);
    expect(materialColumnFilterOptions(rows, {}, 'note').valueOptions.blankCount).toBe(1);
    expect(columnValuesMatchFilter([''], select([], true))).toBe(true);
  });
  it('matches month/year, backdated ranges and blank dates like Campaign', () => {
    const rows = [row('a', { material_update_date: '2020-02-29' }), row('b', { material_update_date: '2026-10-19' }), row('c', { material_update_date: '' })];
    const filter = { type: 'date' as const, mode: 'months' as const, months: ['2020-02'], includeBlank: false, from: '', to: '' };
    expect(applyMaterialColumnFilters(rows, { material_update_date: filter }).map(item => item.clientKey)).toEqual(['a']);
    expect(applyMaterialColumnFilters(rows, { material_update_date: { ...filter, mode: 'range', from: '2020-01-01', to: '2020-12-31' } }).map(item => item.clientKey)).toEqual(['a']);
    expect(materialColumnFilterOptions(rows, {}, 'material_update_date').monthOptions.options.map(option => option.key)).toEqual(['2026-10', '2020-02']);
    expect(materialColumnFilterOptions(rows, {}, 'material_update_date').monthOptions.blankCount).toBe(1);
  });
});
