import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ExcelJsSpreadsheetAdapter } from './exceljs-spreadsheet.adapter';

describe('ExcelJsSpreadsheetAdapter', () => {
  it('preserves physical row and column positions when a source has blank title spacers', async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet('Synthetic personnel');
    sheet.getCell('A1').value = 'Title';
    sheet.getCell('B5').value = 'Employee code';
    sheet.getCell('N5').value = 'Source';
    sheet.getCell('B6').value = '001';
    sheet.getCell('B7').value = '002';
    sheet.getCell('N7').value = 'Last row must survive';
    const content = new Uint8Array(await source.xlsx.writeBuffer());
    const result = await new ExcelJsSpreadsheetAdapter().read({ fileName: 'synthetic.xlsx', content });
    expect(result.sheets[0]?.rows).toHaveLength(7);
    expect(result.sheets[0]?.rows[4]?.[1]).toBe('Employee code');
    expect(result.sheets[0]?.rows[6]?.[1]).toBe('002');
    expect(result.sheets[0]?.rows[6]?.[13]).toBe('Last row must survive');
  });

  it('writes a real XLSX workbook and reads canonical Campaign rows back', async () => {
    const adapter = new ExcelJsSpreadsheetAdapter();
    const content = await adapter.write({ sheets: [
      { name: 'Hướng dẫn', rows: [['Tiêu đề', 'Hướng dẫn'], ['Ngày', 'YYYY-MM-DD']] },
      { name: 'Campaigns', rows: [
        ['Mã chiến dịch', 'Tên chiến dịch', 'Mã thị trường (mảng JSON)'],
        ['campaign_code', 'campaign_name', 'market_codes'],
        ['CPG-202609-XLSX', 'Round trip XLSX', '["VN","US"]'],
      ] },
    ] });
    expect(Buffer.from(content).subarray(0, 2).toString()).toBe('PK');
    const workbook = await adapter.read({ fileName: 'campaigns.xlsx', content });
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Hướng dẫn', 'Campaigns']);
    expect(workbook.sheets[1]?.rows[2]).toEqual(['CPG-202609-XLSX', 'Round trip XLSX', '["VN","US"]']);
  });

  it('reads RFC-style quoted CSV values', async () => {
    const adapter = new ExcelJsSpreadsheetAdapter();
    const content = new TextEncoder().encode('campaign_code,campaign_name\r\nCPG-01,"Tên, có dấu phẩy"');
    const workbook = await adapter.read({ fileName: 'campaigns.csv', content });
    expect(workbook.sheets[0]?.rows[1]).toEqual(['CPG-01', 'Tên, có dấu phẩy']);
  });
});
