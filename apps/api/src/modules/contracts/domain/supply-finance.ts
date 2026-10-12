import { bookingDates, bookingEffective, bookingPending, formatSupplyPeriodName, supplyItemTax, supplyTimeKey, supplyTimeLabel, type BookingView, type SupplyAggregate, type SupplyAnalytics, type SupplyFinance, type SupplyFinanceCampaign, type SupplyFinancePeriod, type SupplyMoney } from '@cpms/domain';
import { bookingUsageRows } from '../../booking/domain/booking-workflow';
import { reservedBooking } from '../../booking/domain/booking-engine';
import { add, decimal, effectivePair, numeric, subtract, sum } from './supply-engine';
import { projectedDays, supplyPercent } from './supply-analytics';

const zero = (): SupplyMoney => ({ net: '0', gross: '0' });
const unknown = (): SupplyMoney => ({ net: null, gross: null });
const plus = (a: SupplyMoney, b: SupplyMoney): SupplyMoney => ({ net: add(a.net, b.net), gross: add(a.gross, b.gross) });
const minus = (a: SupplyMoney, b: SupplyMoney): SupplyMoney => ({ net: subtract(a.net, b.net), gross: subtract(a.gross, b.gross) });
const percent = (a: SupplyMoney, b: SupplyMoney): SupplyMoney => ({ net: supplyPercent(a.net, b.net), gross: supplyPercent(a.gross, b.gross) });
const total = (rows: SupplyMoney[]) => rows.reduce(plus, zero());
const daysTotal = (days: Map<string, SupplyMoney>, match: (day: string) => boolean) => total([...days].filter(([day]) => match(day)).map(([, value]) => value));

/** Money is apportioned with the same saved schedule as inventory; no present-day reprice. */
function moneyDays(row: ReturnType<typeof bookingUsageRows>[number], held: boolean) {
  const qty = held ? reservedBooking(row).qty.toFixed() : row.quantity;
  const net = numeric(decimal(qty).mul(row.unitPrice).div(row.priceBasis), 6)!;
  const gross = decimal(net).plus(numeric(decimal(net).mul(row.taxRate), 6)!).toFixed();
  const netDays = projectedDays(row, net), grossDays = projectedDays(row, gross);
  return new Map([...netDays].map(([day, value]) => [day, { net: value, gross: grossDays.get(day)! }]));
}

