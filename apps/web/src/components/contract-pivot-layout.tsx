import { SUPPLY_PIVOT_DIMENSIONS, SUPPLY_PIVOT_MEASURES, type SupplyPivotDimension, type SupplyPivotLayout, type SupplyPivotMeasure } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useRef, useState, type PointerEvent } from 'react';

type Area = 'rows' | 'columns' | 'filters' | 'values';
const areas: { key: Area; label: string; hint: string }[] = [
  { key: 'rows', label: 'Hàng', hint: 'Tối đa 2 cấp, theo thứ tự từ trên xuống' },
  { key: 'columns', label: 'Cột', hint: 'Tối đa 1 trường' },
  { key: 'values', label: 'Chỉ số', hint: 'Chọn và sắp xếp các số muốn xem' },
  { key: 'filters', label: 'Bộ lọc', hint: 'Không tách hàng/cột; lọc bằng các lựa chọn phía trên bảng' },
];
export function ContractPivotLayout({ layout, onChange, onClose }: { layout: SupplyPivotLayout; onChange: (layout: SupplyPivotLayout) => void; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const drag = useRef<{ field: string; x: number; y: number; moved: boolean } | null>(null);
  const [targetArea, setTargetArea] = useState<string | null>(null);
  const label = (field: string) => [...SUPPLY_PIVOT_DIMENSIONS, ...SUPPLY_PIVOT_MEASURES].find(f => f.key === field)?.label ?? field;
  const move = (field: string, area: Area, position?: number) => {
    const dimension = SUPPLY_PIVOT_DIMENSIONS.some(d => d.key === field), measure = SUPPLY_PIVOT_MEASURES.some(d => d.key === field);
    if ((!dimension && !measure) || (area === 'values') !== measure) { setMessage('Trường phân nhóm vào Hàng, Cột hoặc Bộ lọc; số liệu vào Chỉ số.'); return; }
    const next = structuredClone(layout);
    for (const target of areas) next[target.key] = next[target.key].filter(f => f !== field) as never;
    const list = next[area] as string[];
    list.splice(position ?? list.length, 0, field);
    if (!next.rows.length || next.rows.length > 2 || next.columns.length > 1) { setMessage('Giữ 1–2 trường ở Hàng và tối đa 1 trường ở Cột. Chuyển trường đang chiếm chỗ sang Bộ lọc trước.'); return; }
    setMessage(''); onChange({ ...next, collapsed: [] });
  };
  const dragStart = (event: PointerEvent<HTMLButtonElement>, field: string) => {
    if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { field, x: event.clientX, y: event.clientY, moved: false };
  };
  const dragMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) < 5 && !drag.current.moved) return;
    drag.current.moved = true;
    setTargetArea(document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pivot-area]')?.getAttribute('data-pivot-area') ?? null);
  };
  const dragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const moving = drag.current; drag.current = null; setTargetArea(null);
    if (!moving?.moved) return;
    const element = document.elementFromPoint(event.clientX, event.clientY), area = element?.closest('[data-pivot-area]')?.getAttribute('data-pivot-area') as Area | null;
    if (!area || !areas.some(a => a.key === area)) return;
    const targetField = element?.closest('[data-pivot-field]')?.getAttribute('data-pivot-field');
    const index = targetField ? (layout[area] as string[]).indexOf(targetField) : -1;
    move(moving.field, area, index >= 0 ? index : undefined);
  };
  const toggle = (field: SupplyPivotMeasure) => {
    if (layout.values.includes(field)) {
      if (layout.values.length === 1) { setMessage('Cần ít nhất một chỉ số.'); return; }
      onChange({ ...layout, values: layout.values.filter(f => f !== field) });
    } else onChange({ ...layout, values: [...layout.values, field] });
  };
  return <aside aria-label="Bố trí Pivot Table" className="w-full space-y-4 rounded-xl border bg-white p-4 xl:w-80 xl:shrink-0">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Bố trí bảng</h3><Button size="sm" variant="ghost" onClick={onClose}>Đóng</Button></div>
    <p className="text-xs text-slate-500">Kéo trường giữa các vùng hoặc dùng ô chọn trên mỗi trường.</p>
    {message && <p role="status" className="text-xs text-amber-800">{message}</p>}
    {areas.map(area => <section key={area.key} aria-label={`Vùng ${area.label}`} data-pivot-area={area.key} className={`min-h-20 rounded-lg border-2 border-dashed p-3 ${targetArea === area.key ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 bg-slate-50'}`}>
      <h4 className="mb-1 text-xs font-semibold">{area.label}</h4><p className="mb-2 text-xs text-slate-500">{area.hint}</p>
      <div className="space-y-2">{layout[area.key].map((field, index) => <div key={field} className="rounded border bg-white p-2 shadow-sm" data-pivot-field={field}>
        <button type="button" aria-label={`Kéo ${label(field)}`} onPointerDown={e => dragStart(e, field)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = null; setTargetArea(null); }} className="flex w-full touch-none cursor-grab items-center gap-2 text-left text-xs font-medium active:cursor-grabbing"><CpmsIcon name={area.key === 'values' ? 'report' : 'table'} size={16}/>{label(field)}</button>
        <div className="mt-2 flex gap-1">
          {area.key !== 'values' && <select aria-label={`Chuyển ${label(field)} đến`} value={area.key} onChange={e => move(field, e.target.value as Area)} className="min-w-0 flex-1 rounded border px-1 py-1 text-xs">{areas.filter(a => a.key !== 'values').map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select>}
          <button type="button" aria-label={`Đưa ${label(field)} lên trước`} disabled={index === 0} onClick={() => move(field, area.key, index - 1)} className="rounded border px-2 py-1 text-xs disabled:opacity-30">Trước</button>
          <button type="button" aria-label={`Đưa ${label(field)} xuống sau`} disabled={index === layout[area.key].length - 1} onClick={() => move(field, area.key, index + 1)} className="rounded border px-2 py-1 text-xs disabled:opacity-30">Sau</button>
        </div>
      </div>)}</div>
      {!layout[area.key].length && <p className="py-3 text-center text-xs text-slate-400">Thả trường vào đây</p>}
      {area.key === 'values' && <div className="mt-3 space-y-2 border-t pt-3">{SUPPLY_PIVOT_MEASURES.map(m => <label key={m.key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={layout.values.includes(m.key)} onChange={() => toggle(m.key)}/>{m.label}</label>)}</div>}
    </section>)}
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={layout.totals} onChange={e => onChange({ ...layout, totals: e.target.checked })}/>Hiện tổng cộng theo từng đơn vị đo</label>
    <p className="text-xs text-slate-500">Các bộ lọc vẫn áp dụng khi trường nằm ở Hàng hoặc Cột. Bố trí này chỉ thay đổi cách xem số liệu.</p>
  </aside>;
}

export type { SupplyPivotDimension };
