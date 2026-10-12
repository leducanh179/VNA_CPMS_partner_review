import { describe, expect, it } from 'vitest';
import { bookingExactSum, supplyTimeEnd, supplyTimeKey, supplyTimeOptions, type BookingView, type SupplyAggregate, type SupplyAnalyticsQuery } from '@cpms/domain';
import { buildSupplyAnalytics, supplyPercent } from './supply-analytics';
import { normalizeSupplySource } from './source-import';
import { syntheticSource, syntheticSupplyCatalogs } from './supply-fixtures';
import { supplyAnalyticsQuery } from '../application/supply-analytics.query';

const query: SupplyAnalyticsQuery = { period: 'CURRENT', stage: 'booked', grain: 'MONTH', mode: 'CONTIGUOUS', slotIds: [], beneficiary: 'ALL', keys: [] };
const at = '2026-09-12T03:00:00Z';
const aggregate = () => normalizeSupplySource(syntheticSource(), syntheticSupplyCatalogs).aggregate;
function booking(a: SupplyAggregate, patch: Partial<BookingView> = {}): BookingView {
  return { id: 'B1', allocationId: a.allocations[0]!.id, contractId: a.contract.id, slotId: a.slots[0]!.id, unit: 'Click', unitPrice: '100', priceBasis: '1', taxRate: '0.08', amount: '1000', vat: '80', gross: '1080', campaignId: null, campaignLabel: 'Synthetic', startDate: '2026-09-10', endDate: '2026-09-20', quantity: '10', materialId: null, materialUrl: null, note: '', state: 'ACTIVE', deletedAt: null, vendorConfirmedQty: '6', sourceApprovedQty: '3', acceptedQty: '2', reportState: 'ACCEPTED', reportTemplateId: null, reportData: {}, sourceKey: null, source: {}, recordVersion: 1, createdByActorId: 'A', createdAt: at, updatedAt: at, ...patch };
}
describe('Contract analytics from saved operations', () => {
  it('compares all three bars within the same bucket, with unclamped ratios and separate period balance', () => {
    const a = aggregate();
    a.contract.startDate = '2026-09-01'; a.slots[0]!.startDate = '2026-09-01'; a.slots[0]!.endDate = '2026-09-02';
    const b = booking(a, { startDate: '2026-09-01', endDate: '2026-09-01', quantity: '30' });
    const result = buildSupplyAnalytics(a, [b], { ...query, grain: 'DAY' }, at);
    expect(result.buckets[0]).toMatchObject({ timeTotal: '25', used: '30', timeRemaining: '-5', timeUsedPercent: '120', timeRemainingPercent: '-20', remaining: '20' });
    expect(result.buckets[1]).toMatchObject({ timeTotal: '25', used: '0', timeRemaining: '25', timeUsedPercent: '0', timeRemainingPercent: '100' });
    expect(result.summaries[0]).toMatchObject({ total: '50', used: '30', remaining: '20', selectedTotal: '50', selectedRemaining: '20', selectedUsedPercent: '60', selectedRemainingPercent: '40' });
    const subset = buildSupplyAnalytics(a, [b], { ...query, grain: 'DAY', mode: 'DISCRETE', keys: ['2026-09-02'] }, at);
    expect(subset.summaries[0]).toMatchObject({ remaining: '20', selectedTotal: '25', usedSelected: '0', selectedRemaining: '25', selectedRemainingPercent: '100' });
    a.allocations.forEach(allocation => { allocation.baselineQty = '0'; }); a.adjustments = [];
    expect(buildSupplyAnalytics(a, [], { ...query, grain: 'DAY' }, at).buckets[0]).toMatchObject({ timeTotal: '0', timeRemaining: '0', timeUsedPercent: null, timeRemainingPercent: null });
    a.allocations[0]!.baselineQty = null;
    expect(buildSupplyAnalytics(a, [], { ...query, grain: 'DAY' }, at).buckets[0]).toMatchObject({ timeTotal: null, timeRemaining: null, timeUsedPercent: null, timeRemainingPercent: null });
  });
  it('matches effective quota and independent reservations while preserving the aggregate', () => {
    const a = aggregate(), before = structuredClone(a), b = booking(a);
    const result = buildSupplyAnalytics(a, [b], query, at);
    expect(result.summaries[0]).toMatchObject({ total: '50', used: '10', remaining: '40', usedPercent: '20', remainingPercent: '80', booked: '10', reservedRemaining: '40' });
    expect(result.buckets[0]).toMatchObject({ averageBaseline: '4.1666666667', usedVsAveragePercent: '0' });
    expect(bookingExactSum(result.buckets.map(r => r.theory!))).toBe('50');
    expect(bookingExactSum(result.buckets.map(r => r.used))).toBe('10');
    expect(buildSupplyAnalytics(a, [b], { ...query, stage: 'accepted' }, at).summaries[0]).toMatchObject({ used: '2', remaining: '48', booked: '10', reservedRemaining: '40' });
    expect(a).toEqual(before);
  });
  it('uses custom plan weights and exact remainders; acceptance redistribution is labeled', () => {
    const a = aggregate(), b = booking(a, { timeDistribution: { version: 1, mode: 'CUSTOM', fillRemainder: true, segments: [{ startDate: '2026-09-10', endDate: '2026-09-10', quantity: '3' }] } });
    const q = { ...query, grain: 'DAY' as const, from: '2026-09-10', to: '2026-09-20' };
    const result = buildSupplyAnalytics(a, [b], q, at);
    expect(result.buckets[0]!.used).toBe('3'); expect(result.buckets[1]!.used).toBe('0.7');
    const accepted = buildSupplyAnalytics(a, [b], { ...q, stage: 'accepted' }, at);
    expect(accepted.usageBasis).toBe('REWEIGHTED_SCHEDULE'); expect(accepted.buckets[0]!.used).toBe('0.6');
    expect(bookingExactSum(accepted.buckets.map(r => r.used))).toBe('2');
  });
  it('deduplicates disjoint months, omits gaps, and retains preceding usage in closing balances', () => {
    const a = aggregate(), b = booking(a, { startDate: '2026-02-01', endDate: '2026-02-28' });
    const result = buildSupplyAnalytics(a, [b], { ...query, mode: 'DISCRETE', keys: ['2026-03-01', '2026-01-01', '2026-03-01'] }, at);
    expect(result.buckets.map(r => r.key)).toEqual(['2026-01-01', '2026-03-01']);
    expect(result.summaries[0]).toMatchObject({ used: '10', usedSelected: '0', remaining: '40' });
    expect(result.buckets[1]!.remaining).toBe('40');
    expect(() => buildSupplyAnalytics(a, [], { ...query, mode: 'DISCRETE', keys: ['2026-01-01', '2026-04-06'] }, at)).toThrow('cùng mặt cắt');
  });
  it('separates allocations, beneficiary denominators, retired stock and caps', () => {
    const a = aggregate(); a.allocations.push({ ...a.allocations[0]!, id: 'cap', scopeKind: 'CAP', baselineQty: '900' }, { ...a.allocations[0]!, id: 'old', supersededAt: at, baselineQty: '800' });
    const result = buildSupplyAnalytics(a, [booking(a)], { ...query, beneficiary: 'UNIT_A' }, at);
    expect(result.summaries[0]).toMatchObject({ total: '30', used: '10', usedPercent: '33.3333' });
    expect(result.periodSummaries).toHaveLength(1);
  });
  it('keeps whole-contract period balances separate and excludes draft quota', () => {
    const a = aggregate(); a.allocations[2]!.status = 'APPROVED';
    const result = buildSupplyAnalytics(a, [booking(a)], { ...query, period: 'ALL' }, at);
    expect(result.summaries[0]!.total).toBe('90');
    expect(result.periodSummaries.map(r => r.remaining)).toEqual(['40', '40']);
    expect(result.buckets.find(r => r.startDate === '2027-01-01')!.remaining).toBe('40');
    expect(result.buckets.find(r => r.startDate === '2027-01-01')!.future).toBe(true);
    expect(buildSupplyAnalytics(a, [], query, '2028-01-01T00:00:00Z').summaries).toEqual([]);
  });
  it('keeps future and paused reservations and retained accepted quantity after deletion', () => {
    const a = aggregate(), b = booking(a, { state: 'PAUSED', startDate: '2026-12-01', endDate: '2026-12-10' });
    const result = buildSupplyAnalytics(a, [b], { ...query, from: '2026-01-01', to: '2026-09-30' }, at);
    expect(result.summaries[0]).toMatchObject({ usedSelected: '0', reservedRemaining: '40' });
    expect(buildSupplyAnalytics(a, [{ ...b, deletedAt: at }], query, at).summaries[0]).toMatchObject({ booked: '2', remaining: '48' });
  });
  it('keeps cross-period historical charges in the assigned period without falsifying chart dates', () => {
    const a = aggregate();
    const b = booking(a, { startDate: '2025-12-23', endDate: '2025-12-31', quantity: '10' });
    const full = buildSupplyAnalytics(a, [b], { ...query, grain: 'MONTH' }, at);
    expect(full.summaries[0]).toMatchObject({ used: '10', remaining: '40', usedSelected: '10', selectedRemaining: '40' });
    expect(full.buckets.every(row => row.used === '0')).toBe(true);
    expect(full.buckets[0]!.remaining).toBe('40');
    expect(full.outOfPeriod).toMatchObject([{ bookings: 1, before: '10', after: '0' }]);
    const partial = buildSupplyAnalytics(a, [b], { ...query, grain: 'MONTH', from: '2026-02-01', to: '2026-02-28' }, at);
    expect(partial.summaries[0]!.usedSelected).toBe('0');
    expect(partial.summaries[0]!.used).toBe('10');
  });
  it('splits a boundary-crossing schedule only for the chart and keeps its full-period commitment', () => {
    const a = aggregate();
    const b = booking(a, { startDate: '2025-12-31', endDate: '2026-01-02', quantity: '9' });
    const result = buildSupplyAnalytics(a, [b], { ...query, grain: 'DAY' }, at);
    expect(result.outOfPeriod).toMatchObject([{ bookings: 1, before: '3', after: '0' }]);
    expect(result.buckets[0]).toMatchObject({ used: '3', remaining: '44' });
    expect(result.summaries[0]).toMatchObject({ used: '9', usedSelected: '9', remaining: '41' });
  });
  it('does not clamp excess use, negatives or invent zero-denominator percentages', () => {
    const a = aggregate(), result = buildSupplyAnalytics(a, [booking(a, { quantity: '60' })], query, at);
    expect(result.summaries[0]).toMatchObject({ usedPercent: '120', remaining: '-10', remainingPercent: '-20' });
    expect(supplyPercent('0', '0')).toBeNull(); expect(supplyPercent('1', null)).toBeNull();
    a.allocations[0]!.baselineQty = null;
    expect(buildSupplyAnalytics(a, [], query, at).summaries[0]!.total).toBeNull();
    expect(buildSupplyAnalytics(a, [], query, at).buckets[0]!.theory).toBeNull();
  });
  it('normalizes leap days, Monday weeks, quarters and local midnight', () => {
    expect(supplyTimeOptions('2024-02-28', '2024-03-01', 'DAY')).toHaveLength(3);
    expect(supplyTimeKey('2027-01-01', 'WEEK')).toBe('2026-12-28');
    expect(supplyTimeEnd('2024-01-01', 'QUARTER')).toBe('2024-03-31');
    expect(supplyTimeOptions('2024-02-01', '2025-06-01', 'YEAR')).toHaveLength(2);
    const a = aggregate(); a.allocations[2]!.status = 'APPROVED';
    expect(buildSupplyAnalytics(a, [], query, '2026-12-31T17:00:00Z').periodSummaries[0]!.periodId).toBe(a.periods[1]!.id);
  });
  it('keeps a flat monthly baseline for a period even when viewing a shorter range', () => {
    const a = aggregate(), b = booking(a, { startDate: '2026-09-10', endDate: '2026-09-20', quantity: '10' });
    const full = buildSupplyAnalytics(a, [b], { ...query, grain: 'MONTH' }, at);
    const slice = buildSupplyAnalytics(a, [b], { ...query, grain: 'MONTH', from: '2026-09-01', to: '2026-09-30' }, at);
    expect(new Set(full.buckets.map(row => row.averageBaseline))).toEqual(new Set(['4.1666666667']));
    expect(slice.buckets[0]).toMatchObject({ averageBaseline: '4.1666666667', used: '10', usedVsAveragePercent: '240' });
    const daily = buildSupplyAnalytics(a, [b], { ...query, grain: 'DAY', from: '2026-09-10', to: '2026-09-10' }, at);
    expect(daily.buckets[0]!.averageBaseline).toBe('0.1369863014');
  });
  it('conserves leap-year theory and clips service dates before calculating monthly averages', () => {
    const a = aggregate(); a.periods[0]!.startDate = '2024-01-01'; a.periods[0]!.endDate = '2024-12-31';
    a.contract.startDate = '2024-01-01'; a.slots[0]!.startDate = '2024-02-01'; a.slots[0]!.endDate = '2024-03-31';
    const result = buildSupplyAnalytics(a, [], { ...query, period: a.periods[0]!.id, grain: 'DAY' }, at);
    expect(result.buckets).toHaveLength(60); expect(bookingExactSum(result.buckets.map(r => r.theory!))).toBe('50');
    expect(result.summaries[0]!.monthlyAverage).toBe('25');
    expect(result.buckets[0]!.startDate).toBe('2024-02-01');
  });
  it('validates query size, grain, mixed modes and calendar dates', () => {
    expect(supplyAnalyticsQuery.safeParse({ mode: 'DISCRETE', from: '2026-01-01', keys: ['2026-02-01'] }).success).toBe(false);
    expect(supplyAnalyticsQuery.safeParse({ asOf: '2020-01-01' }).success).toBe(false);
    expect(() => buildSupplyAnalytics(aggregate(), [], { ...query, from: '2026-02-30' }, at)).toThrow();
    expect(() => buildSupplyAnalytics(aggregate(), [], { ...query, from: '2026-05-01', to: '2026-01-01' }, at)).toThrow();
  });
});
