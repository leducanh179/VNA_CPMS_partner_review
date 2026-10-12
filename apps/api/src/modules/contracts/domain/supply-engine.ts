import { Prisma } from '@prisma/client';
import type { SupplyAggregate, SupplyAllocationView, SupplyInventory, SupplyPair, SupplyDecimal, SupplyQuality, SupplySlotView } from '@cpms/domain';
import type { InventoryConsumptionProvider } from '@cpms/integrations';
import { supplyItemSlot } from '@cpms/domain';

// Decimal precision exceeds the database scale. Round only at persistence/display boundaries.
export const Decimal = Prisma.Decimal.clone({ precision: 48, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const decimal = (value: string | number | Prisma.Decimal) => new Decimal(value.toString());
export const numeric = (value: string | number | Prisma.Decimal | null | undefined, scale = 10): SupplyDecimal => value == null ? null : decimal(value).toDecimalPlaces(scale).toFixed();
export const sum = (values: readonly SupplyDecimal[]): SupplyDecimal => values.some(v => v === null) ? null : values.reduce((a, v) => a.plus(v!), decimal(0)).toFixed();
export const add = (a: SupplyDecimal, b: SupplyDecimal): SupplyDecimal => a === null || b === null ? null : decimal(a).plus(b).toFixed();
export const subtract = (a: SupplyDecimal, b: SupplyDecimal): SupplyDecimal => a === null || b === null ? null : decimal(a).minus(b).toFixed();
export const divide = (a: SupplyDecimal, b: SupplyDecimal): SupplyDecimal => a === null || b === null || decimal(b).isZero() ? null : numeric(decimal(a).div(b));
export const pair = (qty: SupplyDecimal, amount: SupplyDecimal): SupplyPair => ({ qty, amount });
export const isoDate = (date: string | Date) => date instanceof Date ? date.toISOString().slice(0, 10) : date.slice(0, 10);
export function appDate(asOf: string): string {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('INVALID_AS_OF');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
}
export function calendarMonths(start: string, end: string): number {
  if (isoDate(start) > isoDate(end)) return 0;
  return (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
}
export function parseSourceNumber(value: unknown, locale: string, percentage = false): SupplyDecimal {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('INVALID_NUMBER');
  let text = String(value).trim(); const percent = text.includes('%');
  text = text.replace(/[\s\u00a0₫đ%]/g, '').replace(/VND/gi, '');
  const negative = /^\(.*\)$/.test(text); if (negative) text = '-' + text.slice(1, -1);
  if (typeof value === 'string') text = locale === 'vi_VN' ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) throw new Error('INVALID_NUMBER');
  const n = decimal(text); if (!n.isFinite() || n.abs().gte('1e18')) throw new Error('NUMBER_OUT_OF_RANGE');
  return numeric(percentage && percent ? n.div(100) : n);
}
export function parseSourceDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  let date: string;
  if (typeof value === 'number') date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  else {
    const text = String(value).trim();
    const local = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
    date = local ? `${local[3]}-${local[2]}-${local[1]}` : text.slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('INVALID_DATE');
  return date;
}
export function effectivePair(aggregate: SupplyAggregate, allocation: SupplyAllocationView, asOf: string, includeDraft = false): SupplyPair {
  const date = appDate(asOf);
  const lines = aggregate.adjustments.filter(g => ['APPROVED', 'SOURCE_APPLIED', ...(includeDraft ? ['DRAFT', 'PENDING'] : [])].includes(g.status)
    && (!g.effectiveDate || isoDate(g.effectiveDate) <= date || includeDraft)).flatMap(g => g.lines).filter(l => l.allocationId === allocation.id);
  return pair(add(allocation.baselineQty, sum(lines.map(l => l.deltaQty ?? '0'))), add(allocation.baselineAmount, sum(lines.map(l => l.deltaAmount ?? '0'))));
}
export function capacityCheck(mode: SupplySlotView['capacityMode'], capacity: number | null, concurrent: number): 'ALLOWED' | 'BLOCKED' | 'UNKNOWN' {
  if (!Number.isInteger(concurrent) || concurrent < 0) throw new Error('INVALID_CONCURRENCY');
  if (mode === 'UNKNOWN') return 'UNKNOWN';
  if (mode === 'UNRESTRICTED') return 'ALLOWED';
  const limit = mode === 'EXCLUSIVE' ? 1 : capacity;
  return limit == null || limit < 1 ? 'UNKNOWN' : concurrent <= limit ? 'ALLOWED' : 'BLOCKED';
}
export function convertAllocation(input: { basis: 'QTY' | 'AMOUNT' | 'PERCENT_QTY' | 'PERCENT_AMOUNT'; value: string; denominator?: string | null; unitPrice: SupplyDecimal; priceBasis: SupplyDecimal }): SupplyPair {
  let value = decimal(input.value);
  if (!value.isFinite() || value.isNegative()) throw new Error('INVALID_ALLOCATION_VALUE');
  if (input.basis.startsWith('PERCENT_')) {
    if (input.denominator == null || decimal(input.denominator).lte(0) || value.gt(100)) throw new Error('PERCENT_DENOMINATOR_REQUIRED');
    value = value.mul(input.denominator).div(100);
  }
  const basis = input.priceBasis == null ? null : decimal(input.priceBasis);
  const price = input.unitPrice == null ? null : decimal(input.unitPrice);
  if (basis?.lte(0)) throw new Error('INVALID_PRICE_BASIS');
  if (input.basis.endsWith('QTY')) return pair(numeric(value), price != null && basis != null ? numeric(value.mul(price).div(basis), 6) : null);
  return pair(price != null && price.gt(0) && basis != null ? numeric(value.mul(basis).div(price)) : null, numeric(value, 6));
}
/** Validate approved leaves against simultaneous containing caps, without summing caps into stock. */
export function validateSupplyLimits(aggregate: SupplyAggregate, asOf: string): Array<SupplyQuality & { excess?: string }> {
  const issues: Array<SupplyQuality & { excess?: string }> = [];
  const active = aggregate.allocations.filter(a => a.status === 'APPROVED' && !a.supersededAt);
  const leaves = active.filter(a => a.scopeKind === 'ENTITLEMENT');
  const check = (amount: SupplyDecimal, cap: SupplyDecimal, label: string, mode = 'HARD_LIMIT', tolerance = '0.01') => {
    if (cap !== null && amount !== null && decimal(amount).gt(decimal(cap).plus(tolerance))) issues.push({ code: 'CAP_EXCEEDED', message: label, excess: decimal(amount).minus(cap).toFixed(), severity: mode === 'HARD_LIMIT' ? 'BLOCK' : 'WARNING' });
  };
  for (const a of active) {
    const value = effectivePair(aggregate, a, asOf);
    if ([value.qty, value.amount].some(n => n !== null && decimal(n).lt(0))) issues.push({ code: 'NEGATIVE_LIMIT', severity: 'BLOCK', message: `Hạn mức âm: ${a.sourceKey ?? a.id}` });
  }
  for (const slot of aggregate.slots) {
    const rows = leaves.filter(a => a.slotId === slot.id);
    check(sum(rows.map(a => effectivePair(aggregate, a, asOf).qty)), slot.effectiveTotalQty ?? slot.totalQty, `Vượt số lượng slot ${slot.code}`, 'HARD_LIMIT', '0.00000001');
    // Budget can be restructured across slots. Signed line money is a reference, while quantity remains a supply cap.
  }
  check(sum(leaves.map(a => effectivePair(aggregate, a, asOf).amount)), aggregate.contract.signedAmount, 'Vượt trần tiền toàn hợp đồng');
  for (const cap of active.filter(a => a.scopeKind === 'CAP' && a.limitMode !== 'REFERENCE')) {
    const period = aggregate.periods.find(p => p.id === cap.periodId)!;
    const contained = leaves.filter(a => {
      const p = aggregate.periods.find(p => p.id === a.periodId)!;
      const sameScope=(!cap.slotId||cap.slotId===a.slotId)&&(!cap.beneficiaryUnitCode||cap.beneficiaryUnitCode===a.beneficiaryUnitCode);
      const intersects=isoDate(p.startDate)<=isoDate(period.endDate)&&isoDate(p.endDate)>=isoDate(period.startDate);
      if(sameScope&&intersects&&(isoDate(p.startDate)<isoDate(period.startDate)||isoDate(p.endDate)>isoDate(period.endDate))) issues.push({code:'CAP_PARTIAL_PERIOD',message:`Phân bổ giao một phần trần ${period.name}; cần tách kỳ trước khi áp dụng.`,severity:cap.limitMode==='HARD_LIMIT'?'BLOCK':'WARNING'});
      return (!cap.slotId || cap.slotId === a.slotId) && (!cap.beneficiaryUnitCode || cap.beneficiaryUnitCode === a.beneficiaryUnitCode)
        && isoDate(p.startDate) >= isoDate(period.startDate) && isoDate(p.endDate) <= isoDate(period.endDate);
    });
    const limit = effectivePair(aggregate, cap, asOf);
    check(sum(contained.map(a => effectivePair(aggregate, a, asOf).amount)), limit.amount, `Vượt trần ${period.name}/${cap.beneficiaryLabel}`, cap.limitMode);
    if (cap.slotId) check(sum(contained.map(a => effectivePair(aggregate, a, asOf).qty)), limit.qty, `Vượt trần số lượng ${period.name}`, cap.limitMode, '0.00000001');
  }
  return issues;
}

export async function buildInventory(aggregate: SupplyAggregate, provider: InventoryConsumptionProvider, asOf: string): Promise<SupplyInventory> {
  aggregate = { ...aggregate, allocations: aggregate.allocations.filter(a => !a.supersededAt) };
  const date = appDate(asOf);
  const scopes = aggregate.allocations.map(a => {
    const p = aggregate.periods.find(p => p.id === a.periodId)!;
    return { allocationId: a.id, contractId: a.contractId, slotId: a.slotId, periodStart: isoDate(p.startDate), periodEnd: isoDate(p.endDate), beneficiaryUnitCode: a.beneficiaryUnitCode };
  });
  const sample = await provider.read(scopes, asOf);
  if (!sample?.asOf || !sample.mode || !sample.source || !sample.values) throw new Error('CONSUMPTION_PROVIDER_INVALID');
  const rows = aggregate.allocations.map(a => {
    const p = aggregate.periods.find(p => p.id === a.periodId)!;
    const slot = supplyItemSlot(aggregate, a.slotId ?? '', a.periodId);
    const effective = effectivePair(aggregate, a, asOf);
    const baseline = pair(a.baselineQty, a.baselineAmount);
    const usage = sample.values[a.id];
    if (!usage || ['booked','vendorConfirmed','approved','accepted','committed'].some(k => !usage[k as keyof typeof usage])) throw new Error('CONSUMPTION_PROVIDER_INCOMPLETE');
    const remaining = Object.fromEntries(Object.entries(usage).map(([stage, value]) => [stage, pair(subtract(effective.qty, value.qty), subtract(effective.amount, value.amount))])) as typeof usage;
    const months = calendarMonths(isoDate(p.startDate), isoDate(p.endDate));
    const remainingMonths = calendarMonths(date > isoDate(p.startDate) ? date : isoDate(p.startDate), isoDate(p.endDate));
    const reasons: string[] = [];
    if (aggregate.contract.status !== 'ACTIVE') reasons.push('Hợp đồng chưa hoạt động');
    if (slot && slot.status !== 'ACTIVE') reasons.push('Slot chưa hoạt động');
    if (slot?.capacityMode === 'UNKNOWN') reasons.push('Quy tắc trùng lịch chưa xác định');
    if (a.status !== 'APPROVED') reasons.push(a.status === 'HELD' ? 'Dữ liệu hạn mức cần xử lý' : 'Phân bổ chưa có hiệu lực');
    if (date > isoDate(p.endDate)) reasons.push('Kỳ đã kết thúc');
    if (date < isoDate(p.startDate)) reasons.push('Kỳ chưa bắt đầu');
    for (const range of [aggregate.contract, ...(slot ? [slot] : [])]) {
      if (!range.startDate && range === aggregate.contract || !range.endDate && range === aggregate.contract) reasons.push('Thiếu thời hạn cung ứng');
      if (range.startDate && date < isoDate(range.startDate) || range.endDate && date > isoDate(range.endDate)) reasons.push('Ngoài thời hạn cung ứng');
    }
    if ([...a.quality, ...aggregate.contract.quality, ...(slot?.quality ?? [])].some(q => q.severity === 'BLOCK')) reasons.push('Chất lượng dữ liệu chưa đạt');
    if (a.scopeKind === 'CAP') reasons.push('Trần kiểm soát, không phải kho cộng thêm');
    if (!a.beneficiaryUnitCode && a.beneficiaryLabel !== 'Toàn hợp đồng') reasons.push('Chưa xác định CQĐV hưởng hạn mức');
    if ([effective.qty, effective.amount].every(n => n === null || decimal(n).isZero())) reasons.push('Hạn mức hiệu lực bằng 0 hoặc chưa xác định');
    if ([remaining.committed.qty, remaining.committed.amount].some(n => n !== null && decimal(n).lt(0))) reasons.push('Thiếu hụt hạn mức');
    const avg = (v: SupplyPair, n: number) => pair(divide(v.qty, String(n)), divide(v.amount, String(n)));
    const pct = (used: SupplyDecimal, limit: SupplyDecimal) => { const ratio = divide(used, limit); return ratio === null ? null : decimal(ratio).mul(100).toFixed(); };
    const peers = aggregate.allocations.filter(v=>v.scopeKind==='ENTITLEMENT' && v.periodId===a.periodId && v.beneficiaryUnitCode===a.beneficiaryUnitCode);
    const quantityPeers = peers.filter(v=>v.slotId===a.slotId);
    const baselineShare=pair(pct(a.baselineQty,sum(quantityPeers.map(v=>v.baselineQty))),pct(a.baselineAmount,sum(peers.map(v=>v.baselineAmount))));
    const effectiveShare=pair(pct(effective.qty,sum(quantityPeers.map(v=>effectivePair(aggregate,v,asOf).qty))),pct(effective.amount,sum(peers.map(v=>effectivePair(aggregate,v,asOf).amount))));
    const usagePercent=Object.fromEntries(Object.entries(usage).map(([stage,v])=>[stage,pair(pct(v.qty,effective.qty),pct(v.amount,effective.amount))])) as typeof usage;
    const remainingPercent=Object.fromEntries(Object.entries(remaining).map(([stage,v])=>[stage,pair(pct(v.qty,effective.qty),pct(v.amount,effective.amount))])) as typeof usage;
    const avgRemainingByStage=Object.fromEntries(Object.entries(remaining).map(([stage,v])=>[stage,avg(v,remainingMonths)])) as typeof usage;
    return { allocationId: a.id, slotId: a.slotId, periodId: a.periodId, beneficiaryLabel: a.beneficiaryLabel, unit: slot?.quantityUnit ?? slot?.unit ?? null,
      scopeKind: a.scopeKind, baseline, effective, proposed: effectivePair(aggregate, a, asOf, true), adjustment: pair(subtract(effective.qty, baseline.qty), subtract(effective.amount, baseline.amount)),
      usage, remaining, avgBaseline: avg(baseline, months), avgEffective: avg(effective, months), avgRemaining: avg(remaining.committed, remainingMonths),
      usedPercent: pair(pct(usage.committed.qty, effective.qty), pct(usage.committed.amount, effective.amount)), monthCount: months, remainingMonths,
      baselineShare,effectiveShare,usagePercent,remainingPercent,avgRemainingByStage,eligible: reasons.length === 0, reasons: [...new Set(reasons)], applied: a.status === 'APPROVED' };
  });
  const leaves = rows.filter(r => r.scopeKind === 'ENTITLEMENT' && r.applied);
  return { rows, amountTotals: { baseline: sum(leaves.map(r => r.baseline.amount)), effective: sum(leaves.map(r => r.effective.amount)), remaining: sum(leaves.map(r => r.remaining.committed.amount)), used:sum(leaves.map(r=>r.usage.committed.amount)) },
    quantityTotals: [...new Set(leaves.map(r => r.unit).filter((u): u is string => u != null))].map(unit => {
      const group = leaves.filter(r => r.unit === unit); return { unit, baseline: sum(group.map(r => r.baseline.qty)), effective: sum(group.map(r => r.effective.qty)), remaining: sum(group.map(r => r.remaining.committed.qty)) };
    }), asOf: sample.asOf, mode: sample.mode, source: sample.source,
    notice: sample.mode === 'ZERO_DEMO' ? 'Demo: chưa kết nối Booking, giả định chưa phát sinh sử dụng' : 'Sử dụng theo consumption provider; các trạng thái có thể chồng lấn.' };
}
