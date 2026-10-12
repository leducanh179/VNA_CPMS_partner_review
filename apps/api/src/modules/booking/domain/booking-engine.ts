import type { BookingFields, BookingIssue, BookingTemplateDefinition, BookingView, SupplyAggregate } from '@cpms/domain';
import { BOOKING_METRICS, bookingPlanDays, bookingPlanBuckets, bookingDateNumber } from '@cpms/domain';
import { appDate, calendarMonths, decimal, effectivePair, numeric, parseSourceDate } from '../../contracts/domain/supply-engine';
import { physicalIntervals, reservationRows } from './booking-workflow';
import { supplyItemSlot, supplyItemTax } from '@cpms/domain';

export function priceBooking(fields: BookingFields, supply: SupplyAggregate) {
  const allocation = supply.allocations.find(a => a.id === fields.allocationId);
  const slot = allocation ? supplyItemSlot(supply,allocation.slotId??'',allocation.periodId) : undefined;
  const period = supply.periods.find(p => p.id === allocation?.periodId);
  if (!allocation || !slot || !period) throw new Error('Không tìm thấy slot và kỳ phân bổ.');
  if (allocation.supersededAt || allocation.scopeKind !== 'ENTITLEMENT' || allocation.status !== 'APPROVED' || slot.status !== 'ACTIVE' || supply.contract.status !== 'ACTIVE') throw new Error('Hợp đồng, slot hoặc phân bổ chưa có hiệu lực.');
  const start = parseSourceDate(fields.startDate), end = parseSourceDate(fields.endDate);
  if (!start || !end || start > end) throw new Error('Thời gian bắt đầu/kết thúc không hợp lệ.');
  if (fields.overallStartDate) bookingDateNumber(fields.overallStartDate);
  if (fields.overallEndDate) bookingDateNumber(fields.overallEndDate);
  if (fields.overallStartDate && fields.overallEndDate && fields.overallStartDate > fields.overallEndDate) throw Error('Ngày bắt đầu tổng thể không được sau ngày kết thúc tổng thể.');
  bookingPlanDays(fields);
  for (const range of [period, supply.contract, slot]) {
    if (range.startDate && start < range.startDate.slice(0, 10) || range.endDate && end > range.endDate.slice(0, 10)) throw new Error('Lịch chạy phải nằm trong cùng kỳ phân bổ và thời hạn cung ứng. Tách dòng nếu chạy qua nhiều kỳ.');
  }
  if ([...allocation.quality, ...slot.quality, ...supply.contract.quality].some(i => i.severity === 'BLOCK')) throw new Error('Nguồn phân bổ có dữ liệu cần xử lý.');
  const term=supply.itemTerms?.find(t=>t.slotId===slot.id&&t.periodId===period.id)?.effective;
  const unitPrice = term?.unitPrice ?? allocation.unitPrice ?? slot.unitPrice, priceBasis = slot.priceBasis, taxRate = supplyItemTax(supply,slot.id,period.id)??allocation.taxRate;
  if (unitPrice === null || priceBasis === null || taxRate === null || decimal(priceBasis).lte(0)) throw new Error('Thiếu đơn giá, cơ sở tính giá hoặc VAT của phân bổ.');
  const qty = decimal(fields.quantity);
  if (!qty.isFinite() || qty.lte(0) || qty.gte('1e18') || qty.decimalPlaces() > 10) throw new Error('Số lượng phải lớn hơn 0 và có tối đa 10 chữ số thập phân.');
  const unit = slot.quantityUnit ?? slot.unit;
  if (!unit) throw new Error('Chưa xác định đơn vị của slot.');
  if (/^(ngày|day|video|gói)$/i.test(unit) && !qty.isInteger()) throw new Error('Đơn vị Ngày, Video hoặc Gói cần số lượng nguyên.');
  if (/^(ngày|day)$/i.test(unit) && qty.gt((Date.parse(end) - Date.parse(start)) / 86400000 + 1)) throw new Error('Số ngày đặt vượt độ dài lịch chạy.');
  const amount = numeric(qty.mul(unitPrice).div(priceBasis), 6)!;
  const vat = numeric(decimal(amount).mul(taxRate), 6)!;
  return { contractId: supply.contract.id, slotId: slot.id, quantity: qty.toFixed(), unit, unitPrice, priceBasis, taxRate, amount, vat, gross: numeric(decimal(amount).plus(vat), 6)! };
}

