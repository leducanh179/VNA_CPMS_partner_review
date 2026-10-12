import { describe, expect, it } from 'vitest';
import { bookingExactSum, bookingSnapshot, type BookingView, type SupplyAnalyticsQuery } from '@cpms/domain';
import { normalizeSupplySource } from './source-import';
import { syntheticSource, syntheticSupplyCatalogs } from './supply-fixtures';
import { buildSupplyAnalytics } from './supply-analytics';
import { buildSupplyFinance } from './supply-finance';

const at = '2026-09-12T03:00:00Z';
const query: SupplyAnalyticsQuery = { period: 'CURRENT', stage: 'booked', grain: 'MONTH', mode: 'CONTIGUOUS', slotIds: [], beneficiary: 'ALL', keys: [] };
const source = () => normalizeSupplySource(syntheticSource(), syntheticSupplyCatalogs).aggregate;
function fixture() {
  const a = source();
  const row: BookingView = { id: 'b1', allocationId: a.allocations[0]!.id, contractId: a.contract.id, slotId: a.slots[0]!.id, quantity: '10', unit: 'Click', unitPrice: '100', priceBasis: '1', taxRate: '0.08', amount: '1000', vat: '80', gross: '1080', campaignId: 'campaign', campaignLabel: 'Campaign A', startDate: '2026-09-10', endDate: '2026-09-19', materialId: null, materialUrl: null, note: '', state: 'ACTIVE', deletedAt: null, vendorConfirmedQty: '6', sourceApprovedQty: '4', acceptedQty: '2', reportState: 'ACCEPTED', reportTemplateId: null, reportData: {}, sourceKey: null, source: {}, recordVersion: 1, createdByActorId: 'actor', createdAt: at, updatedAt: at };
  const run = (rows = [row], q = query) => buildSupplyFinance(a, rows, buildSupplyAnalytics(a, rows, q, at));
  return { a, row, run };
}
describe('Contract budget projection', () => {
  it('separates month-to-date, future holds and headroom; campaign slice uses run dates', () => {
    const { run } = fixture(), f = run(), p = f.periods[0]!;
    expect(p.monthToDate.net).toBe('300'); expect(p.elapsed.net).toBe('300'); expect(p.heldFuture.net).toBe('700'); expect(p.held.net).toBe('1000');
    expect(f.selected).toEqual({ net: '1000', gross: '1080' });
    const slice = run(undefined, { ...query, from: '2026-09-11', to: '2026-09-12' });
    expect(slice.selected.net).toBe('200'); expect(slice.periods[0]!.held.net).toBe('1000');
    expect(slice.periods[0]!.months).toHaveLength(1);
    expect(slice.periods[0]!.months[0]!.used.net).toBe('200'); expect(slice.periods[0]!.months[0]!.reserved.net).toBe('300');
  });
  it('keeps headroom independent of accepted/approved reporting cuts', () => {
    const { run } = fixture(), held = run(), accepted = run(undefined, { ...query, stage: 'accepted' });
    expect(accepted.periods[0]!.available).toEqual(held.periods[0]!.available);
    expect(accepted.selected.net).toBe('200'); expect(accepted.periods[0]!.elapsed.net).toBe('60');
  });
  it('uses frozen prices, conserves custom schedule and sums campaign drill-down', () => {
    const { a, row, run } = fixture(); a.slots[0]!.unitPrice = '9999';
    row.timeDistribution = { version: 1, mode: 'CUSTOM', fillRemainder: true, segments: [{ startDate: row.startDate, endDate: row.startDate, quantity: '3' }] };
    const f = run(); expect(f.selected.net).toBe('1000');
    expect(bookingExactSum(f.campaigns.flatMap(c => c.bookings.map(b => b.value.net!)))).toBe(f.selected.net);
  });
  it('does not sum an amendment twice; changed campaign follows the reservation selected by domain', () => {
    const { row, run } = fixture();
    row.workflow = { version: 1, status: 'PENDING_VENDOR', route: 'MANAGER', origin: 'MANAGER', policyVersion: 1, required: true, requestVersion: 1, submittedBy: 'actor', submittedAt: at, reason: '', decisions: [], effective: bookingSnapshot(row) };
    row.quantity = '12'; row.campaignId = 'campaign2'; row.campaignLabel = 'Campaign B';
    const f = run(); expect(f.selected.net).toBe('1200'); expect(f.campaigns).toHaveLength(1); expect(f.campaigns[0]!.label).toBe('Campaign B');
    expect(run(undefined, { ...query, stage: 'approved' }).campaigns[0]!.label).toBe('Campaign A');
    row.unitPrice = '110'; expect(run().periods[0]!.available.net).toBeNull();
  });
  it('does not count CAP rows or superseded allocations as budget; preserves free items and unknown VAT', () => {
    const { a, row, run } = fixture(), before = run().periods[0]!.budget;
    a.allocations.push({ ...a.allocations[0]!, id: 'cap', scopeKind: 'CAP', baselineAmount: '999999' }, { ...a.allocations[0]!, id: 'retired', supersededAt: at, baselineAmount: '999999' });
    expect(run().periods[0]!.budget).toEqual(before);
    row.unitPrice = '0'; expect(run().selected.net).toBe('0'); expect(run().campaigns).toEqual([]);
    a.allocations[0]!.taxRate = null; expect(run().periods[0]!.budget.gross).toBeNull();
  });
  it('retains acceptance after delete and does not invent a forecast without prior use', () => {
    const { row, run } = fixture(); row.deletedAt = at;
    expect(run().selected.net).toBe('200');
    row.startDate = '2026-12-01'; row.endDate = '2026-12-10'; row.deletedAt = null;
    expect(run().periods[0]!.forecastAdditional.net).toBeNull();
  });
  it('clips a shared cap and preserves negative headroom', () => {
    const { a, run } = fixture();
    a.allocations.push({ ...a.allocations[0]!, id: 'cap', slotId: null, beneficiaryUnitCode: null, scopeKind: 'CAP', baselineAmount: '500' });
    expect(run().periods[0]!.available.net).toBe('-500');
  });
  it('uses the tightest duplicate cap without subtracting the same money twice', () => {
    const { a, run } = fixture(), base = a.allocations[0]!;
    a.allocations = [{ ...base, id: 'a', baselineAmount: '100' },
      ...['90', '80'].map((limit, i) => ({ ...base, id: `cap-${i}`, scopeKind: 'CAP' as const, baselineAmount: limit }))];
    expect(run([]).periods[0]!.available.net).toBe('80');
  });
  it('adds disjoint restrictions and applies a parent ceiling only once', () => {
    const { a, run } = fixture(), base = a.allocations[0]!;
    a.allocations = ['UNIT_A', 'UNIT_B'].flatMap((unit, i) => [
      { ...base, id: `a-${i}`, beneficiaryUnitCode: unit, baselineAmount: '100' },
      { ...base, id: `cap-${i}`, beneficiaryUnitCode: unit, scopeKind: 'CAP' as const, baselineAmount: i ? '80' : '70' },
    ]);
    const parent = { ...base, id: 'parent', slotId: null, beneficiaryUnitCode: null, scopeKind: 'CAP' as const, baselineAmount: '180' };
    a.allocations.push(parent);
    expect(run([]).periods[0]!.available.net).toBe('150');
    parent.baselineAmount = '140'; expect(run([]).periods[0]!.available.net).toBe('140');
  });
  it('does not invent spendable headroom for crossing caps outside an allocation tree', () => {
    const { a, run } = fixture(), base = a.allocations[0]!;
    a.slots.push({ ...a.slots[0]!, id: 'slot-2' });
    a.allocations = [
      { ...base, id: 'a', beneficiaryUnitCode: 'UNIT_A', baselineAmount: '100' },
      { ...base, id: 'b', beneficiaryUnitCode: 'UNIT_B', baselineAmount: '100' },
      { ...base, id: 'c', slotId: 'slot-2', beneficiaryUnitCode: 'UNIT_A', baselineAmount: '100' },
      { ...base, id: 'cap-slot', beneficiaryUnitCode: null, scopeKind: 'CAP', baselineAmount: '150' },
      { ...base, id: 'cap-unit', slotId: null, beneficiaryUnitCode: 'UNIT_A', scopeKind: 'CAP', baselineAmount: '150' },
    ];
    const period = run([]).periods[0]!;
    expect(period.available.net).toBeNull(); expect(period.issues.join(' ')).toContain('trần tiền giao nhau');
  });
});
