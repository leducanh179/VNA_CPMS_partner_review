import { bookingDates, bookingPlanDays, bookingScaled, bookingUnscaled, formatSupplyPeriodName, isContractLifetimePeriod, supplyTimeEnd, supplyTimeKey, supplyTimeLabel, type BookingView, type SupplyAggregate, type SupplyAnalytics, type SupplyAnalyticsBucket, type SupplyAnalyticsQuery, type SupplyAnalyticsSummary, type SupplyDecimal } from '@cpms/domain';
import { appDate, calendarMonths, decimal, effectivePair, isoDate, numeric, subtract, sum } from './supply-engine';
import { reservedBooking } from '../../booking/domain/booking-engine';
import { bookingUsageRows } from '../../booking/domain/booking-workflow';
import { supplyItemSlot } from '@cpms/domain';

export const supplyPercent = (value: SupplyDecimal, denominator: SupplyDecimal): SupplyDecimal => value === null || denominator === null || decimal(denominator).lte(0) ? null : numeric(decimal(value).div(denominator).mul(100), 4);
const selectedMetrics = (total: SupplyDecimal, used: string) => ({ selectedTotal: total, selectedRemaining: subtract(total, used), selectedUsedPercent: supplyPercent(used, total), selectedRemainingPercent: supplyPercent(subtract(total, used), total) });
export function bookingStageQuantity(row: BookingView, stage: SupplyAnalyticsQuery['stage']): string {
  if (stage === 'booked') return reservedBooking(row).qty.toFixed();
  if (stage === 'accepted') return row.acceptedQty;
  return row.deletedAt ? '0' : (stage === 'vendorConfirmed' ? row.vendorConfirmedQty : row.sourceApprovedQty) ?? '0';
}
/** Apportion stage totals by the saved plan. This is explicitly a projection, never dated acceptance evidence. */
export function projectedDays(row: ReturnType<typeof bookingUsageRows>[number], quantity: string): Map<string, string> {
  const days = bookingPlanDays(row.planBasis ?? row), weights = days.map(d => bookingScaled(d.quantity)), total = bookingScaled(quantity);
  const denominator = weights.reduce((a, b) => a + b, 0n);
  if (!denominator && total) throw Error('Đặt chỗ có mức sử dụng nhưng thiếu lịch số lượng để đối chiếu.');
  let cumulative = 0n, previous = 0n;
  return new Map(days.map((day, i) => {
    cumulative += weights[i]!;
    const next = denominator ? total * cumulative / denominator : 0n, value = next - previous; previous = next;
    return [day.date, bookingUnscaled(value)];
  }));
}

