import {
  CAMPAIGN_SPREADSHEET_FIELDS,
  type CampaignSpreadsheetExportRequest,
  type CampaignSpreadsheetCompareRequest,
  type CampaignSpreadsheetComparisonResult,
  type CampaignSpreadsheetFieldKey,
  type CampaignSpreadsheetFile,
  type CampaignSpreadsheetImportResult,
  type CampaignSpreadsheetMapping,
  type CampaignSpreadsheetPreviewResult,
  type CampaignSpreadsheetRowStatus,
  type GoogleIntegrationStatus,
  type GoogleSheetPreviewResponse,
  type GoogleSpreadsheetMetadata,
} from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  exportCampaignSpreadsheet,
  compareGoogleSpreadsheet,
  connectGoogleIntegration,
  createGoogleDiffTab,
  createGoogleSyncTab,
  disconnectGoogleIntegration,
  getGoogleIntegrationStatus,
  importCampaignSpreadsheet,
  importGoogleSpreadsheet,
  inspectGoogleSpreadsheet,
  inspectCampaignSpreadsheet,
  previewGoogleSpreadsheet,
  previewCampaignSpreadsheet,
} from '../lib/api';

export type ExchangeTab = 'export' | 'import' | 'google';

interface CampaignSpreadsheetExchangeProps {
  open: boolean;
  initialTab: ExchangeTab;
  filteredIds: string[];
  selectedIds: string[];
  visibleFieldKeys: string[];
  onClose(): void;
  onImported(): Promise<void>;
  notify(message: string): void;
  showGoogleSheets?: boolean;
}

const inputClass = 'min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-vna-blue focus:ring-4 focus:ring-cyan-100';
const statusTone: Record<CampaignSpreadsheetRowStatus, string> = {
  CREATE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  UPDATE: 'bg-sky-50 text-sky-800 ring-sky-200',
  UNCHANGED: 'bg-slate-100 text-slate-700 ring-slate-200',
  CONFLICT: 'bg-rose-50 text-rose-800 ring-rose-200',
  INVALID: 'bg-amber-50 text-amber-900 ring-amber-200',
  SKIP: 'bg-slate-50 text-slate-500 ring-slate-200',
};

