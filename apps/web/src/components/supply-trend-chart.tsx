import { useEffect, useId, useRef, useState } from 'react';
import type { SupplyAnalyticsBucket } from '@cpms/domain';
import { Button } from '@cpms/ui';
import { formatSupply } from './supply-grid';

const usedColor = '#005f6b', baselineColor = '#d7aa38', baselineTextColor = '#9b7412';
type Metric = 'used' | 'baseline';
const quantity = (row: SupplyAnalyticsBucket, metric: Metric) => metric === 'used' ? row.used : row.averageBaseline;
const ratio = (row: SupplyAnalyticsBucket, metric: Metric) => metric === 'used' ? row.usedVsAveragePercent : row.averageBaseline !== null && Number(row.averageBaseline) > 0 ? '100' : null;
const tick = (r: SupplyAnalyticsBucket) => r.label.startsWith('Tháng ') ? r.label.slice(6) : r.label.startsWith('Quý ') ? r.label.replace('Quý ', 'Q') : r.label.startsWith('Năm ') ? r.label.slice(4) : r.startDate.split('-').reverse().join('/');

/** Decimal strings remain authoritative. Number conversion is only for chart coordinates. */
export function SupplyTrendChart({ rows, display }: { rows: SupplyAnalyticsBucket[]; display: 'BOTH' | 'QUANTITY' | 'PERCENT' }) {
  const percent = display === 'PERCENT', showRatios = display !== 'QUANTITY';
  const multiplePeriods = new Set(rows.map(r => r.periodId)).size > 1;
  const tickCounts = new Map<string, number>();
  for (const row of rows) tickCounts.set(tick(row), (tickCounts.get(tick(row)) ?? 0) + 1);
  const splitBuckets = [...tickCounts.values()].some(count => count > 1);
  const container = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), tooltipId = useId();
  const [available, setAvailable] = useState(760), [zoom, setZoom] = useState(100);
  const [hover, setHover] = useState<{ row: SupplyAnalyticsBucket; metric: Metric; x: number; y: number } | null>(null);
  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const observer = new ResizeObserver(() => { setAvailable(element.clientWidth); setHover(null); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { setHover(null); }, [rows, display]);
  const wideGroups = showRatios || splitBuckets;
  const width = Math.max(rows.length * (wideGroups ? 116 : 72) + 100, Math.max(available, rows.length * (wideGroups ? 132 : 96) + 100) * zoom / 100);
  const height = splitBuckets ? 330 : 310, left = 76, right = width - 24, top = 40, bottom = 254;
  const value = (row: SupplyAnalyticsBucket, metric: Metric) => percent ? ratio(row, metric) : quantity(row, metric);
  const values = rows.flatMap(r => [value(r, 'used'), value(r, 'baseline')]).filter((v): v is string => v !== null).map(Number);
  const min = Math.min(0, ...values), max = Math.max(1, ...values), span = max - min;
  const y = (n: number) => bottom - (n - min) / span * (bottom - top), zero = y(0);
  const groupWidth = (right - left) / Math.max(1, rows.length), barWidth = Math.min(44, groupWidth * .48);
  const segments: Array<{ row: SupplyAnalyticsBucket; first: number; last: number }> = [];
  rows.forEach((row, i) => {
    const previous = segments.at(-1);
    if (previous?.row.periodId === row.periodId) previous.last = i;
    else segments.push({ row, first: i, last: i });
  });
  const show = (row: SupplyAnalyticsBucket, metric: Metric, target: SVGElement) => {
    const bounds = container.current?.getBoundingClientRect(), bar = target.getBoundingClientRect(); if (!bounds) return;
    setHover({ row, metric, x: Math.max(8, Math.min(bounds.width - 248, bar.left - bounds.left + bar.width / 2)), y: Math.max(8, Math.min(bounds.height - 105, bar.top - bounds.top + 16)) });
  };
  const changeZoom = (next: number) => { setHover(null); setZoom(next); };
  const description = (r: SupplyAnalyticsBucket, metric: Metric) => `${metric === 'used' ? r.label : r.periodName}${metric === 'used' && multiplePeriods ? ` · ${r.periodName}` : ''} · ${metric === 'used' ? 'Đã sử dụng' : 'Trung bình mỗi mốc'}: ${formatSupply(quantity(r, metric), 2)} ${r.unit ?? ''} · ${ratio(r, metric) === null ? 'Không tính được tỷ lệ' : `${formatSupply(ratio(r, metric), 2)}% mức trung bình`}`;
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 className="text-sm font-semibold text-slate-800">Đã sử dụng so với mức trung bình</h4>
      <div role="group" aria-label="Thu phóng biểu đồ" className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={zoom <= 50} onClick={() => changeZoom(Math.max(50, zoom - 25))}>Thu nhỏ</Button>
        <Button variant="ghost" size="sm" title="Về mức phóng 100%" aria-label={`Mức phóng ${zoom}%, bấm để về 100%`} onClick={() => changeZoom(100)}>{zoom}%</Button>
        <Button variant="secondary" size="sm" disabled={zoom >= 300} onClick={() => changeZoom(Math.min(300, zoom + 25))}>Phóng to</Button>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: usedColor }}/>Đã sử dụng</span><span className="inline-flex items-center gap-2"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: baselineColor }}/>Trung bình mỗi mốc</span><span className="text-slate-500">{percent ? 'Đường trung bình = 100%' : `${rows[0]?.unit ?? 'Số lượng'} · Số trên cột: đã sử dụng${display === 'BOTH' ? ' · Di chuột để xem tỷ lệ %' : ''}`} · Tính trên toàn kỳ phân bổ</span></div>
    <div ref={container} className="relative min-w-0">
      <div ref={scroller} role="region" aria-label="Biểu đồ theo thời gian, cuộn ngang để xem thêm" tabIndex={0} className="overflow-x-auto rounded-lg border bg-white" onScroll={() => setHover(null)}>
        <svg role="group" aria-label="Mỗi mốc có một cột xanh VNA Đã sử dụng và đường vàng VNA nét đứt là mức trung bình của kỳ. Di chuột hoặc dùng Tab để xem số lượng." width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-none">
          {[0, 1, 2, 3, 4].map(i => { const n = min + span * i / 4, py = y(n); return <g key={i}><line x1={left} x2={right} y1={py} y2={py} stroke="#e2e8f0"/><text x={left - 10} y={py + 4} textAnchor="end" fontSize={11} fill="#64748b">{new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}{percent ? '%' : ''}</text></g>; })}
          <line x1={left} x2={right} y1={zero} y2={zero} stroke="#94a3b8"/>
          {segments.map(({ row, first, last }) => {
            const baseline = value(row, 'baseline'); if (baseline === null) return null;
            const py = y(Number(baseline)), x1 = left + groupWidth * (first + .1), x2 = left + groupWidth * (last + .9);
            return <g key={`${row.periodId}:${first}`} data-baseline-period={row.periodId}>
              <line x1={x1} x2={x2} y1={py} y2={py} stroke={baselineColor} strokeWidth={2.5} strokeDasharray="7 5" pointerEvents="none"/>
              <line x1={x1} x2={x2} y1={py} y2={py} stroke="transparent" strokeWidth={14} role="button" tabIndex={0} aria-label={description(row, 'baseline')} aria-describedby={hover?.metric === 'baseline' && hover.row.periodId === row.periodId ? tooltipId : undefined}
                onMouseEnter={e => show(row, 'baseline', e.currentTarget)} onMouseLeave={() => setHover(null)} onFocus={e => show(row, 'baseline', e.currentTarget)} onBlur={() => setHover(null)} onClick={e => show(row, 'baseline', e.currentTarget)} onKeyDown={e => { if (e.key === 'Escape') setHover(null); else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(row, 'baseline', e.currentTarget); } }}><title>{description(row, 'baseline')}</title></line>
            </g>;
          })}
          {rows.map((r, i) => {
            const center = left + groupWidth * (i + .5), v = value(r, 'used');
            const py = v === null ? zero : y(Number(v)), barHeight = Math.abs(py - zero);
            return <g key={r.id}>
              <rect data-series="used" data-value={r.used} role="button" aria-label={description(r, 'used')} aria-describedby={hover?.row.id === r.id && hover.metric === 'used' ? tooltipId : undefined} tabIndex={0}
                x={center - barWidth / 2} y={barHeight < 3 ? zero - 3 : Math.min(py, zero)} width={barWidth} height={Math.max(3, barHeight)} rx={2} fill={usedColor} fillOpacity={v === null ? .25 : 1}
                onMouseEnter={e => show(r, 'used', e.currentTarget)} onMouseLeave={() => setHover(null)} onFocus={e => show(r, 'used', e.currentTarget)} onBlur={() => setHover(null)} onClick={e => show(r, 'used', e.currentTarget)} onKeyDown={e => { if (e.key === 'Escape') setHover(null); else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(r, 'used', e.currentTarget); } }}><title>{description(r, 'used')}</title></rect>
              <text pointerEvents="none" x={center} y={py + (Number(v) < 0 ? 14 : -7)} textAnchor="middle" fontSize={10} fill={usedColor}>{v === null ? '—' : percent ? `${formatSupply(v, 2)}%` : formatSupply(v, 2)}</text>
              <text x={center} y={282} textAnchor="middle" fontSize={10} fill="#64748b" transform={groupWidth < 85 ? `rotate(-30 ${center} 282)` : undefined}>{tick(r)}</text>{tickCounts.get(tick(r))! > 1 && <text x={center} y={310} textAnchor="middle" fontSize={9} fill="#64748b">{r.startDate.split('-').reverse().join('/')}–{r.endDate.split('-').reverse().join('/')}</text>}
            </g>;
          })}
        </svg>
      </div>
      {hover && <div id={tooltipId} role="tooltip" className="pointer-events-none absolute z-30 w-60 rounded-lg border bg-white p-3 text-xs text-slate-700 shadow-lg" style={{ left: Math.min(hover.x, Math.max(8, available - 248)), top: hover.y, maxWidth: 'calc(100% - 16px)' }}><p className="text-slate-500">{hover.metric === 'used' ? hover.row.label : hover.row.periodName}{hover.metric === 'used' && multiplePeriods && <> · {hover.row.periodName}</>}</p><p className="mt-1 font-semibold" style={{ color: hover.metric === 'used' ? usedColor : baselineTextColor }}>{hover.metric === 'used' ? 'Đã sử dụng' : 'Trung bình mỗi mốc'}: {formatSupply(quantity(hover.row, hover.metric), 2)} {hover.row.unit}</p><p className="mt-1">{ratio(hover.row, hover.metric) === null ? 'Không tính được tỷ lệ' : `${formatSupply(ratio(hover.row, hover.metric), 2)}% mức trung bình của kỳ`}</p></div>}
    </div>
  </div>;
}
