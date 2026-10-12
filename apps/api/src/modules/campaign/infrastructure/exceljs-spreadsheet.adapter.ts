import type { SpreadsheetDocumentPort, TabularWorkbookData } from '@cpms/integrations';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

function parseCsv(source: string) {
  const rows: Array<Array<string | number | boolean | null>> = [];
  let row: Array<string | number | boolean | null> = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function cellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if ('result' in value && value.result !== undefined) return cellValue(value.result as ExcelJS.CellValue);
  if ('text' in value) return value.text;
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  return String(value);
}

@Injectable()
export class ExcelJsSpreadsheetAdapter implements SpreadsheetDocumentPort {
  async read(input: { fileName: string; content: Uint8Array }): Promise<TabularWorkbookData> {
    if (input.fileName.toLocaleLowerCase().endsWith('.csv')) {
      return { sheets: [{ name: 'Campaigns', rows: parseCsv(new TextDecoder('utf-8').decode(input.content)) }] };
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(input.content as never);
    return {
      sheets: workbook.worksheets.map((sheet) => ({
        name: sheet.name,
        rows: Array.from({ length: sheet.rowCount }, (_, rowIndex) => {
          const row = sheet.getRow(rowIndex + 1);
          return Array.from({ length: Math.max(sheet.columnCount, row.cellCount) }, (_, columnIndex) => cellValue(row.getCell(columnIndex + 1).value));
        }),
      })),
    };
  }

  async write(input: TabularWorkbookData): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CPMS';
    workbook.created = new Date();
    workbook.properties.date1904 = false;
    for (const source of input.sheets) {
      const sheet = workbook.addWorksheet(source.name, { views: [{ state: 'frozen', ySplit: source.name === 'Campaigns' ? 2 : 1 }] });
      source.rows.forEach((values) => sheet.addRow(values));
      const header = sheet.getRow(1);
      header.height = 28;
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF005B75' } };
      header.alignment = { vertical: 'middle', wrapText: true };
      if (source.name === 'Campaigns' && sheet.rowCount >= 2) {
        const keys = sheet.getRow(2);
        keys.hidden = true;
        keys.font = { italic: true, color: { argb: 'FF64748B' } };
        keys.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6F8' } };
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, sheet.columnCount) } };
      }
      sheet.columns.forEach((column) => {
        let maximum = 12;
        column.eachCell?.({ includeEmpty: false }, (cell) => { maximum = Math.max(maximum, Math.min(48, String(cell.value ?? '').length + 2)); });
        column.width = maximum;
      });
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > (source.name === 'Campaigns' ? 2 : 1)) {
          row.alignment = { vertical: 'top', wrapText: true };
          row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5E8' } } }; });
        }
      });
    }
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }
}
