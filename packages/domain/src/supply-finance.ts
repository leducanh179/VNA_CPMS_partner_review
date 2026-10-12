import type { SupplyDecimal } from './contracts';

export interface SupplyMoney { net: SupplyDecimal; gross: SupplyDecimal }
export interface SupplyFinanceMonth {
  key: string; label: string; startDate: string; endDate: string; used: SupplyMoney; cumulative: SupplyMoney; reserved: SupplyMoney;
}
export interface SupplyFinancePeriod {
  id: string; name: string; startDate: string; endDate: string;
  budget: SupplyMoney; monthToDate: SupplyMoney; elapsed: SupplyMoney; scheduled: SupplyMoney;
  heldElapsed: SupplyMoney; heldFuture: SupplyMoney; held: SupplyMoney; available: SupplyMoney;
  usedPercent: SupplyMoney; heldPercent: SupplyMoney;
  recentDaily: SupplyMoney; forecastAdditional: SupplyMoney; forecastRemaining: SupplyMoney;
  recentDays: number; futureDays: number; months: SupplyFinanceMonth[];
  issues: string[];
}
export interface SupplyFinanceCampaign {
  id: string; campaignId: string | null; label: string; value: SupplyMoney; percent: SupplyMoney;
  bookings: Array<{ id: string; campaignLabel: string; slotName: string; startDate: string; endDate: string; value: SupplyMoney }>;
}
export interface SupplyFinance {
  currency: string; periods: SupplyFinancePeriod[]; selected: SupplyMoney;
  from: string | null; to: string | null; campaigns: SupplyFinanceCampaign[]; notices: string[];
}
