import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleApiAdapter } from './google-api.adapter';
import { googleEgress } from './google-egress';

beforeEach(() => { googleEgress.reset(); vi.useFakeTimers(); });
afterEach(() => { googleEgress.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function complete<T>(promise: Promise<T>) { await vi.runAllTimersAsync(); return promise; }

function source(rows: unknown[][], allocatedRows = rows.length, failStart?: number) {
  const ranges: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
    const url = new URL(raw);
    if (url.hostname === 'www.googleapis.com') return Response.json({ capabilities: { canEdit: false } });
    if (!url.pathname.includes('/values/')) return Response.json({ spreadsheetId: 'fixture-sheet',
      sheets: [{ properties: { sheetId: 1, title: 'DriveIndex', gridProperties: { rowCount: allocatedRows, columnCount: 27 } } }] });
    const range = decodeURIComponent(url.pathname.split('/values/')[1]!); ranges.push(range);
    const match = range.match(/!A(\d+):(?:AA|CV)(\d+)/)!;
    const start = Number(match[1]), end = Number(match[2]);
    if (start === failStart) return Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 });
    const values = rows.slice(start - 1, end);
    while (values.length && !values.at(-1)!.length) values.pop();
    return Response.json({ values });
  }));
  return ranges;
}

describe('bounded library Sheets reads', () => {
  it('reads beyond 1000 rows, preserves blank pages and row positions, trims allocated trailing blanks', async () => {
    const rows = Array.from({ length: 2423 }, (_, i) => i >= 500 && i < 1000 ? [] : [`row-${i + 1}`]);
    const ranges = source(rows, 4391);
    const result = await complete(new GoogleApiAdapter().readTab('token', 'fixture-sheet', 'DriveIndex', { purpose: 'AI_LIBRARY' }));
    expect(result.rows).toEqual(rows);
    expect(ranges).toHaveLength(9);
    expect(ranges[1]).toBe("'DriveIndex'!A501:AA1000");
    expect(ranges.at(-1)).toBe("'DriveIndex'!A4001:AA4391");
  });
  it('rejects an oversized library instead of silently replacing with a partial index', async () => {
    source(Array.from({ length: 10002 }, (_, i) => [`row-${i}`]));
    const check = expect(new GoogleApiAdapter().readTab('token', 'fixture-sheet', 'DriveIndex', { purpose: 'AI_LIBRARY' })).rejects.toThrow('10.000');
    await complete(check);
  });
  it('rejects any failed page rather than returning earlier rows', async () => {
    source(Array.from({ length: 1002 }, () => ['row']), 1002, 501);
    const check = expect(new GoogleApiAdapter().readTab('token', 'fixture-sheet', 'DriveIndex', { purpose: 'AI_LIBRARY' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await complete(check);
  });
  it('retains the original small-import limit outside the library reader', async () => {
    source(Array.from({ length: 1100 }, () => ['row']));
    const check = expect(new GoogleApiAdapter().readTab('token', 'fixture-sheet', 'DriveIndex')).rejects.toThrow('1000');
    await complete(check);
  });
  it('distinguishes a disabled Sheets API without returning provider secrets or error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'private provider details', details: [
      { reason: 'SERVICE_DISABLED', metadata: { service: 'sheets.googleapis.com' } },
    ] } }, { status: 403 })));
    const check = expect(new GoogleApiAdapter().metadata('token', 'fixture-sheet')).rejects.toThrow('Google Sheets API chưa được bật');
    await complete(check);
  });
});
