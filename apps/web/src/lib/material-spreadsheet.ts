import { MATERIAL_CAMPAIGN_DATE_COLUMNS, materialCampaignDateProjection } from './material-campaign-dates';
import { MATERIAL_GROUPS, MATERIAL_LANGUAGES, MATERIAL_TYPES_BY_GROUP, parseMaterialCampaignRefs, type MaterialFields, type MaterialPortalBootstrap } from '@cpms/domain';
import { DEFAULT_MATERIAL_COLUMNS, MATERIAL_COLUMNS, materialDisplayValue, type MaterialGridRow } from './material-grid';
import { materialGridPreferenceKeys } from './material-grid-preferences';
import { materialDescription, plainRichText } from './material-form';
import type { SupplyColumnLayout } from '../components/supply-column-chooser';

export const MATERIAL_CONTENT_KEYS = ['material_update_date', 'campaign_refs', 'material_group', 'material_type', 'material_type_other', 'material_languages', 'material_name', 'material_description_rich_text', 'material_link', 'market_codes', 'note'] as const;
export const MATERIAL_SHEET_COLUMNS = [...MATERIAL_COLUMNS, ...MATERIAL_CAMPAIGN_DATE_COLUMNS, { key: 'material_type_other' as const, label: 'Loại khác', width: '14rem', editable: true }];
export const materialFieldKey = (key: string) => key === 'campaign' ? 'campaign_refs' : key;
export function materialContent(fields: MaterialFields): Record<string, string> {
  return Object.fromEntries(MATERIAL_CONTENT_KEYS.map(key => [key, String(fields[key] ?? '')]));
}
export function materialSheetRow(row: MaterialGridRow, position: number, campaigns: MaterialPortalBootstrap['campaigns'] = []) {
  return { ...row.fields, ...materialCampaignDateProjection(row.fields, campaigns), id: row.clientKey, materialId: row.materialId, recordVersion: row.recordVersion, sortOrder: position,
    __groupingSource: { ...row.fields, material_update_date: materialDisplayValue(row.fields, 'material_update_date').replace(/^—$/, '') },
    baselineFields: row.baselineFields, isDeleted: row.isDeleted, campaign: row.fields.campaign_refs || '',
    material_group: row.fields.material_group || materialDisplayValue(row.fields, 'material_group').replace(/^—$/, ''),
    material_update_date: materialDisplayValue(row.fields, 'material_update_date').replace(/^—$/, ''),
    material_description_rich_text: JSON.stringify(materialDescription(row.fields)),
  };
}
export function materialSheetPatch(patch: Record<string, string>): MaterialFields {
  return Object.fromEntries(Object.entries(patch).flatMap(([key, value]) => {
    const field = materialFieldKey(key);
    return (MATERIAL_CONTENT_KEYS as readonly string[]).includes(field) ? [[field, value]] : [];
  })) as MaterialFields;
}
/** Keep dependent input in the private draft until the operator completes it. */
export function normalizeMaterialSheetPatch(row: Record<string, unknown>, patch: Record<string, string>) {
  const next = { ...patch };
  if (Object.hasOwn(next, 'campaign_refs')) { next.campaign = next.campaign_refs!; delete next.campaign_refs; }
  if (Object.hasOwn(next, 'material_group') && next.material_group !== row.material_group) {
    const group = next.material_group as keyof typeof MATERIAL_TYPES_BY_GROUP;
    const type = next.material_type ?? String(row.material_type ?? '');
    if (!MATERIAL_TYPES_BY_GROUP[group]?.includes(type)) { next.material_type = ''; next.material_type_other = ''; }
  }
  if (Object.hasOwn(next, 'material_type') && next.material_type !== 'Khác') next.material_type_other = '';
  return next;
}
export function materialDraftReason(fields: MaterialFields, existing: boolean): string | null {
  if (!existing || fields.material_link) {
    try { if (!['http:', 'https:'].includes(new URL(fields.material_link || '').protocol)) throw Error(); }
    catch { return 'Bản nhập dở: bổ sung Link tư liệu http/https để lưu record.'; }
  }
  if ((fields.material_group === 'Khác' || fields.material_type === 'Khác') && !fields.material_type_other?.trim()) return 'Bản nhập dở: nhập Loại khác.';
  return null;
}
export function materialClipboardValue(key: string, value: string, bootstrap: MaterialPortalBootstrap): string {
  if (key === 'material_update_date') {
    if (!value) return '';
    const match = value.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    const date = match ? `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}` : value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
      throw Error('Ngày không hợp lệ. Dùng dd/MM/yyyy hoặc yyyy-MM-dd.');
    return date;
  }
  if (key === 'campaign') {
    try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && parseMaterialCampaignRefs(value).length === parsed.length) return value; } catch { /* labels below */ }
    const refs = value.split(/[;\n]/).map(text => text.trim()).filter(Boolean).map(text => {
      const options = bootstrap.campaigns.filter(option => [option.campaign_id, option.campaign_code, option.campaign_name].includes(text));
      if (options.length !== 1) throw Error(`Không xác định được Chiến dịch “${text}”. Chọn từ danh sách hoặc Khác.`);
      return { kind: 'SYSTEM', id: options[0]!.campaign_id, name: options[0]!.campaign_name };
    });
    return JSON.stringify(refs);
  }
  if (key === 'material_languages') {
    let values: unknown;
    try { values = JSON.parse(value); } catch { values = value.split(/[;,\n]/).map(text => text.trim()).filter(Boolean); }
    if (!Array.isArray(values) || values.some(item => !(MATERIAL_LANGUAGES as readonly unknown[]).includes(item))) throw Error('Ngôn ngữ không hợp lệ. Chọn các ngôn ngữ trong danh sách.');
    return JSON.stringify([...new Set(values)]);
  }
  if (key === 'material_description_rich_text') {
    try { const parsed = JSON.parse(value); if (parsed?.type === 'doc') return value; } catch { /* plain text */ }
    return JSON.stringify(plainRichText(value));
  }
  if (key === 'material_group' && value && !(MATERIAL_GROUPS as readonly string[]).includes(value)) throw Error('Nhóm tư liệu không hợp lệ.');
  return value;
}
export function materialLayoutKey(actor: string, campaignId: string, embedded: boolean) {
  return `cpms-material-sheet-v1:${encodeURIComponent(actor)}:${embedded ? 'embedded' : 'portal'}:${encodeURIComponent(campaignId || 'all')}`;
}
export function defaultMaterialLayout(embedded = false): SupplyColumnLayout {
  const known = MATERIAL_SHEET_COLUMNS.map(column => column.key as string);
  const defaults: readonly string[] = [...DEFAULT_MATERIAL_COLUMNS, ...MATERIAL_CAMPAIGN_DATE_COLUMNS.map(column => column.key)];
  return {
    order: [...defaults, ...known.filter(key => !defaults.includes(key))],
    hidden: known.filter(key => (embedded && key === 'campaign') || !defaults.includes(key)),
    pinned: embedded ? ['material_update_date', 'material_name'] : ['material_update_date', 'campaign', 'material_name'],
    widths: { material_update_date: 180, campaign: 240, material_name: 300 }, pinningVersion: 1,
  };
}
/** One-time migration, retaining deliberate Material pins (unlike legacy Plan defaults). */
export function migrateMaterialLayout(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, actor: string, campaignId: string, embedded: boolean): SupplyColumnLayout {
  const known = MATERIAL_SHEET_COLUMNS.map(column => column.key as string);
  const read = (name: string, fallback: unknown) => { try { return JSON.parse(storage.getItem(name) || 'null') ?? fallback; } catch { return fallback; } };
  const embeddedDefaultKey = `${key}:hide-campaign-default-v2`;
  const withEmbeddedDefault = (layout: SupplyColumnLayout): SupplyColumnLayout => {
    if (!embedded || storage.getItem(embeddedDefaultKey) === '1') return layout;
    const next = layout.hidden.includes('campaign') ? layout : {
      ...layout,
      hidden: [...layout.hidden, 'campaign'],
      pinned: layout.pinned.filter(field => field !== 'campaign'),
    };
    if (next !== layout) storage.setItem(key, JSON.stringify(next));
    storage.setItem(embeddedDefaultKey, '1');
    return next;
  };
  const saved = read(key, null) as SupplyColumnLayout | null;
  if (saved) {
    // Newly introduced reference columns appear once; later user choices remain untouched.
    const added = MATERIAL_CAMPAIGN_DATE_COLUMNS.map(column => column.key).filter(field => !saved.order.includes(field));
    if (added.length) { saved.order = [...saved.order, ...added]; storage.setItem(key, JSON.stringify(saved)); }
    return withEmbeddedDefault(saved);
  }
  const legacy = materialGridPreferenceKeys(embedded ? { actorId: actor, campaignId } : undefined);
  if (![legacy.columns, legacy.pinned, legacy.widths].some(name => storage.getItem(name) !== null)) {
    const initial = defaultMaterialLayout(embedded);
    storage.setItem(key, JSON.stringify(initial));
    return withEmbeddedDefault(initial);
  }
  const selected = read(legacy.columns, DEFAULT_MATERIAL_COLUMNS);
  const order = Array.isArray(selected) ? [...new Set(selected.filter((value): value is string => typeof value === 'string' && known.includes(value)))] : [...DEFAULT_MATERIAL_COLUMNS];
  if (!order.length) order.push(...DEFAULT_MATERIAL_COLUMNS);
  const oldPins = read(legacy.pinned, []);
  const pinned = Array.isArray(oldPins) ? oldPins.filter((value): value is string => typeof value === 'string' && order.includes(value)).slice(0, 3) : [];
  const widths = read(legacy.widths, {});
  const layout: SupplyColumnLayout = { order: [...pinned, ...order.filter(value => !pinned.includes(value)), ...known.filter(value => !order.includes(value))],
    hidden: known.filter(value => !order.includes(value)), pinned, pinningVersion: 1,
    widths: Object.fromEntries(Object.entries(widths && typeof widths === 'object' ? widths : {}).flatMap(([field, width]) => known.includes(field) && typeof width === 'number' && width >= 90 && width <= 800 ? [[field, width]] : [])),
  };
  storage.setItem(key, JSON.stringify(layout));
  return withEmbeddedDefault(layout);
}
