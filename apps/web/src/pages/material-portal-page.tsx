import { MATERIAL_GROUPS, MATERIAL_PUBLICATION_LABELS, MATERIAL_TYPES_BY_GROUP, parseMaterialCampaignRefs, type MaterialBulkAction, type MaterialFieldKey, type MaterialGroup, type MaterialPortalBootstrap } from '@cpms/domain';
import { Button, Card, CpmsIcon, SectionHeading, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CampaignRichTextEditor } from '../components/campaign-rich-text-editor';
import { MaterialCollaborationPanel } from '../components/material-collaboration-panel';
import { useAuth } from '../auth-context';
import { useAccessCapabilities } from '../access-context';
import { batchSaveMaterials, bulkMaterialAction, getCampaign, getMaterialBootstrap, getMaterials, purgeMaterial, requestJson } from '../lib/api';
import { materialsForCampaign } from '../lib/campaign-materials';
import { columnDragAutoScrollDelta, moveOrderedItemAt, type ColumnDropPosition } from '../lib/column-order';
import { materialDescription, plainRichText } from '../lib/material-form';
import { materialGridPreferenceKeys } from '../lib/material-grid-preferences';
import { AppLink, navigate } from '../lib/router';
import { useGridSave } from '../lib/use-grid-save';
import { gridDestination } from '../lib/grid-navigation';
import {
  DEFAULT_MATERIAL_COLUMNS,
  MATERIAL_COLUMNS,
  compareMaterialRows,
  materialCompletionInRange,
  duplicateMaterialRow,
  matchesMaterialSearch,
  materialDisplayValue,
  materialRowFromSummary,
  materialSaveItem,
  materialSortDirectionLabel,
  newMaterialRow,
  type MaterialColumn,
  type MaterialGridRow,
} from '../lib/material-grid';

interface ActiveCell {
  rowKey: string;
  fieldKey: MaterialFieldKey;
}

interface MaterialFormDraftSummary {
  id: string;
  materialId: string | null;
  title: string;
  updatedAt: string;
}

type ContextMenu =
  | { kind: 'row'; x: number; y: number; rowKey: string }
  | { kind: 'column'; x: number; y: number; fieldKey: MaterialFieldKey }
  | { kind: 'background'; x: number; y: number };

const bulkLabels: Record<MaterialBulkAction, string> = {
  PUBLISH: 'Xuất bản',
  PAUSE_PUBLISH: 'Tạm dừng xuất bản',
  UNPUBLISH: 'Đưa về Chưa xuất bản',
  SOFT_DELETE: 'Xóa tạm',
  RESTORE: 'Phục hồi',
};

function defaultColumnWidth(key: MaterialFieldKey): number {
  return Math.round(Number.parseFloat(MATERIAL_COLUMNS.find((column) => column.key === key)?.width || '12') * 16);
}

function loadStoredWidths(storageKey: string): Partial<Record<MaterialFieldKey, number>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const known = new Set(MATERIAL_COLUMNS.map((column) => column.key));
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => known.has(key as MaterialFieldKey) && typeof value === 'number' && Number.isFinite(value) && value >= 96 && value <= 800)) as Partial<Record<MaterialFieldKey, number>>;
  } catch { return {}; }
}

function loadStoredColumns(storageKey: string): MaterialFieldKey[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [...DEFAULT_MATERIAL_COLUMNS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_MATERIAL_COLUMNS];
    const known = new Set(MATERIAL_COLUMNS.map((column) => column.key));
    const values = parsed.filter((value): value is MaterialFieldKey => typeof value === 'string' && known.has(value as MaterialFieldKey));
    return values.length ? values : [...DEFAULT_MATERIAL_COLUMNS];
  } catch {
    return [...DEFAULT_MATERIAL_COLUMNS];
  }
}

function loadPinnedColumns(storageKey: string): MaterialFieldKey[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown;
    const known = new Set(MATERIAL_COLUMNS.map((column) => column.key));
    return Array.isArray(parsed) ? parsed.filter((key): key is MaterialFieldKey => typeof key === 'string' && known.has(key as MaterialFieldKey)).slice(0, 3) : [];
  } catch {
    return [];
  }
}

function clientKey(prefix = 'new') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function rangeLabel(range: { from: string; to: string }) {
  const format = (value: string) => value ? value.split('-').reverse().join('/') : '';
  if (range.from && range.to) return `${format(range.from)} – ${format(range.to)}`;
  if (range.from) return `Từ ${format(range.from)}`;
  if (range.to) return `Đến ${format(range.to)}`;
  return 'Chọn khoảng thời gian';
}

