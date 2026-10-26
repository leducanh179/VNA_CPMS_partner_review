import { normalizeDirectorySearch, type CampaignFieldDefinition, type CampaignSummary } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allFilterOptionsSelected, toggleAllSetFilterOptions } from '../lib/column-filter-selection';
import {
  campaignColumnFilterOptions,
  campaignDateMonthOptions,
  defaultColumnFilter,
  type CampaignColumnFilter,
  type CampaignColumnFilterModel,
  type CampaignDateColumnFilter,
  type CampaignSetColumnFilter,
  type CampaignTextColumnFilter,
  type CampaignTextFilterOperator,
  type CampaignColumnFilterOption,
  type CampaignDateMonthOption,
} from '../lib/campaign-filters';

export interface CampaignColumnFilterAnchor {
  left: number;
  top: number;
  element?: HTMLElement;
}

interface CampaignColumnFilterMenuProps {
  definition: CampaignFieldDefinition;
  campaigns: readonly CampaignSummary[];
  filters: CampaignColumnFilterModel;
  anchor: CampaignColumnFilterAnchor;
  onApply(filter: CampaignColumnFilter): void;
  onClear(): void;
  onClose(): void;
}

const textOperators: Array<{ value: CampaignTextFilterOperator; label: string }> = [
  { value: 'contains', label: 'Chứa' },
  { value: 'startsWith', label: 'Bắt đầu bằng' },
  { value: 'equals', label: 'Bằng chính xác' },
  { value: 'notContains', label: 'Không chứa' },
];

export type ColumnFilterDefinition = Pick<CampaignFieldDefinition, 'key' | 'label' | 'kind'> & { supportsCondition?: boolean };
interface ValueOptions { options: CampaignColumnFilterOption[]; blankCount: number }
interface MonthOptions { options: CampaignDateMonthOption[]; blankCount: number }
interface ColumnFilterMenuProps extends Omit<CampaignColumnFilterMenuProps, 'definition' | 'campaigns'> {
  definition: ColumnFilterDefinition;
  valueOptions: ValueOptions;
  monthOptions: MonthOptions;
  materialSelectionMode?: boolean;
}

function SetChecklist({ draft, setDraft, options, blankCount, materialSelectionMode = false }: ValueOptions & {
  draft: CampaignSetColumnFilter; setDraft(filter: CampaignSetColumnFilter): void;
  materialSelectionMode?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [keepSelection, setKeepSelection] = useState(true);
  const normalized = normalizeDirectorySearch(query);
  const visible = options.filter((option) => !normalized || normalizeDirectorySearch(option.label).includes(normalized));
  const selected = new Set(draft.values);
  const visibleValues = visible.map(option => option.value);
  const blankInScope = !normalized && blankCount > 0;
  const allSelected = allFilterOptionsSelected(visibleValues, draft.values, blankInScope, draft.includeBlank);
  const selectVisible = () => setDraft({
    ...draft,
    values: keepSelection ? [...new Set([...draft.values, ...visibleValues])] : visibleValues,
  });

  return <>
    <input autoFocus type="search" className="min-h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-vna-blue" placeholder="Tìm trong danh sách…" value={query} onChange={(event) => setQuery(event.target.value)} />
    {materialSelectionMode ? <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-vna-blue hover:bg-slate-50">
      <input type="checkbox" checked={allSelected} disabled={!visibleValues.length && !blankInScope} onChange={() => setDraft(toggleAllSetFilterOptions(draft, visibleValues, blankInScope, normalized ? keepSelection : false))} />
      Chọn tất cả{normalized ? ' kết quả tìm' : ''}
    </label> : <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
      <button type="button" className="font-semibold text-vna-blue" onClick={selectVisible}>Chọn tất cả{normalized ? ' kết quả tìm' : ''}</button>
      <button type="button" className="font-semibold text-slate-500" onClick={() => setDraft({ ...draft, values: [], includeBlank: false })}>Bỏ chọn tất cả</button>
    </div>}
    <label className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
      <input type="checkbox" checked={keepSelection} onChange={(event) => setKeepSelection(event.target.checked)} />
      Thêm lựa chọn hiện tại vào bộ lọc
    </label>
    <div className="mt-2 max-h-64 space-y-0.5 overflow-auto overscroll-contain pr-1">
      {visible.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selected.has(option.value)} onChange={(event) => setDraft({ ...draft, values: event.target.checked ? [...draft.values, option.value] : draft.values.filter((value) => value !== option.value) })} /><span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span><span className="text-[10px] text-slate-400">{option.count}</span></label>)}
      {blankCount && (!materialSelectionMode || !normalized) ? <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs italic text-slate-600 hover:bg-slate-50"><input type="checkbox" checked={draft.includeBlank} onChange={(event) => setDraft({ ...draft, includeBlank: event.target.checked })} /><span className="flex-1">(Trống)</span><span className="text-[10px] text-slate-400">{blankCount}</span></label> : null}
      {!visible.length && (!blankCount || (materialSelectionMode && normalized)) ? <p className="px-2 py-4 text-center text-xs text-slate-500">Không có giá trị phù hợp.</p> : null}
    </div>
  </>;
}

