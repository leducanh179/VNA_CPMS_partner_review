export const GRID_ROW_CLIPBOARD_TYPE = 'application/x-cpms-grid-rows';
export interface GridRowClipboard { scope: string; text: string; rows: Array<Record<string, string>> }
let copiedRows: GridRowClipboard | null = null;
const normalize = (text: string) => text.replace(/\r\n/g, '\n');
export function clearGridRows(): void { copiedRows = null; }

/** Keep typed row values alongside the plain text accepted by other spreadsheets. */
export function rememberGridRows(value: GridRowClipboard): string {
  if (value.rows.length > 50) throw new Error('Mỗi lần sao chép tối đa 50 dòng.');
  copiedRows = structuredClone(value);
  return JSON.stringify(copiedRows);
}

export function readGridRows(text: string, scope: string, encoded = ''): GridRowClipboard['rows'] | null {
  let value: unknown = copiedRows;
  if (encoded) { try { value = JSON.parse(encoded); } catch { return null; } }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as GridRowClipboard;
  if (candidate.scope !== scope || typeof candidate.text !== 'string' || normalize(candidate.text) !== normalize(text) || !Array.isArray(candidate.rows)) return null;
  if (!candidate.rows.length || candidate.rows.length > 50 || candidate.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(cell => typeof cell !== 'string'))) return null;
  return structuredClone(candidate.rows);
}
