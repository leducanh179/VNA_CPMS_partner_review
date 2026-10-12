import { normalizeDirectorySearch, type CampaignSummary } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CampaignCommunicationRange } from '../lib/campaign-filters';

const RECENT_SEARCH_STORAGE_KEY = 'cpms.campaign.recent-searches.v1';
const MAX_RECENT_SEARCHES = 8;

interface SearchSuggestion {
  value: string;
  type: string;
  detail: string;
}

interface CampaignQuickFiltersProps {
  campaigns: readonly CampaignSummary[];
  query: string;
  range: CampaignCommunicationRange;
  onApply(query: string, range: CampaignCommunicationRange): void;
}

function storedRecentSearches() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
}

function campaignSuggestions(campaigns: readonly CampaignSummary[]) {
  const suggestions = campaigns.flatMap<SearchSuggestion>((campaign) => [
    { value: campaign.code, type: 'Mã chiến dịch', detail: campaign.name },
    { value: campaign.name, type: 'Tên chiến dịch', detail: campaign.code },
    ...campaign.requestingUnits.map((unit) => ({ value: unit.displayName, type: 'Đơn vị yêu cầu', detail: campaign.code })),
    ...(campaign.requestingUnits.length || !campaign.requestingUnit ? [] : [{ value: campaign.requestingUnit, type: 'Đơn vị yêu cầu', detail: campaign.code }]),
    ...(campaign.requestingEmployeeName ? [{ value: campaign.requestingEmployeeName, type: 'Người yêu cầu', detail: campaign.code }] : []),
    ...(campaign.manualRequesterEmail ? [{ value: campaign.manualRequesterEmail, type: 'Email người yêu cầu', detail: campaign.code }] : []),
  ]);
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.type}:${normalizeDirectorySearch(suggestion.value)}`;
    if (!normalizeDirectorySearch(suggestion.value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDate(value: string) {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('vi-VN').format(parsed);
}

function rangeSummary(range: CampaignCommunicationRange) {
  if (range.from && range.to) return `${formatDate(range.from)} – ${formatDate(range.to)}`;
  if (range.from) return `Từ ${formatDate(range.from)}`;
  if (range.to) return `Đến ${formatDate(range.to)}`;
  return 'Chọn khoảng thời gian';
}

export function CampaignQuickFilters({ campaigns, query, range, onApply }: CampaignQuickFiltersProps) {
  const root = useRef<HTMLDivElement>(null);
  const [queryDraft, setQueryDraft] = useState(query);
  const deferredQuery = useDeferredValue(queryDraft);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>(storedRecentSearches);
  const [dateOpen, setDateOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<CampaignCommunicationRange>(range);
  const [dateError, setDateError] = useState('');

  const allSuggestions = useMemo(() => campaignSuggestions(campaigns), [campaigns]);
  const normalizedQuery = normalizeDirectorySearch(deferredQuery);
  const suggestions = useMemo(() => normalizedQuery
    ? allSuggestions.filter((suggestion) => normalizeDirectorySearch(`${suggestion.value} ${suggestion.detail}`).includes(normalizedQuery)).slice(0, 8)
    : recentSearches.map((value) => ({ value, type: 'Tìm kiếm gần đây', detail: '' })), [allSuggestions, normalizedQuery, recentSearches]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setSearchOpen(false);
        setDateOpen(false);
      }
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, []);

  useEffect(() => setActiveSuggestion(-1), [deferredQuery, searchOpen]);
  useEffect(() => setQueryDraft(query), [query]);
  useEffect(() => setRangeDraft(range), [range]);

  const remember = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    setRecentSearches((current) => {
      const normalized = normalizeDirectorySearch(trimmed);
      const next = [trimmed, ...current.filter((item) => normalizeDirectorySearch(item) !== normalized)].slice(0, MAX_RECENT_SEARCHES);
      window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const chooseSuggestion = (value: string) => {
    setQueryDraft(value);
    setSearchOpen(false);
  };

  const clearRecent = () => {
    setRecentSearches([]);
    window.localStorage.removeItem(RECENT_SEARCH_STORAGE_KEY);
  };

  const openDateRange = () => {
    setDateError('');
    setSearchOpen(false);
    setDateOpen((current) => !current);
  };

  const validateDateRange = () => {
    if (rangeDraft.from && rangeDraft.to && rangeDraft.from > rangeDraft.to) {
      setDateError('Ngày bắt đầu không được sau ngày kết thúc.');
      return false;
    }
    setDateError('');
    return true;
  };

  const finishDateRange = () => {
    if (!validateDateRange()) return;
    setDateOpen(false);
  };

  const applyFilters = () => {
    if (!validateDateRange()) {
      setDateOpen(true);
      return;
    }
    const nextQuery = queryDraft.trim();
    remember(nextQuery);
    onApply(nextQuery, rangeDraft);
    setSearchOpen(false);
    setDateOpen(false);
  };

  const dateDraftChanged = rangeDraft.from !== range.from || rangeDraft.to !== range.to;

  return (
    <div ref={root} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <label className="relative block text-xs font-semibold text-slate-600">
        Từ khóa
        <div className="relative mt-2">
          <CpmsIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-vna-blue focus:ring-4 focus:ring-cyan-100"
            placeholder="Mã, tên, đơn vị hoặc người yêu cầu…"
            value={queryDraft}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? 'campaign-search-suggestions' : undefined}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setQueryDraft(event.target.value); setSearchOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && suggestions.length) {
                event.preventDefault();
                setActiveSuggestion((current) => Math.min(suggestions.length - 1, current + 1));
              } else if (event.key === 'ArrowUp' && suggestions.length) {
                event.preventDefault();
                setActiveSuggestion((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const suggestion = suggestions[activeSuggestion];
                if (suggestion) chooseSuggestion(suggestion.value);
                else applyFilters();
              } else if (event.key === 'Escape') setSearchOpen(false);
            }}
          />
          {queryDraft ? <button type="button" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Xóa từ khóa" onClick={() => { setQueryDraft(''); setSearchOpen(true); }}><CpmsIcon name="reject" /></button> : null}
        </div>
        {searchOpen ? (
          <div id="campaign-search-suggestions" role="listbox" className="absolute inset-x-0 z-40 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-panel">
            {!normalizedQuery && recentSearches.length ? <div className="flex items-center justify-between px-3 py-1.5"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tìm kiếm gần đây</span><button type="button" className="text-[10px] font-semibold text-vna-blue" onClick={clearRecent}>Xóa lịch sử</button></div> : null}
            {suggestions.length ? suggestions.map((suggestion, index) => (
              <button
                type="button"
                role="option"
                aria-selected={activeSuggestion === index}
                key={`${suggestion.type}:${suggestion.value}`}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${activeSuggestion === index ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(suggestion.value)}
              >
                <span className="min-w-0 truncate text-sm font-medium text-slate-800">{suggestion.value}</span>
                <span className="shrink-0 text-[10px] font-semibold text-slate-400">{suggestion.type}</span>
              </button>
            )) : <p className="px-3 py-3 text-xs font-normal text-slate-500">Không có gợi ý phù hợp.</p>}
          </div>
        ) : null}
      </label>

      <div className="relative block text-xs font-semibold text-slate-600">
        <span>Thời gian truyền thông</span>
        <button
          type="button"
          className={`mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm font-normal outline-none transition ${dateOpen ? 'border-vna-blue ring-4 ring-cyan-100' : 'border-slate-200 hover:border-vna-blue/40'}`}
          aria-expanded={dateOpen}
          aria-haspopup="dialog"
          onClick={openDateRange}
        >
          <span className="flex min-w-0 items-center gap-2"><CpmsIcon name="planning" className="shrink-0 text-slate-400" /><span className={`truncate ${rangeDraft.from || rangeDraft.to ? 'text-slate-900' : 'text-slate-400'}`}>{rangeSummary(rangeDraft)}</span></span>
          {dateDraftChanged ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Chờ áp dụng</span> : range.from || range.to ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-vna-blue">Đang lọc</span> : null}
        </button>
        {dateOpen ? (
          <div role="dialog" aria-label="Chọn khoảng thời gian truyền thông" className="absolute right-0 z-40 mt-2 w-full min-w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
            <p className="text-sm font-semibold text-slate-900">Khoảng thời gian truyền thông</p>
            <p className="mt-1 text-[11px] font-normal text-slate-500">Hiển thị Chiến dịch có thời gian giao với khoảng đã chọn.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Từ ngày<input type="date" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal outline-none focus:border-vna-blue" value={rangeDraft.from} onChange={(event) => { setDateError(''); setRangeDraft((current) => ({ ...current, from: event.target.value })); }} /></label>
              <label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal outline-none focus:border-vna-blue" value={rangeDraft.to} onChange={(event) => { setDateError(''); setRangeDraft((current) => ({ ...current, to: event.target.value })); }} /></label>
            </div>
            {dateError ? <p className="mt-2 text-xs font-medium text-rose-700" role="alert">{dateError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setDateError(''); setRangeDraft({ from: '', to: '' }); }}>Xóa</Button>
              <Button size="sm" variant="secondary" onClick={() => { setDateError(''); setRangeDraft(range); setDateOpen(false); }}>Hủy</Button>
              <Button size="sm" onClick={finishDateRange}>Xong</Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-end">
        <Button className="min-h-11 w-full gap-2 px-5 md:w-auto" onClick={applyFilters}><CpmsIcon name="search" />Áp dụng</Button>
      </div>
    </div>
  );
}