export function reservedBooking(row: BookingView):{qty:ReturnType<typeof decimal>;amount:ReturnType<typeof decimal>} {
  if(row.workflow){const parts=reservationRows(row).map(reservedBooking);return {qty:parts.reduce((sum,p)=>sum.plus(p.qty),decimal(0)),amount:parts.reduce((sum,p)=>sum.plus(p.amount),decimal(0))};}
  const qty = row.deletedAt ? decimal(row.acceptedQty) : decimal(row.quantity).gt(row.acceptedQty) ? decimal(row.quantity) : decimal(row.acceptedQty);
  return { qty, amount: qty.mul(row.unitPrice).div(row.priceBasis) };
}

/** Count physical reservations across all beneficiary allocations, once per booking at any date. */
export function slotPeakConcurrency(slotId:string, rows:BookingView[], startDate:string, endDate:string):number {
  const intervals=rows.flatMap(physicalIntervals).filter(r=>r.slotId===slotId&&r.startDate<=endDate&&r.endDate>=startDate);
  const events=intervals.flatMap(r=>[
    {date:r.startDate<startDate?startDate:r.startDate,delta:1},
    {date:new Date(Date.parse(r.endDate>endDate?endDate:r.endDate)+86400000).toISOString().slice(0,10),delta:-1},
  ]).sort((a,b)=>a.date.localeCompare(b.date)||a.delta-b.delta);
  let current=0;
  return events.reduce((peak,event)=>{current+=event.delta;return Math.max(peak,current);},0);
}