/** Read projection under the same supply lock as analytics. CAP rows are constraints, never added as stock. */
export function buildSupplyFinance(aggregate: SupplyAggregate, bookings: BookingView[], report: SupplyAnalytics): SupplyFinance {
  const { query, date, asOf } = report;
  const periodIds = new Set(report.periodSummaries.map(p => p.periodId));
  const scoped = aggregate.allocations.filter(a => a.scopeKind === 'ENTITLEMENT' && periodIds.has(a.periodId)
    && (!query.slotIds.length || query.slotIds.includes(a.slotId ?? '')) && (query.beneficiary === 'ALL' || (a.beneficiaryUnitCode ?? '__UNKNOWN__') === query.beneficiary));
  const notices = ['Giá trị được phân bổ theo lịch chạy đang lưu, không phải tiền đã thanh toán hoặc ảnh chụp lịch sử số dư. Giá/VAT dùng bản lưu của đặt chỗ.',
    'Các chỉ số đầu kỳ đến hôm nay và lịch sắp tới luôn xem toàn kỳ đã chọn; biểu đồ chiến dịch dùng khoảng Từ/Đến. Còn có thể phân bổ luôn trừ mọi khoản giữ chỗ, độc lập cách tính Đã sử dụng.',
    'Số dư tiền không thay thế kiểm tra trần số lượng, CQĐV, hạng mục và hạn dùng. Các kỳ không chuyển số dư cho nhau.'];
  if (query.stage !== 'booked') notices.push('Giá trị xác nhận/phê duyệt/nghiệm thu theo tháng là quy đổi theo lịch đặt chỗ, chưa phải ngày thực tế phát sinh xác nhận hoặc nghiệm thu.');
  const selectedDate = (day: string) => query.mode === 'DISCRETE' ? query.keys.includes(supplyTimeKey(day, query.grain)) : (!query.from || day >= query.from) && (!query.to || day <= query.to);
  const campaigns = new Map<string, SupplyFinanceCampaign>();
  const heldRows = bookings.flatMap(b => bookingUsageRows(b, 'booked'));
  const periods: SupplyFinancePeriod[] = [];
  for (const period of aggregate.periods.filter(p => periodIds.has(p.id))) {
    const allocations = scoped.filter(a => a.periodId === period.id), ids = new Set(allocations.map(a => a.id));
    const live = allocations.filter(a => !a.supersededAt && a.status === 'APPROVED');
    const budget = total(live.map(a => {
      const amount = effectivePair(aggregate, a, asOf).amount, tax = supplyItemTax(aggregate, a.slotId!, a.periodId) ?? a.taxRate;
      return { net: amount, gross: amount === null || tax === null ? null : numeric(decimal(amount).mul(decimal(1).plus(tax)), 6) };
    }));
    const usage = new Map<string, SupplyMoney>(), held = new Map<string, SupplyMoney>();
    const issues: string[] = [];
    const startDate = period.startDate.slice(0, 10), endDate = period.endDate.slice(0, 10);
    const dateList = bookingDates(startDate, endDate);
    const accumulate = (rows: ReturnType<typeof bookingUsageRows>, destination: Map<string, SupplyMoney>, isHeld: boolean) => {
      for (const row of rows.filter(r => ids.has(r.allocationId))) {
        const days = moneyDays(row, isHeld || query.stage === 'booked');
        for (const [day, value] of days) {
          if (day < startDate || day > endDate) { issues.push('Có lịch đặt chỗ ngoài kỳ; cần đối soát trước khi phân bổ thêm.'); continue; }
          destination.set(day, plus(destination.get(day) ?? zero(), value));
        }
        if (isHeld) continue;
        const selected = daysTotal(days, day => day >= startDate && day <= endDate && selectedDate(day));
        if (!decimal(selected.net ?? '0').gt(0) && !decimal(selected.gross ?? '0').gt(0)) continue;
        const key = row.campaignId ?? `unlinked:${row.campaignLabel.trim().toLocaleLowerCase('vi-VN')}`;
        const campaign = campaigns.get(key) ?? { id: key, campaignId: row.campaignId, label: row.campaignLabel || 'Chưa liên kết chiến dịch', value: zero(), percent: unknown(), bookings: [] };
        campaign.value = plus(campaign.value, selected);
        campaign.bookings.push({ id: row.id, campaignLabel: row.campaignLabel, slotName: row.contractSnapshot?.slotName ?? aggregate.slots.find(s => s.id === row.slotId)?.name ?? '', startDate: row.startDate, endDate: row.endDate, value: selected });
        campaigns.set(key, campaign);
      }
    };
    accumulate(bookings.flatMap(b => bookingUsageRows(b, query.stage)), usage, false);
    accumulate(heldRows, held, true);
    for (const row of bookings.filter(b => bookingPending(b))) {
      const effective = bookingEffective(row);
      if (effective?.allocationId === row.allocationId && ids.has(row.allocationId) && (effective.unitPrice !== row.unitPrice || effective.priceBasis !== row.priceBasis || effective.taxRate !== row.taxRate)) {
        issues.push('Đặt chỗ đang sửa giá/VAT trong cùng phân bổ: cần hoàn tất quyết định trước khi kết luận số tiền có thể phân bổ thêm.');
      }
    }
    const heldTotal = total([...held.values()]);
    let available = minus(budget, heldTotal);
    const capBounds: { ids: Set<string>; reduction: string }[] = [];
    // Containing caps can further restrict this scope. Do not add cap amounts to the allocation budget.
    for (const cap of aggregate.allocations.filter(a => !a.supersededAt && a.status === 'APPROVED' && a.scopeKind === 'CAP' && a.limitMode === 'HARD_LIMIT')) {
      const capPeriod = aggregate.periods.find(p => p.id === cap.periodId)!;
      const memberIds = new Set(aggregate.allocations.filter(a => a.scopeKind === 'ENTITLEMENT' && (!cap.slotId || cap.slotId === a.slotId) && (!cap.beneficiaryUnitCode || cap.beneficiaryUnitCode === a.beneficiaryUnitCode)).filter(a => {
        const p = aggregate.periods.find(p => p.id === a.periodId)!;
        return p.startDate >= capPeriod.startDate && p.endDate <= capPeriod.endDate;
      }).map(a => a.id));
      const members = live.filter(a => memberIds.has(a.id));
      if (!members.length) continue;
      const limit = effectivePair(aggregate, cap, asOf).amount;
      if (limit === null) continue;
      const capUsed = sum(heldRows.filter(r => memberIds.has(r.allocationId)).map(r => numeric(reservedBooking(r).amount, 6)))!;
      const memberBudget = sum(members.map(a => effectivePair(aggregate, a, asOf).amount));
      const memberUsed = sum(heldRows.filter(r => memberIds.has(r.allocationId) && ids.has(r.allocationId)).map(r => numeric(reservedBooking(r).amount, 6)))!;
      const reduction = subtract(subtract(limit, capUsed), subtract(memberBudget, memberUsed));
      if (reduction !== null && decimal(reduction).lt(0)) {
        const ids = new Set(members.map(a => a.id));
        const same = capBounds.find(b => b.ids.size === ids.size && [...ids].every(id => b.ids.has(id)));
        if (same) same.reduction = decimal(reduction).lt(same.reduction) ? reduction : same.reduction;
        else capBounds.push({ ids, reduction });
      }
    }
    if (capBounds.length) {
      const contains = (outer: Set<string>, inner: Set<string>) => [...inner].every(id => outer.has(id));
      const crosses = capBounds.some((a, i) => capBounds.slice(i + 1).some(b => [...a.ids].some(id => b.ids.has(id)) && !contains(a.ids, b.ids) && !contains(b.ids, a.ids)));
      if (crosses) {
        available = unknown();
        issues.push('Có các trần tiền giao nhau ngoài cây phân bổ; cần đối soát trước khi kết luận số tiền có thể phân bổ thêm.');
      } else {
        // Disjoint caps add their reductions; nested caps constrain the same money only once.
        const parents = capBounds.map((b, i) => capBounds.map((p, j) => ({ p, j })).filter(({ p, j }) => j !== i && contains(p.ids, b.ids)).sort((a, b) => a.p.ids.size - b.p.ids.size)[0]?.j ?? -1);
        const constrained = (i: number): string => {
          const children = capBounds.map((_, j) => j).filter(j => parents[j] === i);
          const childReduction = sum(children.map(constrained))!;
          return decimal(childReduction).lt(capBounds[i]!.reduction) ? childReduction : capBounds[i]!.reduction;
        };
        const reduction = sum(capBounds.map((_, i) => i).filter(i => parents[i] === -1).map(constrained))!;
        available = { net: add(available.net, reduction), gross: null };
        issues.push('Số dư bị giới hạn thêm bởi trần chung; chưa quy đổi số dư trần chung sang sau VAT.');
      }
    }
    if (issues.some(i => i.includes('ngoài kỳ') || i.includes('đang sửa giá'))) available = unknown();
    if (live.some(a => a.vatEstimated)) issues.push('Một phần VAT của kỳ là dự kiến theo dữ liệu phân bổ.');
    const months = [...new Set(dateList.filter(selectedDate).map(d => d.slice(0, 7)))].map(key => {
      const days = dateList.filter(d => d.startsWith(key) && selectedDate(d)), last = days.at(-1)!;
      return { key, label:supplyTimeLabel(`${key}-01`, 'MONTH'), startDate:days[0]!, endDate:last, used:daysTotal(usage, d => d.startsWith(key) && selectedDate(d)), cumulative:daysTotal(usage, d => d <= last), reserved:daysTotal(held, d => d <= last) };
    });
    const recentStart = new Date(Date.parse(`${date}T00:00:00Z`) - 59 * 86400000).toISOString().slice(0, 10);
    const recentDays = dateList.filter(d => d >= recentStart && d <= date).length, future = dateList.filter(d => d > date);
    const recent = daysTotal(held, d => d >= recentStart && d <= date);
    const recentDaily: SupplyMoney = recentDays && decimal(recent.net ?? '0').gt(0) ? { net: numeric(decimal(recent.net!).div(recentDays), 6), gross: recent.gross === null ? null : numeric(decimal(recent.gross).div(recentDays), 6) } : unknown();
    const forecastAdditional = recentDaily.net === null ? unknown() : total(future.map(d => {
      const expected = minus(recentDaily, held.get(d) ?? zero());
      return { net: expected.net === null ? null : decimal(expected.net).gt(0) ? expected.net : '0', gross: expected.gross === null ? null : decimal(expected.gross).gt(0) ? expected.gross : '0' };
    }));
    periods.push({ id: period.id, name: formatSupplyPeriodName(period), startDate, endDate, budget,
      monthToDate: daysTotal(usage, d => d.startsWith(date.slice(0, 7)) && d <= date), elapsed: daysTotal(usage, d => d <= date), scheduled: daysTotal(usage, d => d > date),
      heldElapsed: daysTotal(held, d => d <= date), heldFuture: daysTotal(held, d => d > date), held: heldTotal, available,
      usedPercent: percent(daysTotal(usage, d => d <= date), budget), heldPercent: percent(heldTotal, budget),
      recentDaily, forecastAdditional, forecastRemaining: minus(available, forecastAdditional), recentDays, futureDays: future.length, months, issues: [...new Set(issues)] });
  }
  const selected = total([...campaigns.values()].map(c => c.value));
  return { currency: aggregate.contract.currency, periods, selected, from: query.from ?? report.bounds?.startDate ?? null, to: query.to ?? report.bounds?.endDate ?? null,
    campaigns: [...campaigns.values()].map(c => ({ ...c, percent: percent(c.value, selected) })).sort((a, b) => decimal(b.value.net ?? 0).cmp(a.value.net ?? 0)), notices };
}