function isUrl(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function statusTone(value: string) {
  if (['Done', 'APPROVED', 'PUBLISHED', 'Đã phê duyệt'].includes(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['Cancel', 'Replaced', 'Từ chối'].includes(value)) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

interface MaterialCampaignScope {
  id: string;
  code: string;
  name: string;
}

export function MaterialPortalPage({
  notify,
  campaignScope,
  embedded = false,
}: {
  notify: (message: string) => void;
  campaignScope?: MaterialCampaignScope;
  embedded?: boolean;
}) {
  const { me } = useAuth();
  const capabilities = useAccessCapabilities();
  const preferenceKeys = materialGridPreferenceKeys(embedded && campaignScope ? { actorId: me.account.id, campaignId: campaignScope.id } : undefined);
  const [routeCampaignId, setRouteCampaignId] = useState<string | null>(() => embedded ? null : new URLSearchParams(window.location.search).get('campaignId'));
  const [routeCampaign, setRouteCampaign] = useState<MaterialCampaignScope | null>(null);
  const [scopeError, setScopeError] = useState<{ id: string; message: string } | null>(null);
  const activeScopeError = scopeError?.id === routeCampaignId ? scopeError.message : null;
  const scopedCampaign = campaignScope ?? (routeCampaign?.id === routeCampaignId ? routeCampaign : null);
  const waitingForScope = Boolean(routeCampaignId && !scopedCampaign && !activeScopeError);
  const scopeKey = scopedCampaign?.id ?? '';
  const [rows, updateRows] = useState<MaterialGridRow[]>([]);
  const rowsRef = useRef(rows);
  const setRows = (value: MaterialGridRow[] | ((old: MaterialGridRow[]) => MaterialGridRow[])) => {
    rowsRef.current = typeof value === 'function' ? value(rowsRef.current) : value;
    updateRows(rowsRef.current);
  };
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formDrafts, setFormDrafts] = useState<MaterialFormDraftSummary[]>([]);
  const [bootstrap, setBootstrap] = useState<MaterialPortalBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [addCount, setAddCount] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [completionRangeDraft, setCompletionRangeDraft] = useState({ from: '', to: '' });
  const [completionRange, setCompletionRange] = useState({ from: '', to: '' });
  const [publicationFilterDraft, setPublicationFilterDraft] = useState('ALL');
  const [publicationFilter, setPublicationFilter] = useState('ALL');
  const [dateOpen, setDateOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<MaterialFieldKey, string>>>({});
  const [columnFiltersEnabled, setColumnFiltersEnabled] = useState(false);
  const [filterMenu, setFilterMenu] = useState<{ key: MaterialFieldKey; x: number; y: number } | null>(null);
  const [filterDraft, setFilterDraft] = useState('');
  const [sort, setSort] = useState<{ key: MaterialFieldKey; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [bulkAction, setBulkAction] = useState<MaterialBulkAction | ''>('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<MaterialFieldKey[]>(() => loadStoredColumns(preferenceKeys.columns));
  const [pinnedColumnKeys, setPinnedColumnKeys] = useState<MaterialFieldKey[]>(() => loadPinnedColumns(preferenceKeys.pinned));
  const [columnWidths, setColumnWidths] = useState<Partial<Record<MaterialFieldKey, number>>>(() => loadStoredWidths(preferenceKeys.widths));
  const [pendingColumnKeys, setPendingColumnKeys] = useState<MaterialFieldKey[]>(() => loadStoredColumns(preferenceKeys.columns));
  const [columnQuery, setColumnQuery] = useState('');
  const [editingRows, setEditingRows] = useState<Set<string>>(() => new Set());
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [selectedCell, setSelectedCell] = useState<ActiveCell | null>(null);
  const [richEditor, setRichEditor] = useState<{ rowKey: string; value: ReturnType<typeof materialDescription> } | null>(null);
  const copiedRows = useRef<MaterialGridRow[]>([]);
  const copiedText = useRef('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [focusComment, setFocusComment] = useState(0);
  const [focusJournal, setFocusJournal] = useState(0);
  const [draggedColumnKey, setDraggedColumnKey] = useState<MaterialFieldKey | null>(null);
  const [dragOverColumnKey, setDragOverColumnKey] = useState<MaterialFieldKey | null>(null);
  const [dropPosition, setDropPosition] = useState<ColumnDropPosition>('before');
  const history = useRef<MaterialGridRow[][]>([]);
  const loadSequence = useRef(0);
  const columnChooserRef = useRef<HTMLDetailsElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragScrollFrame = useRef<number | null>(null);
  const dragScrollVelocity = useRef(0);
  const dragScrollElement = useRef<HTMLDivElement | null>(null);
  const titleNavigationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (dragScrollFrame.current !== null) window.cancelAnimationFrame(dragScrollFrame.current);
  }, []);

  useEffect(() => {
    if (embedded) return;
    const updateRouteScope = () => setRouteCampaignId(new URLSearchParams(window.location.search).get('campaignId'));
    window.addEventListener('popstate', updateRouteScope);
    return () => window.removeEventListener('popstate', updateRouteScope);
  }, [embedded]);

  useEffect(() => {
    if (!routeCampaignId) return;
    let active = true;
    void getCampaign(routeCampaignId).then((campaign) => {
      if (active) { setRouteCampaign({ id: campaign.id, code: campaign.code, name: campaign.name }); setScopeError(null); }
    }).catch((error: unknown) => {
      if (active) setScopeError({ id: routeCampaignId, message: error instanceof Error ? error.message : 'Không mở được Chiến dịch để lọc tư liệu.' });
    });
    return () => { active = false; };
  }, [routeCampaignId]);

  const load = useCallback(async (trash: boolean) => {
    if (waitingForScope || activeScopeError) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [records, portalBootstrap, drafts] = await Promise.all([getMaterials(trash), getMaterialBootstrap(), trash || scopedCampaign ? Promise.resolve([]) : requestJson<MaterialFormDraftSummary[]>('/material-form-drafts')]);
      if (sequence !== loadSequence.current) return;
      const matchingRecords = scopedCampaign ? materialsForCampaign(records, scopedCampaign) : records;
      setRows(matchingRecords.filter((record) => trash ? record.isDeleted : !record.isDeleted).map((record) => materialRowFromSummary(record)));
      setLoadedScopeKey(scopeKey);
      setBootstrap(portalBootstrap);
      setFormDrafts(drafts);
      setSelected(new Set());
      setBulkAction('');
      setEditingRows(new Set());
      setActiveCell(null);
      setSelectedCell(null);
      setContextMenu(null);
      history.current = [];
    } catch (error) {
      if (sequence === loadSequence.current) {
        const message = error instanceof Error ? error.message : 'Không tải được dữ liệu tư liệu.';
        setRows([]);
        setLoadedScopeKey(scopeKey);
        setLoadError(message);
        notify(message);
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [activeScopeError, notify, scopeKey, scopedCampaign, waitingForScope]);

  useEffect(() => { void load(showTrash); }, [load, showTrash]);

  useEffect(() => {
    if (embedded) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveAll(); }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', escape);
    };
  }, []);

  useEffect(() => { window.localStorage.setItem(preferenceKeys.widths, JSON.stringify(columnWidths)); }, [columnWidths, preferenceKeys.widths]);

  useEffect(() => {
    const clearCellOutsideTable = (event: PointerEvent) => {
      const table = gridRef.current?.querySelector('table');
      if (event.target instanceof Node && !table?.contains(event.target)) setSelectedCell(null);
    };
    window.addEventListener('pointerdown', clearCellOutsideTable);
    return () => { window.removeEventListener('pointerdown', clearCellOutsideTable); if (titleNavigationTimer.current !== null) window.clearTimeout(titleNavigationTimer.current); };
  }, []);

  const visibleColumns = useMemo(() => [...pinnedColumnKeys.filter((key) => visibleColumnKeys.includes(key)), ...visibleColumnKeys.filter((key) => !pinnedColumnKeys.includes(key))].flatMap((key) => {
    const column = MATERIAL_COLUMNS.find((candidate) => candidate.key === key);
    return column ? [column] : [];
  }), [pinnedColumnKeys, visibleColumnKeys]);

  const filteredRows = useMemo(() => rows.filter((row) => (
    matchesMaterialSearch(row, search)
    && materialCompletionInRange(row, completionRange)
    && (publicationFilter === 'ALL' || (row.fields.publish_status || 'NOT_PUBLISHED') === publicationFilter)
    && (!columnFiltersEnabled || Object.entries(columnFilters).every(([key, value]) => materialDisplayValue(row.fields, key as MaterialFieldKey).toLocaleLowerCase('vi').includes(value.toLocaleLowerCase('vi'))))
  )).sort((a, b) => {
    if (!sort) return 0;
    const column = MATERIAL_COLUMNS.find((candidate) => candidate.key === sort.key);
    return column ? compareMaterialRows(a, b, column, sort.direction) : 0;
  }), [columnFilters, columnFiltersEnabled, completionRange, publicationFilter, rows, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  const dirtyRows = rows.filter((row) => row.dirty);
  const autosave = useGridSave({ scope: `material-grid:${scopeKey}`, enabled: !embedded && !showTrash && !loading && loadedScopeKey === scopeKey,
    root: gridRef, editing: Boolean(activeCell && dirtyRows.some(row => row.clientKey === activeCell.rowKey)), value: dirtyRows.length ? { rows: dirtyRows } : {}, commit: commitRows,
    restore: value => setRows(current => {
      const restored = (value.rows ?? []) as MaterialGridRow[];
      return [...restored.filter(row => !current.some(item => item.clientKey === row.clientKey)), ...current.map(row => restored.find(item => item.clientKey === row.clientKey) ?? row)];
    }) });
  const savedSelection = rows.filter((row) => selected.has(row.clientKey) && row.materialId);
  const collaborationRow = !showTrash && selected.size === 1 ? rows.find((row) => selected.has(row.clientKey) && row.materialId) : undefined;
  const activeFilterCount = Number(Boolean(search)) + Number(Boolean(completionRange.from || completionRange.to))
    + Number(publicationFilter !== 'ALL')
    + (columnFiltersEnabled ? Object.values(columnFilters).filter(Boolean).length : 0);

  function refreshList() {
    if (dirtyRows.length && !window.confirm(`Bỏ ${dirtyRows.length} dòng chưa lưu để làm mới danh sách?`)) return;
    void load(showTrash);
  }

  function applySearch() {
    if (completionRangeDraft.from && completionRangeDraft.to && completionRangeDraft.from > completionRangeDraft.to) {
      notify('Ngày bắt đầu không được sau ngày kết thúc.');
      return;
    }
    setSearch(searchDraft.trim());
    setCompletionRange(completionRangeDraft);
    setPublicationFilter(publicationFilterDraft);
    setDateOpen(false);
    setPage(1);
  }

  function remember(current: MaterialGridRow[]) {
    history.current.push(structuredClone(current));
    if (history.current.length > 30) history.current.shift();
  }

  function updateCell(row: MaterialGridRow, column: MaterialColumn, value: string) {
    if (embedded || !column.editable || !capabilities['material.update'] || row.isDeleted) return;
    setRows((current) => {
      remember(current);
      return current.map((candidate) => {
        if (candidate.clientKey !== row.clientKey) return candidate;
        const fields = { ...candidate.fields };
        fields[column.key] = value;
        if (column.key === 'material_group') { fields.material_type = null; fields.material_type_other = null; }
        return { ...candidate, fields, dirty: true, error: null };
      });
    });
  }

  function beginCellEdit(row: MaterialGridRow, column: MaterialColumn) {
    if (embedded || !autosave.ready) return;
    if (['campaign', 'market_codes', 'material_languages'].includes(column.key) && row.materialId) {
      navigate(`/materials/${encodeURIComponent(row.materialId)}/edit`);
      return;
    }
    if (!column.editable || !capabilities['material.update'] || row.isDeleted) return;
    if (column.key === 'material_description_rich_text') {
      setRichEditor({ rowKey: row.clientKey, value: materialDescription(row.fields) });
      return;
    }
    setActiveCell({ rowKey: row.clientKey, fieldKey: column.key });
    setContextMenu(null);
  }

  function startRowEdit(row: MaterialGridRow) {
    if (embedded) return;
    if (!capabilities['material.update'] || row.isDeleted) {
      notify('Không có quyền sửa tư liệu này hoặc tư liệu đang nằm trong Thùng rác.');
      return;
    }
    setActiveCell(null);
    setEditingRows((current) => new Set(current).add(row.clientKey));
  }

  function editSelected() {
    const editableRows = rows.filter((row) => selected.has(row.clientKey) && !row.isDeleted);
    if (!editableRows.length) return notify('Hãy chọn ít nhất một tư liệu có thể chỉnh sửa.');
    setActiveCell(null);
    setEditingRows((current) => {
      const next = new Set(current);
      editableRows.forEach((row) => next.add(row.clientKey));
      return next;
    });
  }

  function finishEditing(key: string) {
    setEditingRows((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setActiveCell((current) => current?.rowKey === key ? null : current);
  }

  function cancelRow(key: string) {
    setRows((current) => {
      const target = current.find((row) => row.clientKey === key);
      if (!target) return current;
      remember(current);
      if (!target.materialId) return current.filter((row) => row.clientKey !== key);
      return current.map((row) => row.clientKey === key
        ? { ...row, fields: { ...row.baselineFields }, dirty: false, error: null }
        : row);
    });
    finishEditing(key);
    setSelected((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function cancelActiveCell(row: MaterialGridRow, column: MaterialColumn) {
    const baseline = String(row.baselineFields[column.key] ?? '');
    setRows((current) => current.map((candidate) => candidate.clientKey === row.clientKey
      ? { ...candidate, fields: { ...candidate.fields, [column.key]: baseline }, dirty: JSON.stringify({ ...candidate.fields, [column.key]: baseline }) !== JSON.stringify(candidate.baselineFields), error: null }
      : candidate));
    setActiveCell(null);
  }

  function copyGridSelection(): string {
    if (selected.size) {
      copiedRows.current = rows.filter((row) => selected.has(row.clientKey));
      copiedText.current = [visibleColumns.map((column) => column.label).join('\t'), ...copiedRows.current.map((row) => visibleColumns.map((column) => materialDisplayValue(row.fields, column.key).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))].join('\n');
      notify(`Đã sao chép ${copiedRows.current.length} dòng. Dán để tạo bản sao chưa lưu.`);
      return copiedText.current;
    }
    const row = rows.find((candidate) => candidate.clientKey === selectedCell?.rowKey);
    if (!row || !selectedCell) return '';
    copiedRows.current = [];
    copiedText.current = materialDisplayValue(row.fields, selectedCell.fieldKey);
    notify('Đã sao chép ô đang chọn.');
    return copiedText.current;
  }

  function pasteGridText(value: string) {
    if (showTrash || !value) return;
    if (copiedRows.current.length && value === copiedText.current && selected.size) {
      if (dirtyRows.length + copiedRows.current.length > 50) return notify('Một lần lưu tối đa 50 dòng mới/thay đổi.');
      const copies = copiedRows.current.map((row) => duplicateMaterialRow(row, clientKey('paste')));
      setRows((current) => { remember(current); return [...copies, ...current]; });
      setSelected(new Set(copies.map((row) => row.clientKey)));
      setPage(1);
      void autosave.save(copies.map(row => row.clientKey));
      return;
    }
    if (!selectedCell) return notify('Hãy chọn một ô trong bảng trước khi dán.');
    const startColumn = visibleColumns.findIndex((column) => column.key === selectedCell.fieldKey);
    const startRow = pageRows.findIndex((row) => row.clientKey === selectedCell.rowKey);
    if (startColumn < 0 || startRow < 0) return;
    const matrix = value.replaceAll('\r', '').trimEnd().split('\n').map((line) => line.split('\t'));
    const changes: Array<{ rowKey: string; key: MaterialFieldKey; value: string }> = [];
    matrix.forEach((cells, rowOffset) => cells.forEach((cell, columnOffset) => {
      const row = pageRows[startRow + rowOffset];
      const column = visibleColumns[startColumn + columnOffset];
      if (!row || !column?.editable || row.isDeleted || !capabilities['material.update']) return;
      changes.push({ rowKey: row.clientKey, key: column.key, value: column.key === 'material_description_rich_text' ? JSON.stringify(plainRichText(cell)) : cell });
    }));
    if (!changes.length) return notify('Vùng dán không có ô nào có thể chỉnh sửa.');
    if (new Set([...dirtyRows.map((row) => row.clientKey), ...changes.map((item) => item.rowKey)]).size > 50) return notify('Một lần lưu tối đa 50 dòng mới/thay đổi.');
    setRows((current) => { remember(current); return current.map((row) => {
      const entries = changes.filter((item) => item.rowKey === row.clientKey);
      if (!entries.length) return row;
      const fields = { ...row.fields };
      for (const item of entries) {
        fields[item.key] = item.value;
      }
      return { ...row, fields, dirty: true, error: null };
    }); });
    void autosave.save([...new Set(changes.map(item => item.rowKey))]);
  }

  function handleCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const value = copyGridSelection();
    if (value) { event.preventDefault(); event.clipboardData.setData('text/plain', value); }
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    pasteGridText(event.clipboardData.getData('text/plain'));
  }

  async function copyByButton() {
    const value = copyGridSelection();
    if (!value) return notify('Hãy chọn dòng hoặc một ô trước khi sao chép.');
    try { await navigator.clipboard.writeText(value); } catch { notify('Không thể ghi vào clipboard trình duyệt. Hãy nhấn Ctrl+C trong bảng.'); }
  }

  async function pasteByButton() {
    try { pasteGridText(await navigator.clipboard.readText()); }
    catch { notify('Trình duyệt chưa cho phép đọc clipboard. Hãy chọn vùng bảng rồi nhấn Ctrl+V.'); }
  }

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    setRows(current => current.map(row => {
      const old = previous.find(item => item.clientKey === row.clientKey);
      return old ? { ...row, fields: old.fields, dirty: JSON.stringify(old.fields) !== JSON.stringify(row.baselineFields), error: null } : row;
    }));
    void autosave.save();
  }

  function addRows() {
    if (showTrash || !capabilities['material.create']) return;
    const additions = Array.from({ length: addCount }, () => newMaterialRow(clientKey()));
    setSearch('');
    setSearchDraft('');
    setCompletionRange({ from: '', to: '' });
    setCompletionRangeDraft({ from: '', to: '' });
    setPublicationFilter('ALL');
    setPublicationFilterDraft('ALL');
    setColumnFilters({});
    setRows((current) => {
      remember(current);
      return [...additions, ...current];
    });
    setEditingRows((current) => new Set([...current, ...additions.map((row) => row.clientKey)]));
    setPage(1);
  }

  function duplicateSelected() {
    if (!capabilities['material.create']) return notify('Tài khoản không có quyền tạo tư liệu.');
    const sources = rows.filter((row) => selected.has(row.clientKey));
    if (!sources.length) return notify('Hãy chọn ít nhất một dòng để nhân bản.');
    if (sources.length + dirtyRows.length > 50) return notify('Một lần lưu tối đa 50 dòng mới/thay đổi.');
    const copies = sources.map((row) => duplicateMaterialRow(row, clientKey('copy')));
    setRows((current) => {
      remember(current);
      return [...copies, ...current];
    });
    setEditingRows((current) => new Set([...current, ...copies.map((row) => row.clientKey)]));
    setSelected(new Set());
    setPage(1);
  }

  function removeNewRows() {
    const removable = rows.filter((row) => selected.has(row.clientKey) && !row.materialId);
    if (!removable.length) return notify('Không có dòng mới nào được chọn.');
    setRows((current) => {
      remember(current);
      return current.filter((row) => !selected.has(row.clientKey) || Boolean(row.materialId));
    });
    setSelected(new Set());
    setEditingRows((current) => new Set([...current].filter((key) => !selected.has(key))));
  }

  async function commitRows(ids?: string[]) {
    const pending = rowsRef.current.filter(row => row.dirty && (!ids || ids.includes(row.clientKey))).map(row => structuredClone(row));
    if (!pending.length) return true;
    setSaving(true);
    let ok = true;
    try {
      for (let index = 0; index < pending.length; index += 50) {
        const snapshot = pending.slice(index, index + 50);
        const result = await batchSaveMaterials(snapshot.map(materialSaveItem));
        const byClientKey = new Map(result.items.map(item => [item.clientKey, item]));
        if (result.failed) ok = false;
        setRows(current => current.map(row => {
          const item = byClientKey.get(row.clientKey), sent = snapshot.find(item => item.clientKey === row.clientKey);
          if (!item || !sent) return row;
          if (!item.ok || !item.material) return { ...row, error: item.message || 'Không lưu được dòng này.' };
          const saved = materialRowFromSummary(item.material, row.clientKey);
          if (JSON.stringify(row.fields) === JSON.stringify(sent.fields)) return saved;
          const newer = Object.fromEntries(Object.entries(row.fields).filter(([key, value]) => value !== sent.fields[key as MaterialFieldKey]));
          return { ...saved, fields: { ...saved.fields, ...newer }, dirty: true };
        }));
      }
      return ok;
    } catch (error) { notify(error instanceof Error ? error.message : 'Không lưu được lô tư liệu.'); return false; }
    finally { setSaving(false); }
  }
  function saveAll() { return autosave.save(); }
  function selectCell(rowKey: string, fieldKey: MaterialFieldKey) {
    if (activeCell && (activeCell.rowKey !== rowKey || activeCell.fieldKey !== fieldKey)) {
      setActiveCell(null); void autosave.save([activeCell.rowKey]);
    }
    setSelectedCell({ rowKey, fieldKey });
    window.setTimeout(() => { const cell=gridRef.current?.querySelector<HTMLElement>('[data-material-selected-cell="true"]'); if(cell&&!cell.contains(document.activeElement)) cell.focus(); }, 0);
  }
  function moveCell(rowKey: string, fieldKey: MaterialFieldKey, key: string, shift = false) {
    const next = gridDestination(pageRows.findIndex(row => row.clientKey === rowKey), visibleColumns.findIndex(col => col.key === fieldKey), pageRows.length, visibleColumns.length, key, shift);
    const row = next && pageRows[next.row], col = next && visibleColumns[next.column];
    if (row && col) selectCell(row.clientKey, col.key);
  }
  function editorKey(event: React.KeyboardEvent, row: MaterialGridRow, col: MaterialColumn, select = false) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelActiveCell(row, col); return; }
    if (['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !(select && event.key.startsWith('Arrow'))) {
      event.preventDefault(); event.stopPropagation(); setActiveCell(null); void autosave.save([row.clientKey]); moveCell(row.clientKey, col.key, event.key, event.shiftKey);
    }
  }
  function gridKey(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing || (event.target as Element).closest('input,select,textarea,[contenteditable=true]') || !selectedCell) return;
    if (event.key === 'Enter' || event.key === 'F2') {
      const row = pageRows.find(row => row.clientKey === selectedCell.rowKey), col = visibleColumns.find(col => col.key === selectedCell.fieldKey);
      if (row && col) { event.preventDefault(); beginCellEdit(row, col); } return;
    }
    if (['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveCell(selectedCell.rowKey, selectedCell.fieldKey, event.key, event.shiftKey); }
  }

  async function confirmBulkAction() {
    if (!bulkAction || !savedSelection.length) return;
    if (savedSelection.some((row) => row.dirty)) return notify('Hãy lưu hoặc hoàn tác các dòng đang sửa trước khi thao tác lô.');
    const label = bulkLabels[bulkAction];
    if (!window.confirm(`Xác nhận “${label}” cho ${savedSelection.length} tư liệu đã chọn?`)) return;
    const reason = bulkAction === 'SOFT_DELETE' ? window.prompt('Lý do xóa tạm:', 'Xóa từ Material Portal') : '';
    if (reason === null) return;
    setSaving(true);
    try {
      const result = await bulkMaterialAction(savedSelection.map((row) => ({ materialId: row.materialId!, expectedVersion: row.recordVersion })), bulkAction, reason);
      notify(result.failed
        ? `Đã xử lý ${result.succeeded}/${result.total} tư liệu; ${result.items.filter((item) => !item.ok).map((item) => `${item.materialId}: ${item.message}`).join('; ')}`
        : `Đã xử lý ${result.succeeded}/${result.total} tư liệu trong lô.`);
      setBulkAction('');
      await load(showTrash);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thực hiện được thao tác lô.');
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else if (next.size < 50) next.add(key);
      return next;
    });
  }

  function togglePageSelection() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = pageRows.length > 0 && pageRows.every((row) => next.has(row.clientKey));
      for (const row of pageRows) {
        if (allSelected) next.delete(row.clientKey);
        else if (next.size < 50) next.add(row.clientKey);
      }
      return next;
    });
  }

  function applyColumns() {
    if (!pendingColumnKeys.length) return notify('Hãy chọn ít nhất một cột hiển thị.');
    setVisibleColumnKeys(pendingColumnKeys);
    setPinnedColumnKeys((current) => {
      const next = current.filter((key) => pendingColumnKeys.includes(key));
      window.localStorage.setItem(preferenceKeys.pinned, JSON.stringify(next));
      return next;
    });
    window.localStorage.setItem(preferenceKeys.columns, JSON.stringify(pendingColumnKeys));
    if (columnChooserRef.current) columnChooserRef.current.open = false;
    notify(`Đã xác nhận ${pendingColumnKeys.length} cột hiển thị.`);
  }

  function hideColumn(key: MaterialFieldKey) {
    if (visibleColumnKeys.length <= 1) return notify('Bảng cần hiển thị ít nhất một cột.');
    const next = visibleColumnKeys.filter((item) => item !== key);
    setVisibleColumnKeys(next);
    setPinnedColumnKeys((current) => {
      const remaining = current.filter((item) => item !== key);
      window.localStorage.setItem(preferenceKeys.pinned, JSON.stringify(remaining));
      return remaining;
    });
    setColumnFilters((current) => { const remaining = { ...current }; delete remaining[key]; return remaining; });
    setPendingColumnKeys((current) => current.filter((item) => item !== key));
    window.localStorage.setItem(preferenceKeys.columns, JSON.stringify(next));
    setContextMenu(null);
    notify('Đã ẩn cột. Có thể bật lại trong Chọn cột.');
  }

  function togglePinColumn(key: MaterialFieldKey) {
    if (!pinnedColumnKeys.includes(key) && pinnedColumnKeys.length >= 3) {
      setContextMenu(null);
      notify('Chỉ được ghim tối đa 3 cột. Hãy bỏ ghim một cột trước.');
      return;
    }
    const next = pinnedColumnKeys.includes(key) ? pinnedColumnKeys.filter((item) => item !== key) : [...pinnedColumnKeys, key];
    setPinnedColumnKeys(next);
    window.localStorage.setItem(preferenceKeys.pinned, JSON.stringify(next));
    setContextMenu(null);
  }

  function pinnedStyle(key: MaterialFieldKey) {
    const index = pinnedColumnKeys.indexOf(key);
    if (index < 0) return {};
    const width = pinnedColumnKeys.slice(0, index).reduce((sum, item) => sum + (columnWidths[item] ?? defaultColumnWidth(item)), 0);
    return { position: 'sticky' as const, left: `${48 + width}px` };
  }

  function startColumnResize(event: ReactPointerEvent<HTMLButtonElement>, key: MaterialFieldKey) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? defaultColumnWidth(key);
    const move = (pointer: PointerEvent) => setColumnWidths((current) => ({ ...current, [key]: Math.min(800, Math.max(96, startWidth + pointer.clientX - startX)) }));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function startColumnDrag(event: ReactDragEvent<HTMLTableCellElement>, fieldKey: MaterialFieldKey) {
    if ((event.target as HTMLElement).closest('[data-column-resize]')) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fieldKey);
    setDraggedColumnKey(fieldKey);
    setDragOverColumnKey(fieldKey);
    setDropPosition('before');
    setContextMenu(null);
  }

  function dragOverColumn(event: ReactDragEvent<HTMLTableCellElement>, fieldKey: MaterialFieldKey) {
    if (!draggedColumnKey) return;
    const sourcePinned = pinnedColumnKeys.includes(draggedColumnKey);
    const targetPinned = pinnedColumnKeys.includes(fieldKey);
    const boundaryDrop = !sourcePinned && targetPinned && pinnedColumnKeys.at(-1) === fieldKey;
    const allowed = sourcePinned === targetPinned || boundaryDrop;
    event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    if (!allowed) return;
    event.preventDefault();
    setDragOverColumnKey(fieldKey);
    if (boundaryDrop) {
      setDropPosition('after');
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropPosition(event.clientX >= bounds.left + bounds.width / 2 ? 'after' : 'before');
  }

  function dropColumn(event: ReactDragEvent<HTMLTableCellElement>, fieldKey: MaterialFieldKey) {
    event.preventDefault();
    const source = draggedColumnKey ?? event.dataTransfer.getData('text/plain') as MaterialFieldKey;
    if (!source || source === fieldKey) { endColumnDrag(); return; }
    const sourcePinned = pinnedColumnKeys.includes(source);
    const targetPinned = pinnedColumnKeys.includes(fieldKey);
    const boundaryDrop = !sourcePinned && targetPinned && pinnedColumnKeys.at(-1) === fieldKey;
    if (boundaryDrop) {
      const firstUnpinned = visibleColumnKeys.find((key) => !pinnedColumnKeys.includes(key));
      if (firstUnpinned && source !== firstUnpinned) {
        setVisibleColumnKeys((current) => {
          const next = moveOrderedItemAt(current, source, firstUnpinned, 'before');
          window.localStorage.setItem(preferenceKeys.columns, JSON.stringify(next));
          return next;
        });
        setPendingColumnKeys((current) => moveOrderedItemAt(current, source, firstUnpinned, 'before'));
      }
      endColumnDrag();
      return;
    }
    if (sourcePinned !== targetPinned) {
      notify('Cột ghim luôn nằm đầu bảng. Bỏ ghim trước khi kéo sang nhóm khác.');
      endColumnDrag();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX >= bounds.left + bounds.width / 2 ? 'after' : dropPosition;
    setVisibleColumnKeys((current) => {
      const next = moveOrderedItemAt(current, source, fieldKey, position);
      window.localStorage.setItem(preferenceKeys.columns, JSON.stringify(next));
      return next;
    });
    setPendingColumnKeys((current) => moveOrderedItemAt(current, source, fieldKey, position));
    if (sourcePinned) {
      const next = moveOrderedItemAt(pinnedColumnKeys, source, fieldKey, position);
      setPinnedColumnKeys(next);
      window.localStorage.setItem(preferenceKeys.pinned, JSON.stringify(next));
    }
    endColumnDrag();
  }

  function stopColumnAutoScroll() {
    dragScrollVelocity.current = 0;
    dragScrollElement.current = null;
    if (dragScrollFrame.current !== null) {
      window.cancelAnimationFrame(dragScrollFrame.current);
      dragScrollFrame.current = null;
    }
  }

  function runColumnAutoScroll() {
    const element = dragScrollElement.current;
    const velocity = dragScrollVelocity.current;
    if (!element || !velocity) { dragScrollFrame.current = null; return; }
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    const next = Math.min(maximum, Math.max(0, element.scrollLeft + velocity));
    if (next === element.scrollLeft) { dragScrollFrame.current = null; return; }
    element.scrollLeft = next;
    dragScrollFrame.current = window.requestAnimationFrame(runColumnAutoScroll);
  }

  function updateColumnAutoScroll(event: ReactDragEvent<HTMLDivElement>) {
    const element = gridRef.current;
    if (!draggedColumnKey || !element) return;
    const bounds = element.getBoundingClientRect();
    const pinnedWidth = 48 + pinnedColumnKeys.reduce((sum, key) => sum + (columnWidths[key] ?? defaultColumnWidth(key)), 0);
    const delta = columnDragAutoScrollDelta(
      event.clientX,
      Math.min(bounds.right, bounds.left + pinnedWidth),
      Math.max(bounds.left, bounds.right - 96),
    );
    if (!delta) { stopColumnAutoScroll(); return; }
    event.preventDefault();
    dragScrollElement.current = element;
    dragScrollVelocity.current = delta;
    if (dragScrollFrame.current === null) dragScrollFrame.current = window.requestAnimationFrame(runColumnAutoScroll);
  }

  function endColumnDrag() {
    stopColumnAutoScroll();
    setDraggedColumnKey(null);
    setDragOverColumnKey(null);
    setDropPosition('before');
  }

  function contextRows(rowKey: string) {
    const keys = selected.has(rowKey) ? selected : new Set([rowKey]);
    return rows.filter((row) => keys.has(row.clientKey));
  }

  function duplicateContextRows(rowKey: string) {
    const sources = contextRows(rowKey);
    const copies = sources.slice(0, 50).map((row) => duplicateMaterialRow(row, clientKey('copy')));
    if (!copies.length) return;
    setRows((current) => {
      remember(current);
      return [...copies, ...current];
    });
    setEditingRows((current) => new Set([...current, ...copies.map((row) => row.clientKey)]));
    setContextMenu(null);
    setPage(1);
    notify(`Đã tạo ${copies.length} bản sao đang chờ lưu.`);
  }

  async function runContextAction(action: MaterialBulkAction, rowKey: string) {
    const targets = contextRows(rowKey).filter((row) => row.materialId);
    setContextMenu(null);
    if (!targets.length) return;
    if (targets.some((row) => row.dirty)) return notify('Hãy lưu hoặc hoàn tác các dòng đang sửa trước khi thao tác.');
    const label = bulkLabels[action].toLocaleLowerCase('vi');
    if (!window.confirm(`Xác nhận ${label} ${targets.length} tư liệu?`)) return;
    const reason = action === 'SOFT_DELETE' ? window.prompt('Lý do xóa tạm:', 'Xóa từ Material Portal') : undefined;
    if (reason === null) return;
    setSaving(true);
    try {
      const result = await bulkMaterialAction(targets.map((row) => ({ materialId: row.materialId!, expectedVersion: row.recordVersion })), action, reason);
      notify(`Đã xử lý ${result.succeeded}/${result.total} tư liệu.`);
      await load(showTrash);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thực hiện được thao tác.');
    } finally {
      setSaving(false);
    }
  }

  async function purgeRow(row: MaterialGridRow) {
    setContextMenu(null);
    if (!row.materialId || !me.directSuperadmin) return;
    if (window.prompt(`Xóa vĩnh viễn ${row.materialId} và các bình luận của tư liệu. Không thể khôi phục. Nhập chính xác mã tư liệu để xác nhận:`) !== row.materialId) return;
    setSaving(true);
    try {
      await purgeMaterial(row.materialId, row.recordVersion);
      notify(`Đã xóa vĩnh viễn ${row.materialId}. Nhật ký kiểm toán vẫn được lưu.`);
      await load(showTrash);
    } catch (error) { notify(error instanceof Error ? error.message : 'Không xóa vĩnh viễn được tư liệu.'); }
    finally { setSaving(false); }
  }

  function renderCell(row: MaterialGridRow, column: MaterialColumn) {
    const value = String(row.fields[column.key] ?? (column.key === 'material_update_date' ? materialDisplayValue(row.fields, column.key).replace(/^—$/, '') : ''));
    const display = materialDisplayValue(row.fields, column.key);
    const locked = !column.editable || !capabilities['material.update'] || row.isDeleted;
    const cellActive = activeCell?.rowKey === row.clientKey && activeCell.fieldKey === column.key;
    const rowWideEdit = editingRows.has(row.clientKey) && !activeCell;
    if (column.key === 'campaign' && row.materialId) {
      const explicit = parseMaterialCampaignRefs(row.fields.campaign_refs);
      const legacy = !explicit.length ? bootstrap?.campaigns.find((campaign) => campaign.campaign_code === row.fields.campaign_code || campaign.campaign_name === row.fields.campaign_name) : undefined;
      const references = explicit.length ? explicit : legacy ? [{ kind: 'SYSTEM' as const, id: legacy.campaign_id, name: legacy.campaign_name }] : [];
      return references.length ? <span className="flex flex-wrap gap-x-2 gap-y-1">{references.map((reference) => reference.kind === 'SYSTEM'
        ? <AppLink key={reference.id} className="text-xs font-medium text-vna-blue hover:underline" to={`/campaigns/${encodeURIComponent(reference.id)}?tab=information`}>{reference.name}</AppLink>
        : <span key={reference.id} className="text-xs text-slate-600" title="Chiến dịch tạm">{reference.name}</span>)}</span>
        : <span className="block truncate text-xs text-slate-600" title={display}>{display}</span>;
    }
    if (column.key === 'material_name' && row.materialId && !cellActive && !rowWideEdit) {
      return <button type="button" className="block w-full truncate text-left text-xs font-semibold text-slate-900 hover:text-vna-blue hover:underline" title="Mở thông tin tư liệu" onClick={(event) => {
        if (event.detail !== 1) return;
        if (titleNavigationTimer.current !== null) window.clearTimeout(titleNavigationTimer.current);
        titleNavigationTimer.current = window.setTimeout(() => navigate(`/materials/${encodeURIComponent(row.materialId!)}/edit`), 220);
      }} onDoubleClick={() => { if (titleNavigationTimer.current !== null) window.clearTimeout(titleNavigationTimer.current); titleNavigationTimer.current = null; }}>{display}</button>;
    }
    if ((!cellActive && !rowWideEdit) || locked) {
      if (column.kind === 'publish' && display === MATERIAL_PUBLICATION_LABELS.PUBLISHED) {
        return <StatusBadge tone="positive">{display}</StatusBadge>;
      }
      if (['status', 'approval', 'publish'].includes(column.kind || '')) {
        return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(display)}`}>{display}</span>;
      }
      return column.kind === 'link' && isUrl(value)
        ? <a className="inline-flex rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-vna-blue hover:bg-cyan-100" href={value} target="_blank" rel="noreferrer">Mở link</a>
        : <span className={`block truncate text-xs ${column.key === 'material_name' ? 'font-semibold text-slate-900' : 'text-slate-600'}`} title={display}>{display}</span>;
    }
    if (locked && ['status', 'approval', 'publish'].includes(column.kind || '')) {
      return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(value)}`}>{value || '—'}</span>;
    }
    if (locked) {
      return column.kind === 'link' && isUrl(value)
        ? <a className="inline-flex rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-vna-blue hover:bg-cyan-100" href={value} target="_blank" rel="noreferrer">Mở link</a>
        : <span className="block max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-slate-600" title={value}>{value || '—'}</span>;
    }
    if (column.key === 'material_description_rich_text') {
      return <button type="button" className="w-full truncate rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1.5 text-left text-xs text-vna-blue" onClick={() => setRichEditor({ rowKey: row.clientKey, value: materialDescription(row.fields) })} title="Sửa mô tả có định dạng">{display === '—' ? 'Nhập mô tả…' : display}</button>;
    }
    if (column.key === 'material_group' || column.key === 'material_type') {
      const options = column.key === 'material_group' ? MATERIAL_GROUPS : MATERIAL_TYPES_BY_GROUP[(row.fields.material_group || 'Khác') as MaterialGroup];
      return <select autoFocus={cellActive} className="w-full rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-xs outline-none focus:ring-4 focus:ring-cyan-100" value={value} onChange={(event) => updateCell(row, column, event.target.value)} onKeyDown={event => editorKey(event, row, column, true)}><option value="">Chọn {column.label.toLocaleLowerCase('vi')}</option>{options.map((option) => <option key={option}>{option}</option>)}</select>;
    }
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus={cellActive}
          className={`w-full min-w-0 rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-xs outline-none focus:ring-4 focus:ring-cyan-100 ${column.key === 'material_name' ? 'font-semibold' : ''}`}
          type={column.kind === 'date' ? 'date' : 'text'}
          maxLength={column.key === 'note' ? 500 : undefined}
          value={value}
          onChange={(event) => updateCell(row, column, event.target.value)}
          onFocus={(event) => { if (cellActive && column.kind !== 'date') event.currentTarget.select(); }}
          onKeyDown={event => editorKey(event, row, column)}
        />
        {column.kind === 'link' && isUrl(value) ? <a className="shrink-0 rounded border border-cyan-200 px-1.5 py-1 text-[10px] font-semibold text-vna-blue" href={value} target="_blank" rel="noreferrer">Mở</a> : null}
      </div>
    );
  }


  if (activeScopeError) return <Card className="border-rose-200 p-5 text-sm text-rose-700" role="alert">Không thể lọc Tư liệu theo Chiến dịch: {activeScopeError}</Card>;
  if (waitingForScope) return <Card className="p-5 text-sm text-slate-600">Đang mở Chiến dịch để lọc Tư liệu…</Card>;
  if (loadedScopeKey !== scopeKey) return <Card className="p-5 text-sm text-slate-600">Đang tải Tư liệu của Chiến dịch…</Card>;
  if (loadError) return <Card className="flex flex-wrap items-center justify-between gap-3 border-rose-200 p-5 text-sm text-rose-700" role="alert"><span>{loadError}</span><Button variant="secondary" onClick={() => void load(showTrash)}>Thử lại</Button></Card>;

  return (
    <div className="space-y-5">
      {!embedded ? <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Không gian quản lý</p>
            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-vna-blue">{me.directSuperadmin ? 'Quản trị viên' : me.mode === 'DEMO_IMPERSONATION' ? 'Trình diễn' : me.mode === 'ADMIN_ASSIST' ? 'Đang hỗ trợ' : 'Không gian của bạn'}</span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Tư liệu QCTT</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={loading} onClick={refreshList}>{loading ? 'Đang tải…' : 'Làm mới'}</Button>
          <Button variant="secondary" className="gap-2" disabled title="Chức năng xuất dữ liệu đang được phát triển"><CpmsIcon name="export" />Xuất dữ liệu</Button>
          <Button variant="secondary" className="gap-2" disabled title="Chức năng nhập dữ liệu đang được phát triển"><CpmsIcon name="import" />Nhập dữ liệu</Button>
          <AppLink className="inline-flex min-h-10 items-center rounded-xl bg-vna-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-vna-blue/90" to="/materials/new">Tạo tư liệu mới</AppLink>
        </div>
      </header> : null}

      {scopedCampaign && !embedded ? <Card className="flex flex-wrap items-center justify-between gap-3 border-cyan-200 bg-cyan-50 p-4">
        <p className="text-sm text-slate-700">Đang hiển thị Tư liệu của Chiến dịch <strong>{scopedCampaign.code} · {scopedCampaign.name}</strong>, gồm cả Tư liệu gắn nhiều Chiến dịch.</p>
        <AppLink to="/materials" className="text-sm font-semibold text-vna-blue hover:underline">Xem toàn bộ Tư liệu</AppLink>
      </Card> : null}

      <Card className="overflow-visible">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <SectionHeading>Tìm kiếm</SectionHeading>
          <p className="text-xs text-slate-500">{activeFilterCount ? `${activeFilterCount} nhóm điều kiện đang áp dụng` : 'Chưa áp dụng bộ lọc'}</p>
        </div>
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
          <label className="block text-xs font-semibold text-slate-600">Từ khóa
            <span className="relative mt-2 block"><CpmsIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-vna-blue focus:ring-4 focus:ring-cyan-100" placeholder="Mã, mô tả, Chiến dịch hoặc link…" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applySearch(); } }} /></span>
          </label>
          <div className="relative block text-xs font-semibold text-slate-600"><span>Ngày cập nhật</span>
            <button type="button" aria-expanded={dateOpen} aria-haspopup="dialog" className={`mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm font-normal outline-none transition ${dateOpen ? 'border-vna-blue ring-4 ring-cyan-100' : 'border-slate-200 hover:border-vna-blue/40'}`} onClick={() => setDateOpen((current) => !current)}><span className="flex min-w-0 items-center gap-2"><CpmsIcon name="planning" className="shrink-0 text-slate-400" /><span className={`truncate ${completionRangeDraft.from || completionRangeDraft.to ? 'text-slate-900' : 'text-slate-400'}`}>{rangeLabel(completionRangeDraft)}</span></span>{completionRangeDraft.from !== completionRange.from || completionRangeDraft.to !== completionRange.to ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Chờ áp dụng</span> : completionRange.from || completionRange.to ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-vna-blue">Đang lọc</span> : null}</button>
            {dateOpen ? <div role="dialog" aria-label="Chọn khoảng ngày cập nhật" className="absolute right-0 z-40 mt-2 w-full min-w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"><p className="text-sm font-semibold text-slate-900">Khoảng ngày cập nhật</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Từ ngày<input type="date" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal" value={completionRangeDraft.from} onChange={(event) => setCompletionRangeDraft((current) => ({ ...current, from: event.target.value }))} /></label><label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal" value={completionRangeDraft.to} onChange={(event) => setCompletionRangeDraft((current) => ({ ...current, to: event.target.value }))} /></label></div><div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setCompletionRangeDraft({ from: '', to: '' })}>Xóa</Button><Button size="sm" variant="secondary" onClick={() => { setCompletionRangeDraft(completionRange); setDateOpen(false); }}>Hủy</Button><Button size="sm" onClick={() => setDateOpen(false)}>Xong</Button></div></div> : null}
          </div>
          <label className="block text-xs font-semibold text-slate-600">Tình trạng Xuất bản<select aria-label="Tình trạng Xuất bản" className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900" value={publicationFilterDraft} onChange={(event) => setPublicationFilterDraft(event.target.value)}><option value="ALL">Mọi tình trạng</option>{Object.entries(MATERIAL_PUBLICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="flex items-end md:col-span-2 xl:col-span-1"><Button className="min-h-11 w-full gap-2 px-5 xl:w-auto" onClick={applySearch}><CpmsIcon name="search" />Áp dụng</Button></div>
        </div>
      </Card>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div><SectionHeading>Tư liệu QCTT</SectionHeading>{!scopedCampaign ? <div className="mt-3 flex items-center gap-2"><button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${!showTrash ? 'bg-vna-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setShowTrash(false)}>Đang sử dụng</button><button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${showTrash ? 'bg-vna-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setShowTrash(true)}>Thùng rác</button></div> : null}<p className="mt-1 text-xs text-slate-500">Hiển thị {filteredRows.length} / {rows.length} tư liệu{scopedCampaign ? ' của Chiến dịch này' : ''}</p></div>
          <div className="flex flex-wrap items-center gap-2">{embedded && scopedCampaign ? <AppLink to={`/materials?campaignId=${encodeURIComponent(scopedCampaign.id)}`} className="inline-flex min-h-9 items-center rounded-lg bg-vna-blue px-3 py-2 text-xs font-semibold text-white hover:bg-vna-blue/90">Chỉnh sửa Tư liệu</AppLink> : null}<select aria-label="Số tư liệu mỗi trang" className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50].map((size) => <option key={size} value={size}>{size} dòng</option>)}</select></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {!showTrash && !embedded ? <>
              <select className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" aria-label="Số dòng mới sẽ thêm" value={addCount} onChange={(event) => setAddCount(Number(event.target.value))}>{[1, 3, 5, 10, 20, 50].map((count) => <option key={count} value={count}>{count} dòng mới</option>)}</select>
              <Button size="sm" onClick={addRows}><CpmsIcon name="add" />Thêm {addCount} dòng</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={editSelected}>Sửa dòng chọn</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={duplicateSelected}>Nhân bản</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size && !selectedCell} onClick={() => void copyByButton()}>Sao chép</Button>
              <Button size="sm" variant="secondary" onClick={() => void pasteByButton()}>Dán</Button>
              <Button size="sm" variant="ghost" disabled={!history.current.length} onClick={undo}>Hoàn tác</Button>
            </> : <span className="text-xs font-semibold text-slate-600">{embedded ? 'Xem Tư liệu liên kết với Chiến dịch này.' : 'Các dòng trong Thùng rác chỉ có thể phục hồi.'}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={columnFiltersEnabled ? 'secondary' : 'ghost'} className={columnFiltersEnabled ? 'border-cyan-200 bg-cyan-50 text-vna-blue' : ''} aria-pressed={columnFiltersEnabled} title="Hiện hoặc ẩn bộ lọc tại tiêu đề cột" onClick={() => { setColumnFiltersEnabled((current) => !current); setFilterMenu(null); setPage(1); }}><CpmsIcon name="filter" />{columnFiltersEnabled ? 'Tắt bộ lọc' : 'Bật bộ lọc'}{Object.values(columnFilters).filter(Boolean).length ? <span className="rounded-full bg-vna-blue px-1.5 py-0.5 text-[10px] text-white">{Object.values(columnFilters).filter(Boolean).length}</span> : null}</Button>
            {columnFiltersEnabled && Object.values(columnFilters).some(Boolean) ? <Button size="sm" variant="ghost" onClick={() => setColumnFilters({})}>Xóa lọc cột</Button> : null}
            <details ref={columnChooserRef} className="relative" onToggle={(event) => { if (event.currentTarget.open) { setPendingColumnKeys(visibleColumnKeys); setColumnQuery(''); } }}>
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-vna-blue/40">Cột hiển thị <span className="rounded-full bg-slate-100 px-2 py-0.5">{visibleColumns.length}</span></summary>
              <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3"><p className="text-sm font-semibold text-slate-800">Cột hiển thị</p><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => { if (columnChooserRef.current) columnChooserRef.current.open = false; }}>Hủy</Button><Button size="sm" disabled={!pendingColumnKeys.length} onClick={applyColumns}>Áp dụng</Button></div></div>
                <div className="flex items-center gap-2"><input type="search" aria-label="Tìm cột hiển thị" className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs" placeholder="Tìm theo tên cột…" value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} /><button type="button" className="text-xs font-semibold text-vna-blue" onClick={() => setPendingColumnKeys([...DEFAULT_MATERIAL_COLUMNS])}>Mặc định</button></div>
                <p className="mt-2 text-[10px] text-slate-500">Có thể ghim tối đa 3 cột bằng menu chuột phải tại tiêu đề cột.</p>
                <div className="mt-3 max-h-80 space-y-1 overflow-auto pr-1">{MATERIAL_COLUMNS.filter((column) => column.label.toLocaleLowerCase('vi').includes(columnQuery.trim().toLocaleLowerCase('vi'))).map((column) => <label key={column.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={pendingColumnKeys.includes(column.key)} onChange={(event) => setPendingColumnKeys((current) => event.target.checked ? [...current, column.key] : current.filter((key) => key !== column.key))} />{column.label}</label>)}</div>
              </div>
            </details>
            {!embedded ? <><span className={`rounded-full px-3 py-2 text-xs font-semibold ${dirtyRows.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{dirtyRows.length ? `${dirtyRows.length} dòng chưa lưu` : 'Không có thay đổi'}</span>
            <Button size="sm" variant="ghost" disabled={!dirtyRows.length || saving} onClick={() => void load(showTrash)}>Bỏ thay đổi</Button>
            <span role="status" className="text-xs text-slate-600">{autosave.status || "Enter / Tab / Arrow để lưu ô"}</span><Button size="sm" disabled={!dirtyRows.length || saving} onClick={() => void saveAll()}>Thử lưu lại</Button></> : null}
          </div>
        </div>

        {selected.size && !embedded ? <>
          <div className="flex flex-wrap items-center gap-2 border-b border-cyan-100 bg-cyan-50/60 px-5 py-2.5 text-xs">
            <strong className="mr-2 text-slate-900">Đã chọn {selected.size} tư liệu</strong>
            {!showTrash ? <>
              <Button size="sm" disabled={!capabilities['material.publish'] || !savedSelection.length || saving} onClick={() => setBulkAction('PUBLISH')}>Xuất bản / Khôi phục xuất bản</Button>
              <Button size="sm" variant="secondary" disabled={!capabilities['material.publish'] || !savedSelection.length || saving} onClick={() => setBulkAction('PAUSE_PUBLISH')}>Tạm dừng xuất bản</Button>
              <Button size="sm" variant="secondary" disabled={!capabilities['material.delete'] || !savedSelection.length || saving} onClick={() => setBulkAction('SOFT_DELETE')}>Xóa tạm</Button>
              {rows.some((row) => selected.has(row.clientKey) && !row.materialId) ? <Button size="sm" variant="ghost" onClick={removeNewRows}>Bỏ dòng mới</Button> : null}
            </> : <>
              <Button size="sm" variant="secondary" disabled={!capabilities['material.restore'] || !savedSelection.length || saving} onClick={() => setBulkAction('RESTORE')}>Phục hồi</Button>
              {me.directSuperadmin && savedSelection.length === 1 ? <Button size="sm" variant="secondary" disabled={saving} onClick={() => void purgeRow(savedSelection[0]!)}>Xóa vĩnh viễn</Button> : null}
            </>}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b border-cyan-100 bg-cyan-50 px-4 py-3">
            <span className="grid size-9 place-items-center rounded-full bg-vna-blue text-sm font-bold text-white">{selected.size}</span>
            <div><p className="text-sm font-bold text-vna-blue-deep">Tư liệu đã chọn</p><p className="text-xs text-slate-500">Tối đa 50 record mỗi thao tác</p></div>
            <select className="ml-auto min-w-60 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm" value={bulkAction} onChange={(event) => setBulkAction(event.target.value as MaterialBulkAction | '')}><option value="">Chọn thao tác trạng thái…</option>{(showTrash ? ['RESTORE'] : ['PUBLISH', 'PAUSE_PUBLISH', 'UNPUBLISH', 'SOFT_DELETE']).map((action) => <option key={action} value={action}>{bulkLabels[action as MaterialBulkAction]}</option>)}</select>
            <button className="rounded-xl bg-vna-blue px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!bulkAction || !savedSelection.length || savedSelection.length !== selected.size || saving || savedSelection.some((row) => row.dirty)} onClick={() => void confirmBulkAction()}>Xác nhận lô</button>
            <button className="text-sm font-semibold text-slate-600" onClick={() => { setSelected(new Set()); setBulkAction(''); }}>Bỏ chọn</button>
          </div>
        </> : null}

        <div ref={gridRef} onKeyDown={gridKey} tabIndex={0} aria-label="Bảng tư liệu, chọn ô để sao chép hoặc dán" className="overflow-x-auto outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-200" onCopy={handleCopy} onPaste={embedded ? undefined : handlePaste} onDragOver={updateColumnAutoScroll} onDragLeave={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) stopColumnAutoScroll(); }} onContextMenu={(event) => { if (!embedded && event.target === event.currentTarget) { event.preventDefault(); setContextMenu({ kind: 'background', x: event.clientX, y: event.clientY }); } }}>
          <table className="min-w-[1800px] table-fixed border-separate border-spacing-0 text-left text-xs" style={{ width: Math.max(1800, 48 + visibleColumns.reduce((sum, column) => sum + (columnWidths[column.key] ?? defaultColumnWidth(column.key)), 0) + 96) }}>
            <thead className="sticky top-0 z-20 bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-30 w-12 min-w-12 border-b border-r border-slate-200 bg-slate-50 p-3 text-center"><input aria-label="Chọn tất cả dòng đang hiển thị" type="checkbox" disabled={embedded} checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.clientKey))} onChange={togglePageSelection} /></th>
                {visibleColumns.map((column) => <th key={column.key} data-pinned={pinnedColumnKeys.includes(column.key) ? 'true' : 'false'} className={`relative cursor-grab select-none border-b border-r border-slate-200 p-3 font-semibold transition active:cursor-grabbing ${dragOverColumnKey === column.key && draggedColumnKey !== column.key ? `bg-cyan-50 ${dropPosition === 'before' ? 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-vna-blue' : 'after:absolute after:inset-y-0 after:right-0 after:w-1 after:bg-vna-blue'}` : 'bg-slate-50'} ${draggedColumnKey === column.key ? 'opacity-55' : ''} ${pinnedColumnKeys.includes(column.key) ? 'z-20 shadow-[2px_0_0_#e2e8f0]' : ''}`} style={{ width: columnWidths[column.key] ?? defaultColumnWidth(column.key), minWidth: columnWidths[column.key] ?? defaultColumnWidth(column.key), ...pinnedStyle(column.key) }} draggable title={`Kéo để đổi vị trí cột ${column.label}${pinnedColumnKeys.includes(column.key) ? ' trong nhóm cột ghim' : ''}`} onDragStart={(event) => startColumnDrag(event, column.key)} onDragOver={(event) => dragOverColumn(event, column.key)} onDrop={(event) => dropColumn(event, column.key)} onDragEnd={endColumnDrag} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'column', x: event.clientX, y: event.clientY, fieldKey: column.key }); }}><div className="flex items-center justify-between gap-1"><button type="button" draggable={false} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left hover:text-vna-blue" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSort((current) => ({ key: column.key, direction: current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc' })); setPage(1); }} title={`Sắp xếp ${materialSortDirectionLabel(column, sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc')}`} aria-label={`Sắp xếp ${column.label}: ${materialSortDirectionLabel(column, sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc')}`}><span className="truncate">{column.label}</span><span className={sort?.key === column.key ? 'text-vna-blue' : 'text-slate-300'}>{sort?.key === column.key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>{columnFiltersEnabled ? <button type="button" draggable={false} aria-label={`Lọc cột ${column.label}`} title={`Lọc cột ${column.label}`} className={`rounded p-1 hover:bg-cyan-100 ${columnFilters[column.key] ? 'text-vna-blue' : 'text-slate-400'}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const bounds = event.currentTarget.getBoundingClientRect(); setFilterDraft(columnFilters[column.key] || ''); setFilterMenu({ key: column.key, x: bounds.left, y: bounds.bottom + 4 }); }}><CpmsIcon name="filter" size={16} /></button> : null}</div><button type="button" data-column-resize draggable={false} aria-label={`Thay đổi độ rộng cột ${column.label}`} title={`Kéo để thay đổi độ rộng cột ${column.label}`} className="absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize touch-none hover:bg-vna-blue/20" onPointerDown={(event) => startColumnResize(event, column.key)} /></th>)}
                <th className="sticky right-0 z-30 w-24 min-w-24 border-b border-slate-200 bg-slate-50 p-3 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !showTrash ? formDrafts.map((draft) => <tr key={`draft-${draft.id}`} className="bg-amber-50/70"><td colSpan={visibleColumns.length + 2} className="border-b border-amber-100 px-5 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Bản nháp đang nhập · chỉ bạn nhìn thấy</span><span className="ml-3 text-xs font-semibold text-slate-800">{draft.title || 'Chưa đặt tiêu đề tư liệu'}</span></div><AppLink className="text-xs font-semibold text-vna-blue hover:underline" to={`${draft.materialId ? `/materials/${encodeURIComponent(draft.materialId)}/edit` : '/materials/new'}?draft=${encodeURIComponent(draft.id)}`}>Tiếp tục nhập</AppLink></div></td></tr>) : null}
              {loading ? <tr><td className="p-10 text-center text-sm text-slate-500" colSpan={visibleColumns.length + 2}>Đang tải dữ liệu…</td></tr> : null}
              {!loading && !pageRows.length ? <tr><td className="p-10 text-center text-sm text-slate-500" colSpan={visibleColumns.length + 2} onContextMenu={(event) => { if (embedded) return; event.preventDefault(); setContextMenu({ kind: 'background', x: event.clientX, y: event.clientY }); }}>{embedded ? 'Chưa có tư liệu thuộc Chiến dịch này.' : 'Không có tư liệu phù hợp. Nhấp chuột phải vào vùng này để thêm hoặc làm mới.'}</td></tr> : null}
              {!loading ? pageRows.map((row) => {
                const contextHighlighted = contextMenu?.kind === 'row' && contextMenu.rowKey === row.clientKey;
                const rowBackground = row.error ? '#fff1f2' : contextHighlighted ? '#dbeafe' : selected.has(row.clientKey) ? '#ecfeff' : row.dirty ? '#fffbeb' : undefined;
                return <tr
                    key={row.clientKey}
                    className="group bg-white transition-colors hover:bg-cyan-50/80"
                    data-context-active={contextHighlighted ? 'true' : undefined}
                    style={{ backgroundColor: rowBackground, boxShadow: contextHighlighted ? 'inset 4px 0 0 #0284c7, inset 0 1px 0 #bae6fd, inset 0 -1px 0 #bae6fd' : undefined }}
                    onContextMenu={(event) => { if (embedded) return; event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'row', x: event.clientX, y: event.clientY, rowKey: row.clientKey }); }}
                  >
                    <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white p-3 text-center align-middle transition-colors group-hover:bg-cyan-50" style={{ backgroundColor: rowBackground }}><input aria-label={`Chọn ${row.fields.material_name || row.fields.material_id || 'tư liệu'}`} type="checkbox" disabled={embedded} checked={selected.has(row.clientKey)} onChange={() => toggleSelected(row.clientKey)} /></td>
                    {visibleColumns.map((column) => <td tabIndex={0} data-material-selected-cell={selectedCell?.rowKey === row.clientKey && selectedCell.fieldKey === column.key ? "true" : undefined} key={column.key} className={`h-[58px] max-w-0 border-b border-r border-slate-100 p-2 align-middle text-slate-700 transition-colors group-hover:bg-cyan-50 ${pinnedColumnKeys.includes(column.key) ? 'z-10 bg-white' : ''} ${selectedCell?.rowKey === row.clientKey && selectedCell.fieldKey === column.key ? 'ring-2 ring-inset ring-vna-blue' : ''}`} style={{ width: columnWidths[column.key] ?? defaultColumnWidth(column.key), minWidth: columnWidths[column.key] ?? defaultColumnWidth(column.key), backgroundColor: pinnedColumnKeys.includes(column.key) ? rowBackground : undefined, ...pinnedStyle(column.key) }} onClick={event => { if (!(event.target as HTMLElement).closest('input, select, textarea, button, a')) selectCell(row.clientKey, column.key); }} onDoubleClick={() => beginCellEdit(row, column)}><div className="truncate">{renderCell(row, column)}</div>{row.error && column.key === visibleColumns[0]?.key ? <p className="mt-1 truncate text-[10px] font-semibold text-rose-600" title={row.error}>{row.error}</p> : null}</td>)}
                    <td className="sticky right-0 z-10 border-b border-slate-100 bg-white p-2 text-right transition-colors group-hover:bg-cyan-50" style={{ backgroundColor: rowBackground }}>
                      {embedded && row.materialId ? <AppLink className="text-xs font-semibold text-vna-blue" to={`/materials/${encodeURIComponent(row.materialId)}/edit`}>Mở</AppLink> : showTrash ? <span className="text-[10px] font-semibold text-slate-500">Chuột phải</span> : editingRows.has(row.clientKey) ? <div className="flex justify-end gap-1"><button className="text-xs font-semibold text-vna-blue" onClick={() => { finishEditing(row.clientKey); void autosave.save([row.clientKey]); }}>Xong</button><button className="text-xs text-slate-500" onClick={() => cancelRow(row.clientKey)}>Hủy</button></div> : <button className="text-xs font-semibold text-vna-blue" onClick={() => startRowEdit(row)}>Sửa</button>}
                    </td>
                  </tr>;
              }) : null}
              {!loading ? <tr><td colSpan={visibleColumns.length + 2} className="h-[320px] border-b border-slate-100 bg-white align-top" onContextMenu={(event) => { if (embedded) return; event.preventDefault(); setContextMenu({ kind: 'background', x: event.clientX, y: event.clientY }); }}>{!embedded ? <span className="sr-only">Vùng trống trong bảng. Nhấp chuột phải để thêm tư liệu, thêm dòng hoặc làm mới.</span> : null}</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
          <span>Hiển thị {pageRows.length}/{filteredRows.length} record · trang {Math.min(page, pageCount)}/{pageCount}</span>
          <span>{embedded ? 'Chọn cột, lọc và sắp xếp như tại phân hệ Tư liệu.' : showTrash ? 'Nhấp chuột phải để phục hồi' : 'Nhấp đúp ô để sửa · Chọn ô/dòng rồi Ctrl+C, Ctrl+V · Enter / Tab / Arrow lưu ô'}</span>
          <div className="flex gap-2"><button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:opacity-30" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Trước</button><button className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold disabled:opacity-30" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Sau →</button></div>
        </div>
      </section>

      {!embedded ? <MaterialCollaborationPanel materialId={collaborationRow?.materialId || null} materialTitle={collaborationRow?.fields.material_name || ''} focusComment={focusComment} focusJournal={focusJournal} notify={notify} /> : null}

      {contextMenu ? <div className="fixed z-[100] min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-sm shadow-xl" style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 240) }} role="menu" onPointerDown={(event) => event.stopPropagation()}>
        {contextMenu.kind === 'column' ? <><button type="button" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => togglePinColumn(contextMenu.fieldKey)}>{pinnedColumnKeys.includes(contextMenu.fieldKey) ? 'Bỏ ghim cột' : 'Ghim cột'}</button><div className="my-1 border-t border-slate-100" /><button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => hideColumn(contextMenu.fieldKey)}>Xóa cột khỏi bảng hiển thị</button></> : contextMenu.kind === 'background' ? <><button type="button" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => { setContextMenu(null); navigate('/materials/new'); }}>Thêm tư liệu mới</button><button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40" disabled={showTrash} onClick={() => { setContextMenu(null); addRows(); }}>Thêm dòng mới</button><button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); refreshList(); }}>Làm mới</button></> : (() => {
          const row = rows.find((item) => item.clientKey === contextMenu.rowKey);
          if (!row) return null;
          const targets = contextRows(contextMenu.rowKey);
          return <>
            {!showTrash ? <>
              {row.materialId ? <button type="button" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => { setContextMenu(null); navigate(`/materials/${encodeURIComponent(row.materialId!)}/edit`); }}>Mở hồ sơ tư liệu</button> : null}
              {row.materialId ? <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); setSelected(new Set([row.clientKey])); setFocusComment((value) => value + 1); }}>Bình luận</button> : null}
              {row.materialId ? <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); setSelected(new Set([row.clientKey])); setFocusJournal((value) => value + 1); }}>Xem lịch sử</button> : null}
              <button type="button" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => { setContextMenu(null); startRowEdit(row); }}>Sửa dòng</button>
              <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => duplicateContextRows(contextMenu.rowKey)}>Nhân bản{targets.length > 1 ? ` ${targets.length} tư liệu` : ''}</button>
              {row.materialId && capabilities['material.publish'] ? row.fields.publish_status === 'PUBLISHED'
                ? <button type="button" className="block w-full px-4 py-2 text-left text-amber-800 hover:bg-amber-50" onClick={() => void runContextAction('PAUSE_PUBLISH', contextMenu.rowKey)}>Tạm dừng xuất bản</button>
                : <button type="button" className="block w-full px-4 py-2 text-left text-emerald-700 hover:bg-emerald-50" onClick={() => void runContextAction('PUBLISH', contextMenu.rowKey)}>{row.fields.publish_status === 'PAUSED' ? 'Khôi phục xuất bản' : 'Xuất bản'}</button> : null}
              {row.materialId && capabilities['material.delete'] ? <button type="button" className="block w-full px-4 py-2 text-left text-rose-700 hover:bg-rose-50" onClick={() => void runContextAction('SOFT_DELETE', contextMenu.rowKey)}>Xóa tạm{targets.length > 1 ? ` (${targets.length})` : ''}</button> : !row.materialId ? <button type="button" className="block w-full px-4 py-2 text-left text-rose-700 hover:bg-rose-50" onClick={() => { setContextMenu(null); cancelRow(row.clientKey); }}>Bỏ dòng mới</button> : null}
              {me.directSuperadmin && row.materialId ? <><div className="my-1 border-t border-slate-100" /><button type="button" className="block w-full px-4 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50" onClick={() => void purgeRow(row)}>Xóa vĩnh viễn</button></> : null}
            </> : <>
              {capabilities['material.restore'] ? <button type="button" className="block w-full px-4 py-2 text-left font-semibold text-emerald-700 hover:bg-emerald-50" onClick={() => void runContextAction('RESTORE', contextMenu.rowKey)}>Phục hồi{targets.length > 1 ? ` ${targets.length} tư liệu` : ''}</button> : null}
              {me.directSuperadmin && row.materialId ? <><div className="my-1 border-t border-slate-100" /><button type="button" className="block w-full px-4 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50" onClick={() => void purgeRow(row)}>Xóa vĩnh viễn</button></> : null}
            </>}
          </>;
        })()}
      </div> : null}

      {filterMenu ? <div className="fixed z-[110] w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left: Math.min(filterMenu.x, window.innerWidth - 270), top: Math.min(filterMenu.y, window.innerHeight - 150) }} onPointerDown={(event) => event.stopPropagation()}><label className="text-xs font-semibold text-slate-700">Lọc {MATERIAL_COLUMNS.find((column) => column.key === filterMenu.key)?.label}<input autoFocus className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filterDraft} onChange={(event) => setFilterDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setColumnFilters((current) => ({ ...current, [filterMenu.key]: filterDraft.trim() })); setFilterMenu(null); setPage(1); } }} /></label><div className="mt-3 flex gap-2"><button className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" onClick={() => { setColumnFilters((current) => { const next = { ...current }; delete next[filterMenu.key]; return next; }); setFilterMenu(null); setPage(1); }}>Xóa lọc</button><button className="flex-1 rounded-lg bg-vna-blue px-2 py-1.5 text-xs font-semibold text-white" onClick={() => { setColumnFilters((current) => ({ ...current, [filterMenu.key]: filterDraft.trim() })); setFilterMenu(null); setPage(1); }}>Áp dụng</button></div></div> : null}

      {richEditor ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4" data-inline-save-surface role="dialog" aria-modal="true" aria-label="Sửa Mô tả tư liệu"><div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"><h2 className="text-lg font-semibold text-slate-900">Sửa Mô tả tư liệu</h2><p className="mb-4 mt-1 text-xs text-slate-500">Nội dung trong bảng được thu gọn; định dạng đầy đủ được giữ khi lưu.</p><CampaignRichTextEditor value={richEditor.value} onChange={(value) => setRichEditor((current) => current ? { ...current, value } : null)} onValidationError={notify} label="Mô tả tư liệu" idPrefix="material-grid-description" /><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRichEditor(null)}>Hủy</Button><Button onClick={() => { const row = rows.find((item) => item.clientKey === richEditor.rowKey); const column = MATERIAL_COLUMNS.find((item) => item.key === 'material_description_rich_text'); if (row && column) updateCell(row, column, JSON.stringify(richEditor.value)); setRichEditor(null); void autosave.save([richEditor.rowKey]); }}>Xong và lưu</Button></div></div></div> : null}

      <datalist id="material-campaign-options">{bootstrap?.campaigns.map((campaign) => <option key={campaign.campaign_code || campaign.campaign_name} value={campaign.campaign_name || campaign.campaign_code} />)}</datalist>
      <datalist id="material-type-options">{bootstrap?.options.materialTypes.map((value) => <option key={value} value={value} />)}</datalist>
    </div>
  );
}
