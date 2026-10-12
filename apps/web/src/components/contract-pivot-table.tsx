import { SUPPLY_PIVOT_DIMENSIONS, SUPPLY_PIVOT_MEASURES, type SupplyPivotLayout, type SupplyPivotMeasure, type SupplyPivotMetrics, type SupplyPivotReport, type SupplyPivotRow } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useRef, useState, type PointerEvent } from 'react';
import { formatSupply } from './supply-grid';

const metricText = (metric: SupplyPivotMeasure, cell: SupplyPivotMetrics | undefined) => cell?.[metric] == null ? '—' : `${formatSupply(cell[metric])}${metric.endsWith('Percent') ? '%' : ''}`;
const flatRows = (rows: SupplyPivotRow[], collapsed: string[]): SupplyPivotRow[] => rows.flatMap(row => [row, ...(collapsed.includes(row.id) ? [] : flatRows(row.children, collapsed))]);
export function ContractPivotTable({ report, layout, onChange }: { report: SupplyPivotReport; layout: SupplyPivotLayout; onChange: (layout: SupplyPivotLayout) => void }) {
  const resizing = useRef<{ key: string; x: number; width: number } | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [copyStatus, setCopyStatus] = useState('');
  const [selection, setSelection] = useState<{ section: string; start: [number, number]; end: [number, number] } | null>(null);
  const dragging = useRef(false);
  const columns = [...report.columns.map(c => ({ ...c, total: false })), ...(layout.columns.length && layout.totals ? [{ id: '__TOTAL__', label: 'Tổng các cột', total: true }] : [])];
  const leaves = columns.flatMap(c => layout.values.map(value => ({ id: `${c.id}:${value}`, column: c, value, label: SUPPLY_PIVOT_MEASURES.find(m => m.key === value)!.label })));
  const width = (key: string) => sizes[key] ?? layout.widths[key] ?? (key === 'label' ? 320 : 145);
  const resize = (event: PointerEvent<HTMLSpanElement>, key: string) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resizing.current = { key, x: event.clientX, width: width(key) }; };
  const resizeMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!resizing.current) return;
    const { key, x, width: initial } = resizing.current;
    setSizes(old => ({ ...old, [key]: Math.round(Math.min(600, Math.max(90, initial + event.clientX - x))) }));
  };
  const resizeEnd = () => { if (resizing.current) { const key = resizing.current.key; onChange({ ...layout, widths: { ...layout.widths, [key]: width(key) } }); resizing.current = null; } };
  const handle = (key: string) => <span role="separator" aria-orientation="vertical" tabIndex={0} aria-label={`Đổi độ rộng ${key === 'label' ? 'tên hàng' : leaves.find(l => l.id === key)?.label ?? 'cột'}`} onPointerDown={e => resize(e, key)} onPointerMove={resizeMove} onPointerUp={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const value = Math.max(90, Math.min(600, width(key) + (e.key === 'ArrowRight' ? 20 : -20))); setSizes(old => ({ ...old, [key]: value })); onChange({ ...layout, widths: { ...layout.widths, [key]: value } });
  }} className="absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize touch-none hover:bg-cyan-300 focus:bg-cyan-300"/>;
  const selected = (section: string, row: number, col: number) => selection?.section === section && row >= Math.min(selection.start[0], selection.end[0]) && row <= Math.max(selection.start[0], selection.end[0]) && col >= Math.min(selection.start[1], selection.end[1]) && col <= Math.max(selection.start[1], selection.end[1]);
  const copy = async (onlySelection: boolean) => {
    const chunks = report.sections.filter(s => !onlySelection || !selection || selection.section === s.id).map(section => {
      const rows = [...flatRows(section.rows, layout.collapsed), ...(layout.totals ? [section.total] : [])];
      const matrix = rows.map(row => [row.label, ...leaves.map(l => metricText(l.value, l.column.total ? row.total : row.cells[l.column.id]))]);
      if (onlySelection && selection) return matrix.slice(Math.min(selection.start[0], selection.end[0]), Math.max(selection.start[0], selection.end[0]) + 1).map(r => r.slice(Math.min(selection.start[1], selection.end[1]), Math.max(selection.start[1], selection.end[1]) + 1).join('\t')).join('\n');
      return [[`Đơn vị: ${section.unit}`, ...leaves.map(l => `${l.column.label} · ${l.label}`)].join('\t'), ...matrix.map(row => row.join('\t'))].join('\n');
    });
    try { await navigator.clipboard.writeText(chunks.join('\n\n')); setCopyStatus('Đã sao chép để dán vào Excel.'); }
    catch { setCopyStatus('Trình duyệt chưa cho phép sao chép. Cho phép clipboard rồi thử lại.'); }
  };
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => onChange({ ...layout, collapsed: [] })}>Mở các nhóm</Button>
      <Button size="sm" variant="ghost" onClick={() => onChange({ ...layout, collapsed: report.sections.flatMap(s => s.rows.filter(r => r.children.length).map(r => r.id)) })}>Thu các nhóm</Button>
      <Button size="sm" variant="ghost" onClick={() => void copy(false)}><CpmsIcon name="duplicate" size={16}/>Sao chép bảng</Button>
      {selection && <Button size="sm" variant="ghost" onClick={() => void copy(true)}>Sao chép vùng chọn</Button>}
      <span role="status" className="text-xs text-slate-500">{copyStatus}</span>
    </div>
    {report.sections.map(section => {
      const rows = [...flatRows(section.rows, layout.collapsed), ...(layout.totals ? [section.total] : [])];
      return <section key={section.id} className="overflow-hidden rounded-xl border bg-white">
        <h3 className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold">Đơn vị: {section.unit}</h3>
        <div className="max-h-[65vh] overflow-auto outline-none" data-pivot-grid tabIndex={0} aria-label={`Bảng Pivot — ${section.unit}`} onPointerUp={() => { dragging.current = false; }} onPointerLeave={() => { dragging.current = false; }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selection?.section === section.id) { e.preventDefault(); void copy(true); } }}>
          <table className="border-separate border-spacing-0 text-xs" style={{ tableLayout: 'fixed', width: width('label') + leaves.reduce((n, l) => n + width(l.id), 0), minWidth: '100%' }}>
            <colgroup><col style={{ width: width('label') }}/>{leaves.map(l => <col key={l.id} style={{ width: width(l.id) }}/>)}</colgroup>
            <thead className="sticky top-0 z-20 bg-slate-50"><tr><th rowSpan={2} scope="col" className="sticky left-0 z-30 border-b border-r bg-slate-50 px-4 py-3 text-left">{layout.rows.map(d => SUPPLY_PIVOT_DIMENSIONS.find(f => f.key === d)!.label).join(' / ')}{handle('label')}</th>{columns.map(c => <th scope="colgroup" key={c.id} colSpan={layout.values.length} className="border-b border-r px-3 py-2 text-center">{c.label}</th>)}</tr>
              <tr>{leaves.map(l => <th key={l.id} scope="col" className="relative border-b border-r px-3 py-3 text-right">{l.label}{handle(l.id)}</th>)}</tr>
            </thead>
            <tbody>{rows.map((row, rowIndex) => {
              const total = row === section.total, group = row.children.length > 0;
              const pointer = (col: number) => ({ onPointerDown: (e: PointerEvent) => { if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return; e.preventDefault(); e.currentTarget.closest<HTMLElement>('[data-pivot-grid]')?.focus({ preventScroll: true }); dragging.current = true; setSelection({ section: section.id, start: e.shiftKey && selection?.section === section.id ? selection.start : [rowIndex, col], end: [rowIndex, col] }); }, onPointerEnter: () => { if (dragging.current) setSelection(old => old?.section === section.id ? { ...old, end: [rowIndex, col] } : old); } });
              return <tr key={row.id} className={total ? 'bg-cyan-50 font-semibold' : group ? 'bg-slate-50 font-semibold' : 'bg-white'}>
                <th scope="row" {...pointer(0)} className={`sticky left-0 z-10 border-b border-r px-3 py-3 text-left ${selected(section.id, rowIndex, 0) ? 'bg-cyan-100 ring-1 ring-inset ring-cyan-400' : total ? 'bg-cyan-50' : group ? 'bg-slate-50' : 'bg-white'}`} style={{ paddingLeft: 12 + row.depth * 22 }}>
                  {group ? <button aria-expanded={!layout.collapsed.includes(row.id)} aria-label={`${layout.collapsed.includes(row.id) ? 'Mở' : 'Thu'} nhóm ${row.label}`} onClick={() => onChange({ ...layout, collapsed: layout.collapsed.includes(row.id) ? layout.collapsed.filter(id => id !== row.id) : [...layout.collapsed, row.id] })} className="flex w-full items-start gap-2 text-left"><CpmsIcon name="more" size={16}/><span>{row.label}<span className="mt-1 block text-[10px] font-normal text-slate-500">{layout.collapsed.includes(row.id) ? 'Mở chi tiết' : 'Thu chi tiết'} · Tổng nhóm</span></span></button> : row.label}
                </th>
                {leaves.map((l, col) => { const cell = l.column.total ? row.total : row.cells[l.column.id]; return <td key={l.id} {...pointer(col + 1)} title={`${row.label} · ${l.column.label} · ${l.label}: ${metricText(l.value, cell)}`} className={`border-b border-r px-3 py-3 text-right tabular-nums ${selected(section.id, rowIndex, col + 1) ? 'bg-cyan-100 ring-1 ring-inset ring-cyan-400' : ''} ${cell?.[l.value]?.startsWith('-') ? 'text-rose-700' : ''}`}>{metricText(l.value, cell)}</td>; })}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>;
    })}
    {!report.sections.length && <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Không có hạn mức trong phạm vi đã chọn. Thử đổi kỳ hoặc bộ lọc phía trên.</div>}
  </div>;
}
