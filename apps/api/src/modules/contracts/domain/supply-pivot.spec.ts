import { describe, expect, it } from 'vitest';
import { bookingExactSum, supplyPivotPreset, type BookingView, type SupplyAnalyticsQuery, type SupplyPivotDefinition } from '@cpms/domain';
import { buildSupplyAnalytics } from './supply-analytics';
import { buildSupplyPivot } from './supply-pivot';
import { normalizeSupplySource } from './source-import';
import { syntheticSource, syntheticSupplyCatalogs } from './supply-fixtures';
import { saveSupplyPivotView, supplyPivotDefinition } from '../application/supply-pivot.commands';

const at = '2026-09-14T03:00:00Z';
const query: SupplyAnalyticsQuery = { period: 'CURRENT', stage: 'booked', grain: 'MONTH', mode: 'CONTIGUOUS', slotIds: [], beneficiary: 'ALL', keys: [] };
const definition = (preset: 'SLOT' | 'UNIT' | 'TIME' = 'SLOT', patch: Partial<SupplyAnalyticsQuery> = {}): SupplyPivotDefinition => ({ version: 1, query: { ...query, ...patch }, layout: supplyPivotPreset(preset) });
const aggregate = () => normalizeSupplySource(syntheticSource(), syntheticSupplyCatalogs).aggregate;
const booking = (a: ReturnType<typeof aggregate>): BookingView => ({ id: 'B', allocationId: a.allocations[0]!.id, contractId: a.contract.id, slotId: a.slots[0]!.id, unit: 'CPM', unitPrice: '100', priceBasis: '1', taxRate: '0.08', amount: '1000', vat: '80', gross: '1080', campaignId: null, campaignLabel: 'Synthetic', startDate: '2026-09-10', endDate: '2026-09-20', quantity: '10', materialId: null, materialUrl: null, note: '', state: 'ACTIVE', deletedAt: null, vendorConfirmedQty: '6', sourceApprovedQty: '3', acceptedQty: '2', reportState: 'ACCEPTED', reportTemplateId: null, reportData: {}, sourceKey: null, source: {}, recordVersion: 1, createdByActorId: 'A', createdAt: at, updatedAt: at });

