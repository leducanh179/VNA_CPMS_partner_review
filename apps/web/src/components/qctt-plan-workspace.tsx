import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { DEFAULT_QCTT_PLAN_COLUMNS, QCTT_PLAN_FIELDS, emptyQcttPlanFields,
  type CampaignRichTextNode, type QcttPlanColumn, type QcttPlanFields, type QcttPlanItem, type QcttPlanView } from '@cpms/domain';
import { requestJson } from '../lib/api';
import { navigate } from '../lib/router';
import { richTextToHtml } from '../lib/campaign-rich-text';
import { bookingTimelineScale, type BookingTimelineZoom } from '../lib/booking-timeline';
import { copyQcttPlanRowFields, patchQcttPlanCells, qcttPlanRowClipboardFields } from '../lib/qctt-plan-cells';
import { SupplyGrid, type SupplyGridColumn, type SupplyGridPatch, type SupplyGridCommitRequest } from './supply-grid';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không hoàn tất thao tác.';
const dateLabel = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Chưa xác định';
const topicText = (nodes: CampaignRichTextNode[] = []): string => nodes.map(node => node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : topicText(node.content ?? [])).join(' ');
const fieldLabels: Record<typeof QCTT_PLAN_FIELDS[number], string> = Object.fromEntries(DEFAULT_QCTT_PLAN_COLUMNS.map(column => [column.key, column.label])) as Record<typeof QCTT_PLAN_FIELDS[number], string>;
const fieldsOf = (item: QcttPlanFields): QcttPlanFields => ({
  customValues: { ...item.customValues }, professionLayer: item.professionLayer, channelCode: item.channelCode,
  activityCode: item.activityCode, activityLabel: item.activityLabel, content: item.content, format: item.format,
  otherFormat: item.otherFormat, startDate: item.startDate, endDate: item.endDate,
  departmentId: item.departmentId, requirements: item.requirements, progress: item.progress,
});
function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  return <div role="dialog" aria-label={title} className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="max-h-[85vh] w-[min(900px,95vw)] overflow-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex justify-between"><h2 className="text-lg font-semibold">{title}</h2><Button variant="ghost" onClick={onClose}>Đóng</Button></div>{children}</div></div>;
}

