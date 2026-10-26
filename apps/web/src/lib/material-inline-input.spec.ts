import { describe, expect, it } from 'vitest';
import { materialInlineTitleSuggestion, materialPublicationAction, materialTypeChoicePatch } from './material-inline-input';
import { materialSheetPatch, normalizeMaterialSheetPatch } from './material-spreadsheet';

const a = { kind: 'SYSTEM', id: 'qa-a', name: 'Mở đường bay thử nghiệm Đà Nẵng – Singapore' };
const row = { campaign_refs: JSON.stringify([a]), material_type: 'Key Visual' };
describe('Material inline input', () => {
  it('suggests without altering the current title or fields', () => {
    const fields = { ...row, material_name: '' };
    expect(materialInlineTitleSuggestion(fields, '')).toBe('Key Visual ' + a.name);
    expect(fields.material_name).toBe('');
    expect(materialInlineTitleSuggestion(fields, 'Tiêu đề tự do')).toBeNull();
  });
  it('completes a campaign suffix even when type has not been selected', () => {
    expect(materialInlineTitleSuggestion({ campaign: row.campaign_refs }, 'Key Visual Mở đường bay thử nghiệm Đà Nẵng - Si'))
      .toBe('Key Visual Mở đường bay thử nghiệm Đà Nẵng - Singapore');
    expect(materialInlineTitleSuggestion(row, 'KV Mở đư')).toBe('KV ' + a.name);
  });
  it('keeps typed accents, case, spaces and IME-normalized text intact', () => {
    const typed = 'key visual mo duong';
    expect(materialInlineTitleSuggestion(row, typed)).toBe(typed + ' bay thử nghiệm Đà Nẵng – Singapore');
    const ime = 'Key Visual Mở đư'.normalize('NFD');
    expect(materialInlineTitleSuggestion(row, ime)).toBe(ime + 'ờng bay thử nghiệm Đà Nẵng – Singapore');
    expect(materialInlineTitleSuggestion(row, 'Key  Visual ')).toBe('Key  Visual ' + a.name);
  });
  it('does not append to an already complete or unrelated title', () => {
    expect(materialInlineTitleSuggestion(row, 'Key Visual ' + a.name)).toBeNull();
    expect(materialInlineTitleSuggestion(row, 'Key Visual ' + a.name + ' bản ngang')).toBeNull();
    expect(materialInlineTitleSuggestion({}, 'Key Visual Mở')).toBeNull();
  });
  it('uses pending Campaign selection, temporary names and the multi-Campaign form convention', () => {
    const other = { kind: 'TEMPORARY', id: 'temp:qa', name: 'Chiến dịch thử nghiệm khác' };
    expect(materialInlineTitleSuggestion({ ...row, campaign: JSON.stringify([other]) }, '')).toBe('Key Visual ' + other.name);
    expect(materialInlineTitleSuggestion({ ...row, campaign: '[]' }, '')).toBeNull();
    expect(materialInlineTitleSuggestion({ ...row, campaign_refs: JSON.stringify([a, other]) }, 'Key Visual')).toBe('Key Visual nhiều chiến dịch');
    expect(materialInlineTitleSuggestion({ ...row, material_type: 'Khác', material_type_other: 'Poster' }, '')).toBe('Poster ' + a.name);
  });
  it('does not choose between ambiguous campaign prefixes', () => {
    expect(materialInlineTitleSuggestion({ campaign_refs: JSON.stringify([a, { ...a, id: 'qa-b', name: 'Mở đường bay thử nghiệm khác' }]) }, 'KV Mở đường')).toBeNull();
  });
  it('updates type and its group atomically, including from an empty or hidden group', () => {
    const patch = materialTypeChoicePatch('Trang web', 'Landing Page');
    expect(normalizeMaterialSheetPatch({ material_group: 'Video', material_type: 'TVC quảng cáo' }, patch)).toEqual(patch);
    expect(materialSheetPatch(patch)).toEqual({ material_group: 'Trang web', material_type: 'Landing Page', material_type_other: '' });
    expect(materialTypeChoicePatch('Hình ảnh', 'Key Visual').material_group).toBe('Hình ảnh');
    expect(materialTypeChoicePatch('Văn bản', 'Khác')).toEqual({ material_group: 'Văn bản', material_type: 'Khác', material_type_other: '' });
    expect(() => materialTypeChoicePatch('Video', 'Key Visual')).toThrow();
  });
  it('routes publication through lifecycle commands, never through content patches', () => {
    expect(['PUBLISHED', 'PAUSED', 'NOT_PUBLISHED'].map(materialPublicationAction)).toEqual(['PUBLISH', 'PAUSE_PUBLISH', 'UNPUBLISH']);
    expect(() => materialPublicationAction('invalid')).toThrow();
    expect(materialSheetPatch({ publish_status: 'PUBLISHED' })).toEqual({});
  });
});
