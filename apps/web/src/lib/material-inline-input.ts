import { MATERIAL_TYPES_BY_GROUP, parseMaterialCampaignRefs, type MaterialGroup } from '@cpms/domain';
import { materialTitleSuggestion } from './material-form';

const folded = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').replace(/[–—]/g, '-').replace(/\s+/g, ' ');

/** Complete only a prefix; retain every character the operator has already typed. */
function completePrefix(typed: string, candidate: string): string | null {
  const prefix = folded(typed);
  if (!folded(candidate).startsWith(prefix) || folded(candidate) === prefix) return null;
  let end = 0;
  for (const char of candidate) {
    if (folded(candidate.slice(0, end)) === prefix) break;
    end += char.length;
  }
  return typed + candidate.slice(end);
}

export function materialInlineTitleSuggestion(row: Record<string, unknown>, typed: string): string | null {
  const encoded = typeof row.campaign === 'string' && row.campaign.trim().startsWith('[') ? row.campaign : row.campaign_refs;
  const refs = parseMaterialCampaignRefs(String(encoded || ''));
  if (!refs.length) return null;
  const initial = materialTitleSuggestion(String(row.material_type || ''), String(row.material_type_other || ''), refs);
  if (!typed) return initial || null;
  if (initial) {
    const completion = completePrefix(typed, initial);
    if (completion) return completion;
  }
  const names = [...new Set(refs.map(ref => ref.name.trim()).filter(Boolean))];
  const types = [...new Set(Object.values(MATERIAL_TYPES_BY_GROUP).flat())].filter(type => type !== 'Khác');
  for (const type of types) {
    const completion = completePrefix(typed, type + ' ' + (names.length > 1 ? 'nhiều chiến dịch' : names[0]));
    if (completion) return completion;
  }
  // A manually typed prefix such as "KV " is valid, too. Match the longest campaign prefix.
  for (let start = 0; start < typed.length; start++) {
    if (start && !/\s/.test(typed[start - 1]!)) continue;
    const suffix = typed.slice(start);
    if (folded(suffix).trim().length < 3) continue;
    const matches = names.flatMap(name => { const value = completePrefix(suffix, name); return value ? [typed.slice(0, start) + value] : []; });
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) return null;
  }
  return null;
}

export function materialTypeChoicePatch(group: string, type: string) {
  if (!MATERIAL_TYPES_BY_GROUP[group as MaterialGroup]?.includes(type)) throw Error('Loại tư liệu không thuộc nhóm đã chọn.');
  return { material_group: group, material_type: type, material_type_other: '' };
}

export function materialPublicationAction(status: string) {
  if (status === 'PUBLISHED') return 'PUBLISH' as const;
  if (status === 'PAUSED') return 'PAUSE_PUBLISH' as const;
  if (status === 'NOT_PUBLISHED') return 'UNPUBLISH' as const;
  throw Error('Tình trạng xuất bản không hợp lệ.');
}
