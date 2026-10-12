import { normalizeDirectorySearch, type CampaignFieldDefinition, type CampaignSummary } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  campaignColumnFilterOptions,
  campaignDateMonthOptions,
  defaultColumnFilter,
  type CampaignColumnFilter,
  type CampaignColumnFilterModel,
  type CampaignDateColumnFilter,
  type CampaignSetColumnFilter,
  type CampaignTextFilterOperator,
} from '../lib/campaign-filters';

export interface CampaignColumnFilterAnchor {
  left: number;
  top: number;
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

function SetChecklist({
  draft,
  setDraft,
  campaigns,
  filters,
  definition,
}: {
  draft: CampaignSetColumnFilter;
  setDraft(filter: CampaignSetColumnFilter): void;
  campaigns: readonly CampaignSummary[];
  filters: CampaignColumnFilterModel;
  definition: CampaignFieldDefinition;
}) {
  const [query, setQuery] = useState('');
  const [keepSelection, setKeepSelection] = useState(true);
  const { options, blankCount } = useMemo(
    () => campaignColumnFilterOptions(campaigns, filters, definition.key),
    [campaigns, definition.key, filters],
  );
  const normalized = normalizeDirectorySearch(query);
  const visible = options.filter((option) => !normalized || normalizeDirectorySearch(option.label).includes(normalized));
  const selected = new Set(draft.values);
  const selectVisible = () => setDraft({
    ...draft,
    values: keepSelection ? [...new Set([...draft.values, ...visible.map((option) => option.value)])] : visible.map((option) => option.value),
  });

  return <>
    <input autoFocus type="search" className="min-h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-vna-blue" placeholder="Tìm trong danh sách…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
      <button type="button" className="font-semibold text-vna-blue" onClick={selectVisible}>Chọn tất cả{normalized ? ' kết quả tìm' : ''}</button>
      <button type="button" className="font-semibold text-slate-500" onClick={() => setDraft({ ...draft, values: [], includeBlank: false })}>Bỏ chọn tất cả</button>
    </div>
    <label className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
      <input type="checkbox" checked={keepSelection} onChange={(event) => setKeepSelection(event.target.checked)} />
      Thêm lựa chọn hiện tại vào bộ lọc
    </label>
    <div className="mt-2 max-h-64 space-y-0.5 overflow-auto overscroll-contain pr-1">
      {visible.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selected.has(option.value)} onChange={(event) => setDraft({ ...draft, values: event.target.checked ? [...draft.values, option.value] : draft.values.filter((value) => value !== option.value) })} /><span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span><span className="text-[10px] text-slate-400">{option.count}</span></label>)}
      {blankCount ? <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs italic text-slate-600 hover:bg-slate-50"><input type="checkbox" checked={draft.includeBlank} onChange={(event) => setDraft({ ...draft, includeBlank: event.target.checked })} /><span className="flex-1">(Trống)</span><span className="text-[10px] text-slate-400">{blankCount}</span></label> : null}
      {!visible.length && !blankCount ? <p className="px-2 py-4 text-center text-xs text-slate-500">Không có giá trị phù hợp.</p> : null}
    </div>
  </>;
}

