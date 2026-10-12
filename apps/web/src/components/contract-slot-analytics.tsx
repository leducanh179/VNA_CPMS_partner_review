import { formatSupplyDate, formatSupplyPeriod, isContractLifetimePeriod, supplyTimeEnd, supplyTimeKey, supplyTimeOptions, type SupplyAnalytics, type SupplyAnalyticsQuery, type SupplyContractWorkspace, type SupplyTimeGrain, type SupplyUsageStage } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
import { SupplyGrid, formatSupply, type SupplyGridColumn } from './supply-grid';
import { SupplyTrendChart } from './supply-trend-chart';

const stages: Array<{ value: SupplyUsageStage; label: string }> = [
  { value: 'booked', label: 'Tính theo số đặt chỗ' }, { value: 'vendorConfirmed', label: 'Tính theo số đặt chỗ đã xác nhận' },
  { value: 'approved', label: 'Tính theo số đặt chỗ đã phê duyệt' }, { value: 'accepted', label: 'Tính theo số đã nghiệm thu' },
];
const grains: Array<{ value: SupplyTimeGrain; label: string }> = [{ value: 'DAY', label: 'Ngày' }, { value: 'WEEK', label: 'Tuần' }, { value: 'MONTH', label: 'Tháng' }, { value: 'QUARTER', label: 'Quý' }, { value: 'YEAR', label: 'Năm' }];
const initial: SupplyAnalyticsQuery = { period: 'CURRENT', stage: 'booked', grain: 'MONTH', mode: 'CONTIGUOUS', slotIds: [], beneficiary: 'ALL', keys: [] };
const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const pct = (v: unknown) => v === null || v === undefined ? 'Không tính được tỷ lệ' : `${formatSupply(v, 2)}%`;
type Display = 'BOTH' | 'QUANTITY' | 'PERCENT';

