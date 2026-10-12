import { SUPPLY_PIVOT_MEASURES, supplyPivotPreset, type SupplyAnalyticsQuery, type SupplyPivotDefinition, type SupplyPivotLayout, type SupplyPivotReport, type SupplyPivotView, type SupplyUsageStage } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
import { ContractPivotLayout } from './contract-pivot-layout';
import { ContractPivotTable } from './contract-pivot-table';

const stages: { value: SupplyUsageStage; label: string }[] = [
  { value: 'booked', label: 'Tính theo số đặt chỗ' }, { value: 'vendorConfirmed', label: 'Tính theo số đặt chỗ đã xác nhận' },
  { value: 'approved', label: 'Tính theo số đặt chỗ đã phê duyệt' }, { value: 'accepted', label: 'Tính theo số đã nghiệm thu' },
];
const css = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const signature = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
export function ContractPivotPanel({ contractId, active, asOf, query, filtersPending, onQueryChange, onStageChange }: {
  contractId: string; active: boolean; asOf: string; query: SupplyAnalyticsQuery; filtersPending: boolean;
  onQueryChange: (query: SupplyAnalyticsQuery) => void; onStageChange: (stage: SupplyUsageStage) => void;
}) {
  const [layout, setLayout] = useState<SupplyPivotLayout>(() => supplyPivotPreset('SLOT'));
  const [views, setViews] = useState<SupplyPivotView[]>([]), [selected, setSelected] = useState<SupplyPivotView | null>(null);
  const [name, setName] = useState(''), [isDefault, setIsDefault] = useState(false), [baseline, setBaseline] = useState('');
  const [hydrated, setHydrated] = useState(false), [initialError, setInitialError] = useState(''), [reload, setReload] = useState(0);
  const [report, setReport] = useState<SupplyPivotReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [showLayout, setShowLayout] = useState(false);
  const [editor, setEditor] = useState<'COPY' | 'RENAME' | 'DELETE' | null>(null), [editName, setEditName] = useState('');
  const [pendingView, setPendingView] = useState<string | null>(null), [tableKey, setTableKey] = useState(0);
  const callbacks = useRef({ onQueryChange, onStageChange }); callbacks.current = { onQueryChange, onStageChange };
  const latestQuery = useRef(query); latestQuery.current = query;
  const definition: SupplyPivotDefinition = { version: 1, query, layout };
  const currentSignature = signature({ name, isDefault, definition });
  const dirty = hydrated && baseline !== currentSignature;
  const hasQueryDraft = filtersPending;
  const reportSequence = useRef(0);
  const endpoint = `/contracts/${contractId}/pivot`;
  const queryKey = signature({ version: 1, query, layout: { ...layout, widths: {}, collapsed: [] } });
  const loadView = (view: SupplyPivotView | null, preset: 'SLOT' | 'UNIT' | 'TIME' = 'SLOT') => {
    const nextLayout = view?.definition.layout ?? supplyPivotPreset(preset), nextQuery = view?.definition.query ?? latestQuery.current;
    setSelected(view); setName(view?.name ?? ''); setIsDefault(view?.isDefault ?? false); setLayout(nextLayout);
    callbacks.current.onQueryChange(nextQuery); setTableKey(n => n + 1); setEditor(null); setMessage('');
    setBaseline(signature({ name: view?.name ?? '', isDefault: view?.isDefault ?? false, definition: { version: 1, query: nextQuery, layout: nextLayout } }));
  };
  // Fetch personal definitions once per contract/actor mount, then resolve CURRENT from live data each time.
  useEffect(() => {
    let cancelled = false;
    requestJson<SupplyPivotView[]>(`${endpoint}/views`).then(result => {
      if (cancelled) return; setViews(result); setInitialError('');
      const view = result.find(v => v.isDefault) ?? null;
      const nextQuery = view?.definition.query ?? latestQuery.current, nextLayout = view?.definition.layout ?? supplyPivotPreset('SLOT');
      setSelected(view); setName(view?.name ?? ''); setIsDefault(view?.isDefault ?? false); setLayout(nextLayout);
      callbacks.current.onQueryChange(nextQuery);
      setBaseline(signature({ name: view?.name ?? '', isDefault: view?.isDefault ?? false, definition: { version: 1, query: nextQuery, layout: nextLayout } })); setHydrated(true);
    }).catch((caught: unknown) => { if (!cancelled) setInitialError(caught instanceof Error ? caught.message : 'Không tải được view cá nhân.'); });
    return () => { cancelled = true; };
  }, [endpoint, reload]);
  useEffect(() => {
    if (!active || !hydrated) return;
    const sequence = ++reportSequence.current;
    setBusy(true); setError(''); setReport(null);
    requestJson<SupplyPivotReport>(`${endpoint}/query`, { method: 'POST', body: queryKey }).then(value => { if (sequence === reportSequence.current) setReport(value); })
      .catch((caught: unknown) => { if (sequence === reportSequence.current) setError(caught instanceof Error ? caught.message : 'Không thể tải Pivot.'); })
      .finally(() => { if (sequence === reportSequence.current) setBusy(false); });
    return () => { reportSequence.current++; };
  }, [active, hydrated, endpoint, queryKey, asOf]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const performSwitch = async (value: string) => {
    setPendingView(null);
    if (value.startsWith('preset:')) loadView(null, value.slice(7) as 'SLOT' | 'UNIT' | 'TIME');
    else {
      try { const fresh = await requestJson<SupplyPivotView[]>(`${endpoint}/views`); setViews(fresh); const found = fresh.find(v => v.id === value); if (found) loadView(found); else setMessage('View đã bị xóa ở phiên khác.'); }
      catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Không tải được view.'); }
    }
  };
  const switchView = (value: string) => { if (dirty || hasQueryDraft) setPendingView(value); else void performSwitch(value); };
  const save = async (copy = false) => {
    if (hasQueryDraft) { setMessage('Bấm Xem dữ liệu để áp dụng bộ lọc trước khi lưu view.'); return; }
    const nextName = (editor === 'COPY' || editor === 'RENAME' ? editName : name).trim();
    if (!nextName) { setEditor('COPY'); setEditName(''); return; }
    setSaving(true); setMessage('');
    try {
      const saved = await requestJson<SupplyPivotView>(`${endpoint}/views`, { method: 'POST', body: signature({ ...(selected && !copy ? { id: selected.id, expectedVersion: selected.recordVersion } : {}), name: nextName, definition, isDefault }) });
      setSelected(saved); setName(saved.name); setIsDefault(saved.isDefault); setEditor(null);
      setBaseline(signature({ name: saved.name, isDefault: saved.isDefault, definition: saved.definition })); setMessage('Đã lưu view cá nhân.');
      setViews(await requestJson<SupplyPivotView[]>(`${endpoint}/views`));
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Không thể lưu view.'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected) return; setSaving(true); setMessage('');
    try {
      await requestJson(`${endpoint}/views/${selected.id}/delete`, { method: 'POST', body: signature({ expectedVersion: selected.recordVersion }) });
      setViews(await requestJson<SupplyPivotView[]>(`${endpoint}/views`)); loadView(null); setMessage('Đã xóa view cá nhân.');
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Không thể xóa view.'); }
    finally { setSaving(false); }
  };
  return <section hidden={!active} role="tabpanel" id="slot-pivot-panel" aria-labelledby="slot-pivot-tab" className="space-y-4">
    {initialError && <div role="alert" className="rounded-lg border border-rose-200 p-4 text-sm text-rose-800">{initialError}<Button variant="ghost" size="sm" onClick={() => setReload(n => n + 1)}>Thử tải view lại</Button></div>}
    {!hydrated && !initialError && <LoadingBlock label="Đang tải view cá nhân…"/>}
    {hydrated && <>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600">View cá nhân<select aria-label="View Pivot cá nhân" className={`${css} ml-2 max-w-64`} value={selected?.id ?? ''} disabled={saving} onChange={e => switchView(e.target.value)}><option value="" disabled>{selected ? 'Chọn view' : 'Chưa lưu view'}</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}{view.isDefault ? ' · Mặc định' : ''}</option>)}</select></label>
          <Button size="sm" onClick={() => void save()} disabled={saving || hasQueryDraft || !!error || !report}><CpmsIcon name="save" size={16}/>Lưu view</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditor('COPY'); setEditName(name ? `${name} — bản sao` : ''); }} disabled={saving || !report}><CpmsIcon name="duplicate" size={16}/>Lưu thành view mới</Button>
          {selected && <><Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditor('RENAME'); setEditName(name); }}>Đổi tên</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditor('DELETE')}><CpmsIcon name="delete" size={16}/>Xóa view</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => switchView(selected.id)}>Khôi phục view đã lưu</Button></>}
          <Button size="sm" variant="secondary" aria-expanded={showLayout} onClick={() => setShowLayout(v => !v)}><CpmsIcon name="table" size={16}/>Bố trí bảng</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-500">Mẫu nhanh:</span>{[{ key: 'SLOT', label: 'Tình trạng slot' }, { key: 'UNIT', label: 'Theo đơn vị' }, { key: 'TIME', label: 'Theo thời gian' }].map(p => <button key={p.key} disabled={saving} className="rounded-full border px-3 py-1.5 hover:bg-cyan-50" onClick={() => switchView(`preset:${p.key}`)}>{p.label}</button>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} disabled={saving}/>Mặc định khi tôi mở Pivot của hợp đồng này</label>
          <span className="text-amber-800">{dirty ? 'Có thay đổi chưa lưu' : selected ? 'Đã lưu' : 'Bản xem thử'}</span>
        </div>
        {pendingView && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm"><span>Chuyển view sẽ bỏ các thay đổi chưa lưu.</span><Button size="sm" onClick={() => void performSwitch(pendingView)}>Bỏ thay đổi và chuyển</Button><Button size="sm" variant="ghost" onClick={() => setPendingView(null)}>Giữ chỉnh sửa</Button></div>}
        {editor && <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-3">
          {editor === 'DELETE' ? <><p className="text-sm">Xóa view “{name}” khỏi danh sách cá nhân?</p><Button size="sm" disabled={saving} onClick={() => void remove()}>Xác nhận xóa view</Button></> : <><input aria-label="Tên view Pivot" autoFocus maxLength={100} placeholder="Đặt tên view của bạn" className={css} value={editName} onChange={e => setEditName(e.target.value)}/><Button size="sm" disabled={saving || !editName.trim() || hasQueryDraft || !report || !!error} onClick={() => void save(editor === 'COPY')}>Lưu tên và bố trí</Button></>}
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditor(null)}>Hủy</Button>
        </div>}
        {message && <p role="status" className="text-sm text-vna-blue">{message}</p>}
      </Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-slate-600">Đã sử dụng<select aria-label="Cách tính nhanh trong Pivot" className={`${css} ml-2 max-w-80`} value={query.stage} onChange={e => callbacks.current.onStageChange(e.target.value as SupplyUsageStage)}>{stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
          <label className="text-xs text-slate-600">Sắp xếp<select className={`${css} ml-2`} aria-label="Sắp xếp Pivot" value={layout.sort.field} onChange={e => setLayout({ ...layout, sort: { ...layout.sort, field: e.target.value as SupplyPivotLayout['sort']['field'] } })}><option value="label">Tên hàng</option>{SUPPLY_PIVOT_MEASURES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
          <select aria-label="Thứ tự sắp xếp Pivot" className={css} value={layout.sort.direction} onChange={e => setLayout({ ...layout, sort: { ...layout.sort, direction: e.target.value as 'asc' | 'desc' } })}><option value="asc">Tăng dần</option><option value="desc">Giảm dần</option></select>
        </div>
        {report && <span className="text-xs text-slate-500">{new Date(report.asOf).toLocaleString('vi-VN')}</span>}
      </div>
      <div className="flex min-w-0 flex-col-reverse items-start gap-4 xl:flex-row">
        <div className="w-full min-w-0 flex-1 space-y-3">
          <p className="text-xs text-slate-500">Số liệu trong các mốc đã áp dụng · Hạn mức sau điều chỉnh. Tỷ lệ = số lượng / tổng số của cùng ô hoặc nhóm; không cộng các tỷ lệ.</p>
          {query.period === 'ALL' && <p className="text-xs text-amber-800">Tổng hợp đồng để tham khảo; phần dư kỳ cũ không tự chuyển sang kỳ khác.</p>}
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
          {busy && <LoadingBlock label="Đang tính Pivot từ dữ liệu hợp đồng…"/>}
          {report && <ContractPivotTable key={tableKey} report={report} layout={layout} onChange={setLayout}/>}
        </div>
        {showLayout && <ContractPivotLayout layout={layout} onChange={setLayout} onClose={() => setShowLayout(false)}/>}
      </div>
      {report && <details className="rounded-xl border bg-white p-4 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Cách tính và giới hạn Pivot</summary><ul className="mt-3 list-disc space-y-2 pl-4"><li>View chỉ lưu cách xem, không lưu bản sao số liệu. Các trường không làm hàng/cột được đưa vào vùng Bộ lọc.</li><li>Không cộng khác đơn vị đo. Ô không có phân bổ hoặc chưa xác định hiện dấu —. Mẫu số bằng 0 không tính phần trăm; số âm và tỷ lệ vượt 100% được giữ nguyên.</li>{report.notices.map(n => <li key={n}>{n}</li>)}</ul></details>}
    </>}
  </section>;
}