/** Recompute from all persisted rows plus the proposed complete batch, under the transaction fence. */
export function checkBookingLimits(supply: SupplyAggregate, all: BookingView[], proposed: BookingView[], asOf: string): BookingIssue[] {
  const issues: BookingIssue[] = [];
  const proposedIds = new Set(proposed.map(r => r.id));
  const originalRows = [...all.filter(r => !proposedIds.has(r.id)), ...proposed];
  const rows = originalRows.flatMap(reservationRows);
  const at = appDate(asOf);
  const affected = new Set([...proposed.flatMap(r=>[r.allocationId,...reservationRows(r).map(p=>p.allocationId)]), ...all.filter(r => proposedIds.has(r.id)).flatMap(r=>reservationRows(r).map(p=>p.allocationId))]);
  for (const a of supply.allocations.filter(a => !a.supersededAt && (affected.has(a.id) || a.scopeKind === 'CAP' && a.status === 'APPROVED'))) {
    const p = supply.periods.find(p => p.id === a.periodId)!;
    const members = a.scopeKind === 'ENTITLEMENT' ? rows.filter(r => r.allocationId === a.id) : rows.filter(r => {
      const leaf = supply.allocations.find(l => l.id === r.allocationId);
      const lp = supply.periods.find(t => t.id === leaf?.periodId);
      return leaf && lp && (!a.slotId || a.slotId === r.slotId) && (!a.beneficiaryUnitCode || leaf.beneficiaryUnitCode === a.beneficiaryUnitCode)
        && lp.startDate >= p.startDate && lp.endDate <= p.endDate;
    });
    const used = members.reduce((v, r) => { const n = reservedBooking(r); return { qty: v.qty.plus(n.qty), amount: v.amount.plus(n.amount) }; }, { qty: decimal(0), amount: decimal(0) });
    const limit = effectivePair(supply, a, asOf);
    const indexes = proposed.flatMap((r, i) => r.allocationId === a.id || members.some(m => m.id === r.id) ? [i] : []);
    if (!indexes.length) continue;
    for (const index of indexes) {
      if (a.scopeKind === 'ENTITLEMENT' && limit.qty === null) issues.push({ index, field: 'quantity', severity: 'BLOCK', message: 'Chưa xác định hạn mức số lượng của kỳ.' });
      if (limit.qty !== null && (a.scopeKind === 'ENTITLEMENT' || a.slotId) && used.qty.gt(limit.qty)) issues.push({ index, field: 'quantity', severity: 'BLOCK', message: `Vượt hạn mức số lượng: tổng giữ/đã sử dụng ${used.qty.toFixed()}, hạn mức ${limit.qty}.` });
      if (limit.amount !== null && used.amount.toDecimalPlaces(6).gt(limit.amount)) issues.push({ index, field: 'quantity', severity: 'BLOCK', message: `Vượt hạn mức tiền trước VAT của ${a.scopeKind === 'CAP' ? 'trần chung' : 'slot/kỳ'}.` });
    }
    if (a.scopeKind !== 'ENTITLEMENT') continue;
    const months = calendarMonths(at > p.startDate ? at : p.startDate, p.endDate);
    const previous = all.filter(r => r.allocationId === a.id && !proposedIds.has(r.id)).reduce((n,r) => n.plus(reservedBooking(r).qty), decimal(0));
    const avg = months && limit.qty !== null ? decimal(limit.qty).minus(previous).div(months) : null;
    // Compare aggregate proposed pacing against one common pre-batch reference.
    const monthLoads = new Map<string, ReturnType<typeof decimal>>();
    for (const row of proposed.filter(r => r.allocationId === a.id && !r.deletedAt)) {
      for (const bucket of bookingPlanBuckets(bookingPlanDays(row), 'MONTH')) {
        const month = bucket.startDate.slice(0,7);
        monthLoads.set(month,(monthLoads.get(month) ?? decimal(0)).plus(bucket.quantity));
      }
    }
    if (avg && [...monthLoads.values()].some(q => q.gt(avg))) for (const index of indexes) issues.push({ index, field: 'quantity', severity: 'WARNING', message: `Lượng đặt theo tháng vượt bình quân còn lại ${avg.toDecimalPlaces(2).toFixed()}/tháng (theo phân bổ kế hoạch).` });
  }
  for (const [index,row] of proposed.entries()) {
    if (row.deletedAt) continue;
    if (row.overallStartDate && row.startDate < row.overallStartDate || row.overallEndDate && row.endDate > row.overallEndDate) issues.push({index,field:'startDate',severity:'WARNING',message:'Ngày chạy nằm ngoài thời gian tổng thể. Kiểm tra ngày hoặc mở rộng thời gian tổng thể.'});
    const allocation = supply.allocations.find(a=>a.id===row.allocationId)!;
    const slot = supplyItemSlot(supply,row.slotId,allocation.periodId)!;
    if (slot.capacityMode === 'UNKNOWN') issues.push({ index, field: 'startDate', severity: 'WARNING', message: 'Chưa có quy tắc công suất/trùng lịch được xác nhận cho slot.' });
    if (['EXCLUSIVE','SHARED_CAPACITY'].includes(slot.capacityMode)) {
      const limit = slot.capacityMode === 'EXCLUSIVE' ? 1 : slot.capacity;
      const max = slotPeakConcurrency(row.slotId,originalRows,row.startDate,row.endDate);
      if (!limit || max > limit) issues.push({ index, field: 'startDate', severity: 'BLOCK', message: slot.capacityMode==='EXCLUSIVE'?'Hạng mục không cho phép đặt chỗ trùng khung thời gian (vượt công suất đồng thời).':'Lịch đặt vượt công suất đồng thời của slot.' });
    }
    if (!row.campaignId) issues.push({ index, field: 'campaignLabel', severity: 'WARNING', message: 'Tên chiến dịch tự do, chưa liên kết phân hệ Chiến dịch.' });
  }
  return issues;
}

export function calculateBookingReport(input: Record<string, string | null>, template: BookingTemplateDefinition, slotId: string) {
  const allowed = new Set<string>([...template.metrics, 'fileUrl', 'liveUrl', 'note']);
  const result: Record<string, string | null> = {};
  for (const [key,value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`Chỉ số ${key} không thuộc mẫu báo cáo.`);
    if (value == null || value === '') { result[key] = null; continue; }
    if (BOOKING_METRICS.some(m => m.key === key)) {
      if (template.excludedSlotIds.includes(slotId)) throw new Error('Slot sản xuất không áp dụng chỉ số truyền thông của mẫu này.');
      if (!/^\d+(\.\d{1,6})?$/.test(value) || decimal(value).gte('1e18')) throw new Error(`Giá trị ${key} không hợp lệ.`);
      result[key] = decimal(value).toFixed();
    } else if (key.endsWith('Url')) {
      const url = new URL(value); if (!['https:','http:'].includes(url.protocol)) throw new Error('Link báo cáo phải dùng http/https.');
      result[key] = url.href;
    } else result[key] = value;
  }
  const rate = (n: string, d: string | null) => d && result[n] != null && result[d] != null && decimal(result[d]!).gt(0) ? numeric(decimal(result[n]!).div(result[d]!).mul(100),6) : null;
  result.linkClickRate = rate('linkClick','impression');
  result.conversionRate = rate('conversion',template.conversionDenominator);
  return result;
}