export function ContractSlotAnalytics({ workspace, actorId }: { workspace: SupplyContractWorkspace; actorId: string }) {
  const [draft, setDraft] = useState<SupplyAnalyticsQuery>(initial), [applied, setApplied] = useState<SupplyAnalyticsQuery>(initial);
  const [display, setDisplay] = useState<Display>('BOTH');
  const [report, setReport] = useState<SupplyAnalytics | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const [chartSlotIds, setChartSlotIds] = useState<string[] | null>(null), [timeSearch, setTimeSearch] = useState(''), [optionPage, setOptionPage] = useState(1);
  const generation = useRef(0);
  const periods = workspace.periods.filter(p => !isContractLifetimePeriod(p) || workspace.periods.length === 1);
  const selectedPeriods = workspace.periods.filter(p => draft.period === 'ALL' || draft.period === 'CURRENT' && workspace.currentPeriodIds.includes(p.id) || p.id === draft.period);
  const bounds = selectedPeriods.length ? { start: selectedPeriods.map(p => p.startDate.slice(0, 10)).sort()[0]!, end: selectedPeriods.map(p => p.endDate.slice(0, 10)).sort().at(-1)! } : null;
  const options = (() => {
    if (!bounds) return [];
    try { return supplyTimeOptions(bounds.start, bounds.end, draft.grain).filter(o => selectedPeriods.some(p => o.key <= p.endDate.slice(0, 10) && supplyTimeEnd(o.key, draft.grain) >= p.startDate.slice(0, 10))); } catch { return []; }
  })();
  useEffect(() => {
    const request = ++generation.current; setBusy(true);
    requestJson<SupplyAnalytics>(`/contracts/${workspace.contract.id}/analytics/query`, { method: 'POST', body: JSON.stringify(applied) })
      .then(value => { if (request === generation.current) { setReport(value); setChartSlotIds(old => old === null ? null : old.filter(id => value.summaries.some(s => s.slotId === id))); setError(''); } })
      .catch((caught: unknown) => { if (request === generation.current) setError(caught instanceof Error ? caught.message : 'Không thể tải số liệu.'); })
      .finally(() => { if (request === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [workspace.contract.id, workspace.asOf, applied]);
  const change = (patch: Partial<SupplyAnalyticsQuery>) => setDraft(old => ({ ...old, ...patch }));
  const resetTime = (patch: Partial<SupplyAnalyticsQuery>) => { const next = { ...draft, ...patch, keys: [] }; delete next.from; delete next.to; setDraft(next); setTimeSearch(''); setOptionPage(1); };
  const apply = () => { setReport(null); setApplied({ ...draft, slotIds: [...new Set(draft.slotIds)], keys: [...new Set(draft.keys)].sort() }); };
  const applyStage = (stage: SupplyUsageStage) => { change({ stage }); setReport(null); setApplied(old => ({ ...old, stage })); };
  const usageControl = <div className="mt-2 font-normal"><select aria-label="Cách tính nhanh tại cột Đã sử dụng" className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs" value={draft.stage} onChange={e => applyStage(e.target.value as SupplyUsageStage)}>{stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>;
  const pending = JSON.stringify(draft) !== JSON.stringify(applied);
  const quantities = display !== 'PERCENT', percentages = display !== 'QUANTITY';
  const metricColumn = (quantityKey: string, percentKey: string, label: string, color: string, hint: string): SupplyGridColumn => ({
    key: quantities ? quantityKey : percentKey, label, type: 'number', width: 150, hint,
    render: r => <div className={`space-y-1 tabular-nums ${color}`}>
      {quantities && <p className="font-semibold">{formatSupply(r[quantityKey], 2)}</p>}
      {percentages && <p className={quantities ? 'text-xs' : 'font-semibold'}>{pct(r[percentKey])}</p>}
    </div>,
  });
  const totalColumns: SupplyGridColumn[] = [
    { key: 'name', label: 'Hàng hóa, dịch vụ', width: 280, render: r => <><strong className="font-medium">{String(r.name)}</strong><p className="mt-1 text-xs text-slate-500">{String(r.periodName)}</p></> },
    { key: 'unit', label: 'Đơn vị', width: 95 },
    metricColumn('selectedTotal', 'selectedTotalPercent', 'Tổng số', 'text-blue-700', 'Hạn mức hiệu lực phân bổ đều theo ngày trong khoảng thời gian đã chọn.'),
    { ...metricColumn('usedSelected', 'selectedUsedPercent', 'Đã sử dụng', 'text-red-700', 'Sử dụng theo lịch đặt chỗ trong cùng khoảng thời gian, theo cách tính đang áp dụng.'), width: 245, headerControl: usageControl },
    metricColumn('selectedRemaining', 'selectedRemainingPercent', 'Còn lại', 'text-green-700', 'Tổng số trừ Đã sử dụng trong cùng khoảng thời gian đã chọn.'),
  ];
  const rows = report?.buckets ?? [], chartOptions = report?.summaries ?? [];
  const chartSlots = chartOptions.filter(s => chartSlotIds === null || chartSlotIds.includes(s.slotId));
  const toggleChartSlot = (id: string, checked: boolean) => setChartSlotIds(old => {
    const selected = old ?? chartOptions.map(s => s.slotId);
    return checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id);
  });
  const visibleOptions = options.filter(o => `${o.label} ${o.key}`.toLocaleLowerCase().includes(timeSearch.toLocaleLowerCase()));
  const stageLabel = stages.find(s => s.value === (report?.query.stage ?? applied.stage))!.label;
  const columnKey = `cpms:supply:inventory-v3:${actorId}:${display}`;
  const starts = rows.map(r => r.startDate).sort(), ends = rows.map(r => r.endDate).sort();
  const timeLabel = report?.query.mode === 'DISCRETE' ? `${report.query.keys.length} mốc thời gian đã chọn` : starts.length ? `${formatSupplyDate(starts[0]!)} đến ${formatSupplyDate(ends.at(-1)!)}` : 'Không có mốc trong phạm vi đã chọn';
  return <div className="space-y-4">
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-slate-600">Phạm vi hạn mức<select className={inputClass} aria-label="Phạm vi hạn mức" value={draft.period} onChange={e => resetTime({ period: e.target.value })}><option value="CURRENT">Kỳ hiện tại</option><option value="ALL">Toàn bộ hợp đồng</option>{periods.map(p => <option key={p.id} value={p.id}>{formatSupplyPeriod(p)}</option>)}</select></label>
        <label className="text-xs text-slate-600">CQĐV hưởng hạn mức<select className={inputClass} aria-label="CQĐV hưởng hạn mức" value={draft.beneficiary} onChange={e => change({ beneficiary: e.target.value })}><option value="ALL">Tất cả CQĐV</option>{(report?.beneficiaries ?? []).map(b => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
        <label className="text-xs text-slate-600">Đã sử dụng — cách tính<select className={inputClass} aria-label="Cách tính Đã sử dụng" value={draft.stage} onChange={e => change({ stage: e.target.value as SupplyUsageStage })}>{stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="text-xs text-slate-600">Hiển thị<select className={inputClass} aria-label="Hiển thị số lượng và tỷ lệ" value={display} onChange={e => setDisplay(e.target.value as Display)}><option value="BOTH">Số lượng và tỷ lệ %</option><option value="QUANTITY">Số lượng</option><option value="PERCENT">Tỷ lệ %</option></select></label>
      </div>
      <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-sm">Slot: {draft.slotIds.length ? `${draft.slotIds.length} slot đã chọn` : 'Tất cả slot'} — chọn một hoặc nhiều</summary><div className="mt-3 grid gap-2 md:grid-cols-2"><label className="text-sm"><input type="checkbox" checked={!draft.slotIds.length} onChange={() => change({ slotIds: [] })} className="mr-2"/>Tất cả slot</label>{workspace.slots.map(s => <label key={s.id} className="text-xs"><input type="checkbox" aria-label={`Chọn slot ${s.name}`} checked={draft.slotIds.includes(s.id)} onChange={e => change({ slotIds: e.target.checked ? [...draft.slotIds, s.id] : draft.slotIds.filter(id => id !== s.id) })} className="mr-2"/>{s.name}</label>)}</div></details>
      <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-slate-600">Mặt cắt thời gian<select aria-label="Mặt cắt thời gian" className={inputClass} value={draft.grain} onChange={e => resetTime({ grain: e.target.value as SupplyTimeGrain })}>{grains.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
        <label className="text-xs text-slate-600">Cách chọn thời gian<select aria-label="Cách chọn thời gian" className={inputClass} value={draft.mode} onChange={e => resetTime({ mode: e.target.value as SupplyAnalyticsQuery['mode'] })}><option value="CONTIGUOUS">Dải liên tục</option><option value="DISCRETE">Các mốc không liền nhau</option></select></label>
        {draft.mode === 'CONTIGUOUS' && <><label className="text-xs text-slate-600">Từ mốc<select aria-label="Từ mốc" className={inputClass} value={draft.from ? supplyTimeKey(draft.from, draft.grain) : options[0]?.key ?? ''} onChange={e => change({ from: e.target.value })}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label><label className="text-xs text-slate-600">Đến mốc<select aria-label="Đến mốc" className={inputClass} value={draft.to ? supplyTimeKey(draft.to, draft.grain) : options.at(-1)?.key ?? ''} onChange={e => change({ to: supplyTimeEnd(e.target.value, draft.grain) })}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label></>}
      </div>
      {draft.mode === 'DISCRETE' && <div className="rounded-lg border p-3"><p className="mb-2 text-xs text-slate-600">Chọn các mốc cùng mặt cắt {grains.find(g => g.value === draft.grain)?.label.toLowerCase()}. Bảng và biểu đồ chỉ hiển thị các mốc đã chọn.</p><input aria-label="Tìm mốc thời gian" placeholder="Tìm mốc thời gian…" className="mb-3 w-full rounded-lg border px-3 py-2 text-sm" value={timeSearch} onChange={e => { setTimeSearch(e.target.value); setOptionPage(1); }}/><div className="grid max-h-48 gap-2 overflow-auto md:grid-cols-3">{visibleOptions.slice(0, optionPage * 90).map(o => <label key={o.key} className="text-xs"><input type="checkbox" className="mr-2" checked={draft.keys.includes(o.key)} onChange={e => change({ keys: e.target.checked ? [...draft.keys, o.key] : draft.keys.filter(k => k !== o.key) })}/>{o.label}</label>)}</div>{visibleOptions.length > optionPage * 90 && <Button variant="ghost" size="sm" onClick={() => setOptionPage(n => n + 1)}>Xem thêm mốc</Button>}<div className="mt-3 flex flex-wrap gap-2">{draft.keys.map(key => <button key={key} className="rounded-full bg-cyan-50 px-3 py-1 text-xs text-vna-blue" aria-label={`Bỏ ${options.find(o => o.key === key)?.label ?? key}`} onClick={() => change({ keys: draft.keys.filter(k => k !== key) })}>{options.find(o => o.key === key)?.label ?? key} · Bỏ</button>)}</div></div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{bounds ? `${formatSupplyDate(bounds.start)} đến ${formatSupplyDate(bounds.end)}` : 'Không có kỳ hiện hành; chọn một kỳ hoặc Toàn bộ hợp đồng.'} · Mốc hiện tại theo giờ Việt Nam: {formatSupplyDate(workspace.date)}</p><Button onClick={apply} disabled={busy || draft.mode === 'DISCRETE' && !draft.keys.length}><CpmsIcon name="filter" size={18}/>Xem dữ liệu</Button></div>
      {pending && <p className="text-xs text-amber-800">Bộ lọc có thay đổi. Bấm Xem dữ liệu để áp dụng.</p>}
    </Card>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}{report && ' Dữ liệu đang hiển thị là lần tải thành công gần nhất.'}<Button variant="ghost" size="sm" onClick={() => setApplied({ ...applied })}>Thử lại</Button></div>}
    {busy && !report && <LoadingBlock label="Đang tính số liệu từ hạn mức và lịch Đặt chỗ…"/>}
    {report && <>
      <p className="text-xs text-slate-600"><strong>{stageLabel}</strong> · Hạn mức sau điều chỉnh · {report.query.period === 'ALL' ? 'Toàn bộ hợp đồng' : report.query.period === 'CURRENT' ? 'Kỳ hiện tại' : periods.find(p => p.id === report.query.period)?.name} · {busy ? 'Đang cập nhật…' : `Dữ liệu lúc ${new Date(report.asOf).toLocaleString('vi-VN')}`}</p>
      <section aria-labelledby="slot-inventory-heading" className="space-y-3">
        <div><h3 id="slot-inventory-heading" className="text-sm font-semibold">Bảng tình trạng sử dụng slot</h3><p className="mt-1 text-xs text-slate-500">{timeLabel} · Tỷ lệ % tính trên tổng số trong thời gian đã chọn của từng slot.</p></div>
        <Card className="overflow-hidden"><SupplyGrid key={columnKey} rowNumbers canEdit={false} rows={report.summaries.map(r => ({ ...r, selectedTotalPercent: r.selectedTotal !== null && Number(r.selectedTotal) > 0 ? '100' : null }))} columns={totalColumns} storageKey={columnKey} empty="Không có hạn mức đã áp dụng trong phạm vi này."/></Card>
        {report.query.period === 'ALL' && <p className="text-xs text-amber-800">“Còn lại” toàn hợp đồng là tổng tham chiếu của các kỳ. Phần dư kỳ đã hết hạn không chuyển sang kỳ khác.</p>}
      </section>
      <section aria-labelledby="slot-chart-heading" className="space-y-3">
        <h3 id="slot-chart-heading" className="text-sm font-semibold">Biểu đồ tình trạng sử dụng slot</h3>
        {report.query.mode === 'DISCRETE' && <p className="text-xs text-slate-500">Chỉ các mốc thời gian đã chọn được hiển thị trên trục ngang.</p>}
          {chartOptions.length > 0 && <details className="rounded-xl border bg-white p-3">
            <summary className="cursor-pointer text-sm">Slot xem biểu đồ: {chartSlots.length === chartOptions.length ? `Tất cả (${chartOptions.length})` : `${chartSlots.length}/${chartOptions.length} slot`}</summary>
            <fieldset className="mt-3" aria-label="Chọn slot xem biểu đồ">
              <div className="mb-3 flex gap-2"><Button variant="ghost" size="sm" onClick={() => setChartSlotIds(null)}>Chọn tất cả</Button><Button variant="ghost" size="sm" onClick={() => setChartSlotIds([])}>Bỏ chọn tất cả</Button></div>
              <div className="grid max-h-64 gap-3 overflow-auto md:grid-cols-2">{chartOptions.map(s => <label key={s.slotId} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" aria-label={`Hiển thị biểu đồ ${s.name}`} checked={chartSlotIds === null || chartSlotIds.includes(s.slotId)} onChange={e => toggleChartSlot(s.slotId, e.target.checked)}/><span>{s.name}</span></label>)}</div>
            </fieldset>
          </details>}
          {chartSlots.length ? chartSlots.map(slot => {
            const points = rows.filter(r => r.slotId === slot.slotId).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.periodId.localeCompare(b.periodId));
            return <Card key={slot.slotId} className="min-w-0 space-y-4 p-4" role="region" aria-label={`Biểu đồ slot ${slot.name}`}>
              <div><h4 className="text-sm font-semibold">{slot.name}</h4><p className="mt-1 text-xs text-slate-500">{slot.periodName} · Cùng khoảng thời gian với bảng tình trạng sử dụng slot</p></div>
              {points.length ? <SupplyTrendChart rows={points} display={display}/> : <p className="text-sm text-slate-500">Không có mốc trong phạm vi đã chọn.</p>}
            </Card>;
          }) : <Card className="p-4 text-sm text-slate-500">{chartOptions.length ? 'Chọn slot để hiển thị biểu đồ.' : 'Không có slot trong phạm vi đã chọn.'}</Card>}
      </section>
      {report.outOfPeriod?.length > 0 && <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer">Lưu ý đối soát: {report.outOfPeriod.reduce((n, row) => n + row.bookings, 0)} đặt chỗ có lịch chạy ngoài kỳ cung ứng</summary>
        <p className="mt-2">Bảng cả kỳ vẫn trừ số đã dùng khỏi hạn mức kỳ được gán; biểu đồ chỉ đặt số sử dụng vào ngày chạy thực tế thuộc kỳ. Chọn một khoảng thời gian nhỏ hơn sẽ không cộng phần chạy ngoài khoảng đó.</p>
        <ul className="mt-2 list-disc pl-5">{report.outOfPeriod.map(row => <li key={`${row.slotId}:${row.periodId}`}>{row.slotName} · {row.periodName}: {row.bookings} đặt chỗ (trước kỳ: {formatSupply(row.before, 2)}, sau kỳ: {formatSupply(row.after, 2)})</li>)}</ul>
      </details>}
    </>}
  </div>;
}