export function buildSupplyAnalytics(aggregate: SupplyAggregate, bookings: BookingView[], query: SupplyAnalyticsQuery, asOf: string): SupplyAnalytics {
  const date = appDate(asOf), operational = aggregate.allocations.filter(a => !a.supersededAt && a.scopeKind === 'ENTITLEMENT' && a.slotId);
  const periods = aggregate.periods.filter(p => operational.some(a => a.periodId === p.id));
  const explicit = periods.find(p => p.id === query.period);
  if (!['CURRENT', 'ALL'].includes(query.period) && !explicit) throw Error('Không tìm thấy kỳ phân bổ của hợp đồng.');
  const selectedPeriods = periods.filter(p => query.period === 'ALL' || query.period === 'CURRENT' && isoDate(p.startDate) <= date && isoDate(p.endDate) >= date || p.id === query.period || explicit && isContractLifetimePeriod(p) && p.startDate <= explicit.endDate && p.endDate >= explicit.startDate);
  if (query.slotIds.some(id => !aggregate.slots.some(s => s.id === id))) throw Error('Slot không thuộc hợp đồng.');
  const beneficiaries = [...new Map(operational.map(a => [a.beneficiaryUnitCode ?? '__UNKNOWN__', { value: a.beneficiaryUnitCode ?? '__UNKNOWN__', label: a.beneficiaryLabel }])).values()];
  if (query.beneficiary !== 'ALL' && !beneficiaries.some(b => b.value === query.beneficiary)) throw Error('CQĐV không thuộc hợp đồng.');
  const leaves = operational.filter(a => a.status === 'APPROVED' && selectedPeriods.some(p => p.id === a.periodId) && (!query.slotIds.length || query.slotIds.includes(a.slotId!)) && (query.beneficiary === 'ALL' || (a.beneficiaryUnitCode ?? '__UNKNOWN__') === query.beneficiary));
  const bounds = selectedPeriods.length ? { startDate: selectedPeriods.map(p => isoDate(p.startDate)).sort()[0]!, endDate: selectedPeriods.map(p => isoDate(p.endDate)).sort().at(-1)! } : null;
  let keys = [...new Set(query.keys)].sort();
  if (bounds) {
    bookingDates(bounds.startDate, bounds.endDate);
    if (query.mode === 'DISCRETE') {
      if (!keys.length) throw Error('Chọn ít nhất một mốc thời gian.');
      if (keys.some(k => supplyTimeKey(k, query.grain) !== k || supplyTimeEnd(k, query.grain) < bounds.startDate || k > bounds.endDate || !selectedPeriods.some(p => k <= isoDate(p.endDate) && supplyTimeEnd(k, query.grain) >= isoDate(p.startDate)))) throw Error('Các mốc phải cùng mặt cắt và giao với kỳ phân bổ đã chọn.');
    } else {
      const from = query.from ?? bounds.startDate, to = query.to ?? bounds.endDate;
      bookingDates(from, to);
      if (from < supplyTimeKey(bounds.startDate, query.grain) || to > supplyTimeEnd(supplyTimeKey(bounds.endDate, query.grain), query.grain)) throw Error('Khoảng xem nằm ngoài phạm vi hợp đồng đã chọn.');
      keys = [];
    }
  }
  const normalized = { ...query, keys };
  const selectedDate = (day: string) => query.mode === 'DISCRETE' ? keys.includes(supplyTimeKey(day, query.grain)) : (!query.from || day >= query.from) && (!query.to || day <= query.to);
  const buckets: SupplyAnalyticsBucket[] = [], periodSummaries: SupplyAnalyticsSummary[] = [];
  const outOfPeriod: SupplyAnalytics['outOfPeriod'] = [];
  const monthCounts = new Map<string, number>();
  let reweighted = false, work = 0;
  const notices = [
    'Tổng số ở mỗi mốc được chia đều từ hạn mức sau điều chỉnh theo số ngày cung ứng, rồi cộng theo ngày/tuần/tháng/quý/năm. Có thể có số lẻ; việc chia này không tạo hạn mức đặt chỗ mới.',
    'Tại mỗi mốc: Còn lại = Tổng số − Đã sử dụng trong mốc. Tỷ lệ lấy Tổng số của chính mốc đó làm 100%. Số âm cho biết đã dùng nhiều hơn phần chia cho mốc; hạn mức đặt chỗ vẫn được kiểm tra theo kỳ.',
    'Xu hướng được tính lại từ dữ liệu đang lưu và lịch chạy của Đặt chỗ; không phải ảnh chụp số dư tại thời điểm quá khứ. Phần tương lai là lịch dự kiến.',
    'Các kỳ giữ hạn mức riêng. Phần dư kỳ cũ không tự chuyển sang kỳ mới; số dư theo đặt chỗ đã trừ cả lịch tương lai và vẫn chịu các trần, điều kiện đặt chỗ hiện hành.',
  ];
  for (const baseSlot of aggregate.slots.filter(s => leaves.some(a => a.slotId === s.id))) {
    for (const period of selectedPeriods.filter(p => leaves.some(a => a.slotId === baseSlot.id && a.periodId === p.id))) {
      const slot=supplyItemSlot(aggregate,baseSlot.id,period.id)!;
      const allocations = leaves.filter(a => a.slotId === slot.id && a.periodId === period.id);
      const rows = bookings.flatMap(b => bookingUsageRows(b, query.stage)).filter(b => allocations.some(a => a.id === b.allocationId));
      const held = bookings.flatMap(b => bookingUsageRows(b, 'booked')).filter(b => allocations.some(a => a.id === b.allocationId));
      const stageQuantity = (r:BookingView) => query.stage === 'booked' ? reservedBooking(r).qty.toFixed() : r.quantity;
      const start = [isoDate(period.startDate), aggregate.contract.startDate?.slice(0, 10), slot.startDate?.slice(0, 10)].filter((v): v is string => !!v).sort().at(-1)!;
      const end = [isoDate(period.endDate), aggregate.contract.endDate?.slice(0, 10), slot.endDate?.slice(0, 10)].filter((v): v is string => !!v).sort()[0]!;
      const days = bookingDates(start, end), total = sum(allocations.map(a => effectivePair(aggregate, a, asOf).qty));
      const bucketCount = new Set(days.map(day => supplyTimeKey(day, query.grain))).size;
      const averageBaseline = total === null ? null : numeric(decimal(total).div(bucketCount));
      monthCounts.set(`${slot.id}:${period.id}`, calendarMonths(start, end));
      work += days.length * (allocations.length + 1) + rows.reduce((n, r) => n + (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000 + 1, 0);
      if (work > 1000000) throw Error('Phạm vi dữ liệu quá lớn; chọn một slot hoặc một kỳ phân bổ để xem.');
      // Distribute each entitlement once, so ALL and per-beneficiary projections conserve identical daily quantities.
      const theory = total === null ? null : new Map<string, string>();
      if (theory) for (const allocation of allocations) {
        for (const day of bookingPlanDays({ startDate: start, endDate: end, quantity: effectivePair(aggregate, allocation, asOf).qty! })) {
          theory.set(day.date, decimal(theory.get(day.date) ?? '0').plus(day.quantity).toFixed());
        }
      }
      const usage = new Map<string, string>();
      let outsideBookings = 0, before = '0', after = '0';
      for (const row of rows) {
        const qty = stageQuantity(row);
        if (decimal(qty).isZero()) continue;
        if (row.startDate < start || row.endDate > end) outsideBookings++;
        if (query.stage !== 'booked' || qty !== row.quantity) reweighted = true;
        for (const [day, count] of projectedDays(row, qty)) {
          if (day < start) before = decimal(before).plus(count).toFixed();
          else if (day > end) after = decimal(after).plus(count).toFixed();
          else usage.set(day, decimal(usage.get(day) ?? '0').plus(count).toFixed());
        }
      }
      const used = sum(rows.map(stageQuantity))!, booked = sum(held.map(r => reservedBooking(r).qty.toFixed()))!;
      const remaining = subtract(total, used), periodName = formatSupplyPeriodName(period), unit = slot.quantityUnit ?? slot.unit;
      if (outsideBookings) outOfPeriod.push({ slotId: slot.id, periodId: period.id, slotName: slot.name, periodName, bookings: outsideBookings, before, after });
      const group = new Map<string, SupplyAnalyticsBucket>();
      let cumulativeUsed = before, cumulativeTheory: SupplyDecimal = theory ? '0' : null;
      for (const day of days) {
        cumulativeUsed = decimal(cumulativeUsed).plus(usage.get(day) ?? '0').toFixed();
        cumulativeTheory = sum([cumulativeTheory, theory?.get(day) ?? null]);
        if (!selectedDate(day)) continue;
        const key = supplyTimeKey(day, query.grain);
        const row: SupplyAnalyticsBucket = group.get(key) ?? { id: `${slot.id}:${period.id}:${key}`, slotId: slot.id, name: slot.name, unit, periodId: period.id, periodName, key, startDate: day, endDate: day, label: supplyTimeLabel(key, query.grain), theory: '0', used: '0', pacingPercent: null, delta: null, usedPercent: null, remaining: null, remainingPercent: null, theoryRemaining: null, theoryRemainingPercent: null, timeTotal: null, timeRemaining: null, timeUsedPercent: null, timeRemainingPercent: null, averageBaseline, usedVsAveragePercent: null, future: day > date };
        row.endDate = day; row.theory = sum([row.theory, theory?.get(day) ?? null]); row.used = decimal(row.used).plus(usage.get(day) ?? '0').toFixed();
        row.remaining = subtract(total, cumulativeUsed); row.theoryRemaining = subtract(total, cumulativeTheory);
        group.set(key, row);
      }
      for (const row of group.values()) {
        row.timeTotal = row.theory; row.timeRemaining = subtract(row.timeTotal, row.used);
        row.timeUsedPercent = supplyPercent(row.used, row.timeTotal); row.timeRemainingPercent = supplyPercent(row.timeRemaining, row.timeTotal);
        row.pacingPercent = supplyPercent(row.used, row.theory); row.delta = subtract(row.used, row.theory);
        row.usedVsAveragePercent = supplyPercent(row.used, row.averageBaseline);
        row.usedPercent = supplyPercent(row.used, total); row.remainingPercent = supplyPercent(row.remaining, total); row.theoryRemainingPercent = supplyPercent(row.theoryRemaining, total);
        buckets.push(row);
      }
      const theorySelected = sum([...group.values()].map(b => b.theory));
      // A full-period table includes charges against this entitlement even if their original run dates sit outside it.
      // Partial time slices and chart bars stay faithful to actual run dates.
      const fullPeriodSelected = days.every(selectedDate);
      const usedSelected = sum([...group.values()].map(b => b.used).concat(fullPeriodSelected ? [before, after] : []))!;
      const reasons = [...new Set([
        ...(outsideBookings ? [`${outsideBookings} đặt chỗ chạy ngoài kỳ; tổng kỳ vẫn trừ hạn mức, biểu đồ chỉ hiện ngày chạy trong kỳ`] : []),
        ...(slot.capacityMode === 'UNKNOWN' ? ['Quy tắc trùng lịch chưa xác định'] : []),
        ...(total === null ? ['Hạn mức số lượng chưa xác định'] : []),
        ...(aggregate.contract.status !== 'ACTIVE' || slot.status !== 'ACTIVE' ? ['Hợp đồng hoặc slot chưa hoạt động'] : []),
        ...[...aggregate.contract.quality, ...slot.quality, ...allocations.flatMap(a => a.quality)].filter(q => q.severity === 'BLOCK').map(q => q.message),
      ])];
      periodSummaries.push({ id: `${slot.id}:${period.id}`, slotId: slot.id, name: slot.name, unit, periodId: period.id, periodName, total, used, remaining, usedPercent: supplyPercent(used, total), remainingPercent: supplyPercent(remaining, total), booked, reservedRemaining: subtract(total, booked), monthlyAverage: total === null ? null : numeric(decimal(total).div(calendarMonths(start, end))), theorySelected, usedSelected, ...selectedMetrics(theorySelected, usedSelected), pacingPercent: supplyPercent(usedSelected, theorySelected), delta: subtract(usedSelected, theorySelected), expiry: end < date ? 'PAST' : start > date ? 'FUTURE' : 'CURRENT', reasons });
    }
  }
  if (buckets.length > 12000) throw Error('Bảng vượt 12.000 dòng; thu hẹp kỳ hoặc slot để xem.');
  const summaries = aggregate.slots.flatMap(slot => {
    const rows = periodSummaries.filter(r => r.slotId === slot.id); if (!rows.length) return [];
    const total = sum(rows.map(r => r.total)), used = sum(rows.map(r => r.used))!, booked = sum(rows.map(r => r.booked))!, remaining = subtract(total, used);
    const theorySelected = sum(rows.map(r => r.theorySelected)), usedSelected = sum(rows.map(r => r.usedSelected))!;
    const months = rows.reduce((n, r) => n + monthCounts.get(r.id)!, 0);
    return [{ ...rows[0]!, id: slot.id, periodId: null, periodName: rows.map(r => r.periodName).join(' · '), total, used, remaining, booked, reservedRemaining: subtract(total, booked), usedPercent: supplyPercent(used, total), remainingPercent: supplyPercent(remaining, total), monthlyAverage: total === null || !months ? null : numeric(decimal(total).div(months)), theorySelected, usedSelected, ...selectedMetrics(theorySelected, usedSelected), pacingPercent: supplyPercent(usedSelected, theorySelected), delta: subtract(usedSelected, theorySelected), expiry: rows.every(r => r.expiry === rows[0]!.expiry) ? rows[0]!.expiry : 'MIXED' as const, reasons: [...new Set(rows.flatMap(r => r.reasons))] }];
  });
  if (reweighted || query.stage !== 'booked') notices.push('Số xác nhận, phê duyệt, nghiệm thu hoặc số giữ lại sau xóa được quy đổi theo tỷ trọng lịch đặt chỗ. Chưa có dữ liệu xác nhận/nghiệm thu theo từng ngày; các con số thời gian này là phân bổ ước tính, không phải kết quả ghi nhận tại ngày đó.');
  return { version: 1, asOf, date, query: normalized, bounds, summaries, periodSummaries, buckets, beneficiaries, outOfPeriod, usageBasis: reweighted || query.stage !== 'booked' ? 'REWEIGHTED_SCHEDULE' : 'BOOKING_SCHEDULE', notices };
}
