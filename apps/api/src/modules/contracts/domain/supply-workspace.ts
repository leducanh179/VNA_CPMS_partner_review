import { formatSupplyPeriodName, isContractLifetimePeriod, type SupplyAggregate, type SupplyAllocationInformationRow, type SupplyContractWorkspace, type SupplyInformationPhase, type SupplyInformationRow, type SupplyInventory, type SupplySlotStatusRow, type SupplyTaxGroup, type SupplyUsageStage } from '@cpms/domain';
import { add, appDate, decimal, isoDate, numeric, subtract, sum } from './supply-engine';
import { supplyItemSlot, supplyItemTax } from '@cpms/domain';

const stages: SupplyUsageStage[] = ['booked', 'vendorConfirmed', 'approved', 'accepted'];
/** Read projection only: independent consumption stages and leaf entitlements; caps never become stock. */
export function buildSupplyWorkspace(aggregate: SupplyAggregate, inventory: SupplyInventory, period = 'CURRENT', phase: SupplyInformationPhase = 'EFFECTIVE'): Omit<SupplyContractWorkspace, 'pollIntervalMs'> {
  const date = appDate(inventory.asOf);
  const leaves = aggregate.allocations.filter(a => !a.supersededAt && a.scopeKind === 'ENTITLEMENT' && a.slotId);
  const periods = aggregate.periods.filter(p => leaves.some(a => a.periodId === p.id)).map(p => ({ ...p, name: formatSupplyPeriodName(p) }));
  const currentPeriodIds = periods.filter(p => isoDate(p.startDate) <= date && isoDate(p.endDate) >= date).map(p => p.id);
  const selected = periods.find(p => p.id === period);
  if (!['CURRENT', 'ALL'].includes(period) && !selected) throw new Error('UNKNOWN_ALLOCATION_PERIOD');
  const selectedPeriodIds = period === 'CURRENT' ? currentPeriodIds : period === 'ALL' ? periods.map(p => p.id) : periods.filter(p => p.id === period || isContractLifetimePeriod(p) && selected && p.startDate <= selected.endDate && p.endDate >= selected.startDate).map(p => p.id);
  const inventories = new Map(inventory.rows.map(row => [row.allocationId, row]));
  const periodNames = (ids: string[]) => periods.filter(p => ids.includes(p.id)).map(p => p.name);
  const statusRows: SupplySlotStatusRow[] = aggregate.slots.flatMap(slot => {
    const current = leaves.filter(a => a.slotId === slot.id && currentPeriodIds.includes(a.periodId));
    if (!current.length) return [];
    const applied = current.filter(a => a.status === 'APPROVED').map(a => inventories.get(a.id)!);
    const total = applied.length ? sum(applied.map(row => row.effective.qty)) : null;
    const used = Object.fromEntries(stages.map(stage => [stage, applied.length ? sum(applied.map(row => row.usage[stage].qty)) : null])) as SupplySlotStatusRow['used'];
    const remaining = Object.fromEntries(stages.map(stage => [stage, subtract(total, used[stage])])) as SupplySlotStatusRow['remaining'];
    const currentSlot=supplyItemSlot(aggregate,slot.id,current[0]!.periodId)!;
    return [{ id: slot.id, code: currentSlot.code, name: currentSlot.name, unit: currentSlot.quantityUnit ?? currentSlot.unit, periodNames: periodNames(current.map(a => a.periodId)), total, used, remaining,
      reasons: [...new Set(current.flatMap(a => inventories.get(a.id)!.reasons))] }];
  });
  const groups = new Map<string, SupplyTaxGroup>();
  const allocationRows: SupplyAllocationInformationRow[] = [];
  for (const allocation of leaves.filter(a => selectedPeriodIds.includes(a.periodId))) {
    const slot = supplyItemSlot(aggregate,allocation.slotId!,allocation.periodId,phase)!;
    const term=aggregate.itemTerms?.find(t=>t.slotId===slot.id&&t.periodId===allocation.periodId);
    const terms=phase==='BASELINE'?term?.baseline:term?.effective;if(phase==='EFFECTIVE'&&terms?.deleted||phase==='BASELINE'&&term&&!term.baseline)continue;
    const unitPrice=terms?.unitPrice??allocation.unitPrice;
    const rate=supplyItemTax(aggregate,slot.id,allocation.periodId,phase)??allocation.taxRate;
    const taxRate = rate === null ? null : decimal(rate).toFixed();
    const groupId = `${taxRate ?? 'UNKNOWN'}:${allocation.vatEstimated}`;
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, taxRate, taxPercent: taxRate === null ? null : decimal(taxRate).mul(100).toFixed(), estimated: allocation.vatEstimated, periods: [], rows: [], amount: '0', vat: '0', gross: '0' };
      groups.set(groupId, group);
    }
    const allocationPeriod = periods.find(p => p.id === allocation.periodId)!;
    if (!group.periods.some(p => p.id === allocationPeriod.id)) group.periods.push(allocationPeriod);
    const values = phase === 'BASELINE' ? { qty: allocation.baselineQty, amount: allocation.baselineAmount } : inventories.get(allocation.id)!.effective;
    const vat = values.amount === null ? null : decimal(values.amount).isZero() ? '0' : taxRate === null ? null : numeric(decimal(values.amount).mul(taxRate), 6);
    const freeOfCharge = slot.costType === 'VENDOR_FOC' && unitPrice === '0';
    allocationRows.push({ id: allocation.id, slotId: slot.id, code: slot.code, name: slot.name, unit: slot.quantityUnit ?? slot.unit,
      unitPrice, priceBasis: slot.priceBasis, qty: values.qty, amount: values.amount, vat, gross: add(values.amount, vat), status: allocation.status,
      periodNames: [allocationPeriod.name], beneficiaries: [allocation.beneficiaryLabel], periodId: allocation.periodId, periodName: allocationPeriod.name,
      beneficiaryUnitCode: allocation.beneficiaryUnitCode, beneficiaryLabel: allocation.beneficiaryLabel, baselineQty: allocation.baselineQty,
      adjustmentQty: phase === 'BASELINE' ? '0' : subtract(values.qty, allocation.baselineQty), taxRate, vatEstimated: allocation.vatEstimated, freeOfCharge });
    const rowId = `${slot.id}:${unitPrice}:${allocation.status}`;
    let row = group.rows.find(r => r.id === rowId);
    if (!row) {
      row = { id: rowId, slotId: slot.id, code: slot.code, name: slot.name, unit: slot.quantityUnit ?? slot.unit, unitPrice, priceBasis: slot.priceBasis,
        qty: '0', amount: '0', vat: '0', gross: '0', status: allocation.status, periodNames: [], beneficiaries: [], freeOfCharge } satisfies SupplyInformationRow;
      group.rows.push(row);
    }
    row.qty = add(row.qty, values.qty); row.amount = add(row.amount, values.amount); row.vat = add(row.vat, vat); row.gross = add(row.amount, row.vat);
    row.periodNames = [...new Set([...row.periodNames, allocationPeriod.name])];
    row.beneficiaries = [...new Set([...row.beneficiaries, allocation.beneficiaryLabel])];
  }
  for (const group of groups.values()) {
    group.periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
    group.amount = sum(group.rows.map(row => row.amount)); group.vat = sum(group.rows.map(row => row.vat)); group.gross = add(group.amount, group.vat);
  }
  const informationGroups = [...groups.values()].sort((a, b) => a.taxRate === null ? 1 : b.taxRate === null ? -1 : decimal(a.taxRate).cmp(b.taxRate) || Number(a.estimated) - Number(b.estimated));
  allocationRows.sort((a,b) => a.code.localeCompare(b.code) || periods.find(p=>p.id===a.periodId)!.startDate.localeCompare(periods.find(p=>p.id===b.periodId)!.startDate) || a.beneficiaryLabel.localeCompare(b.beneficiaryLabel,'vi'));
  return { contract: aggregate.contract, slots: aggregate.slots, periods, currentPeriodIds, selectedPeriodIds, period, phase, statusRows, informationGroups, allocationRows, asOf: inventory.asOf, date, notice: inventory.notice, mode: inventory.mode };
}
