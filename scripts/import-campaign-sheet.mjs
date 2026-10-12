const [, , sheetInput, apiInput, confirmation] = process.argv;

if (!sheetInput) {
  console.error('Usage: node scripts/import-campaign-sheet.mjs <google-sheet-url-or-id> [api-base-url] [--confirm]');
  process.exit(1);
}

const idMatch = sheetInput.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
const spreadsheetId = idMatch?.[1] ?? sheetInput.trim();
const apiBaseUrl = (apiInput || 'http://localhost:3000/api').replace(/\/$/, '');
const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;

async function jsonRequest(path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message || `HTTP ${response.status}`);
  return payload;
}

const csvResponse = await fetch(csvUrl);
if (!csvResponse.ok) throw new Error(`Cannot download Campaign sheet: HTTP ${csvResponse.status}`);
const csv = await csvResponse.text();
const file = { fileName: `google-sheet-${spreadsheetId}.csv`, mimeType: 'text/csv', contentBase64: Buffer.from(csv, 'utf8').toString('base64') };
const inspected = await jsonRequest('/campaigns/spreadsheet/inspect', file);
const sheetName = inspected.sheets[0]?.name;
if (!sheetName) throw new Error('Spreadsheet does not contain a readable sheet.');
const preview = await jsonRequest('/campaigns/spreadsheet/preview', { ...file, sheetName });

console.log(`Campaign sheet preview: ${preview.rows.length} dòng.`);
for (const [status, count] of Object.entries(preview.counts)) console.log(`  ${status}: ${count}`);
for (const row of preview.rows.filter((item) => item.errors.length)) console.warn(`Dòng ${row.rowNumber}: ${row.errors.join(' ')}`);

if (confirmation !== '--confirm') {
  console.log('Không ghi dữ liệu. Chạy lại với tham số --confirm sau khi kiểm tra preview.');
  process.exit(0);
}

const selectedFieldKeys = [...new Set(preview.mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []))];
const selectedRows = preview.rows.filter((row) => row.status === 'CREATE' || row.status === 'UPDATE').map((row) => row.rowNumber);
const decisions = preview.rows.map((row) => ({
  rowNumber: row.rowNumber,
  action: row.status === 'CREATE' ? 'CREATE' : row.status === 'UPDATE' ? 'UPDATE' : 'SKIP',
  selectedFieldKeys,
  ...(row.expectedVersion ? { expectedVersion: row.expectedVersion } : {}),
}));
const result = await jsonRequest('/campaigns/spreadsheet/import', { ...file, sheetName, mapping: preview.mapping, selectedRows, selectedFieldKeys, decisions });
console.log(`Campaign sheet import: thành công ${result.succeeded}/${result.processed}; lỗi ${result.failed}.`);
for (const item of result.items.filter((candidate) => !candidate.ok)) console.error(`${item.clientKey}: ${item.message || 'Không rõ lỗi'}`);
if (result.failed) process.exitCode = 1;