export function QcttPlanWorkspace({ campaignId, onInitialized }: { campaignId: string; onInitialized?(): void }) {
  const [data, setData] = useState<QcttPlanView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'table' | 'timeline'>('table');
  const [draftRows, setDraftRows] = useState<Array<{ id: string; campaignId: string; recordVersion: number } & QcttPlanFields>>([]);
  const [gridDirty, setGridDirty] = useState(false);
  const [duplicateCommit, setDuplicateCommit] = useState<SupplyGridCommitRequest | null>(null);
  const createKeys = useRef(new Map<string, string>());
  const [selected, setSelected] = useState<string[]>([]);
  const [trash, setTrash] = useState(false);
  const [history, setHistory] = useState<{ title: string; entries: Array<{ version: number; action: string; actorName: string; createdAt: string }> } | null>(null);
  const load = useCallback(async () => setData(await requestJson<QcttPlanView>(`/campaigns/${campaignId}/qctt-plan`)), [campaignId]);
  useEffect(() => { let active = true; setData(null); setDraftRows([]); setSelected([]); setError('');
    requestJson<QcttPlanView>(`/campaigns/${campaignId}/qctt-plan`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; }; }, [campaignId]);
  const command = async (body: object) => {
    await requestJson(`/campaigns/${campaignId}/qctt-plan/commands`, { method: 'POST', body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) });
    await load(); onInitialized?.();
  };
  const run = async (body: object) => { setBusy(true); setError(''); try { await command(body); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const addRow = () => { setMode('table'); setTrash(false); setDraftRows(rows => [...rows, { ...emptyQcttPlanFields(), id: `draft-${crypto.randomUUID()}`, campaignId, recordVersion: 0 }]); };
  const saveGrid = async (patches: SupplyGridPatch[]) => {
    if (!data) return null;
    try {
      const entries = patches.map(patch => {
        const original = data.items.find(item => item.id === patch.id);
        const draft = draftRows.find(row => row.id === patch.id);
        const targetCampaignId = original?.campaignId ?? patch.fields.campaignId ?? draft?.campaignId ?? campaignId;
        if (!data.campaigns.some(option => option.id === targetCampaignId)) throw new Error('Chiến dịch không còn trong danh sách.');
        const fields = patchQcttPlanCells(fieldsOf(original ?? draft ?? emptyQcttPlanFields()), patch.fields, data);
        if (!original && !fields.activityCode) throw new Error('Chọn Phương tiện QCTT cho mỗi dòng mới trước khi lưu.');
        if (targetCampaignId !== campaignId && Object.keys(fields.customValues ?? {}).some(key => key.startsWith('custom:'))) throw new Error('Hãy mở chiến dịch đích để dùng cột Tự nhập của kế hoạch đó.');
        return { campaignId: targetCampaignId, item: { ...(original ? { id: original.id, expectedVersion: patch.recordVersion } : {}), fields } };
      });
      if (new Set(entries.map(entry => entry.campaignId)).size > 1) throw new Error('Lưu các dòng của từng chiến dịch riêng để tránh ghi một phần.');
      for (const targetCampaignId of [...new Set(entries.map(entry => entry.campaignId))]) {
        const items = entries.filter(entry => entry.campaignId === targetCampaignId).map(entry => entry.item);
        const creating = items.some(item => !item.id);
        const signature = JSON.stringify({ targetCampaignId, ids: patches.map(patch => patch.id), items });
        const idempotencyKey = (creating && createKeys.current.get(signature)) || crypto.randomUUID();
        if (creating) createKeys.current.set(signature, idempotencyKey);
        await requestJson(`/campaigns/${targetCampaignId}/qctt-plan/commands`, { method: 'POST', body: JSON.stringify({ action: 'SAVE', idempotencyKey, items }) });
      }
      setDraftRows(current => current.filter(row => !patches.some(patch => patch.id === row.id)));
      if (entries.length === 1 && entries[0]!.campaignId !== campaignId) navigate(`/qctt-plans/${encodeURIComponent(entries[0]!.campaignId)}`);
      else await load();
      onInitialized?.();
      return {};
    } catch (cause) { return Object.fromEntries(patches.map(patch => [patch.id, errorText(cause)])); }
  };
  const duplicateRows = (rows: Array<Record<string, unknown> & { id: string }>) => {
    if (busy || duplicateCommit || trash || !rows.length) return;
    const copies = rows.map(row => ({ ...copyQcttPlanRowFields(row), id: `draft-${crypto.randomUUID()}`,
      campaignId: String(row.campaignId ?? campaignId), recordVersion: 0 }));
    setError('');
    setDraftRows(current => [...current, ...copies]);
    const ids = copies.filter(row => row.activityCode && row.campaignId === campaignId).map(row => row.id);
    if (ids.length) setDuplicateCommit({ ids, onComplete: () => setDuplicateCommit(null) });
  };
  const changeColumns = async (columns: QcttPlanColumn[]) => {
    if (!data || gridDirty || busy) return;
    setBusy(true); setError('');
    try { await command({ action: 'COLUMNS', expectedVersion: data.state.recordVersion, columns }); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  if (!data) return error ? <p role="alert" className="rounded-xl border p-5 text-rose-700">{error} <Button onClick={() => void load().catch(cause => setError(errorText(cause)))}>Thử lại</Button></p> : <LoadingBlock label="Đang tải kế hoạch QCTT…" />;
  const catalog = data.catalog.data;
  const columns = data.state.columns.length ? data.state.columns : DEFAULT_QCTT_PLAN_COLUMNS;
  const campaign = data.campaigns.find(item => item.id === campaignId);
  const visible = data.items.filter(item => Boolean(item.deletedAt) === trash);
  const bookings = (id: string) => data.bookings.filter(booking => booking.itemId === id && !booking.deleted);
  const bookingCount = (id: string) => new Set(bookings(id).map(booking => booking.id)).size;
  const updateColumn = (index: number, value: string) => {
    if (value === 'custom:new') {
      const label = window.prompt('Tên trường Tự nhập mới:')?.trim();
      if (label) void changeColumns(columns.map((column, at) => at === index ? { key: `custom:${crypto.randomUUID()}`, label } : column));
      return;
    }
    const old = columns[index]!;
    const other = columns.findIndex((column, at) => at !== index && column.key === value);
    const next = columns.map((column, at) => at === index ? { key: value as QcttPlanColumn['key'], label: fieldLabels[value as typeof QCTT_PLAN_FIELDS[number]] ?? column.label } : other === at ? old : column);
    void changeColumns(next);
  };
  const addColumn = (value: string) => {
    if (value === 'custom:new') {
      const label = window.prompt('Tên trường Tự nhập mới:')?.trim();
      if (label) void changeColumns([...columns, { key: `custom:${crypto.randomUUID()}`, label }]);
    } else if (value && !columns.some(column => column.key === value)) void changeColumns([...columns, { key: value as QcttPlanColumn['key'], label: fieldLabels[value as typeof QCTT_PLAN_FIELDS[number]] }]);
  };
  const header = (column: QcttPlanColumn, index: number, visibleIndex: number) => <select aria-label={`Trường thông tin cột ${String.fromCharCode(65 + visibleIndex)}`} title="Chọn trường thông tin của cột" className="mt-1 block max-w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px] font-normal" value={column.key} disabled={gridDirty || busy} onChange={event => updateColumn(index, event.target.value)}>
    {QCTT_PLAN_FIELDS.map(key => <option key={key} value={key}>{fieldLabels[key]}</option>)}
    {columns.filter(item => item.key.startsWith('custom:')).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    <option value="custom:new">+ Tự nhập…</option>
  </select>;
  const gridColumns: SupplyGridColumn[] = columns.map((column, index) => {
    const base: SupplyGridColumn = { key: column.key, label: column.label, editable: true, width: column.key === 'content' || column.key === 'requirements' ? 320 : 190, headerControl: visibleIndex => header(column, index, visibleIndex) };
    if (column.key === 'campaignId') return { ...base, editableWhen: row => String(row.id).startsWith('draft-'), width: 260, options: data.campaigns.map(item => ({ value: item.id, label: `${item.code} · ${item.name}` })) };
    if (column.key === 'professionLayer') return { ...base, options: catalog?.layers.map(item => ({ value: item.code, label: item.name })) ?? [] };
    if (column.key === 'channelCode') return { ...base, optionsForRow: row => catalog?.channels.filter(item => !row.professionLayer || catalog.activities.some(activity => activity.professionLayer === row.professionLayer && activity.channelCode === item.code)).map(item => ({ value: item.code, label: item.name })) ?? [] };
    if (column.key === 'activityLabel') return { ...base, width: 280, optionsForRow: row => catalog?.activities.filter(item => (!row.professionLayer || item.professionLayer === row.professionLayer) && (!row.channelCode || item.channelCode === row.channelCode)).map(item => ({ value: item.code, label: item.name })) ?? [], render: row => <div><span className="font-semibold text-vna-blue">{catalog?.activities.find(item => item.code === row.activityCode)?.name ?? String(row.activityName ?? 'Chọn Phương tiện')}</span>{bookingCount(String(row.id)) > 0 && <span className="ml-2 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] text-vna-blue">{bookingCount(String(row.id))} booking</span>}{row.origin === 'BOOKING' && <span className="ml-2 text-[10px] text-slate-500">Từ booking</span>}</div> };
    if (column.key === 'content') return { ...base, type: 'rich-text', clipboardValue: row => topicText((row.contentDocument as QcttPlanItem['content'])?.content ?? []), render: row => <div className="campaign-rich-text max-h-20 overflow-hidden" dangerouslySetInnerHTML={{ __html: richTextToHtml(row.contentDocument as QcttPlanItem['content'] ?? null) }} /> };
    if (column.key === 'startDate' || column.key === 'endDate') return { ...base, type: 'date', width: 165 };
    if (column.key === 'departmentId') return { ...base, width: 240, options: data.departments.map(item => ({ value: item.id, label: item.name })) };
    if (column.key.startsWith('custom:')) return { ...base, width: 220 };
    return base;
  });
  const gridRows = [...visible, ...(!trash ? draftRows : [])].map(item => ({ ...item, activityName: item.activityLabel,
    activityLabel: item.activityCode ?? '', contentDocument: item.content, content: item.content ? JSON.stringify(item.content) : '',
    ...Object.fromEntries(columns.filter(column => column.key.startsWith('custom:')).map(column => [column.key, item.customValues?.[column.key] ?? ''])) }));
  const projectDraft = (row: Record<string, unknown>, patch: Record<string, string>) => {
    if (!Object.keys(patch).length) return {};
    try {
      const original = data.items.find(item => item.id === row.id) ?? draftRows.find(item => item.id === row.id);
      const next = patchQcttPlanCells(fieldsOf(original ?? emptyQcttPlanFields()), patch, data);
      return { ...next, activityName: next.activityLabel, activityLabel: next.activityCode ?? '', contentDocument: next.content,
        content: next.content ? JSON.stringify(next.content) : '', ...Object.fromEntries(columns.filter(column => column.key.startsWith('custom:')).map(column => [column.key, next.customValues?.[column.key] ?? ''])) };
    } catch { return {}; }
  };
  const openHistory = async (item: QcttPlanItem) => { try {
    const entries = await requestJson<NonNullable<typeof history>['entries']>(`/campaigns/${campaignId}/qctt-plan/items/${item.id}/history`);
    setHistory({ title: item.activityLabel, entries });
  } catch (cause) { setError(errorText(cause)); } };
  return <section aria-label="Kế hoạch QCTT" className="w-full min-w-0 space-y-4">
    <div className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-vna-blue-deep">Kế hoạch QCTT · {campaign?.name ?? campaignId}</h2><p className="mt-1 text-sm text-slate-600">{data.state.recordVersion ? 'Kế hoạch đang nhận Booking theo Chiến dịch và Phương tiện QCTT.' : 'Chọn Phương tiện trong dòng mới để tạo một kế hoạch duy nhất cho chiến dịch.'}</p></div><div className="flex flex-wrap gap-2"><Button disabled={busy || gridDirty} onClick={addRow}><CpmsIcon name="add"/>Thêm dòng</Button><Button variant="ghost" disabled={busy || gridDirty} onClick={() => void load().catch(cause => setError(errorText(cause)))}>Tải lại</Button></div></div>
      <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Chiến dịch<select aria-label="Chọn chiến dịch lập kế hoạch" className="ml-2 max-w-[360px] rounded-lg border px-2 py-2" value={campaignId} disabled={gridDirty} onChange={event => navigate(`/qctt-plans/${encodeURIComponent(event.target.value)}`)}>{data.campaigns.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}{item.hasPlan ? ' · Đã có kế hoạch' : ''}</option>)}</select></label><div className="flex rounded-lg bg-slate-100 p-1">{(['table', 'timeline'] as const).map(value => <button key={value} aria-pressed={mode === value} className={`rounded-md px-3 py-2 text-sm ${mode === value ? 'bg-white font-semibold text-vna-blue shadow-sm' : 'text-slate-600'}`} onClick={() => { if (gridDirty && !window.confirm('Bỏ các chỉnh sửa chưa lưu?')) return; setMode(value); }}>{value === 'table' ? 'Bảng' : 'Timeline'}</button>)}</div><label className="text-sm"><input type="checkbox" className="mr-1" checked={trash} disabled={gridDirty} onChange={event => setTrash(event.target.checked)}/>Thùng rác</label><label className="text-sm">Thêm cột <select aria-label="Thêm cột thông tin" className="ml-1 rounded-lg border px-2 py-2" value="" disabled={gridDirty || busy} onChange={event => addColumn(event.target.value)}><option value="">Chọn trường…</option>{QCTT_PLAN_FIELDS.filter(key => !columns.some(column => column.key === key)).map(key => <option key={key} value={key}>{fieldLabels[key]}</option>)}<option value="custom:new">Tự nhập…</option></select></label></div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {mode === 'table' ? <div className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3 pb-16 shadow-panel"><SupplyGrid key={`${campaignId}:${columns.map(column => column.key).join('|')}:${trash}`} rows={gridRows} columns={gridColumns} storageKey={`cpms.qctt-plan.sheet.${campaignId}`} viewportClassName="min-h-[420px] bg-white" columnReordering spreadsheet rowNumbers columnLetters selectionStyle="campaign" canEdit={!trash} onRestoreRows={restored => setDraftRows(current => [...current, ...restored.filter(row => String(row.id).startsWith("draft-") && !current.some(item => item.id === row.id)).map(row=>({...row,content:row.contentDocument??null,activityLabel:row.activityName??""})) as unknown as typeof current])} rowClipboard={{scope:'QCTT_PLAN',fields:qcttPlanRowClipboardFields}} commitRequest={duplicateCommit} onSave={saveGrid} onDirty={setGridDirty} onDiscard={() => setDraftRows([])} draftRowIds={draftRows.map(row => row.id)} projectDraft={projectDraft} onSelectionChange={setSelected} empty={trash ? 'Thùng rác không có dòng.' : 'Chưa có Phương tiện QCTT. Thêm dòng để bắt đầu.'} onCreate={addRow} createLabel="Thêm dòng kế hoạch" contextActions={rows => {
      const items = rows.map(row => data.items.find(item => item.id === row.id)).filter((item): item is QcttPlanItem => Boolean(item));
      return [...(!trash && rows.length ? [{ label: 'Nhân bản', disabled: busy || Boolean(duplicateCommit), run: () => duplicateRows(rows) }] : []),
        { label: 'Xem booking của hoạt động', tone: 'primary', run: () => setSelected(items.map(item => item.id)) },
        ...(items.length === 1 ? [{ label: 'Lịch sử dòng', run: () => void openHistory(items[0]!) }] : []),
        ...(items.length ? [{ label: trash ? 'Phục hồi dòng đã chọn' : 'Đưa dòng đã chọn vào Thùng rác', tone: trash ? 'positive' as const : 'danger' as const, run: () => void run({ action: trash ? 'RESTORE' : 'DELETE', items: items.map(item => ({ id: item.id, expectedVersion: item.recordVersion })) }) }] : [])];
    }} /></div> : <PlanTimeline items={visible} data={data} />}
    <div className="rounded-2xl border bg-white p-4"><h3 className="font-semibold">Booking trong kế hoạch</h3><p className="mt-1 text-xs text-slate-500">Booking tự xuất hiện dưới Phương tiện QCTT tương ứng. Chọn dòng trong bảng để chỉ xem hoạt động đó.</p><div className="mt-3 space-y-3">{visible.filter(item => !selected.length || selected.includes(item.id)).filter(item => bookingCount(item.id)).map(item => <details key={item.id} open={selected.includes(item.id)} className="rounded-lg border"><summary className="cursor-pointer bg-slate-50 p-3 text-sm font-medium">{item.activityLabel} · {bookingCount(item.id)} booking</summary><PlanBookingTable rows={bookings(item.id)}/></details>)}{data.bookings.filter(booking => !booking.itemId && !booking.deleted).length > 0 && <details className="rounded-lg border"><summary className="cursor-pointer bg-amber-50 p-3 text-sm font-medium">Booking chưa liên kết Phương tiện</summary><PlanBookingTable rows={data.bookings.filter(booking => !booking.itemId && !booking.deleted)}/></details>}</div></div>
    {history && <Dialog title={`Lịch sử · ${history.title}`} onClose={() => setHistory(null)}><div className="space-y-2">{history.entries.map(entry => <p key={entry.version} className="border-b py-2 text-sm">Phiên bản {entry.version} · {entry.action} · {entry.actorName} · {new Date(entry.createdAt).toLocaleString('vi-VN')}</p>)}</div></Dialog>}
  </section>;
}

