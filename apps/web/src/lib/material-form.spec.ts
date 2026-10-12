import { describe, expect, it } from 'vitest';
import { inferMaterialGroup, parseMaterialLanguages } from '@cpms/domain';
import { materialTitleSuggestion } from './material-form';

describe('material title suggestion', () => {
  const first = { kind: 'SYSTEM' as const, id: 'campaign-1', name: 'Mở bán vé Tết Đinh Mùi 2027' };
  it('uses the selected type and single campaign name', () => {
    expect(materialTitleSuggestion('Key Visual', '', [first])).toBe('Key Visual Mở bán vé Tết Đinh Mùi 2027');
  });
  it('summarizes multiple campaigns and accepts a temporary name', () => {
    expect(materialTitleSuggestion('TVC quảng cáo', '', [first, { kind: 'TEMPORARY', id: 'temp:1', name: 'Chiến dịch khác' }])).toBe('TVC quảng cáo nhiều chiến dịch');
    expect(materialTitleSuggestion('Khác', 'Poster', [{ kind: 'TEMPORARY', id: 'temp:1', name: 'Chiến dịch khác' }])).toBe('Poster Chiến dịch khác');
  });
  it('waits for both a type and a named campaign', () => {
    expect(materialTitleSuggestion('Key Visual', '', [])).toBe('');
    expect(materialTitleSuggestion('', '', [first])).toBe('');
  });
  it('recognizes Landing Page as a website material and parses multiple selected languages', () => {
    expect(inferMaterialGroup('Landing Page')).toBe('Trang web');
    expect(parseMaterialLanguages('["Tiếng Việt","Tiếng Anh"]')).toEqual(['Tiếng Việt', 'Tiếng Anh']);
  });
});
