import { describe, expect, it } from 'vitest';
import { compareMaterialRows, duplicateMaterialRow, DEFAULT_MATERIAL_COLUMNS, MATERIAL_COLUMNS, materialCompletionInRange, materialDisplayValue, materialRowFromSummary, materialSaveItem, materialSortDirectionLabel, newMaterialRow } from './material-grid';

describe('material grid', () => {
  it('offers only current form and audit columns, not legacy import controls', () => {
    const keys = MATERIAL_COLUMNS.map((column) => column.key);
    expect(keys).not.toContain('workflow_state');
    expect(keys).toContain('publish_status');
    expect(keys).toContain('record_version');
    expect(keys).toContain('material_update_date');
    expect(keys).toContain('material_languages');
    expect(keys).not.toContain('completion_date');
    expect(keys).not.toContain('contract_ids');
    expect(keys).not.toContain('version');
    expect(DEFAULT_MATERIAL_COLUMNS).toEqual(['material_update_date', 'campaign', 'material_name', 'material_type', 'publish_status', 'material_link', 'material_description_rich_text', 'note']);
    expect(keys).not.toContain('supplementary_links');
    expect(keys).not.toContain('supplementary_link_1');
    expect(keys).not.toContain('supplementary_link_2');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('material_publish');
    expect(keys).not.toContain('viber_message');
    expect(keys).not.toContain('campaign_code');
  });
  it('creates BOOKED rows and serializes one batch item without inventing a material id', () => {
    const row = newMaterialRow('new-1');
    row.fields.material_name = 'Key visual thử nghiệm';
    expect(materialSaveItem(row)).toMatchObject({
      clientKey: 'new-1',
      fields: { approval_status: 'BOOKED', publish_status: 'NOT_PUBLISHED' },
    });
    expect(materialSaveItem(row)).not.toHaveProperty('materialId');
  });

  it('duplicates an approved record as a new BOOKED record', () => {
    const source = materialRowFromSummary({
      id: '1', materialId: 'MAT-1', recordVersion: 4, isDeleted: false, updatedAt: '2026-09-01',
      fields: { material_id: 'MAT-1', material_name: 'KV', approval_status: 'APPROVED', publish_status: 'PUBLISHED',
        material_link: 'https://example.com/main', contract_ids: 'LEGACY-CONTRACT', supplementary_link: 'https://example.com/old', supplementary_links: '[{"label":"Old","url":"https://example.com/old"}]' },
    });
    const copy = duplicateMaterialRow(source, 'copy-1');
    expect(copy.materialId).toBeNull();
    expect(copy.fields.material_id).toBeUndefined();
    expect(copy.fields.approval_status).toBe('BOOKED');
    expect(copy.fields.publish_status).toBe('NOT_PUBLISHED');
    expect(copy.fields.material_link).toBe('https://example.com/main');
    expect(copy.fields.contract_ids).toBeUndefined();
    expect(copy.fields.supplementary_link).toBeUndefined();
    expect(copy.fields.supplementary_links).toBeUndefined();
  });

  it('filters editable update dates inclusively and excludes undated rows only when a range is active', () => {
    const dated = newMaterialRow('dated');
    dated.fields.material_update_date = '2026-10-03';
    const undated = newMaterialRow('undated');
    undated.fields.material_update_date = null;
    expect(materialCompletionInRange(dated, { from: '2026-10-03', to: '2026-10-03' })).toBe(true);
    expect(materialCompletionInRange(dated, { from: '2026-10-04', to: '' })).toBe(false);
    expect(materialCompletionInRange(undated, { from: '', to: '' })).toBe(true);
    expect(materialCompletionInRange(undated, { from: '2026-10-01', to: '' })).toBe(false);
  });

  it('sorts dates and numbers semantically with type-specific hints', () => {
    const older = newMaterialRow('older');
    const newer = newMaterialRow('newer');
    older.fields.material_update_date = '2026-01-02';
    newer.fields.material_update_date = '2026-10-03';
    older.fields.record_version = '2';
    newer.fields.record_version = '10';
    const dateColumn = MATERIAL_COLUMNS.find((column) => column.key === 'material_update_date')!;
    const numberColumn = MATERIAL_COLUMNS.find((column) => column.key === 'record_version')!;
    expect(compareMaterialRows(older, newer, dateColumn, 'asc')).toBeLessThan(0);
    expect(compareMaterialRows(older, newer, numberColumn, 'asc')).toBeLessThan(0);
    expect(materialSortDirectionLabel(dateColumn, 'desc')).toBe('Mới tới cũ');
    expect(materialSortDirectionLabel(numberColumn, 'asc')).toBe('Nhỏ tới lớn');
  });

  it('displays multiple selected languages in one optional column', () => {
    expect(materialDisplayValue({ material_languages: '["Tiếng Việt","Tiếng Anh"]' }, 'material_languages')).toBe('Tiếng Việt, Tiếng Anh');
  });

});
