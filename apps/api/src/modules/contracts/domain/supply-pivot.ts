import type { BookingView, SupplyAggregate, SupplyDecimal, SupplyPivotDefinition, SupplyPivotDimension, SupplyPivotMetrics, SupplyPivotReport, SupplyPivotRow } from '@cpms/domain';
import { buildSupplyAnalytics, supplyPercent } from './supply-analytics';
import { decimal, subtract } from './supply-engine';

interface Fact { dimensions: Record<SupplyPivotDimension, { id: string; label: string }>; unit: string; unitId: string; total: SupplyDecimal; used: string }
const key = (value: unknown) => JSON.stringify(value);
const empty = (): SupplyPivotMetrics => ({ total: '0', used: '0', remaining: '0', usedPercent: null, remainingPercent: null });
function add(target: SupplyPivotMetrics, fact: Fact) {
  target.total = target.total === null || fact.total === null ? null : decimal(target.total).plus(fact.total).toFixed();
  target.used = decimal(target.used!).plus(fact.used).toFixed();
  target.remaining = subtract(target.total, target.used);
  target.usedPercent = supplyPercent(target.used, target.total);
  target.remainingPercent = supplyPercent(target.remaining, target.total);
}

/** A curated pivot over effective entitlements and authorized operational usage, never a Booking join that repeats quotas. */
export function buildSupplyPivot(aggregate: SupplyAggregate, bookings: BookingView[], definition: SupplyPivotDefinition, asOf: string): SupplyPivotReport {
  const { query, layout } = definition;
  // Bound the combined projection, including beneficiary partitions, before day expansion.
  const days = (start: string, end: string) => Math.max(0, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const base = buildSupplyAnalytics(aggregate, bookings, query, asOf);
  const selectedAllocations = aggregate.allocations.filter(a => a.scopeKind === 'ENTITLEMENT' && !a.supersededAt && a.status === 'APPROVED' && base.periodSummaries.some(s => s.periodId === a.periodId && s.slotId === a.slotId) && (query.beneficiary === 'ALL' || (a.beneficiaryUnitCode ?? '__UNKNOWN__') === query.beneficiary));
  const work = selectedAllocations.reduce((n, a) => {
    const p = aggregate.periods.find(p => p.id === a.periodId);
    return n + (p ? days(p.startDate, p.endDate) : 0);
  }, 0) + bookings.filter(b => selectedAllocations.some(a => a.id === b.allocationId)).reduce((n, b) => n + days(b.startDate, b.endDate) * 4, 0);
  if (work > 500000) throw Error('Phạm vi Pivot quá lớn; chọn ít slot hoặc một kỳ phân bổ.');
  const axes = [...layout.rows, ...layout.columns], byUnit = axes.includes('beneficiary'), byTime = axes.includes('time');
  const beneficiaries = byUnit ? base.beneficiaries.filter(b => query.beneficiary === 'ALL' || b.value === query.beneficiary) : [{ value: query.beneficiary, label: 'Các CQĐV đã chọn' }];
  if (beneficiaries.length > 50) throw Error('Chọn một CQĐV để thu hẹp Pivot.');
  const facts: Fact[] = [];
  for (const beneficiary of beneficiaries) {
    const report = byUnit && query.beneficiary !== beneficiary.value ? buildSupplyAnalytics(aggregate, bookings, { ...query, beneficiary: beneficiary.value }, asOf) : base;
    const entries = byTime ? report.buckets.map(b => ({ ...b, total: b.timeTotal, used: b.used, timeId: b.key, timeLabel: b.label }))
      : report.periodSummaries.filter(s => report.buckets.some(b => b.slotId === s.slotId && b.periodId === s.periodId)).map(s => ({ ...s, total: s.selectedTotal, used: s.usedSelected, timeId: '', timeLabel: '' }));
    for (const entry of entries) facts.push({ unit: entry.unit ?? 'Chưa xác định đơn vị', unitId: entry.unit ? key(['unit', entry.unit]) : key(['unknown-unit', entry.slotId]), total: entry.total, used: entry.used,
      dimensions: { slot: { id: entry.slotId, label: entry.name }, period: { id: entry.periodId!, label: entry.periodName }, beneficiary: { id: beneficiary.value, label: beneficiary.label }, time: { id: entry.timeId, label: entry.timeLabel } } });
    if (facts.length > 20000) throw Error('Pivot vượt 20.000 điểm dữ liệu; chọn kỳ, CQĐV hoặc ít slot hơn.');
  }
  const column = layout.columns[0];
  const columns = column ? [...new Map(facts.map(f => [f.dimensions[column].id, f.dimensions[column]])).values()]
    .sort((a, b) => column === 'time' ? a.id.localeCompare(b.id) : column === 'period' ? (aggregate.periods.find(p => p.id === a.id)?.startDate ?? '').localeCompare(aggregate.periods.find(p => p.id === b.id)?.startDate ?? '') : a.label.localeCompare(b.label, 'vi', { numeric: true })) : [{ id: '__ALL__', label: 'Phạm vi đã chọn' }];
  if (columns.length > 120) throw Error('Pivot có hơn 120 nhóm cột. Chọn Tuần/Tháng/Quý, thu hẹp thời gian hoặc chuyển Mốc thời gian sang Hàng.');
  let rowCount = 0;
  const makeRow = (id: string, label: string, depth: number): SupplyPivotRow => { rowCount++; return { id, label, depth, cells: {}, total: empty(), children: [] }; };
  const sections: SupplyPivotReport['sections'] = [];
  const groups = new Map<string, SupplyPivotReport['sections'][number]>();
  const rowSortKeys = new Map<string, string>();
  const addRow = (row: SupplyPivotRow, fact: Fact) => {
    const id = column ? fact.dimensions[column].id : '__ALL__';
    add(row.cells[id] ??= empty(), fact); add(row.total, fact);
  };
  for (const fact of facts) {
    let section = groups.get(fact.unitId);
    if (!section) { section = { id: fact.unitId, unit: fact.unit, rows: [], total: makeRow(key([fact.unitId, 'total']), 'Tổng cộng', 0) }; sections.push(section); groups.set(fact.unitId, section); }
    addRow(section.total, fact);
    let siblings = section.rows;
    const path: string[] = [];
    layout.rows.forEach((dimension, depth) => {
      const field = fact.dimensions[dimension]; path.push(dimension, field.id);
      const id = key([fact.unitId, ...path]);
      let row = siblings.find(r => r.id === id);
      if (!row) { row = makeRow(id, field.label, depth); siblings.push(row); rowSortKeys.set(id, dimension === 'time' ? field.id : dimension === 'period' ? aggregate.periods.find(p => p.id === field.id)!.startDate : field.label); }
      addRow(row, fact); siblings = row.children;
    });
    if (rowCount > 1000 || rowCount * (columns.length + 1) * layout.values.length > 30000) throw Error('Pivot vượt giới hạn 1.000 dòng hoặc 30.000 ô; thu hẹp bộ lọc hoặc giảm chỉ số.');
  }
  const sortRows = (rows: SupplyPivotRow[]) => {
    rows.sort((a, b) => {
      const field = layout.sort.field;
      if (field === 'label') return (layout.sort.direction === 'asc' ? 1 : -1) * rowSortKeys.get(a.id)!.localeCompare(rowSortKeys.get(b.id)!, 'vi', { numeric: true });
      const l = a.total[field], r = b.total[field];
      if (l === null || r === null) return l === r ? 0 : l === null ? 1 : -1;
      return (layout.sort.direction === 'asc' ? 1 : -1) * decimal(l).cmp(r);
    });
    rows.forEach(r => sortRows(r.children));
  };
  sections.forEach(s => sortRows(s.rows));
  return { version: 1, asOf, columns, sections, factCount: facts.length, notices: base.notices };
}
