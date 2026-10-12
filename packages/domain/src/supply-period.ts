import type { SupplyPeriodView } from './contracts';

export function formatSupplyDate(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
export function isContractLifetimePeriod(period: SupplyPeriodView): boolean {
  return period.kind === 'CONTRACT' || /contract[_ -]lifetime/i.test(`${period.code} ${period.name}`);
}
export function formatSupplyPeriodName(period: SupplyPeriodView): string {
  if (isContractLifetimePeriod(period)) return 'Quyền lợi dùng chung toàn hợp đồng';
  const start = period.startDate.slice(0, 7).split('-'), end = period.endDate.slice(0, 7).split('-');
  return `Tháng ${start[1]}/${start[0]}${start.join('-') === end.join('-') ? '' : `–${end[1]}/${end[0]}`}`;
}
export function formatSupplyPeriod(period: SupplyPeriodView): string {
  return `${formatSupplyPeriodName(period)} (${formatSupplyDate(period.startDate)} đến ${formatSupplyDate(period.endDate)})`;
}