function DateYearCheckbox({ checked, mixed, onChange, label }: { checked: boolean; mixed: boolean; onChange(): void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"><input ref={input} type="checkbox" checked={checked} onChange={onChange} />{label}</label>;
}

function DateFilterEditor({ draft, setDraft, options, blankCount, materialSelectionMode = false }: MonthOptions & {
  draft: CampaignDateColumnFilter; setDraft(filter: CampaignDateColumnFilter): void;
  materialSelectionMode?: boolean;
}) {
  const years = [...new Set(options.map((option) => option.year))];
  const selected = new Set(draft.months);
  const allSelected = allFilterOptionsSelected(options.map(option => option.key), draft.months, blankCount > 0, draft.includeBlank);
  const toggleMonths = (months: string[], nextChecked: boolean) => setDraft({
    ...draft,
    months: nextChecked ? [...new Set([...draft.months, ...months])] : draft.months.filter((month) => !months.includes(month)),
  });

  return <>
    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      <button type="button" aria-pressed={draft.mode === 'months'} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${draft.mode === 'months' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => setDraft({ ...draft, mode: 'months' })}>Theo tháng/năm</button>
      <button type="button" aria-pressed={draft.mode === 'range'} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${draft.mode === 'range' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => setDraft({ ...draft, mode: 'range' })}>Khoảng ngày</button>
    </div>
    {draft.mode === 'months' ? <>
      {materialSelectionMode ? <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-vna-blue hover:bg-slate-50">
        <input type="checkbox" checked={allSelected} disabled={!options.length && !blankCount} onChange={event => setDraft({ ...draft, months: event.target.checked ? options.map(option => option.key) : [], includeBlank: event.target.checked && Boolean(blankCount) })} />
        Chọn tất cả
      </label> : <div className="mt-2 flex justify-between text-[11px]"><button type="button" className="font-semibold text-vna-blue" onClick={() => setDraft({ ...draft, months: options.map(option => option.key), includeBlank: Boolean(blankCount) })}>Chọn tất cả</button><button type="button" className="font-semibold text-slate-500" onClick={() => setDraft({ ...draft, months: [], includeBlank: false })}>Bỏ chọn tất cả</button></div>}
      <div className="mt-2 max-h-64 space-y-2 overflow-auto overscroll-contain pr-1">
        {years.map((year) => {
          const yearOptions = options.filter((option) => option.year === year);
          const yearMonths = yearOptions.map((option) => option.key);
          const selectedCount = yearMonths.filter((month) => selected.has(month)).length;
          return <details open key={year} className="rounded-lg border border-slate-100 bg-slate-50/70 p-2"><summary className="list-none"><DateYearCheckbox label={`Năm ${year}`} checked={selectedCount === yearMonths.length && yearMonths.length > 0} mixed={selectedCount > 0 && selectedCount < yearMonths.length} onChange={() => toggleMonths(yearMonths, selectedCount !== yearMonths.length)} /></summary><div className="mt-2 grid grid-cols-2 gap-1 pl-5">{yearOptions.map((option) => <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white"><input type="checkbox" checked={selected.has(option.key)} onChange={(event) => toggleMonths([option.key], event.target.checked)} /><span className="flex-1">Tháng {option.month}</span><span className="text-[10px] text-slate-400">{option.count}</span></label>)}</div></details>;
        })}
        {blankCount ? <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs italic text-slate-600 hover:bg-slate-50"><input type="checkbox" checked={draft.includeBlank} onChange={(event) => setDraft({ ...draft, includeBlank: event.target.checked })} /><span className="flex-1">(Chưa xác định)</span><span className="text-[10px] text-slate-400">{blankCount}</span></label> : null}
      </div>
    </> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-600">Từ ngày<input autoFocus type="date" className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-normal outline-none focus:border-vna-blue" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-normal outline-none focus:border-vna-blue" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
    </div>}
  </>;
}

export function CampaignColumnFilterMenu(props: CampaignColumnFilterMenuProps) {
  return <ColumnFilterMenu {...props}
    valueOptions={campaignColumnFilterOptions(props.campaigns, props.filters, props.definition.key)}
    monthOptions={campaignDateMonthOptions(props.campaigns, props.filters, props.definition.key)} />;
}

export function ColumnFilterMenu({ definition, valueOptions, monthOptions, filters, anchor, onApply, onClear, onClose, materialSelectionMode = false }: ColumnFilterMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const applied = filters[definition.key];
  const isDate = definition.kind === 'date' || definition.kind === 'dateTime';
  // Keep independent drafts so switching modes never erases an applied criterion.
  const [valueDraft, setValueDraft] = useState<CampaignSetColumnFilter>(() => applied?.type === 'set' ? applied : { type: 'set', values: [], includeBlank: false });
  const [conditionDraft, setConditionDraft] = useState<CampaignTextColumnFilter>(() => applied?.type === 'text' ? applied : { type: 'text', operator: 'contains', query: '' });
  const [dateDraft, setDateDraft] = useState<CampaignDateColumnFilter>(() => ({
    ...(applied?.type === 'date' ? applied : defaultColumnFilter({ ...definition, kind: 'date' }) as CampaignDateColumnFilter),
    mode: materialSelectionMode ? 'months' : applied?.type === 'date' ? applied.mode : 'months',
  }));
  const [valuesEdited, setValuesEdited] = useState(false);
  const [monthsEdited, setMonthsEdited] = useState(false);
  const supportsCondition = definition.supportsCondition ?? (definition.key === 'campaign_code' || definition.key === 'campaign_name');
  const [editor, setEditor] = useState<'values' | 'condition'>(() => materialSelectionMode ? 'values' : applied?.type === 'text' ? 'condition' : 'values');
  const draft = isDate ? dateDraft : editor === 'condition' ? conditionDraft : valueDraft;
  const awaitingSelection = materialSelectionMode && (isDate
    ? applied?.type === 'date' && applied.mode === 'range' && dateDraft.mode === 'months' && !monthsEdited
    : applied?.type === 'text' && editor === 'values' && !valuesEdited);
  const invalidRange = isDate && dateDraft.mode === 'range' && Boolean(dateDraft.from && dateDraft.to && dateDraft.from > dateDraft.to);
  const appliedSummary = applied?.type === 'text'
    ? `${textOperators.find(item => item.value === applied.operator)?.label}: ${applied.query}`
    : applied?.type === 'date' && applied.mode === 'range'
      ? `Khoảng ngày: ${applied.from || 'Không giới hạn'} → ${applied.to || 'Không giới hạn'}` : '';
  const updateDateDraft = (next: CampaignDateColumnFilter) => {
    if (next.months !== dateDraft.months || next.includeBlank !== dateDraft.includeBlank) setMonthsEdited(true);
    setDateDraft(next);
  };
  const width = Math.min(380, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 520));

  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose(); };
    const close = () => onClose();
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      // Opening an off-screen header can queue a scroll event before the menu mounts.
      // Only dismiss when its anchor actually moved; internal checklist scrolling is ignored above.
      if (anchor.element?.isConnected) {
        const rect = anchor.element.getBoundingClientRect();
        if (Math.abs(rect.left - anchor.left) < 1 && Math.abs(rect.bottom + 6 - anchor.top) < 1) return;
      }
      onClose();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  const switchEditor = (next: 'values' | 'condition') => {
    if (next === editor) return;
    setEditor(next);
    if (!materialSelectionMode) {
      if (next === 'condition') setConditionDraft({ type: 'text', operator: 'contains', query: '' });
      else setValueDraft({ type: 'set', values: [], includeBlank: false });
    }
  };

  const apply = () => {
    if (awaitingSelection || invalidRange) return;
    if (draft.type === 'text' && !draft.query.trim()) return onClear();
    if (draft.type === 'date') {
      if (draft.mode === 'months' && !draft.months.length && !draft.includeBlank) return onClear();
      if (draft.mode === 'range' && !draft.from && !draft.to) return onClear();
      if (draft.mode === 'range' && draft.from && draft.to && draft.from > draft.to) return;
    }
    onApply(draft);
  };

  return createPortal(<div ref={menu} role="dialog" aria-label={`Bộ lọc cột ${definition.label}`} data-inline-save-surface className="fixed z-[110] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel" style={{ left, top, width, maxHeight: window.innerHeight - top - 8 }} onPointerDown={(event) => event.stopPropagation()}>
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><p className="text-sm font-semibold text-slate-900">{definition.label}</p><p className="mt-0.5 text-[10px] text-slate-500">Bộ lọc chỉ áp dụng cho cột này</p></div><button type="button" aria-label="Đóng bộ lọc cột" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}><CpmsIcon name="reject" /></button></div>
    <div className="p-4">
      {materialSelectionMode && appliedSummary ? <p className="mb-3 break-words rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Đang áp dụng: {appliedSummary}</p> : null}
      {supportsCondition ? <div className="mb-3 flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"><button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${editor === 'values' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} aria-pressed={editor === 'values'} onClick={() => switchEditor('values')}>Chọn giá trị</button><button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${editor === 'condition' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} aria-pressed={editor === 'condition'} onClick={() => switchEditor('condition')}>Điều kiện</button></div> : null}
      {isDate ? <DateFilterEditor {...monthOptions} materialSelectionMode={materialSelectionMode} draft={dateDraft} setDraft={updateDateDraft} />
        : editor === 'condition' ? <div className="grid gap-2"><select autoFocus className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-vna-blue" value={(draft.type === 'text' ? draft.operator : 'contains')} onChange={(event) => setConditionDraft({ type: 'text', operator: event.target.value as CampaignTextFilterOperator, query: draft.type === 'text' ? draft.query : '' })}>{textOperators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select><input type="search" className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-vna-blue" placeholder="Nhập nội dung cần lọc…" value={draft.type === 'text' ? draft.query : ''} onChange={(event) => setConditionDraft({ type: 'text', operator: draft.type === 'text' ? draft.operator : 'contains', query: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} /></div>
          : <SetChecklist {...valueOptions} materialSelectionMode={materialSelectionMode} draft={valueDraft} setDraft={next => { setValuesEdited(true); setValueDraft(next); }} />}
      {awaitingSelection ? <p className="mt-3 text-xs text-slate-500">Chọn giá trị để thay bộ lọc, hoặc mở {isDate ? 'Khoảng ngày' : 'Điều kiện'} để sửa tiêu chí đang áp dụng.</p> : null}
      {invalidRange ? <p role="alert" className="mt-3 text-xs text-rose-600">Từ ngày không được sau Đến ngày.</p> : null}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3"><Button size="sm" variant="ghost" onClick={onClear}>Xóa lọc cột</Button><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onClose}>Hủy</Button><Button size="sm" disabled={awaitingSelection || invalidRange} onClick={apply}>Áp dụng</Button></div></div>
  </div>, document.body);
}