describe('Contract Pivot curated projection', () => {
  it('preserves effective quantities once per entitlement even with multiple bookings', () => {
    const a = aggregate(), before = structuredClone(a), b = booking(a);
    const result = buildSupplyPivot(a, [b, { ...b, id: 'B2' }], definition(), at);
    expect(result.sections[0]!.total.total).toEqual({ total: '50', used: '20', remaining: '30', usedPercent: '40', remainingPercent: '60' });
    expect(a).toEqual(before);
  });
  it('recalculates unit/group percentages rather than averaging child percentages', () => {
    const a = aggregate(), result = buildSupplyPivot(a, [booking(a)], definition('UNIT'), at);
    expect(result.sections[0]!.rows[0]!.total.usedPercent).toBe('33.3333');
    expect(result.sections[0]!.rows[1]!.total.usedPercent).toBe('0');
    expect(result.sections[0]!.total.total.usedPercent).toBe('20');
    expect(result.sections[0]!.rows[0]!.children[0]!.total.total).toBe('30');
  });
  it('conserves daily quantities exactly when beneficiary moves between filter and axis', () => {
    const a = aggregate(), d = definition('TIME', { grain: 'DAY', mode: 'DISCRETE', keys: ['2026-09-10', '2026-09-12'] });
    d.layout.rows = ['beneficiary', 'slot']; d.layout.filters = ['period'];
    const pivot = buildSupplyPivot(a, [booking(a)], d, at), base = buildSupplyAnalytics(a, [booking(a)], d.query, at);
    for (const bucket of base.buckets) expect(pivot.sections[0]!.total.cells[bucket.key]!.total).toBe(bucket.timeTotal);
    expect(pivot.columns.map(c => c.id)).toEqual(['2026-09-10', '2026-09-12']);
    expect(pivot.sections[0]!.total.total.total).toBe(base.summaries[0]!.selectedTotal);
    expect(pivot.sections[0]!.total.total.used).toBe(base.summaries[0]!.usedSelected);
  });
  it('uses the same selected time denominator with or without a time axis and deduplicates keys', () => {
    const a = aggregate(), patch = { mode: 'DISCRETE' as const, keys: ['2026-09-01', '2026-01-01', '2026-09-01'] };
    const slot = buildSupplyPivot(a, [booking(a)], definition('SLOT', patch), at), time = buildSupplyPivot(a, [booking(a)], definition('TIME', patch), at);
    expect(slot.sections[0]!.total.total).toEqual(time.sections[0]!.total.total);
    expect(time.columns).toHaveLength(2);
    expect(bookingExactSum(Object.values(time.sections[0]!.total.cells).map(c => c.total!))).toBe(slot.sections[0]!.total.total.total);
  });
  it('keeps separate units and unknown unit slots out of misleading grand totals', () => {
    const a = aggregate(); a.slots.push({ ...a.slots[0]!, id: 'second', unit: 'Gói', quantityUnit: 'Gói' });
    a.allocations.push({ ...a.allocations[0]!, id: 'second-allocation', slotId: 'second', baselineQty: '8' });
    const result = buildSupplyPivot(a, [], definition(), at);
    expect(result.sections).toHaveLength(2); expect(result.sections.map(s => s.total.total.total)).toEqual(['50', '8']);
    a.slots.forEach(s => { s.quantityUnit = null; s.unit = null; });
    expect(buildSupplyPivot(a, [], definition(), at).sections).toHaveLength(2);
  });
  it('does not manufacture percentages for zero or unknown quota, and retains negative balances', () => {
    const a = aggregate(); a.adjustments = []; a.allocations.forEach(x => { x.baselineQty = '0'; });
    const result = buildSupplyPivot(a, [booking(a)], definition(), at);
    expect(result.sections[0]!.total.total).toMatchObject({ total: '0', used: '10', remaining: '-10', usedPercent: null });
    a.allocations[0]!.baselineQty = null;
    expect(buildSupplyPivot(a, [], definition(), at).sections[0]!.total.total).toMatchObject({ total: null, remaining: null, usedPercent: null });
  });
  it('keeps overlapping usage stages separate and uses booking by default', () => {
    const a = aggregate();
    for (const [stage, used] of [['booked', '10'], ['vendorConfirmed', '6'], ['approved', '3'], ['accepted', '2']] as const) expect(buildSupplyPivot(a, [booking(a)], definition('SLOT', { stage }), at).sections[0]!.total.total.used).toBe(used);
    expect(supplyPivotDefinition.parse({ ...definition(), query: {} }).query.stage).toBe('booked');
  });
  it('sorts rows by aggregated values, resolves current periods anew, and rejects excessive columns', () => {
    const a = aggregate(), d = definition('UNIT'); d.layout.sort = { field: 'total', direction: 'asc' };
    expect(buildSupplyPivot(a, [], d, at).sections[0]!.rows.map(r => r.total.total)).toEqual(['20', '30']);
    expect(buildSupplyPivot(a, [], d, '2028-01-01T00:00:00Z').sections).toEqual([]);
    expect(() => buildSupplyPivot(a, [], definition('TIME', { grain: 'DAY' }), at)).toThrow('120');
  });
  it('rejects duplicate/missing dimensions, mixed field kinds, invalid layout and unversioned saves', () => {
    const d = definition();
    expect(supplyPivotDefinition.safeParse({ ...d, layout: { ...d.layout, columns: ['slot'] } }).success).toBe(false);
    expect(supplyPivotDefinition.safeParse({ ...d, layout: { ...d.layout, values: ['total', 'total'] } }).success).toBe(false);
    expect(supplyPivotDefinition.safeParse({ ...d, layout: { ...d.layout, rows: [] } }).success).toBe(false);
    expect(supplyPivotDefinition.safeParse({ ...d, layout: { ...d.layout, rows: ['total'] } }).success).toBe(false);
    expect(saveSupplyPivotView.safeParse({ id: '00000000-0000-4000-8000-000000000099', name: 'View', definition: d, isDefault: false }).success).toBe(false);
    expect(supplyPivotDefinition.safeParse({ ...d, query: { ...query, mode: 'DISCRETE', from: '2026-01-01', keys: ['2026-01-01'] } }).success).toBe(false);
  });
  it('orders time rows chronologically across years instead of sorting month labels alphabetically', () => {
    const a = aggregate(); a.allocations[2]!.status = 'APPROVED';
    const d = definition('SLOT', { period: 'ALL', mode: 'DISCRETE', keys: ['2027-01-01', '2026-12-01'] });
    d.layout.rows = ['time', 'slot']; d.layout.filters = ['beneficiary', 'period'];
    expect(buildSupplyPivot(a, [], d, at).sections[0]!.rows.map(r => r.label)).toEqual(['Tháng 12/2026', 'Tháng 01/2027']);
  });
});