function PlanBookingTable({ rows }: { rows: QcttPlanView['bookings'] }) {
  return <div className="overflow-auto"><table className="w-full min-w-[750px] text-left text-xs"><thead className="bg-slate-50"><tr>{['Slot', 'Bắt đầu', 'Kết thúc', 'Số lượng', 'Trạng thái', 'Thực hiện'].map(label => <th key={label} className="border-b px-3 py-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.id}:${row.perspective}`} className="border-b hover:bg-cyan-50"><td className="px-3 py-2">{row.slotName}{row.perspective === 'PROPOSED' ? ' · Đề nghị' : ''}{row.outsidePlan ? ' · Lệch thời gian' : ''}</td><td className="px-3 py-2">{dateLabel(row.startDate)}</td><td className="px-3 py-2">{dateLabel(row.endDate)}</td><td className="px-3 py-2">{row.quantity} {row.unit}</td><td className="px-3 py-2">{row.status}</td><td className="px-3 py-2">{row.execution}</td></tr>)}</tbody></table></div>;
}

function PlanTimeline({ items, data }: { items: QcttPlanItem[]; data: QcttPlanView }) {
  const [zoom, setZoom] = useState<BookingTimelineZoom>('week');
  const [expanded, setExpanded] = useState<string[]>([]);
  const children = useMemo(() => data.bookings.filter(booking => items.some(item => item.id === booking.itemId) && !booking.deleted), [data.bookings, items]);
  const dates = [...items.flatMap(item => [item.startDate, item.endDate]), ...children.flatMap(booking => [booking.startDate, booking.endDate])].filter((value): value is string => Boolean(value)).sort();
  let scale: ReturnType<typeof bookingTimelineScale> | null = null;
  try { if (dates.length) scale = bookingTimelineScale(dates[0]!, dates.at(-1)!, zoom); } catch { /* Invalid legacy dates remain visible in the table. */ }
  const bar = (start: string | null, end: string | null, proposed = false) => {
    if (!start || !end || !scale) return <span className="px-3 text-xs text-slate-400">Chưa xác định ngày</span>;
    const bounds = scale.bar(start, end);
    return <div title={`${dateLabel(start)} – ${dateLabel(end)}`} className={`absolute top-3 h-5 rounded transition-colors hover:ring-2 hover:ring-vna-blue ${proposed ? 'border-2 border-dashed border-amber-500 bg-amber-50' : 'bg-cyan-600'}`} style={{ left: bounds.left, width: bounds.width }}/>;
  };
  return <div className="rounded-2xl border bg-white"><div className="flex items-center gap-3 border-b p-3 text-sm"><label>Khung thời gian <select aria-label="Khung thời gian Timeline" className="rounded border px-2 py-1" value={zoom} onChange={event => setZoom(event.target.value as BookingTimelineZoom)}>{Object.entries({ day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span className="text-xs text-slate-500">Thanh liền: kế hoạch/booking hiệu lực · nét đứt: booking đề nghị</span></div><div className="max-h-[65vh] overflow-auto" role="region" aria-label="Timeline kế hoạch QCTT" tabIndex={0}><div style={{ minWidth: (scale?.width ?? 900) + 340 }}><div className="sticky top-0 z-30 flex h-12 border-b bg-slate-50"><div className="sticky left-0 z-40 w-[340px] shrink-0 border-r bg-slate-50 p-3 font-semibold">Phương tiện / Booking</div><div className="relative flex-1">{scale?.ticks.map(tick => <span key={tick.key} className="absolute inset-y-0 border-r p-3 text-xs" style={{ left: tick.left, width: tick.width }}>{tick.label}</span>)}</div></div>{items.map(item => <div key={item.id}><div className="flex min-h-14 border-b hover:bg-cyan-50"><div className="sticky left-0 z-20 flex w-[340px] shrink-0 items-center gap-2 border-r bg-inherit px-3 py-2"><button aria-label={`Hiện booking của ${item.activityLabel}`} aria-expanded={expanded.includes(item.id)} onClick={() => setExpanded(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id])}><CpmsIcon name={expanded.includes(item.id) ? 'collapse' : 'expand'}/></button><span className="text-sm font-medium text-vna-blue">{item.activityLabel || 'Chưa đặt tên'}</span></div><div className="relative flex-1">{bar(item.startDate, item.endDate)}</div></div>{expanded.includes(item.id) && children.filter(booking => booking.itemId === item.id).map(booking => <div key={`${booking.id}:${booking.perspective}`} className="flex min-h-12 border-b bg-slate-50 hover:bg-cyan-50"><div className="sticky left-0 z-20 w-[340px] shrink-0 border-r bg-inherit py-2 pl-10 pr-3 text-xs">{booking.slotName}<p className="text-slate-500">{booking.status}{booking.outsidePlan ? ' · Lệch thời gian' : ''}</p></div><div className="relative flex-1">{bar(booking.startDate, booking.endDate, booking.perspective === 'PROPOSED')}</div></div>)}</div>)}{!items.length && <p className="p-8 text-slate-500">Chưa có hoạt động để hiển thị.</p>}</div></div></div>;
}
