export interface GridGroup { key: string; label: string }
export interface GridGrouping {
  mode: string;
  resolve(row: Record<string, unknown>): GridGroup | GridGroup[];
  order: 'NEWEST_FIRST' | 'LABEL_ASC';
  initiallyCollapsed?: boolean;
  rowLabel?: string;
  pageKeys?: string[];
  ungrouped?(row: Record<string, unknown>): boolean;
  compareRows?(a: Record<string, unknown>, b: Record<string, unknown>): number;
}

export function uniqueGridRows<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

export function gridSections<T extends { id: string }>(rows: readonly T[], grouping: GridGrouping) {
  const groups = new Map<string, GridGroup & { rows: T[] }>();
  for (const row of uniqueGridRows(rows)) {
    if (grouping.ungrouped?.(row)) continue;
    const result = grouping.resolve(row);
    for (const group of new Map((Array.isArray(result) ? result : [result]).map(value => [value.key, value])).values()) {
      if (grouping.pageKeys && !grouping.pageKeys.includes(group.key)) continue;
      const section = groups.get(group.key);
      if (section) section.rows.push(row);
      else groups.set(group.key, { ...group, rows: [row] });
    }
  }
  return [...groups.values()].sort((a, b) => grouping.order === 'NEWEST_FIRST'
    ? b.key.localeCompare(a.key)
    : a.label.localeCompare(b.label, 'vi', { numeric: true }) || a.key.localeCompare(b.key));
}

/** One business row can occur in several groups. Never write conflicting pasted values silently. */
export function uniqueGridPatches<T extends { id: string; fields: Record<string, string> }>(patches: T[]): T[] {
  const result = new Map<string, T>();
  for (const patch of patches) {
    const prior = result.get(patch.id);
    if (!prior) result.set(patch.id, { ...patch, fields: { ...patch.fields } });
    else {
      for (const [key, value] of Object.entries(patch.fields)) {
        if (Object.hasOwn(prior.fields, key) && prior.fields[key] !== value)
          throw new Error('Cùng một tư liệu đang xuất hiện ở nhiều nhóm với giá trị dán khác nhau. Chỉ chọn một dòng của tư liệu đó để dán.');
        prior.fields[key] = value;
      }
    }
  }
  return [...result.values()];
}
