import { bookingDateNumber, bookingDates } from './booking-distribution';
import type { SupplyDecimal, SupplyUsageStage } from './contracts';
import type { SupplyFinance } from './supply-finance';

export type SupplyTimeGrain = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
export interface SupplyAnalyticsQuery {
  period: string; stage: SupplyUsageStage; grain: SupplyTimeGrain; mode: 'CONTIGUOUS' | 'DISCRETE';
  slotIds: string[]; beneficiary: string; from?: string | undefined; to?: string | undefined; keys: string[];
}
export interface SupplyAnalyticsSummary {
  id: string; slotId: string; name: string; unit: string | null; periodId: string | null; periodName: string;
  total: SupplyDecimal; used: string; remaining: SupplyDecimal; usedPercent: SupplyDecimal; remainingPercent: SupplyDecimal;
  booked: string; reservedRemaining: SupplyDecimal; monthlyAverage: SupplyDecimal;
  theorySelected: SupplyDecimal; usedSelected: string; pacingPercent: SupplyDecimal; delta: SupplyDecimal;
  selectedTotal: SupplyDecimal; selectedRemaining: SupplyDecimal; selectedUsedPercent: SupplyDecimal; selectedRemainingPercent: SupplyDecimal;
  expiry: 'PAST' | 'CURRENT' | 'FUTURE' | 'MIXED';
  reasons: string[];
}
export interface SupplyAnalyticsBucket {
  id: string; slotId: string; name: string; unit: string | null; periodId: string; periodName: string;
  key: string; startDate: string; endDate: string; label: string;
  theory: SupplyDecimal; used: string; pacingPercent: SupplyDecimal; delta: SupplyDecimal;
  usedPercent: SupplyDecimal; remaining: SupplyDecimal; remainingPercent: SupplyDecimal;
  theoryRemaining: SupplyDecimal; theoryRemainingPercent: SupplyDecimal;
  /** All three quantities and ratios use this time bucket, not a cumulative period balance. */
  timeTotal: SupplyDecimal; timeRemaining: SupplyDecimal; timeUsedPercent: SupplyDecimal; timeRemainingPercent: SupplyDecimal;
  /** Flat effective entitlement average per calendar bucket of the selected grain, across the full supply period. */
  averageBaseline: SupplyDecimal; usedVsAveragePercent: SupplyDecimal;
  future: boolean;
}
export interface SupplyAnalytics {
  finance?: SupplyFinance;
  version: 1; asOf: string; date: string; query: SupplyAnalyticsQuery;
  bounds: { startDate: string; endDate: string } | null;
  summaries: SupplyAnalyticsSummary[]; periodSummaries: SupplyAnalyticsSummary[]; buckets: SupplyAnalyticsBucket[];
  beneficiaries: Array<{ value: string; label: string }>;
  outOfPeriod: Array<{ slotId: string; periodId: string; slotName: string; periodName: string; bookings: number; before: string; after: string }>;
  usageBasis: 'BOOKING_SCHEDULE' | 'REWEIGHTED_SCHEDULE'; notices: string[];
}
const DAY = 86400000;
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
/** Stable calendar identifiers, Monday weeks; no locale-dependent date parsing. */
export function supplyTimeKey(date: string, grain: SupplyTimeGrain): string {
  const n = bookingDateNumber(date), d = new Date(n), year = date.slice(0, 4), month = date.slice(5, 7);
  if (grain === 'DAY') return date;
  if (grain === 'WEEK') return iso(n - ((d.getUTCDay() + 6) % 7) * DAY);
  if (grain === 'MONTH') return `${year}-${month}-01`;
  if (grain === 'QUARTER') return `${year}-${String(Math.floor((Number(month) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  return `${year}-01-01`;
}
export function supplyTimeEnd(key: string, grain: SupplyTimeGrain): string {
  const n = bookingDateNumber(key), d = new Date(n);
  if (grain === 'DAY') return key;
  if (grain === 'WEEK') return iso(n + 6 * DAY);
  const months = grain === 'MONTH' ? 1 : grain === 'QUARTER' ? 3 : 12;
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1) - DAY);
}
export function supplyTimeLabel(key: string, grain: SupplyTimeGrain): string {
  const day = (s: string) => s.split('-').reverse().join('/');
  if (grain === 'DAY') return day(key);
  if (grain === 'WEEK') return `Tuần ${day(key)} – ${day(supplyTimeEnd(key, grain))}`;
  if (grain === 'MONTH') return `Tháng ${key.slice(5, 7)}/${key.slice(0, 4)}`;
  if (grain === 'QUARTER') return `Quý ${Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1}/${key.slice(0, 4)}`;
  return `Năm ${key.slice(0, 4)}`;
}
export function supplyTimeOptions(start: string, end: string, grain: SupplyTimeGrain): Array<{ key: string; label: string }> {
  return [...new Set(bookingDates(start, end).map(d => supplyTimeKey(d, grain)))].map(key => ({ key, label: supplyTimeLabel(key, grain) }));
}