function downloadBase64(fileName: string, mimeType: string, contentBase64: string) {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function filePayload(file: File): Promise<CampaignSpreadsheetFile> {
  if (file.size > 6_000_000) throw new Error('File không được vượt quá 6 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { fileName: file.name, ...(file.type ? { mimeType: file.type } : {}), contentBase64: window.btoa(binary) };
}

function saveResultCsv(result: CampaignSpreadsheetImportResult) {
  const rows = [['Dòng', 'Mã chiến dịch', 'Trạng thái preview', 'Kết quả', 'Thông báo']];
  const itemByKey = new Map(result.items.map((item) => [item.clientKey, item]));
  for (const row of result.preview.rows) {
    const item = itemByKey.get(`spreadsheet-${row.rowNumber}`);
    rows.push([String(row.rowNumber), row.code ?? '', row.status, item ? (item.ok ? 'THÀNH CÔNG' : 'LỖI') : 'BỎ QUA', item?.message ?? '']);
  }
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CPMS_Campaign_Import_Result.csv'; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function CampaignSpreadsheetExchange(props: CampaignSpreadsheetExchangeProps) {
  const [tab, setTab] = useState<ExchangeTab>(props.showGoogleSheets ? props.initialTab : props.initialTab === 'google' ? 'export' : props.initialTab);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (props.open) setTab(props.showGoogleSheets ? props.initialTab : props.initialTab === 'google' ? 'export' : props.initialTab); }, [props.initialTab, props.open, props.showGoogleSheets]);
  useEffect(() => {
    const element = dialog.current; const previous = document.activeElement;
    if (props.open && !element?.open) element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [props.open]);
  if (!props.open) return null;
  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); props.onClose(); }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter((item) => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0);
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} className="fixed inset-0 z-[80] m-0 flex h-screen max-h-none w-screen max-w-none items-start justify-center overflow-y-auto border-0 bg-slate-950/40 px-4 py-8 backdrop-blur-sm" aria-modal="true" aria-label="Trao đổi dữ liệu spreadsheet">
      <div className="w-full max-w-7xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-lg font-semibold text-slate-950">Trao đổi dữ liệu Chiến dịch</h2><p className="mt-1 text-xs text-slate-500">Excel/CSV · xem trước khi ghi · CPMS là nguồn dữ liệu chuẩn</p></div>
          <button className="grid size-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Đóng" onClick={props.onClose}><CpmsIcon name="reject" /></button>
        </div>
        <div className="flex gap-2 border-b border-slate-100 px-5 pt-3">
          <button className={`rounded-t-xl px-4 py-3 text-sm font-semibold ${tab === 'export' ? 'bg-cyan-50 text-vna-blue' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => setTab('export')}>Xuất dữ liệu</button>
          <button className={`rounded-t-xl px-4 py-3 text-sm font-semibold ${tab === 'import' ? 'bg-cyan-50 text-vna-blue' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => setTab('import')}>Nhập dữ liệu</button>
          {props.showGoogleSheets ? <button className={`rounded-t-xl px-4 py-3 text-sm font-semibold ${tab === 'google' ? 'bg-cyan-50 text-vna-blue' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => setTab('google')}>Google Sheets</button> : null}
        </div>
        <div className="p-5 lg:p-6">
          {tab === 'export' ? <ExportPanel {...props} /> : tab === 'import' ? <ImportPanel {...props} /> : <GoogleSheetsPanel {...props} />}
        </div>
      </div>
    </dialog>
  );
}

function ExportPanel({ filteredIds, selectedIds, visibleFieldKeys, notify }: CampaignSpreadsheetExchangeProps) {
  const [mode, setMode] = useState<CampaignSpreadsheetExportRequest['mode']>('DATA');
  const [recordScope, setRecordScope] = useState<CampaignSpreadsheetExportRequest['recordScope']>('FILTERED');
  const [fieldScope, setFieldScope] = useState<CampaignSpreadsheetExportRequest['fieldScope']>('ACTIVE_V2');
  const [customFields, setCustomFields] = useState<CampaignSpreadsheetFieldKey[]>(['campaign_code', 'campaign_name', 'campaign_level_code']);
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = async () => {
    setBusy(true); setError(null);
    try {
      const campaignIds = recordScope === 'SELECTED' ? selectedIds : recordScope === 'FILTERED' ? filteredIds : undefined;
      const fieldKeys = fieldScope === 'VISIBLE' ? visibleFieldKeys as CampaignSpreadsheetFieldKey[] : fieldScope === 'CUSTOM' ? customFields : undefined;
      const result = await exportCampaignSpreadsheet({ mode, recordScope, ...(campaignIds ? { campaignIds } : {}), fieldScope, ...(fieldKeys ? { fieldKeys } : {}), includeLegacyReadOnly: legacy });
      downloadBase64(result.fileName, result.mimeType, result.contentBase64);
      notify(mode === 'TEMPLATE' ? 'Đã tải template Campaign chuẩn CPMS.' : `Đã xuất ${result.rowCount} chiến dịch.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xuất dữ liệu.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <ChoiceSection title="Chế độ" value={mode} onChange={(value) => setMode(value as typeof mode)} options={[['DATA', 'Xuất dữ liệu', 'Tạo file có dữ liệu theo phạm vi đã chọn.'], ['TEMPLATE', 'Template trống', 'Tải biểu mẫu có canonical key để nhập lại an toàn.']]} />
        <ChoiceSection title="Phạm vi bản ghi" value={recordScope} onChange={(value) => setRecordScope(value as typeof recordScope)} options={[['ALL_CURRENT', 'Tất cả hiện tại', 'Toàn bộ chiến dịch đang hoạt động.'], ['FILTERED', `Kết quả đang lọc (${filteredIds.length})`, 'Đúng tập kết quả sau bộ lọc.'], ['SELECTED', `Đang tick chọn (${selectedIds.length})`, 'Chỉ các dòng đang được tick.']]} />
        <ChoiceSection title="Phạm vi trường" value={fieldScope} onChange={(value) => setFieldScope(value as typeof fieldScope)} options={[['ACTIVE_V2', 'Toàn bộ Campaign V2', 'Các trường nghiệp vụ đang hoạt động.'], ['VISIBLE', 'Cột đang hiển thị', 'Dùng cấu hình cột hiện tại của bảng.'], ['CUSTOM', 'Tự chọn trường', 'Chọn từng trường cần xuất.']]} />
        {fieldScope === 'CUSTOM' ? <div className="grid gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-3">{CAMPAIGN_SPREADSHEET_FIELDS.map((field) => <label key={field.key} className="flex items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"><input className="mt-0.5" type="checkbox" checked={customFields.includes(field.key)} onChange={(event) => setCustomFields((current) => event.target.checked ? [...current, field.key] : current.filter((key) => key !== field.key))} /><span><span className="block font-medium text-slate-800">{field.label}</span><span className="text-[11px] text-slate-400">{field.key}</span></span></label>)}</div> : null}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm"><input className="mt-0.5" type="checkbox" checked={legacy} onChange={(event) => setLegacy(event.target.checked)} /><span><b className="block text-slate-800">Kèm dữ liệu legacy chỉ đọc</b><span className="mt-1 block text-xs text-slate-500">Chỉ bật khi cần rà soát đầy đủ; các cột này không được dùng làm trường nhập chính.</span></span></label>
      </div>
      <aside className="h-fit rounded-2xl border border-cyan-100 bg-cyan-50/70 p-5"><CpmsIcon name="export" className="text-vna-blue" /><h3 className="mt-3 font-semibold text-slate-900">File XLSX chuẩn CPMS</h3><p className="mt-2 text-sm leading-6 text-slate-600">Có sheet hướng dẫn, sheet Campaigns, nhãn dễ đọc và dòng canonical key ẩn để round-trip chính xác.</p>{error ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p> : null}<Button className="mt-5 w-full gap-2" disabled={busy || (recordScope === 'SELECTED' && !selectedIds.length)} onClick={() => void execute()}><CpmsIcon name="download" />{busy ? 'Đang tạo file…' : mode === 'TEMPLATE' ? 'Tải template' : 'Xuất dữ liệu'}</Button></aside>
    </div>
  );
}

function ChoiceSection({ title, value, options, onChange }: { title: string; value: string; options: Array<[string, string, string]>; onChange(value: string): void }) {
  return <section><h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3><div className="grid gap-2 md:grid-cols-3">{options.map(([key, label, description]) => <label key={key} className={`cursor-pointer rounded-xl border p-3 ${value === key ? 'border-vna-blue bg-cyan-50 ring-1 ring-vna-blue/20' : 'border-slate-200 hover:border-vna-blue/40'}`}><input className="sr-only" type="radio" checked={value === key} onChange={() => onChange(key)} /><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></label>)}</div></section>;
}

function ImportPanel({ onImported, notify }: CampaignSpreadsheetExchangeProps) {
  const [file, setFile] = useState<CampaignSpreadsheetFile | null>(null);
  const [sheets, setSheets] = useState<Array<{ name: string; rowCount: number }>>([]);
  const [sheetName, setSheetName] = useState('');
  const [preview, setPreview] = useState<CampaignSpreadsheetPreviewResult | null>(null);
  const [mapping, setMapping] = useState<CampaignSpreadsheetMapping[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [result, setResult] = useState<CampaignSpreadsheetImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeFieldKeys = useMemo(() => [...new Set(mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []))], [mapping]);
  const chooseFile = async (picked?: File) => {
    if (!picked) return;
    setBusy(true); setError(null); setPreview(null); setResult(null);
    try {
      const payload = await filePayload(picked); const inspected = await inspectCampaignSpreadsheet(payload);
      setFile(payload); setSheets(inspected.sheets); setSheetName(inspected.sheets[0]?.name ?? '');
      if (!inspected.sheets.length) setError('File không có sheet hợp lệ.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đọc file.'); }
    finally { setBusy(false); }
  };
  const loadPreview = async (nextMapping = mapping, nextRows = selectedRows) => {
    if (!file || !sheetName) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const next = await previewCampaignSpreadsheet({ ...file, sheetName, ...(nextMapping.length ? { mapping: nextMapping } : {}), ...(nextRows.length ? { selectedRows: nextRows } : {}) });
      setPreview(next); setMapping(next.mapping);
      if (!nextRows.length) setSelectedRows(next.rows.filter((row) => ['CREATE', 'UPDATE'].includes(row.status)).map((row) => row.rowNumber));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo preview.'); }
    finally { setBusy(false); }
  };
  const confirmImport = async () => {
    if (!file || !preview || busy) return;
    setBusy(true); setError(null);
    try {
      const decisions = preview.rows.map((row) => ({
        rowNumber: row.rowNumber,
        action: !selectedRows.includes(row.rowNumber) ? 'SKIP' as const : row.status === 'CREATE' ? 'CREATE' as const : row.status === 'UPDATE' ? 'UPDATE' as const : 'SKIP' as const,
        selectedFieldKeys: activeFieldKeys,
        ...(row.expectedVersion ? { expectedVersion: row.expectedVersion } : {}),
      }));
      const imported = await importCampaignSpreadsheet({ ...file, sheetName, mapping, selectedRows, selectedFieldKeys: activeFieldKeys, decisions });
      setResult(imported); await onImported(); notify(`Đã nhập thành công ${imported.succeeded}/${imported.processed} dòng.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể nhập dữ liệu.'); }
    finally { setBusy(false); }
  };
  const changeMapping = (columnIndex: number, fieldKey: string) => setMapping((current) => current.map((item) => item.columnIndex === columnIndex ? { ...item, fieldKey: fieldKey ? fieldKey as CampaignSpreadsheetFieldKey : null, recognized: Boolean(fieldKey) } : item));
  return (
    <div className="space-y-5">
      <ol className="grid gap-2 text-xs font-semibold sm:grid-cols-4">{['1. Chọn file', '2. Chọn sheet & mapping', '3. Preview & xác nhận', '4. Kết quả'].map((label, index) => <li key={label} className={`rounded-xl px-3 py-2 ${result ? 'bg-emerald-50 text-emerald-800' : preview ? (index <= 2 ? 'bg-cyan-50 text-vna-blue' : 'bg-slate-50 text-slate-400') : file ? (index <= 1 ? 'bg-cyan-50 text-vna-blue' : 'bg-slate-50 text-slate-400') : index === 0 ? 'bg-cyan-50 text-vna-blue' : 'bg-slate-50 text-slate-400'}`}>{label}</li>)}</ol>
      <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_260px_auto]">
        <label className="block text-sm font-semibold text-slate-700">File .xlsx hoặc .csv<input className={`${inputClass} mt-2 py-2`} type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
        <label className="block text-sm font-semibold text-slate-700">Sheet<select className={`${inputClass} mt-2`} value={sheetName} disabled={!sheets.length || busy} onChange={(event) => { setSheetName(event.target.value); setPreview(null); setMapping([]); }}><option value="">Chọn sheet</option>{sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rowCount} dòng</option>)}</select></label>
        <div className="flex items-end"><Button className="w-full gap-2" disabled={!file || !sheetName || busy} onClick={() => void loadPreview([], [])}><CpmsIcon name="search" />{busy ? 'Đang đọc…' : 'Tạo preview'}</Button></div>
      </section>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}
      {preview ? <>
        <section className="rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-semibold text-slate-900">Mapping cột</h3><p className="mt-1 text-xs text-slate-500">Chỉ map theo canonical key hoặc nhãn chuẩn; cột lạ mặc định bỏ qua.</p></div><Button size="sm" variant="secondary" disabled={busy || !activeFieldKeys.length} onClick={() => void loadPreview(mapping, selectedRows)}>Cập nhật preview</Button></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{mapping.map((item) => <label key={item.columnIndex} className="text-xs font-semibold text-slate-600"><span className="block truncate">{item.sourceHeader || `Cột ${item.columnIndex + 1}`}</span><select className={`${inputClass} mt-1 min-h-9 text-xs`} value={item.fieldKey ?? ''} onChange={(event) => changeMapping(item.columnIndex, event.target.value)}><option value="">Không nhập cột này</option>{CAMPAIGN_SPREADSHEET_FIELDS.filter((field) => field.importable).map((field) => <option key={field.key} value={field.key}>{field.label} · {field.key}</option>)}</select></label>)}</div></section>
        <section className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex flex-wrap gap-2">{(Object.entries(preview.counts) as Array<[CampaignSpreadsheetRowStatus, number]>).map(([status, count]) => <span key={status} className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusTone[status]}`}>{status}: {count}</span>)}</div><span className="text-xs text-slate-500">Đã chọn {selectedRows.length} dòng</span></div><div className="max-h-[440px] overflow-auto"><table className="w-full min-w-[920px] border-collapse text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="px-3 py-3">Chọn</th><th className="px-3 py-3">Dòng</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3">Mã</th><th className="px-3 py-3">Tên chiến dịch</th><th className="px-3 py-3">Khác biệt / lỗi</th></tr></thead><tbody>{preview.rows.map((row) => { const importable = ['CREATE', 'UPDATE'].includes(row.status); return <tr key={row.rowNumber} className="border-t border-slate-100 align-top hover:bg-cyan-50/50"><td className="px-3 py-3"><input type="checkbox" aria-label={`Chọn dòng ${row.rowNumber}`} disabled={!importable} checked={selectedRows.includes(row.rowNumber)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...current, row.rowNumber] : current.filter((number) => number !== row.rowNumber))} /></td><td className="px-3 py-3 font-semibold">{row.rowNumber}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 font-bold ring-1 ring-inset ${statusTone[row.status]}`}>{row.status}</span></td><td className="px-3 py-3 font-mono">{row.code ?? 'Tự sinh khi lưu'}</td><td className="px-3 py-3 font-medium text-slate-800">{row.name ?? '—'}</td><td className="px-3 py-3"><div className="space-y-1">{row.errors.map((message) => <p key={message} className="text-rose-700">{message}</p>)}{row.diffs.map((diff) => <details key={diff.fieldKey}><summary className="cursor-pointer font-medium text-sky-800">{diff.label}</summary><p className="mt-1 break-all text-slate-500">Hiện tại: {String(diff.currentValue ?? '—')}</p><p className="break-all text-slate-700">Sẽ nhập: {String(diff.incomingValue ?? '—')}</p></details>)}{!row.errors.length && !row.diffs.length ? <span className="text-slate-400">Không có thay đổi</span> : null}</div></td></tr>; })}</tbody></table></div></section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4"><div><p className="text-sm font-semibold text-slate-900">Chỉ các dòng CREATE/UPDATE đang chọn mới được ghi</p><p className="mt-1 text-xs text-slate-500">UPDATE dùng expectedVersion; nếu dữ liệu đổi sau preview, dòng đó bị từ chối.</p></div><Button className="gap-2" disabled={busy || !selectedRows.length} onClick={() => void confirmImport()}><CpmsIcon name="import" />{busy ? 'Đang nhập…' : `Xác nhận nhập ${selectedRows.length} dòng`}</Button></div>
      </> : null}
      {result ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2"><CpmsIcon name="success" className="text-emerald-700" /><h3 className="font-semibold text-emerald-950">Hoàn thành: {result.succeeded}/{result.processed} dòng thành công</h3></div><p className="mt-2 text-sm text-emerald-800">{result.failed ? `${result.failed} dòng cần kiểm tra trong file kết quả.` : 'Không có dòng lỗi.'}</p></div><Button variant="secondary" className="gap-2" onClick={() => saveResultCsv(result)}><CpmsIcon name="download" />Tải kết quả CSV</Button></div></section> : null}
    </div>
  );
}

function GoogleSheetsPanel({ onImported, notify }: CampaignSpreadsheetExchangeProps) {
  const [status, setStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [metadata, setMetadata] = useState<GoogleSpreadsheetMetadata | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [source, setSource] = useState<GoogleSheetPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<CampaignSpreadsheetMapping[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [comparison, setComparison] = useState<CampaignSpreadsheetComparisonResult | null>(null);
  const [timeBasis, setTimeBasis] = useState<CampaignSpreadsheetCompareRequest['timeBasis']>('COMMUNICATION');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeOnlyOneSide, setIncludeOnlyOneSide] = useState(true);
  const [resultLink, setResultLink] = useState<{ label: string; url: string } | null>(null);
  const [diffKey, setDiffKey] = useState(() => crypto.randomUUID());
  const [syncKey, setSyncKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeFieldKeys = useMemo(() => [...new Set(mapping.flatMap((item) => item.fieldKey ? [item.fieldKey] : []))], [mapping]);

  const refreshStatus = async () => {
    try { setStatus(await getGoogleIntegrationStatus()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể kiểm tra kết nối Google.'); }
  };
  useEffect(() => { void refreshStatus(); }, []);

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const result = await connectGoogleIntegration();
      window.location.assign(result.authorizationUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu kết nối Google.'); setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm('Ngắt kết nối tài khoản Google hiện tại? Token đã lưu sẽ bị xóa khỏi CPMS.')) return;
    setBusy(true); setError(null);
    try {
      const result = await disconnectGoogleIntegration();
      notify(result.revoked ? 'Đã ngắt kết nối và thu hồi quyền Google.' : 'Đã xóa kết nối Google khỏi CPMS.');
      setMetadata(null); setSource(null); setComparison(null); await refreshStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể ngắt kết nối Google.'); }
    finally { setBusy(false); }
  };

  const inspect = async () => {
    setBusy(true); setError(null);
    try {
      const next = await inspectGoogleSpreadsheet(spreadsheetUrl);
      setMetadata(next);
      const gid = /(?:[?#&]gid=)(\d+)/.exec(spreadsheetUrl)?.[1];
      setSheetName(next.tabs.find((tab) => String(tab.sheetId) === gid)?.title ?? next.tabs[0]?.title ?? '');
      setSource(null); setMapping([]); setSelectedRows([]); setComparison(null); setResultLink(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể mở Google Spreadsheet.'); }
    finally { setBusy(false); }
  };

  const loadPreview = async (nextMapping = mapping, nextRows = selectedRows) => {
    if (!sheetName) return;
    setBusy(true); setError(null); setResultLink(null);
    try {
      const next = await previewGoogleSpreadsheet({ spreadsheetUrl, sheetName, ...(nextMapping.length ? { mapping: nextMapping } : {}), ...(nextRows.length ? { selectedRows: nextRows } : {}) });
      setMetadata(next.spreadsheet); setSource(next); setMapping(next.preview.mapping);
      if (!nextRows.length) setSelectedRows(next.preview.rows.filter((row) => ['CREATE', 'UPDATE'].includes(row.status)).map((row) => row.rowNumber));
      setComparison(null); setDiffKey(crypto.randomUUID()); setSyncKey(crypto.randomUUID());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo preview Google Sheets.'); }
    finally { setBusy(false); }
  };

  const compare = async () => {
    if (!source) return;
    setBusy(true); setError(null); setResultLink(null);
    try {
      const next = await compareGoogleSpreadsheet({ spreadsheetUrl, sheetName, mapping, selectedRows, selectedFieldKeys: activeFieldKeys, timeBasis, ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), includeOnlyOneSide });
      setComparison(next); setMetadata(next.spreadsheet); setDiffKey(crypto.randomUUID()); setSyncKey(crypto.randomUUID());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đối chiếu dữ liệu.'); }
    finally { setBusy(false); }
  };

  const confirmImport = async () => {
    if (!source || busy) return;
    setBusy(true); setError(null);
    try {
      const decisions = source.preview.rows.map((row) => ({
        rowNumber: row.rowNumber,
        action: !selectedRows.includes(row.rowNumber) ? 'SKIP' as const : row.status === 'CREATE' ? 'CREATE' as const : row.status === 'UPDATE' ? 'UPDATE' as const : 'SKIP' as const,
        selectedFieldKeys: activeFieldKeys,
        ...(row.expectedVersion ? { expectedVersion: row.expectedVersion } : {}),
      }));
      const result = await importGoogleSpreadsheet({ spreadsheetUrl, sheetName, mapping, selectedRows, selectedFieldKeys: activeFieldKeys, decisions });
      await onImported(); notify(`Đã nhập từ Google Sheets ${result.succeeded}/${result.processed} dòng.`);
      await loadPreview(mapping, selectedRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể nhập dữ liệu từ Google Sheets.'); setBusy(false); }
  };

  const resultTab = async (kind: 'DIFF' | 'SYNC') => {
    if (!comparison || busy) return;
    if (kind === 'SYNC' && !window.confirm('Tạo một tab mới lấy dữ liệu từ CPMS? Tab nguồn sẽ không bị sửa hoặc xóa.')) return;
    setBusy(true); setError(null);
    try {
      const command = { spreadsheetUrl, sheetName, mapping, selectedRows, selectedFieldKeys: activeFieldKeys, timeBasis, ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), includeOnlyOneSide, idempotencyKey: kind === 'DIFF' ? diffKey : syncKey };
      const result = kind === 'DIFF' ? await createGoogleDiffTab(command) : await createGoogleSyncTab(command);
      setResultLink({ label: result.sheetName, url: result.url });
      notify(`${result.reused ? 'Đã dùng lại' : 'Đã tạo'} tab ${result.sheetName}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể tạo tab kết quả.';
      setError(message);
      if (/quyền (chỉnh sửa|Editor)|chỉ có quyền xem/i.test(message)) setMetadata((current) => current ? { ...current, canEdit: false } : current);
    }
    finally { setBusy(false); }
  };

  const changeMapping = (columnIndex: number, fieldKey: string) => {
    setMapping((current) => current.map((item) => item.columnIndex === columnIndex ? { ...item, fieldKey: fieldKey ? fieldKey as CampaignSpreadsheetFieldKey : null, recognized: Boolean(fieldKey) } : item));
    setComparison(null);
  };

  if (!status) return <div className="grid min-h-56 place-items-center text-sm text-slate-500">{error ? <div role="alert">{error}<Button variant="secondary" onClick={() => void refreshStatus()}>Thử lại</Button></div> : 'Đang kiểm tra cấu hình Google…'}</div>;
  if (!status.configured) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><div className="flex items-center gap-3"><CpmsIcon name="warning" className="text-amber-700" /><div><h3 className="font-semibold text-amber-950">Google chưa được cấu hình</h3><p className="mt-1 text-sm text-amber-800">Quản trị viên cần cấu hình OAuth phía server. CPMS không lưu credential trong trình duyệt.</p></div></div>{status.callbackUrl ? <p className="mt-4 break-all rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-600">Redirect URI: {status.callbackUrl}</p> : null}</div>;

  return <div className="space-y-5">
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-3"><CpmsIcon name={status.connected ? 'success' : 'link'} className={status.connected ? 'text-emerald-600' : 'text-vna-blue'} /><div><h3 className="text-sm font-semibold text-slate-900">{status.connected ? status.account?.email : 'Chưa kết nối Google'}</h3><p className="mt-1 text-xs text-slate-500">{status.connected ? status.account?.name || 'Tài khoản Google đang kết nối' : 'Nhấn kết nối để tự chọn tài khoản và cấp quyền.'}</p></div></div>
      {status.connected ? <Button variant="secondary" disabled={busy || !status.canDisconnectGoogle} onClick={() => void disconnect()}>Ngắt kết nối</Button> : <Button className="gap-2" disabled={busy || !status.canConnectGoogle} onClick={() => void connect()}><CpmsIcon name="link" />Kết nối Google</Button>}
    </section>
    {!status.canConnectGoogle && <p className="text-sm text-amber-800">Kết nối và ghi Google chưa được phép trong phiên hiện tại. Tài khoản cần được kết nối riêng khi có quyền; CPMS không dùng kết nối của người khác.</p>}
    <p className="text-xs text-slate-500">Quyền CPMS chỉ giới hạn truy cập qua CPMS (CPMS_VISIBILITY_ONLY). Liên kết đã chia sẻ trực tiếp vẫn tuân theo quyền Google.</p>
    {error ? <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert"><span>{error}</span><button className="font-semibold underline" onClick={() => setError(null)}>Đóng</button></div> : null}
    {status.connected && status.canReadSheets ? <>
      <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm font-semibold text-slate-700">URL Google Spreadsheet<input className={`${inputClass} mt-2`} value={spreadsheetUrl} placeholder="https://docs.google.com/spreadsheets/d/.../edit" onChange={(event) => setSpreadsheetUrl(event.target.value)} /></label>
        <div className="flex items-end"><Button className="w-full gap-2" disabled={busy || !spreadsheetUrl.trim()} onClick={() => void inspect()}><CpmsIcon name="search" />Kiểm tra quyền truy cập</Button></div>
      </section>
      {metadata ? <section className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{metadata.title}</h3><p className="mt-1 text-xs text-slate-500">{metadata.tabs.length} tab · {metadata.canEdit === false ? 'Chỉ có quyền xem' : metadata.canEdit === true ? 'Có quyền chỉnh sửa' : 'Quyền ghi sẽ được xác minh khi tạo tab'}</p></div><label className="text-xs font-semibold text-slate-600">Tab nguồn<select className={`${inputClass} mt-1 min-w-64`} value={sheetName} onChange={(event) => { setSheetName(event.target.value); setSource(null); setComparison(null); }}><option value="">Chọn tab</option>{metadata.tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label><Button disabled={busy || !sheetName} onClick={() => void loadPreview([], [])}>Tải header & preview</Button></div></section> : null}
      {source ? <>
        <section className="rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-semibold text-slate-900">Mapping và chọn cột</h3><p className="mt-1 text-xs text-slate-500">Chỉ canonical key hoặc nhãn chuẩn được tự nhận diện; không fuzzy-match.</p></div><Button size="sm" variant="secondary" disabled={busy || !activeFieldKeys.length} onClick={() => void loadPreview(mapping, selectedRows)}>Cập nhật preview</Button></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{mapping.map((item) => <label key={item.columnIndex} className="text-xs font-semibold text-slate-600"><span className="block truncate">{item.sourceHeader || `Cột ${item.columnIndex + 1}`}</span><select className={`${inputClass} mt-1 min-h-9 text-xs`} value={item.fieldKey ?? ''} onChange={(event) => changeMapping(item.columnIndex, event.target.value)}><option value="">Bỏ qua cột này</option>{CAMPAIGN_SPREADSHEET_FIELDS.filter((field) => field.importable).map((field) => <option key={field.key} value={field.key}>{field.label} · {field.key}</option>)}</select></label>)}</div></section>
        <section className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">{(Object.entries(source.preview.counts) as Array<[CampaignSpreadsheetRowStatus, number]>).map(([key, count]) => <span key={key} className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusTone[key]}`}>{key}: {count}</span>)}</div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[880px] text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-3">Chọn</th><th>Dòng</th><th>Trạng thái</th><th>Mã</th><th>Tên chiến dịch</th><th>Lỗi / khác biệt</th></tr></thead><tbody>{source.preview.rows.map((row) => <tr key={row.rowNumber} className="border-t border-slate-100 align-top hover:bg-cyan-50/50"><td className="px-3 py-3"><input type="checkbox" checked={selectedRows.includes(row.rowNumber)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...current, row.rowNumber] : current.filter((item) => item !== row.rowNumber))} /></td><td className="py-3">{row.rowNumber}</td><td className="py-3"><span className={`rounded-full px-2 py-1 font-bold ring-1 ring-inset ${statusTone[row.status]}`}>{row.status}</span></td><td className="py-3 font-mono">{row.code ?? '—'}</td><td className="py-3 font-medium">{row.name ?? '—'}</td><td className="max-w-md py-3 pr-3 text-slate-600">{row.errors.join(' ') || row.diffs.map((item) => item.label).join(', ') || 'Không có thay đổi'}</td></tr>)}</tbody></table></div></section>
        <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 lg:grid-cols-5"><label className="text-xs font-semibold text-slate-600">Cơ sở thời gian<select className={`${inputClass} mt-1`} value={timeBasis} onChange={(event) => setTimeBasis(event.target.value as CampaignSpreadsheetCompareRequest['timeBasis'])}><option value="COMMUNICATION">Thời gian QCTT</option><option value="UPDATED_AT">Thời gian cập nhật</option></select></label><label className="text-xs font-semibold text-slate-600">Từ ngày<input type="date" className={`${inputClass} mt-1`} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" className={`${inputClass} mt-1`} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700"><input type="checkbox" checked={includeOnlyOneSide} onChange={(event) => setIncludeOnlyOneSide(event.target.checked)} />Kèm dữ liệu chỉ có ở một phía</label><div className="flex items-end"><Button className="w-full" disabled={busy || !selectedRows.length || !activeFieldKeys.length} onClick={() => void compare()}>Đối chiếu với CPMS</Button></div></section>
        <div className="flex flex-wrap justify-end gap-3"><Button variant="secondary" className="gap-2" disabled={busy || !selectedRows.some((rowNumber) => source.preview.rows.some((row) => row.rowNumber === rowNumber && ['CREATE', 'UPDATE'].includes(row.status)))} onClick={() => void confirmImport()}><CpmsIcon name="import" />Nhập dòng đã chọn vào CPMS</Button></div>
      </> : null}
      {comparison ? <section className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex flex-wrap gap-2">{Object.entries(comparison.counts).map(([key, count]) => <span key={key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{key}: {count}</span>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy || !status.canWriteSheets || metadata?.canEdit === false} onClick={() => void resultTab('DIFF')}>Tạo tab ghi nhận sai khác</Button><Button size="sm" disabled={busy || !status.canWriteSheets || metadata?.canEdit === false} onClick={() => void resultTab('SYNC')}>Tạo tab đồng bộ theo CPMS</Button></div></div><div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-3">Trạng thái</th><th>Mã</th><th>Tên chiến dịch</th><th>Chi tiết trường</th></tr></thead><tbody>{comparison.rows.map((row, index) => <tr key={`${row.code ?? 'invalid'}-${row.sourceRowNumber ?? index}`} className="border-t border-slate-100 align-top"><td className="px-3 py-3 font-bold">{row.status}</td><td className="py-3 font-mono">{row.code ?? '—'}</td><td className="py-3 font-medium">{row.name ?? '—'}</td><td className="py-3 pr-3"><details><summary className="cursor-pointer text-vna-blue">{row.fields.filter((field) => field.status !== 'SAME').length || row.fields.length} trường</summary><div className="mt-2 space-y-2">{row.fields.map((field) => <div key={field.fieldKey} className="grid gap-1 rounded-lg bg-slate-50 p-2 md:grid-cols-3"><b>{field.label}</b><span>Sheet: {String(field.sheetValue ?? '—')}</span><span>CPMS: {String(field.cpmsValue ?? '—')}</span></div>)}</div></details></td></tr>)}</tbody></table></div></section> : null}
      {resultLink ? <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>Đã tạo tab {resultLink.label}; tab nguồn không bị thay đổi.</span><a className="inline-flex items-center gap-2 font-semibold text-vna-blue underline" href={resultLink.url} target="_blank" rel="noreferrer"><CpmsIcon name="externalLink" />Mở tab mới</a></div> : null}
    </> : null}
  </div>;
}
