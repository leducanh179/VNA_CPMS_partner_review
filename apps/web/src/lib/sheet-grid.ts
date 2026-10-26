export function sheetColumnAddress(index: number): string {
  let value = index + 1, result = '';
  while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
export function sheetCellAddress(row: number, column: number): string { return `${sheetColumnAddress(column)}${row + 1}`; }
export function parseSheetAddress(value: string): { row: number; column: number } | null {
  const match = value.trim().toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  let column = 0; for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
export function compareSheetValues(left: string, right: string, type: string | undefined, descending: boolean): number {
  if (!left.trim()) return right.trim() ? 1 : 0;
  if (!right.trim()) return -1;
  const numeric = type === 'number' ? Number(left.replace(/\s/g, '').replace(',', '.')) - Number(right.replace(/\s/g, '').replace(',', '.')) : NaN;
  const comparison = Number.isFinite(numeric) ? numeric : left.localeCompare(right, 'vi', { numeric: true, sensitivity: 'base' });
  return comparison * (descending ? -1 : 1);
}
export function sheetSortLabel(type: string | undefined, descending: boolean): string {
  return type === 'date' ? descending ? 'Mới tới cũ' : 'Cũ tới mới' : type === 'number' ? descending ? 'Lớn tới nhỏ' : 'Nhỏ tới lớn' : descending ? 'Z tới A' : 'A tới Z';
}
export function sheetInsertionRange(indices: number[], fallback: number): { first: number; last: number; count: number } {
  const selected = [...new Set(indices.filter(index => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b);
  return { first: selected[0] ?? fallback, last: selected.at(-1) ?? fallback, count: selected.length || 1 };
}
export function sheetSavePosition(position: number, unsavedPositions: number[]): number {
  return position - unsavedPositions.filter(value => value < position).length;
}
export function isRemovedSheetBlank(row: Record<string, unknown>, removed: number[]): boolean {
  return Boolean(row.__sheetBlank) && removed.includes(Number(row.sortOrder));
}
/** Match sheet row addresses when locally removed virtual blanks precede a real item. */
export function sheetRecordRowNumber(position:number, occupied:number[], removed:number[]):number {
  return position-new Set(removed.filter(value=>value<position&&!occupied.includes(value))).size;
}
