import type { SupplyAnalyticsQuery } from './supply-analytics';
import type { SupplyDecimal } from './contracts';

export type SupplyPivotDimension = 'slot' | 'beneficiary' | 'period' | 'time';
export type SupplyPivotMeasure = 'total' | 'used' | 'remaining' | 'usedPercent' | 'remainingPercent';
export interface SupplyPivotLayout {
  version: 1;
  rows: SupplyPivotDimension[];
  columns: SupplyPivotDimension[];
  filters: SupplyPivotDimension[];
  values: SupplyPivotMeasure[];
  totals: boolean;
  sort: { field: 'label' | SupplyPivotMeasure; direction: 'asc' | 'desc' };
  widths: Record<string, number>;
  collapsed: string[];
}
export interface SupplyPivotDefinition { version: 1; query: SupplyAnalyticsQuery; layout: SupplyPivotLayout }
export interface SupplyPivotView {
  id: string; contractId: string; name: string; definition: SupplyPivotDefinition;
  isDefault: boolean; recordVersion: number; updatedAt: string;
}
export type SupplyPivotMetrics = Record<SupplyPivotMeasure, SupplyDecimal>;
export interface SupplyPivotRow {
  id: string; label: string; depth: number; cells: Record<string, SupplyPivotMetrics>;
  total: SupplyPivotMetrics; children: SupplyPivotRow[];
}
export interface SupplyPivotReport {
  version: 1; asOf: string; columns: { id: string; label: string }[];
  sections: { id: string; unit: string; rows: SupplyPivotRow[]; total: SupplyPivotRow }[];
  notices: string[]; factCount: number;
}
export const SUPPLY_PIVOT_DIMENSIONS: { key: SupplyPivotDimension; label: string }[] = [
  { key: 'slot', label: 'Hàng hóa, dịch vụ' }, { key: 'beneficiary', label: 'CQĐV hưởng hạn mức' },
  { key: 'period', label: 'Kỳ phân bổ' }, { key: 'time', label: 'Mốc thời gian' },
];
export const SUPPLY_PIVOT_MEASURES: { key: SupplyPivotMeasure; label: string }[] = [
  { key: 'total', label: 'Tổng số' }, { key: 'used', label: 'Đã sử dụng' }, { key: 'remaining', label: 'Còn lại' },
  { key: 'usedPercent', label: 'Đã sử dụng (%)' }, { key: 'remainingPercent', label: 'Còn lại (%)' },
];
export function supplyPivotPreset(preset: 'SLOT' | 'UNIT' | 'TIME'): SupplyPivotLayout {
  const rows: SupplyPivotDimension[] = preset === 'UNIT' ? ['beneficiary', 'slot'] : ['slot'];
  const columns: SupplyPivotDimension[] = preset === 'TIME' ? ['time'] : [];
  return { version: 1, rows, columns, filters: SUPPLY_PIVOT_DIMENSIONS.map(d => d.key).filter(d => ![...rows, ...columns].includes(d)),
    values: ['total', 'used', 'remaining'], totals: true, sort: { field: 'label', direction: 'asc' }, widths: {}, collapsed: [] };
}
