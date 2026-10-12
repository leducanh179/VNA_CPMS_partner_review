import { randomUUID } from 'node:crypto';
import type { SupplyAggregate } from '@cpms/domain';
import { decimal, effectivePair, isoDate, sum } from './supply-engine';

export interface FreeAllocationSplit {
  allocationId: string; reason: string;
  parts: Array<{ periodId: string; qty: string; taxRate: string; vatEstimated: boolean }>;
}
/** Re-express an unused free entitlement in periods without rewriting its source baseline. */
export function splitFreeAllocation(current: SupplyAggregate, input: FreeAllocationSplit, actorId: string, at: string): SupplyAggregate {
  const original = current.allocations.find(a => a.id === input.allocationId);
  const slot = current.slots.find(s => s.id === original?.slotId);
  if (!original || original.supersededAt || original.status !== 'APPROVED' || original.scopeKind !== 'ENTITLEMENT') throw new Error('Phân bổ không còn hiệu lực hoặc đã được tách kỳ.');
  if (slot?.costType !== 'VENDOR_FOC' || original.unitPrice !== '0' || original.baselineAmount !== '0') throw new Error('Chỉ tách kỳ quyền lợi nhà cung cấp tặng miễn phí, đơn giá và thành tiền bằng 0.');
  const effective = effectivePair(current, original, at);
  if (current.adjustments.some(g => (['DRAFT','PENDING'].includes(g.status) || ['APPROVED','SOURCE_APPLIED'].includes(g.status) && g.effectiveDate && isoDate(g.effectiveDate) > isoDate(at)) && g.lines.some(l => l.allocationId === original.id))) throw new Error('Quyền lợi còn điều chỉnh chờ xử lý hoặc có hiệu lực trong tương lai; đối soát trước khi tách kỳ.');
  if (effective.amount !== '0' || effective.qty === null || original.baselineQty === null || !decimal(effective.qty).eq(original.baselineQty)) throw new Error('Quyền lợi đã thay đổi hạn mức; cần đối soát trước khi tách kỳ.');
  if (input.parts.length < 2 || new Set(input.parts.map(p => p.periodId)).size !== input.parts.length) throw new Error('Cần các kỳ phân bổ riêng biệt.');
  if (input.parts.some(p => !decimal(p.qty).isInteger() || decimal(p.qty).lte(0) || decimal(p.taxRate).lt(0) || decimal(p.taxRate).gt(1))) throw new Error('Số gói phải nguyên dương và VAT nằm trong khoảng 0–100%.');
  if (!decimal(sum(input.parts.map(p => p.qty))!).eq(effective.qty)) throw new Error('Tổng số lượng các kỳ phải bằng quyền lợi gốc.');
  const sourcePeriod = current.periods.find(p => p.id === original.periodId)!;
  const periods = input.parts.map(part => current.periods.find(p => p.id === part.periodId));
  if (periods.some(p => !p || p.id === original.periodId || isoDate(p.startDate) < isoDate(sourcePeriod.startDate) || isoDate(p.endDate) > isoDate(sourcePeriod.endDate))) throw new Error('Kỳ đích phải thuộc phạm vi quyền lợi gốc.');
  const ordered = periods.map(p => p!).sort((a,b) => a.startDate.localeCompare(b.startDate));
  if (isoDate(ordered[0]!.startDate) !== isoDate(sourcePeriod.startDate) || isoDate(ordered.at(-1)!.endDate) !== isoDate(sourcePeriod.endDate) || ordered.some((p,i) => i > 0 && Date.parse(isoDate(p.startDate)) !== Date.parse(isoDate(ordered[i-1]!.endDate)) + 86400000)) throw new Error('Các kỳ phải phủ liên tục quyền lợi gốc, không trùng hoặc bỏ sót ngày.');
  const value = structuredClone(current), planId = randomUUID();
  const old = value.allocations.find(a => a.id === original.id)!;
  old.supersededAt = at; old.recordVersion++;
  value.allocations.push(...input.parts.map(part => ({ ...structuredClone(original), id: randomUUID(), planId, periodId: part.periodId,
    sourceKey: null, splitFromId: original.id, supersededAt: null, baselineQty: decimal(part.qty).toFixed(), baselineAmount: '0', taxRate: decimal(part.taxRate).toFixed(), vatEstimated: part.vatEstimated,
    inputBasis: 'DEMO_PERIOD_SPLIT', sourceMonthCount: null, sourceVersion: null, recordVersion: 1,
    source: { kind: 'USER_AUTHORIZED_DEMO_SPLIT', originalAllocationId: original.id, originalSourceKey: original.sourceKey, reason: input.reason, recordedAt: at },
    quality: [{ code: 'DEMO_PERIOD_SPLIT', severity: 'WARNING' as const, message: 'Phân bổ mẫu theo kỳ do người dùng yêu cầu; quyền lợi miễn phí gốc được lưu để đối soát.' }],
    approvedByActorId: actorId, approvedAt: at,
  })));
  return value;
}
