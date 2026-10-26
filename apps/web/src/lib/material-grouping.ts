import { parseMaterialCampaignRefs } from '@cpms/domain';
import { gridSections, type GridGrouping } from './grid-grouping';

export const MATERIAL_GROUP_MODES = [
  { value: 'NONE', label: 'Không gộp nhóm' },
  { value: 'CAMPAIGN', label: 'Theo Chiến dịch' },
  { value: 'MONTH', label: 'Theo Tháng' },
  { value: 'TYPE', label: 'Theo loại tư liệu' },
] as const;
export type MaterialGroupMode = typeof MATERIAL_GROUP_MODES[number]['value'];
export const defaultMaterialGroupMode = (embedded: boolean): MaterialGroupMode => embedded ? 'NONE' : 'CAMPAIGN';
export function readMaterialGroupMode(storage: Pick<Storage, 'getItem'>, key: string, embedded: boolean): MaterialGroupMode {
  const value = storage.getItem(key + ':grouping');
  return MATERIAL_GROUP_MODES.some(mode => mode.value === value) ? value as MaterialGroupMode : defaultMaterialGroupMode(embedded);
}
export function materialGrouping(mode: MaterialGroupMode): GridGrouping | undefined {
  if (mode === 'NONE') return undefined;
  return {
    mode, initiallyCollapsed: true, rowLabel: 'tư liệu', order: mode === 'MONTH' ? 'NEWEST_FIRST' : 'LABEL_ASC',
    ungrouped: row => !row.materialId,
    compareRows: (a, b) => String(b.material_update_date ?? '').localeCompare(String(a.material_update_date ?? '')) || String(a.id).localeCompare(String(b.id)),
    resolve: row => {
      // Keep the edited occurrence mounted until its Application Service command commits.
      row = (row.__groupingSource as Record<string, unknown> | undefined) ?? row;
      if (mode === 'MONTH') {
        const month = /^\d{4}-(0[1-9]|1[0-2])/.exec(String(row.material_update_date ?? ''))?.[0];
        return month ? { key: month, label: `Tháng ${month.slice(5)}/${month.slice(0, 4)}` } : { key: '0000-00', label: 'Chưa có ngày cập nhật' };
      }
      if (mode === 'TYPE') {
        const type = String(row.material_type === 'Khác' ? row.material_type_other || 'Khác' : row.material_type || '').trim();
        return { key: `type:${type.toLocaleLowerCase('vi')}`, label: type || 'Chưa có loại tư liệu' };
      }
      // Persisted `campaign` is a display label; linked identities live in `campaign_refs`.
      const refs = parseMaterialCampaignRefs(String(row.campaign_refs ?? row.campaign ?? ''));
      if (refs.length) return refs.map(ref => ({
        key: ref.kind === 'SYSTEM' ? `campaign:${ref.id}` : `custom:${ref.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')}`,
        label: ref.name,
      }));
      const legacy = String(row.campaign_name || '').trim();
      return { key: legacy ? `legacy:${legacy.toLocaleLowerCase('vi')}` : 'unassigned', label: legacy || 'Chưa gắn chiến dịch' };
    },
  };
}

/** Paginate groups before flattening; drafts stay available independently of collapsed groups. */
export function materialGroupPage<T extends { id: string; materialId?: unknown }>(rows: T[], grouping: GridGrouping, page: number, size: number) {
  const sections = gridSections(rows, grouping);
  const pages = Math.max(1, Math.ceil(sections.length / size)), currentPage = Math.min(Math.max(1, page), pages);
  const current = sections.slice((currentPage - 1) * size, currentPage * size);
  const ids = new Set(current.flatMap(section => section.rows.map(row => row.id)));
  return { pages, currentPage, totalGroups: sections.length, keys: current.map(section => section.key), rows: rows.filter(row => !row.materialId || ids.has(row.id)) };
}
