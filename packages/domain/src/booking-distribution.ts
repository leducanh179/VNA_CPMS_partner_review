/** A booking owns one plan. Calendar buckets are projections, never additional stock. */
export interface BookingTimeSegment { startDate: string; endDate: string; quantity: string }
export interface BookingTimeDistribution {
  version: 1;
  mode: 'AUTO' | 'CUSTOM';
  segments: BookingTimeSegment[];
  fillRemainder: boolean;
}
export interface BookingPlanInput {
  startDate: string; endDate: string; quantity: string;
  timeDistribution?: BookingTimeDistribution | undefined;
  amount?: string; vat?: string;
}
export interface BookingPlanDay { date: string; quantity: string; amount: string; vat: string; gross: string; manual: boolean }
export interface BookingPlanBucket { startDate: string; endDate: string; quantity: string; amount: string; vat: string; gross: string; manual: boolean }
export const automaticBookingDistribution = (): BookingTimeDistribution => ({ version: 1, mode: 'AUTO', segments: [], fillRemainder: true });
const DAY = 86400000;
export function bookingDateNumber(value: string): number {
  const n = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw Error('Ngày phân bổ không hợp lệ.');
  return n;
}
export function bookingDates(startDate: string, endDate: string): string[] {
  const start = bookingDateNumber(startDate), end = bookingDateNumber(endDate), length = (end - start) / DAY + 1;
  if (length < 1 || length > 3660) throw Error('Khoảng phân bổ phải từ 1 đến 3.660 ngày.');
  return Array.from({ length }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}
export function bookingScaled(value: string, scale = 10): bigint {
  if (value.length > 40 || !/^\d+(\.\d+)?$/.test(value)) throw Error('Số lượng phân bổ phải là số không âm.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) throw Error(`Số lượng có tối đa ${scale} chữ số thập phân.`);
  return BigInt(whole! + fraction.slice(0, scale).padEnd(scale, '0'));
}
export function bookingUnscaled(value: bigint, scale = 10): string {
  const sign = value < 0n ? '-' : '', text = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  const fraction = scale ? text.slice(-scale).replace(/0+$/, '') : '';
  return sign + (scale ? text.slice(0, -scale) : text) + (fraction ? `.${fraction}` : '');
}
export function bookingExactSum(values: readonly string[], scale = 10): string {
  return bookingUnscaled(values.reduce((sum, v) => sum + bookingScaled(v, scale), 0n), scale);
}
function split(total: bigint, indexes: number[], values: bigint[]) {
  if (!indexes.length) { if (total !== 0n) throw Error('Tổng phân bổ chưa khớp số lượng booking.'); return; }
  const count = BigInt(indexes.length), base = total / count, remainder = total % count;
  indexes.forEach((index, i) => { values[index] = base + (BigInt(i) < remainder ? 1n : 0n); });
}
/** Cumulative integer apportionment preserves the exact saved amount/VAT across every date cut. */
function moneyByDay(total: string, weights: bigint[]): bigint[] {
  const amount = bookingScaled(total, 6), sum = weights.reduce((a, b) => a + b, 0n);
  if (!sum) return weights.map(() => 0n);
  let cumulative = 0n, previous = 0n;
  return weights.map(w => { cumulative += w; const next = (amount * cumulative + sum / 2n) / sum; const part = next - previous; previous = next; return part; });
}
export function bookingPlanDays(input: BookingPlanInput): BookingPlanDay[] {
  const dates = bookingDates(input.startDate, input.endDate), total = bookingScaled(input.quantity);
  const plan = input.timeDistribution ?? automaticBookingDistribution();
  const values = dates.map(() => 0n), manual = dates.map(() => false);
  if (plan.version !== 1 || !['AUTO', 'CUSTOM'].includes(plan.mode)) throw Error('Phiên bản phân bổ không được hỗ trợ.');
  if (plan.mode === 'AUTO') split(total, dates.map((_, i) => i), values);
  else {
    let assigned = 0n;
    if (plan.segments.length > 3660) throw Error('Tối đa 3.660 khoảng phân bổ.');
    for (const segment of plan.segments) {
      bookingDates(segment.startDate, segment.endDate);
      if (segment.startDate < input.startDate || segment.endDate > input.endDate) throw Error('Phân bổ tùy chỉnh nằm ngoài ngày chạy. Kiểm tra lại lịch hoặc chọn Chia đều lại.');
      const indexes = dates.flatMap((date, i) => date >= segment.startDate && date <= segment.endDate ? [i] : []);
      if (indexes.some(i => manual[i])) throw Error('Các khoảng phân bổ tùy chỉnh không được chồng lấn.');
      const qty = bookingScaled(segment.quantity); assigned += qty;
      indexes.forEach(i => { manual[i] = true; }); split(qty, indexes, values);
    }
    if (assigned > total) throw Error(`Phân bổ vượt số lượng booking ${bookingUnscaled(assigned - total)}.`);
    const remainder = total - assigned, free = dates.flatMap((_, i) => manual[i] ? [] : [i]);
    if (!plan.fillRemainder && remainder) throw Error(`Còn ${bookingUnscaled(remainder)} chưa phân bổ. Chọn Chia đều phần còn lại hoặc nhập bổ sung.`);
    split(remainder, free, values);
  }
  const amounts = moneyByDay(input.amount ?? '0', values), vats = moneyByDay(input.vat ?? '0', values);
  return dates.map((date, i) => ({ date, quantity: bookingUnscaled(values[i]!), amount: bookingUnscaled(amounts[i]!, 6), vat: bookingUnscaled(vats[i]!, 6), gross: bookingUnscaled(amounts[i]! + vats[i]!, 6), manual: manual[i]! }));
}
export function bookingPlanBuckets(days: readonly BookingPlanDay[], unit: 'DAY' | 'WEEK' | 'MONTH' | 'RANGE', from?: string, to?: string): BookingPlanBucket[] {
  const groups = new Map<string, BookingPlanDay[]>();
  for (const day of days.filter(d => (!from || d.date >= from) && (!to || d.date <= to))) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const key = unit === 'DAY' ? day.date : unit === 'MONTH' ? day.date.slice(0, 7) : unit === 'RANGE' ? 'range' : new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const group = groups.get(key) ?? []; group.push(day); groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ startDate: group[0]!.date, endDate: group[group.length - 1]!.date, quantity: bookingExactSum(group.map(d => d.quantity)), amount: bookingExactSum(group.map(d => d.amount), 6), vat: bookingExactSum(group.map(d => d.vat), 6), gross: bookingExactSum(group.map(d => d.gross), 6), manual: group.some(d => d.manual) }));
}
/** Replacing a bucket preserves every manual part outside the edited range. */
export function editBookingPlan(input: BookingPlanInput, segment: BookingTimeSegment, clear = false): BookingTimeDistribution {
  bookingDates(segment.startDate, segment.endDate); bookingScaled(segment.quantity);
  const previous = input.timeDistribution ?? automaticBookingDistribution(), segments: BookingTimeSegment[] = [];
  for (const old of previous.mode === 'CUSTOM' ? previous.segments : []) {
    if (old.endDate < segment.startDate || old.startDate > segment.endDate) { segments.push(old); continue; }
    const oldDays = bookingPlanDays({ startDate: old.startDate, endDate: old.endDate, quantity: old.quantity });
    for (const remaining of [oldDays.filter(d => d.date < segment.startDate), oldDays.filter(d => d.date > segment.endDate)]) {
      if (remaining.length) segments.push({ startDate: remaining[0]!.date, endDate: remaining[remaining.length - 1]!.date, quantity: bookingExactSum(remaining.map(d => d.quantity)) });
    }
  }
  return { version: 1, mode: 'CUSTOM', fillRemainder: previous.fillRemainder, segments: (clear ? segments : [...segments, segment]).sort((a, b) => a.startDate.localeCompare(b.startDate)) };
}
