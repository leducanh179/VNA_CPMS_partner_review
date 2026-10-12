import { describe, expect, it } from 'vitest';
import type { InventoryConsumptionProvider } from '@cpms/integrations';
import { buildInventory } from './supply-engine';
import { normalizeSupplySource } from './source-import';
import { syntheticSource, syntheticSupplyCatalogs } from './supply-fixtures';
import { buildSupplyWorkspace } from './supply-workspace';
import { ZeroConsumptionProvider } from '../infrastructure/zero-consumption.provider';

const aggregate = () => {
  const value = normalizeSupplySource(syntheticSource(), syntheticSupplyCatalogs).aggregate;
  value.allocations[1]!.taxRate = '0.08';
  value.allocations[2]!.taxRate = '0.1'; value.allocations[2]!.vatEstimated = true;
  return value;
};
const asOf = '2026-09-10T00:00:00Z';
describe('Read-only contract workspace', () => {
  it('defaults to current effective leaf quantities, combining beneficiary allocations once', async () => {
    const value = aggregate(); value.allocations.push({ ...value.allocations[0]!, id: 'CAP', scopeKind: 'CAP', baselineQty: '1000', baselineAmount: '100000' });
    const inventory = await buildInventory(value, new ZeroConsumptionProvider(), asOf);
    const view = buildSupplyWorkspace(value, inventory);
    expect(view.currentPeriodIds).toEqual([value.periods[0]!.id]); expect(view.statusRows).toHaveLength(1);
    expect(view.statusRows[0]!.total).toBe('50');
    expect(Object.values(view.statusRows[0]!.used)).toEqual(['0', '0', '0', '0']);
    expect(Object.values(view.statusRows[0]!.remaining)).toEqual(['50', '50', '50', '50']);
    expect(view.informationGroups[0]!.amount).toBe('5000');
  });
  it('keeps four consumption cuts independent and preserves negative balances', async () => {
    const value = aggregate();
    const provider: InventoryConsumptionProvider = { read: async (scopes, at) => ({ asOf: at, mode: 'TEST', source: 'synthetic', values: Object.fromEntries(scopes.map(scope => [scope.allocationId, {
      booked: { qty: '30', amount: '3000' }, vendorConfirmed: { qty: '15', amount: '1500' }, approved: { qty: '8', amount: '800' }, accepted: { qty: '2', amount: '200' }, committed: { qty: '99', amount: '9900' },
    }])) }) };
    const view = buildSupplyWorkspace(value, await buildInventory(value, provider, asOf));
    expect(view.statusRows[0]!.used).toEqual({ booked: '60', vendorConfirmed: '30', approved: '16', accepted: '4' });
    expect(view.statusRows[0]!.remaining).toEqual({ booked: '-10', vendorConfirmed: '20', approved: '34', accepted: '46' });
  });
  it('excludes unapplied draft quantities from current supply without treating unknown as zero', async () => {
    const value = aggregate(); value.allocations[0]!.status = 'DRAFT'; value.allocations[1]!.status = 'HELD';
    const view = buildSupplyWorkspace(value, await buildInventory(value, new ZeroConsumptionProvider(), asOf));
    expect(view.statusRows[0]!.total).toBeNull(); expect(view.statusRows[0]!.used.booked).toBeNull();
    expect(view.statusRows[0]!.reasons).toContain('Phân bổ chưa có hiệu lực');
  });
  it('current period respects application midnight and includes lifetime entitlements', async () => {
    const value = aggregate();
    value.periods.push({ id: 'lifetime', code: 'LIFE', name: 'Lifetime', kind: 'CONTRACT', startDate: '2025-01-01', endDate: '2027-12-31' });
    value.allocations.push({ ...value.allocations[1]!, id: 'FREE', periodId: 'lifetime', baselineQty: '8', baselineAmount: '0' });
    const view = buildSupplyWorkspace(value, await buildInventory(value, new ZeroConsumptionProvider(), '2026-12-31T17:00:00Z'));
    expect(view.date).toBe('2027-01-01'); expect(view.currentPeriodIds).toEqual([value.periods[1]!.id, 'lifetime']);
    expect(view.statusRows[0]!.total).toBe('8');
  });
  it('shows empty current supply after expiry instead of selecting an old period', async () => {
    const value = aggregate(); const view = buildSupplyWorkspace(value, await buildInventory(value, new ZeroConsumptionProvider(), '2028-01-01T00:00:00Z'));
    expect(view.currentPeriodIds).toEqual([]); expect(view.statusRows).toEqual([]); expect(view.informationGroups).toEqual([]);
  });
  it('splits all-period information into source 8% and estimated 10% groups', async () => {
    const value = aggregate(); const inventory = await buildInventory(value, new ZeroConsumptionProvider(), asOf);
    const view = buildSupplyWorkspace(value, inventory, 'ALL');
    expect(view.informationGroups.map(group => [group.taxRate, group.estimated, group.amount, group.vat, group.gross])).toEqual([
      ['0.08', false, '5000', '400', '5400'], ['0.1', true, '4000', '400', '4400'],
    ]);
    expect(view.informationGroups[1]!.rows[0]!.status).toBe('DRAFT');
    expect(view.informationGroups[1]!.periods.map(period => period.name)).toEqual(['Tháng 01/2027–12/2027']);
  });
  it('switches initial and effective amounts without changing signed money or applying draft deltas', async () => {
    const value = aggregate(), before = structuredClone(value); const inventory = await buildInventory(value, new ZeroConsumptionProvider(), asOf);
    const initial = buildSupplyWorkspace(value, inventory, 'CURRENT', 'BASELINE'), effective = buildSupplyWorkspace(value, inventory);
    expect(initial.informationGroups[0]!.amount).toBe('6000'); expect(initial.informationGroups[0]!.gross).toBe('6480');
    expect(effective.informationGroups[0]!.amount).toBe('5000'); expect(initial.contract.signedAmount).toBe('10000'); expect(value).toEqual(before);
  });
  it('keeps zero-price benefits and missing VAT separate instead of inventing an 8% rate', async () => {
    const value = aggregate(); value.allocations[1]!.taxRate = '0'; value.allocations[1]!.baselineAmount = '0'; value.allocations[1]!.unitPrice = '0'; value.allocations[2]!.taxRate = null;
    const view = buildSupplyWorkspace(value, await buildInventory(value, new ZeroConsumptionProvider(), asOf), 'ALL');
    expect(view.informationGroups[0]!.rows[0]!.qty).toBe('20'); expect(view.informationGroups[0]!.gross).toBe('0');
    const unknown = view.informationGroups.find(group => group.taxRate === null)!; expect(unknown.vat).toBeNull(); expect(unknown.gross).toBeNull();
  });
  it('keeps price changes in separate catalog rows and rejects unknown period IDs', async () => {
    const value = aggregate(); value.allocations[1]!.unitPrice = '200';
    const inventory = await buildInventory(value, new ZeroConsumptionProvider(), asOf);
    expect(buildSupplyWorkspace(value, inventory).informationGroups[0]!.rows.map(row => row.unitPrice)).toEqual(['100', '200']);
    expect(() => buildSupplyWorkspace(value, inventory, 'another-contract-period')).toThrow('UNKNOWN_ALLOCATION_PERIOD');
  });
  it('keeps beneficiary quantities and zeroed entitlements separate in both information phases',async()=>{
    const value=aggregate();value.adjustments[0]!.lines[0]!.deltaQty='-40';value.adjustments[0]!.lines[0]!.deltaAmount='-4000';
    const inventory=await buildInventory(value,new ZeroConsumptionProvider(),asOf);
    const baseline=buildSupplyWorkspace(value,inventory,'CURRENT','BASELINE'),effective=buildSupplyWorkspace(value,inventory);
    expect(baseline.allocationRows.map(r=>[r.beneficiaryLabel,r.qty])).toEqual([['Unit A','40'],['Unit B','20']]);
    expect(effective.allocationRows.map(r=>[r.beneficiaryLabel,r.qty,r.adjustmentQty])).toEqual([['Unit A','0','-40'],['Unit B','20','0']]);
    expect(baseline.allocationRows.map(r=>r.id)).toEqual(effective.allocationRows.map(r=>r.id));
  });
});