function DateYearCheckbox({ checked, mixed, onChange, label }: { checked: boolean; mixed: boolean; onChange(): void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"><input ref={input} type="checkbox" checked={checked} onChange={onChange} />{label}</label>;
}

function DateFilterEditor({
  draft,
  setDraft,
  campaigns,
  filters,
  definition,
}: {
  draft: CampaignDateColumnFilter;
  setDraft(filter: CampaignDateColumnFilter): void;
  campaigns: readonly CampaignSummary[];
  filters: CampaignColumnFilterModel;
  definition: CampaignFieldDefinition;
}) {
  const { options, blankCount } = useMemo(
    () => campaignDateMonthOptions(campaigns, filters, definition.key),
    [campaigns, definition.key, filters],
  );
  const years = [...new Set(options.map((option) => option.year))];
  const selected = new Set(draft.months);
  const toggleMonths = (months: string[], nextChecked: boolean) => setDraft({
    ...draft,
    months: nextChecked ? [...new Set([...draft.months, ...months])] : draft.months.filter((month) => !months.includes(month)),
  });

  return <>
    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      <button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${draft.mode === 'months' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => setDraft({ ...draft, mode: 'months' })}>Theo tháng/năm</button>
      <button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${draft.mode === 'range' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => setDraft({ ...draft, mode: 'range' })}>Khoảng ngày</button>
    </div>
    {draft.mode === 'months' ? <>
      <div className="mt-2 flex justify-between text-[11px]"><button type="button" className="font-semibold text-vna-blue" onClick={() => setDraft({ ...draft, months: options.map((option) => option.key), includeBlank: Boolean(blankCount) })}>Chọn tất cả</button><button type="button" className="font-semibold text-slate-500" onClick={() => setDraft({ ...draft, months: [], includeBlank: false })}>Bỏ chọn tất cả</button></div>
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

export function CampaignColumnFilterMenu({ definition, campaigns, filters, anchor, onApply, onClear, onClose }: CampaignColumnFilterMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<CampaignColumnFilter>(() => filters[definition.key] ?? defaultColumnFilter(definition));
  const supportsCondition = definition.key === 'campaign_code' || definition.key === 'campaign_name';
  const [editor, setEditor] = useState<'values' | 'condition'>(() => draft.type === 'text' ? 'condition' : 'values');
  const width = Math.min(380, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 520));

  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose(); };
    const close = () => onClose();
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const switchEditor = (next: 'values' | 'condition') => {
    setEditor(next);
    if (next === 'condition') setDraft({ type: 'text', operator: 'contains', query: '' });
    else setDraft({ type: 'set', values: [], includeBlank: false });
  };

  const apply = () => {
    if (draft.type === 'text' && !draft.query.trim()) return onClear();
    if (draft.type === 'date') {
      if (draft.mode === 'months' && !draft.months.length && !draft.includeBlank) return onClear();
      if (draft.mode === 'range' && !draft.from && !draft.to) return onClear();
      if (draft.mode === 'range' && draft.from && draft.to && draft.from > draft.to) return;
    }
    onApply(draft);
  };

  return createPortal(<div ref={menu} role="dialog" aria-label={`Bộ lọc cột ${definition.label}`} className="fixed z-[110] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel" style={{ left, top, width }} onPointerDown={(event) => event.stopPropagation()}>
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><p className="text-sm font-semibold text-slate-900">{definition.label}</p><p className="mt-0.5 text-[10px] text-slate-500">Bộ lọc chỉ áp dụng cho cột này</p></div><button type="button" aria-label="Đóng bộ lọc cột" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}><CpmsIcon name="reject" /></button></div>
    <div className="p-4">
      {supportsCondition ? <div className="mb-3 flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"><button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${editor === 'values' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => switchEditor('values')}>Chọn giá trị</button><button type="button" className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${editor === 'condition' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => switchEditor('condition')}>Điều kiện</button></div> : null}
      {definition.kind === 'date' || definition.kind === 'dateTime' ? <DateFilterEditor definition={definition} campaigns={campaigns} filters={filters} draft={draft.type === 'date' ? draft : defaultColumnFilter(definition) as CampaignDateColumnFilter} setDraft={setDraft} />
        : editor === 'condition' ? <div className="grid gap-2"><select autoFocus className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-vna-blue" value={(draft.type === 'text' ? draft.operator : 'contains')} onChange={(event) => setDraft({ type: 'text', operator: event.target.value as CampaignTextFilterOperator, query: draft.type === 'text' ? draft.query : '' })}>{textOperators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select><input type="search" className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-vna-blue" placeholder="Nhập nội dung cần lọc…" value={draft.type === 'text' ? draft.query : ''} onChange={(event) => setDraft({ type: 'text', operator: draft.type === 'text' ? draft.operator : 'contains', query: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} /></div>
          : <SetChecklist definition={definition} campaigns={campaigns} filters={filters} draft={draft.type === 'set' ? draft : { type: 'set', values: [], includeBlank: false }} setDraft={setDraft} />}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3"><Button size="sm" variant="ghost" onClick={onClear}>Xóa lọc cột</Button><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onClose}>Hủy</Button><Button size="sm" onClick={apply}>Áp dụng</Button></div></div>
  </div>, document.body);
}
