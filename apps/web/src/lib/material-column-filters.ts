import { MATERIAL_CAMPAIGN_DATE_COLUMNS, materialCampaignDates } from './material-campaign-dates';
import type { MaterialPortalBootstrap } from '@cpms/domain';
import { parseMaterialCampaignRefs, parseMaterialLanguages, type MaterialFieldKey } from '@cpms/domain';
import { columnValuesMatchFilter, type CampaignColumnFilterModel, type CampaignColumnFilterOption, type CampaignDateMonthOption } from './campaign-filters';
import { materialDisplayValue, type MaterialGridRow } from './material-grid';

export function materialColumnValues(row: MaterialGridRow, key: string, campaigns: MaterialPortalBootstrap['campaigns'] = []): string[] {
  const fields = row.fields;
  let values: string[];
  if (MATERIAL_CAMPAIGN_DATE_COLUMNS.some(column => column.key === key)) values = materialCampaignDates(fields, key, campaigns).map(item => item.date);
  else if (key === 'campaign') values = parseMaterialCampaignRefs(fields.campaign_refs).map(ref => ref.name);
  else if (key === 'material_languages') values = parseMaterialLanguages(fields.material_languages);
  else if (key === 'market_codes') values = String(fields.market_codes || '').split(/[,;\n]/);
  else {
    const value = key === 'record_version' ? String(row.recordVersion) : materialDisplayValue(fields, key as MaterialFieldKey);
    values = [value === '—' ? '' : value];
  }
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function applyMaterialColumnFilters(rows: readonly MaterialGridRow[], filters: CampaignColumnFilterModel, campaigns: MaterialPortalBootstrap['campaigns'] = []) {
  return rows.filter(row => !row.materialId || Object.entries(filters).every(([key, filter]) => columnValuesMatchFilter(materialColumnValues(row, key, campaigns), filter)));
}

/** Facets use the entire searched scope, before pagination, excluding their own filter. */
export function materialColumnFilterOptions(rows: readonly MaterialGridRow[], filters: CampaignColumnFilterModel, key: string, campaigns: MaterialPortalBootstrap['campaigns'] = []) {
  const otherFilters = Object.fromEntries(Object.entries(filters).filter(([field]) => field !== key));
  const counts = new Map<string, number>(), months = new Map<string, number>();
  let blankCount = 0, dateBlankCount = 0;
  for (const row of applyMaterialColumnFilters(rows, otherFilters, campaigns)) {
    if (!row.materialId) continue;
    const values = materialColumnValues(row, key, campaigns);
    if (!values.length) blankCount++;
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    const dateMonths = [...new Set(values.flatMap(value => /^\d{4}-\d{2}-\d{2}/.test(value) ? [value.slice(0, 7)] : []))];
    if (!dateMonths.length) dateBlankCount++;
    for (const month of dateMonths) months.set(month, (months.get(month) || 0) + 1);
  }
  const active = filters[key];
  if (active?.type === 'set') for (const value of active.values) if (!counts.has(value)) counts.set(value, 0);
  if (active?.type === 'date') for (const month of active.months) if (!months.has(month)) months.set(month, 0);
  return {
    valueOptions: { options: [...counts].map(([value, count]): CampaignColumnFilterOption => ({ value, label: value, count })).sort((a,b) => a.label.localeCompare(b.label, 'vi', { numeric: true })), blankCount },
    monthOptions: { options: [...months].map(([key, count]): CampaignDateMonthOption => ({ key, year: key.slice(0,4), month: key.slice(5,7), count })).sort((a,b) => b.key.localeCompare(a.key)), blankCount: dateBlankCount },
  };
}
