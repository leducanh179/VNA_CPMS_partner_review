import {
  CAMPAIGN_LIFECYCLE_STATES,
  CAMPAIGN_REFERENCE_OPTIONS,
  DEFAULT_CAMPAIGN_VISIBLE_FIELDS,
  canonicalCampaignFieldKey,
  isProtectedCampaignField,
  type CampaignBatchResult,
  type CampaignBatchSaveItem,
  type CampaignFieldDefinition,
  type CampaignLifecycleState,
  type CampaignSummary,
} from '@cpms/domain';
import { Button, CpmsIcon, LoadingBlock, StatusBadge } from '@cpms/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  campaignDraftFieldValue,
  campaignRowDraftEquals,
  campaignToRowDraft,
  emptyCampaignRow,
  toBatchSaveItem,
  updateCampaignDraftField,
  validateCampaignRow,
  type CampaignRowDraft,
  type CampaignRowErrors,
} from '../lib/campaign-inline-edit';
import { sortDirectionLabel, type CampaignSortDirection } from '../lib/campaign-grid';
import { timelineColumnRevealScrollLeft, timelineDayHeader, timelineMonthGroups } from '../lib/campaign-timeline';
import { CAMPAIGN_STATE_LABELS } from '../lib/campaign-presentation';
import {
  columnDragAutoScrollDelta,
  moveOrderedItemAt,
  type ColumnDropPosition,
} from '../lib/column-order';
import { AppLink, campaignDetailPath } from '../lib/router';
import { navigate } from '../lib/router';
import { useGridSave } from '../lib/use-grid-save';
import { gridDestination } from '../lib/grid-navigation';
import { useAccessCapabilities } from '../access-context';
import { CampaignColumnFilterMenu, type CampaignColumnFilterAnchor } from './campaign-column-filter-menu';
import {
  campaignGridDisplayValue,
  isCampaignColumnFilterable,
  type CampaignColumnFilterModel,
} from '../lib/campaign-filters';
import { CAMPAIGN_GRID_FIELD_BY_KEY, CAMPAIGN_GRID_FIELD_DEFINITIONS } from '../lib/campaign-grid-fields';
import type { CampaignFormDraftSummary } from '../lib/campaign-form-drafts';

interface CampaignInlineTableProps {
  campaigns: readonly CampaignSummary[];
  filterSourceCampaigns: readonly CampaignSummary[];
  columnFiltersEnabled: boolean;
  columnFilters: CampaignColumnFilterModel;
  loading?: boolean;
  sortKey: string;
  sortDirection: CampaignSortDirection;
  onSort(key: string): void;
  onColumnFiltersEnabledChange(enabled: boolean): void;
  onColumnFiltersChange(filters: CampaignColumnFilterModel): void;
  onSave(items: CampaignBatchSaveItem[]): Promise<CampaignBatchResult>;
  trashMode?: boolean;
  onMoveToTrash?(ids: string[]): Promise<void>;
  onRestore?(ids: string[]): Promise<void>;
  onDeletePermanently?(ids: string[]): Promise<void>;
  onSelectionChange?(ids: string[]): void;
  onVisibleFieldsChange?(fieldKeys: string[]): void;
  onViewConversation?(campaignId: string): void;
  onViewJournal?(campaignId: string): void;
  onLifecycleAction?(campaignId: string, action: 'pause' | 'resume' | 'cancel'): Promise<void>;
  onRefresh?(): void;
  formDrafts?: readonly CampaignFormDraftSummary[];
}

interface GridEdit {
  recordVersion?: number;
  key: string;
  id?: string;
  code: string;
  baseline: CampaignRowDraft;
  draft: CampaignRowDraft;
  isNew: boolean;
  editing: boolean;
  error: string | null;
  fieldErrors: CampaignRowErrors;
}

interface DisplayRow {
  key: string;
  campaign?: CampaignSummary;
  edit?: GridEdit;
  draft: CampaignRowDraft;
}

type ViewMode = 'table' | 'timeline';
type TimelineZoom = 'day' | 'week' | 'month' | 'quarter' | 'year';
type ActiveCell = { rowKey: string; fieldKey: string };
type FocusedGridItem = { kind: 'cell'; rowKey: string; fieldKey: string } | { kind: 'timeline-bar'; rowKey: string };
type ContextMenu =
  | { kind: 'column'; x: number; y: number; fieldKey: string }
  | { kind: 'row'; x: number; y: number; rowKey: string }
  | { kind: 'empty'; x: number; y: number };

const MAX_BATCH_ROWS = 50;
const COLUMN_STORAGE_KEY = 'cpms.campaign.visible-columns.v2';
const PIN_STORAGE_KEY = 'cpms.campaign.pinned-columns.v1';
const VIEW_STORAGE_KEY = 'cpms.campaign.view-mode.v1';
const WIDTH_STORAGE_KEY = 'cpms.campaign.column-widths.v1';
const inputClass = 'min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none transition focus:border-vna-blue focus:ring-2 focus:ring-cyan-100';

function storedArray(key: string, fallback: string[]) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(CAMPAIGN_GRID_FIELD_BY_KEY[item])) : fallback;
  } catch {
    return fallback;
  }
}

function storedWidths() {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(WIDTH_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).flatMap(([key, width]) => (
      CAMPAIGN_GRID_FIELD_BY_KEY[key] && typeof width === 'number' ? [[key, Math.min(600, Math.max(96, width))]] : []
    )));
  } catch {
    return {};
  }
}

function statusTone(state: CampaignLifecycleState): 'positive' | 'warning' | 'neutral' {
  if (['READY_TO_LAUNCH', 'RUNNING', 'COMPLETED'].includes(state)) return 'positive';
  if (['DRAFT', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED'].includes(state)) return 'warning';
  return 'neutral';
}

function dirty(edit: GridEdit) {
  return edit.isNew || !campaignRowDraftEquals(edit.draft, edit.baseline);
}

function dateInputValue(value: string, dateTime: boolean) {
  if (!value) return '';
  return dateTime ? value.replace(' ', 'T').slice(0, 16) : value.slice(0, 10);
}

function displayDate(value: string, dateTime: boolean) {
  if (!value) return '—';
  const parsed = new Date(dateTime ? value.replace(' ', 'T') : `${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat('vi-VN', dateTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

function fieldErrorKey(key: string): keyof CampaignRowDraft | null {
  if (key === 'campaign_name') return 'name';
  if (key === 'requesting_unit') return 'requestingUnit';
  if (key === 'campaign_comm_start_date') return 'startDate';
  if (key === 'campaign_comm_end_date') return 'endDate';
  return null;
}

function utcDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfTimelineUnit(value: Date, zoom: TimelineZoom) {
  const next = new Date(value);
  if (zoom === 'year') return new Date(Date.UTC(next.getUTCFullYear(), 0, 1));
  if (zoom === 'quarter') return new Date(Date.UTC(next.getUTCFullYear(), Math.floor(next.getUTCMonth() / 3) * 3, 1));
  if (zoom === 'month') return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1));
  if (zoom === 'week') {
    const day = next.getUTCDay() || 7;
    return addUtcDays(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate())), 1 - day);
  }
  return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()));
}

function nextTimelineUnit(value: Date, zoom: TimelineZoom) {
  if (zoom === 'year') return new Date(Date.UTC(value.getUTCFullYear() + 1, 0, 1));
  if (zoom === 'quarter') return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 3, 1));
  if (zoom === 'month') return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  return addUtcDays(value, zoom === 'week' ? 7 : 1);
}

function timelineLabel(value: Date, zoom: TimelineZoom) {
  if (zoom === 'year') return String(value.getUTCFullYear());
  if (zoom === 'quarter') return `Q${Math.floor(value.getUTCMonth() / 3) + 1}/${value.getUTCFullYear()}`;
  if (zoom === 'month') return `T${value.getUTCMonth() + 1}/${value.getUTCFullYear()}`;
  if (zoom === 'week') return `Tuần ${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function CampaignInlineTable({
  campaigns,
  filterSourceCampaigns,
  columnFiltersEnabled,
  columnFilters,
  loading = false,
  sortKey,
  sortDirection,
  onSort,
  onColumnFiltersEnabledChange,
  onColumnFiltersChange,
  onSave,
  trashMode = false,
  onMoveToTrash,
  onRestore,
  onDeletePermanently,
  onSelectionChange,
  onVisibleFieldsChange,
  onViewConversation,
  onViewJournal,
  onLifecycleAction,
  onRefresh,
  formDrafts = [],
}: CampaignInlineTableProps) {
  const capabilities = useAccessCapabilities();
  const [edits, updateEdits] = useState<Record<string, GridEdit>>({});
  const editsRef = useRef(edits);
  const versions = useRef<Record<string, number>>({});
  const aliases = useRef<Record<string, string>>({});
  const setEdits = (value: typeof edits | ((old: typeof edits) => typeof edits)) => {
    editsRef.current = typeof value === 'function' ? value(editsRef.current) : value;
    updateEdits(editsRef.current);
  };
  const [selected, setSelected] = useState<string[]>([]);
  const [addCount, setAddCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [visibleFields, setVisibleFields] = useState(() => {
    const stored = storedArray(COLUMN_STORAGE_KEY, [...DEFAULT_CAMPAIGN_VISIBLE_FIELDS]);
    if (window.localStorage.getItem('cpms.campaign.qctt-status-column.v1')) return stored;
    return stored.includes('campaign_lifecycle_state') ? stored : [...stored, 'campaign_lifecycle_state'];
  });
  const [pinnedFields, setPinnedFields] = useState(() => storedArray(PIN_STORAGE_KEY, ['campaign_code', 'campaign_name']).slice(0, 3));
  const [draftVisibleFields, setDraftVisibleFields] = useState<string[]>(visibleFields);
  const [draftPinnedFields, setDraftPinnedFields] = useState<string[]>(pinnedFields);
  const [columnChooserOpen, setColumnChooserOpen] = useState(false);
  const [columnChooserPosition, setColumnChooserPosition] = useState<CSSProperties>({});
  const columnChooserId = useId();
  const columnChooser = useRef<HTMLButtonElement>(null);
  const columnChooserPanel = useRef<HTMLDivElement>(null);
  const closeColumnChooser = () => {
    setColumnChooserOpen(false);
    columnChooser.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!columnChooserOpen) return;
    const position = () => {
      const element = columnChooser.current; if (!element) return;
      const anchor = element.getBoundingClientRect(); const host = element.closest('[data-campaign-grid]')?.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        setColumnChooserOpen(false);
        return;
      }
      const width = Math.min(380, window.innerWidth - 16);
      const minimum = Math.min((host?.left ?? 0) + 8, window.innerWidth - width - 8);
      const below = window.innerHeight - anchor.bottom - 16;
      const above = anchor.top - 16;
      const openAbove = below < 360 && above > below;
      const maxHeight = Math.max(0, Math.min(560, openAbove ? above : below));
      setColumnChooserPosition({
        width,
        left: Math.max(8, minimum, Math.min(anchor.right - width, window.innerWidth - width - 8)),
        ...(openAbove ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
        maxHeight,
      });
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && columnChooserPanel.current?.contains(event.target)) return;
      position();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !columnChooser.current?.contains(event.target) && !columnChooserPanel.current?.contains(event.target)) setColumnChooserOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setColumnChooserOpen(false);
        columnChooser.current?.focus({ preventScroll: true });
      }
    };
    position();
    columnChooserPanel.current?.querySelector('input')?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [columnChooserOpen]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(storedWidths);
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);
  const [dragOverFieldKey, setDragOverFieldKey] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<ColumnDropPosition>('before');
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [focusedGridItem, setFocusedGridItem] = useState<FocusedGridItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [columnFilterMenu, setColumnFilterMenu] = useState<{ fieldKey: string; anchor: CampaignColumnFilterAnchor } | null>(null);
  const [columnQuery, setColumnQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(VIEW_STORAGE_KEY) === 'timeline' ? 'timeline' : 'table'
  ));
  const [revealTimelineField, setRevealTimelineField] = useState<string | null>(null);
  const [zoom, setZoom] = useState<TimelineZoom>('month');
  const newRowCounter = useRef(0);
  const editingSnapshot = useRef('');
  const gridRoot = useRef<HTMLDivElement>(null);
  const tableScrollViewport = useRef<HTMLDivElement>(null);
  const dragScrollFrame = useRef<number | null>(null);
  const dragScrollVelocity = useRef(0);
  const dragScrollElement = useRef<HTMLDivElement | null>(null);

  useEffect(() => { window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleFields)); }, [visibleFields]);
  useEffect(() => { window.localStorage.setItem('cpms.campaign.qctt-status-column.v1', 'true'); }, []);
  useEffect(() => { window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedFields)); }, [pinnedFields]);
  useEffect(() => { window.localStorage.setItem(VIEW_STORAGE_KEY, viewMode); }, [viewMode]);
  useEffect(() => { window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(columnWidths)); }, [columnWidths]);
  useEffect(() => {
    if (!columnFiltersEnabled) setColumnFilterMenu(null);
  }, [columnFiltersEnabled]);
  useEffect(() => () => {
    if (dragScrollFrame.current !== null) window.cancelAnimationFrame(dragScrollFrame.current);
  }, []);

  const newRows = useMemo(() => Object.values(edits).filter((edit) => edit.isNew), [edits]);
  const dirtyRows = useMemo(() => Object.values(edits).filter(dirty), [edits]);

  const renderedKeys = useMemo(() => [...newRows.map((row) => row.key), ...campaigns.map((campaign) => campaign.id)], [campaigns, newRows]);
  useEffect(() => {
    if (focusedGridItem && !renderedKeys.includes(focusedGridItem.rowKey)) setFocusedGridItem(null);
  }, [focusedGridItem, renderedKeys]);
  useEffect(() => {
    if (!focusedGridItem) return;
    const clearFocusOutsideGrid = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && gridRoot.current?.contains(target) && target.closest('[data-campaign-grid-surface]')) return;
      setFocusedGridItem(null);
    };
    window.addEventListener('pointerdown', clearFocusOutsideGrid);
    return () => window.removeEventListener('pointerdown', clearFocusOutsideGrid);
  }, [focusedGridItem]);
  const selectedSavedIds = selected.filter((key) => campaigns.some((campaign) => campaign.id === key));
  const selectedDirtyCount = selected.filter((key) => edits[key] && dirty(edits[key])).length;
  const allVisibleSelected = renderedKeys.length > 0 && renderedKeys.every((key) => selected.includes(key));

  useEffect(() => { onSelectionChange?.(selectedSavedIds); }, [onSelectionChange, selectedSavedIds]);
  useEffect(() => { onVisibleFieldsChange?.(visibleFields); }, [onVisibleFieldsChange, visibleFields]);

  const orderedDefinitions = useMemo(() => {
    const withWidth = (definition: CampaignFieldDefinition): CampaignFieldDefinition => ({
      ...definition,
      width: columnWidths[definition.key] ?? definition.width ?? 180,
    });
    const pinned = pinnedFields.flatMap((key) => visibleFields.includes(key) && CAMPAIGN_GRID_FIELD_BY_KEY[key] ? [withWidth(CAMPAIGN_GRID_FIELD_BY_KEY[key]!)] : []);
    const rest = visibleFields.flatMap((key) => (
      !pinnedFields.includes(key) && CAMPAIGN_GRID_FIELD_BY_KEY[key] ? [withWidth(CAMPAIGN_GRID_FIELD_BY_KEY[key]!)] : []
    ));
    return [...pinned, ...rest];
  }, [columnWidths, pinnedFields, visibleFields]);

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);

  const displayRows = useMemo<DisplayRow[]>(() => [
    ...newRows.map((edit) => ({ key: edit.key, edit, draft: edit.draft })),
    ...campaigns.map((campaign) => ({
      key: campaign.id,
      campaign,
      ...(edits[campaign.id] ? { edit: edits[campaign.id] } : {}),
      draft: edits[campaign.id]?.draft ?? campaignToRowDraft(campaign),
    })),
  ], [campaigns, edits, newRows]);

  const toggleSelected = (key: string) => setSelected((current) => current.includes(key)
    ? current.filter((item) => item !== key)
    : current.length >= MAX_BATCH_ROWS ? current : [...current, key]);

  const toggleAllVisible = () => {
    if (allVisibleSelected) setSelected((current) => current.filter((key) => !renderedKeys.includes(key)));
    else setSelected((current) => Array.from(new Set([...current, ...renderedKeys])).slice(0, MAX_BATCH_ROWS));
  };

  const startEdit = (campaign: CampaignSummary) => {
    if (!campaign.access?.canEditAnyField) { setMessage('Campaign này chỉ được xem trong phạm vi hiện tại.'); return; }
    setEdits((current) => {
      const existing = current[campaign.id];
      if (existing) return { ...current, [campaign.id]: { ...existing, editing: true } };
      return {
        ...current,
        [campaign.id]: {
          key: campaign.id,
          id: campaign.id,
          recordVersion: campaign.recordVersion,
          code: campaign.code,
          baseline: campaignToRowDraft(campaign),
          draft: campaignToRowDraft(campaign),
          isNew: false,
          editing: true,
          error: null,
          fieldErrors: {},
        },
      };
    });
    setMessage(null);
  };

  const addBlankRows = () => {
    if (!capabilities['campaign.create']) return;
    const count = Math.min(Math.max(addCount, 1), 20);
    setEdits((current) => {
      const next = { ...current };
      for (let index = 0; index < count; index += 1) {
        newRowCounter.current += 1;
        const key = `new-${Date.now()}-${newRowCounter.current}`;
        next[key] = {
          key,
          code: 'Tự sinh khi lưu',
          baseline: emptyCampaignRow(),
          draft: emptyCampaignRow(),
          isNew: true,
          editing: true,
          error: null,
          fieldErrors: {},
        };
      }
      return next;
    });
    setMessage(`${count} dòng mới đã được thêm ở đầu lưới.`);
  };

  const editSelected = () => {
    const selectedCampaigns = campaigns.filter((campaign) => selected.includes(campaign.id));
    if (!selectedCampaigns.length) return setMessage('Hãy chọn ít nhất một chiến dịch đã lưu để chỉnh sửa.');
    selectedCampaigns.forEach(startEdit);
    setMessage(`${selectedCampaigns.length} dòng đã chuyển sang chế độ chỉnh sửa.`);
  };

  const duplicateRows = (keys: string[]) => {
    if (!capabilities['campaign.create']) return;
    const copies = keys.flatMap((key) => {
      const edit = edits[key];
      if (edit) return [edit.draft];
      const campaign = campaigns.find((item) => item.id === key);
      return campaign ? [campaignToRowDraft(campaign)] : [];
    }).slice(0, MAX_BATCH_ROWS);
    if (!copies.length) return setMessage('Hãy chọn ít nhất một dòng để nhân bản.');

    setEdits((current) => {
      const next = { ...current };
      copies.forEach((source) => {
        newRowCounter.current += 1;
        const key = `new-${Date.now()}-${newRowCounter.current}`;
        const fieldValues = { ...source.fieldValues };
        ['campaign_code', 'created_at', 'created_by', 'last_updated_at', 'last_updated_by', 'campaign_folder_id', 'campaign_folder_link']
          .forEach((fieldKey) => { delete fieldValues[fieldKey]; });
        const draft = { ...source, lifecycleState: 'DRAFT' as const, fieldValues };
        next[key] = { key, code: 'Tự sinh khi lưu', baseline: emptyCampaignRow(), draft, isNew: true, editing: true, error: null, fieldErrors: {} };
      });
      return next;
    });
    setMessage(`${copies.length} bản sao Dự thảo đang chờ lưu.`);
  };

  const duplicateSelected = () => duplicateRows(selected);

  const resetSelected = () => {
    setEdits((current) => {
      const next = { ...current };
      selected.forEach((key) => { delete next[key]; });
      return next;
    });
    setSelected((current) => current.filter((key) => !key.startsWith('new-')));
    setMessage('Đã hoàn tác thay đổi ở các dòng được chọn.');
  };

  const discardAll = () => {
    if (dirtyRows.length && !window.confirm(`Bỏ thay đổi ở ${dirtyRows.length} dòng?`)) return;
    setEdits({});
    setSelected((current) => current.filter((key) => !key.startsWith('new-')));
    setMessage(null);
  };

  const changeDraft = (key: string, fieldKey: string, value: string) => {
    setEdits((current) => {
      const edit = current[key];
      if (!edit) return current;
      const errorKey = fieldErrorKey(fieldKey);
      return {
        ...current,
        [key]: {
          ...edit,
          draft: updateCampaignDraftField(edit.draft, fieldKey, value),
          error: null,
          fieldErrors: errorKey ? { ...edit.fieldErrors, [errorKey]: undefined } : edit.fieldErrors,
        },
      };
    });
  };

  const finishEditing = (key: string) => {
    const edit = edits[key];
    if (!edit) return;
    const fieldErrors = validateCampaignRow(edit.draft);
    setEdits((current) => current[key]
      ? { ...current, [key]: { ...current[key]!, editing: Object.keys(fieldErrors).length > 0, fieldErrors } }
      : current);
  };

  const cancelRow = (key: string) => {
    setEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSelected((current) => current.filter((item) => item !== key));
  };

  const commitRows = async (ids?: string[]) => {
    const pending = Object.values(editsRef.current).filter(edit => dirty(edit) && (!ids || ids.map(id => aliases.current[id] ?? id).includes(edit.key)));
    if (!pending.length) return true;
    const valid: GridEdit[] = [];
    let ok = true;
    for (const edit of pending) {
      const fieldErrors = validateCampaignRow(edit.draft);
      if (Object.keys(fieldErrors).length) {
        ok = false;
        setEdits(current => ({ ...current, [edit.key]: { ...current[edit.key]!, fieldErrors } }));
      } else valid.push(structuredClone(edit));
    }
    setSaving(true);
    try {
      for (let index = 0; index < valid.length; index += MAX_BATCH_ROWS) {
        const snapshot = valid.slice(index, index + MAX_BATCH_ROWS);
        const result = await onSave(snapshot.map(edit => toBatchSaveItem(edit.key, edit.draft, edit.id,
          edit.id ? versions.current[edit.id] ?? edit.recordVersion ?? campaigns.find(c => c.id === edit.id)?.recordVersion : undefined)));
        for (const item of result.items) {
          const sent = snapshot.find(edit => edit.key === item.clientKey);
          if (!item.ok || !item.campaign || !sent) {
            ok = false;
            setEdits(current => current[item.clientKey] ? { ...current, [item.clientKey]: { ...current[item.clientKey]!, error: item.message ?? 'Không lưu được dòng này.' } } : current);
            continue;
          }
          const saved = item.campaign;
          versions.current[saved.id] = saved.recordVersion;
          if (saved.id !== item.clientKey) {
            aliases.current[item.clientKey] = saved.id;
            setActiveCell(current => current?.rowKey === item.clientKey ? { ...current, rowKey: saved.id } : current);
            setFocusedGridItem(current => current?.rowKey === item.clientKey ? { ...current, rowKey: saved.id } : current);
            setSelected(current => current.map(key => key === item.clientKey ? saved.id : key));
          }
          setEdits(current => {
            const next = { ...current }, edit = next[item.clientKey];
            delete next[item.clientKey];
            if (edit && !campaignRowDraftEquals(edit.draft, sent.draft)) next[saved.id] = {
              ...edit, key: saved.id, id: saved.id, recordVersion: saved.recordVersion, code: saved.code, isNew: false, baseline: campaignToRowDraft(saved), error: null,
            };
            return next;
          });
        }
      }
      if (!ok) setMessage('Nội dung được giữ trong bản nhập dở. Kiểm tra các ô được đánh dấu.');
      return ok;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu các thay đổi.'); return false;
    } finally { setSaving(false); }
  };
  const autosave = useGridSave({ scope: `campaign-grid:${trashMode ? 'trash' : 'active'}`, enabled: !trashMode,
    root: gridRoot, editing: Boolean(activeCell && dirtyRows.some(row => row.key === activeCell.rowKey)), value: dirtyRows.length ? { edits: Object.fromEntries(dirtyRows.map(edit => [edit.key, edit])) } : {},
    restore: value => setEdits(current => ({ ...(value.edits as typeof edits ?? {}), ...current })), commit: commitRows });
  const saveAll = () => autosave.save();

  const toggleVisibleField = (key: string) => {
    setDraftVisibleFields((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    if (draftVisibleFields.includes(key)) setDraftPinnedFields((current) => current.filter((item) => item !== key));
  };

  const togglePinnedField = (key: string) => {
    setDraftPinnedFields((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= 3) {
        setMessage('Chỉ được ghim tối đa 3 cột thông tin.');
        return current;
      }
      return [...current, key];
    });
    setDraftVisibleFields((current) => current.includes(key) ? current : [...current, key]);
  };

  const pinColumn = (key: string) => {
    if (pinnedFields.includes(key)) return setContextMenu(null);
    if (pinnedFields.length >= 3) {
      setContextMenu(null);
      setMessage('Chỉ được ghim tối đa 3 cột thông tin. Hãy bỏ ghim một cột trước.');
      return;
    }
    setVisibleFields((current) => current.includes(key) ? current : [...current, key]);
    setPinnedFields((current) => [...current, key]);
    setDraftVisibleFields((current) => current.includes(key) ? current : [...current, key]);
    setDraftPinnedFields((current) => current.includes(key) ? current : [...current, key]);
    setContextMenu(null);
    setMessage(`Đã ghim cột “${CAMPAIGN_GRID_FIELD_BY_KEY[key]?.label ?? key}” sang bên trái.`);
  };

  const unpinColumn = (key: string) => {
    setPinnedFields((current) => current.filter((item) => item !== key));
    setDraftPinnedFields((current) => current.filter((item) => item !== key));
    setContextMenu(null);
    setMessage(`Đã bỏ ghim cột “${CAMPAIGN_GRID_FIELD_BY_KEY[key]?.label ?? key}”.`);
  };

  const openColumnChooser = () => {
    setDraftVisibleFields(visibleFields);
    setDraftPinnedFields(pinnedFields);
    setColumnChooserOpen(true);
  };

  const applyColumnChooser = () => {
    if (!draftVisibleFields.length) return setMessage('Bảng cần hiển thị ít nhất một cột.');
    const newlyVisible = draftVisibleFields.filter((key) => !visibleFields.includes(key));
    setVisibleFields(draftVisibleFields);
    setPinnedFields(draftPinnedFields.filter((key) => draftVisibleFields.includes(key)).slice(0, 3));
    setRevealTimelineField(newlyVisible.at(-1) ?? null);
    const nextFilters = Object.fromEntries(Object.entries(columnFilters).filter(([key]) => draftVisibleFields.includes(key)));
    if (Object.keys(nextFilters).length !== Object.keys(columnFilters).length) onColumnFiltersChange(nextFilters);
    closeColumnChooser();
  };

  const hideColumn = (key: string) => {
    if (visibleFields.length <= 1) return setMessage('Bảng cần hiển thị ít nhất một cột.');
    setVisibleFields((current) => current.filter((item) => item !== key));
    setPinnedFields((current) => current.filter((item) => item !== key));
    if (columnFilters[key]) {
      const nextFilters = { ...columnFilters };
      delete nextFilters[key];
      onColumnFiltersChange(nextFilters);
    }
    setContextMenu(null);
    setMessage(`Đã ẩn cột “${CAMPAIGN_GRID_FIELD_BY_KEY[key]?.label ?? key}”. Có thể lấy lại trong Chọn cột hiển thị.`);
  };

  const startColumnResize = (event: ReactPointerEvent<HTMLButtonElement>, definition: CampaignFieldDefinition) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = definition.width ?? 180;
    const move = (pointer: PointerEvent) => setColumnWidths((current) => ({
      ...current,
      [definition.key]: Math.min(600, Math.max(96, startWidth + pointer.clientX - startX)),
    }));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const startColumnDrag = (event: ReactDragEvent<HTMLElement>, fieldKey: string) => {
    if ((event.target as HTMLElement).closest('[data-column-resize]')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fieldKey);
    setDraggedFieldKey(fieldKey);
    setDragOverFieldKey(fieldKey);
    setDropPosition('before');
    setContextMenu(null);
  };

  const dragOverColumn = (event: ReactDragEvent<HTMLElement>, fieldKey: string) => {
    if (!draggedFieldKey) return;
    const sourcePinned = pinnedFields.includes(draggedFieldKey);
    const targetPinned = pinnedFields.includes(fieldKey);
    const boundaryDrop = !sourcePinned && targetPinned && pinnedFields.at(-1) === fieldKey;
    const allowed = sourcePinned === targetPinned || boundaryDrop;
    event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    if (!allowed) return;
    event.preventDefault();
    setDragOverFieldKey(fieldKey);
    if (boundaryDrop) {
      setDropPosition('after');
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropPosition(event.clientX >= bounds.left + bounds.width / 2 ? 'after' : 'before');
  };

  const dropColumn = (event: ReactDragEvent<HTMLElement>, fieldKey: string) => {
    event.preventDefault();
    const source = draggedFieldKey ?? event.dataTransfer.getData('text/plain');
    if (!source || source === fieldKey) return;
    const sourcePinned = pinnedFields.includes(source);
    const targetPinned = pinnedFields.includes(fieldKey);
    const boundaryDrop = !sourcePinned && targetPinned && pinnedFields.at(-1) === fieldKey;
    if (boundaryDrop) {
      const firstUnpinned = visibleFields.find((key) => !pinnedFields.includes(key));
      if (firstUnpinned && source !== firstUnpinned) {
        setVisibleFields((current) => moveOrderedItemAt(current, source, firstUnpinned, 'before'));
      }
      setMessage(`Đã chuyển cột “${CAMPAIGN_GRID_FIELD_BY_KEY[source]?.label ?? source}” vào vị trí đầu tiên sau vùng ghim.`);
      endColumnDrag();
      return;
    }
    if (sourcePinned !== targetPinned) {
      setMessage('Cột ghim luôn nằm ở đầu bảng. Hãy bỏ ghim hoặc ghim cột trước khi đổi qua nhóm này.');
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX >= bounds.left + bounds.width / 2 ? 'after' : dropPosition;
    setVisibleFields((current) => moveOrderedItemAt(current, source, fieldKey, position));
    if (sourcePinned) setPinnedFields((current) => moveOrderedItemAt(current, source, fieldKey, position));
    setMessage(`Đã chuyển cột “${CAMPAIGN_GRID_FIELD_BY_KEY[source]?.label ?? source}”.`);
    endColumnDrag();
  };

  const stopColumnAutoScroll = () => {
    dragScrollVelocity.current = 0;
    dragScrollElement.current = null;
    if (dragScrollFrame.current !== null) {
      window.cancelAnimationFrame(dragScrollFrame.current);
      dragScrollFrame.current = null;
    }
  };

  const runColumnAutoScroll = () => {
    const element = dragScrollElement.current;
    const velocity = dragScrollVelocity.current;
    if (!element || !velocity) {
      dragScrollFrame.current = null;
      return;
    }
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    element.scrollLeft = Math.min(maximum, Math.max(0, element.scrollLeft + velocity));
    dragScrollFrame.current = window.requestAnimationFrame(runColumnAutoScroll);
  };

  const updateColumnAutoScroll = (
    event: ReactDragEvent<HTMLElement>,
    element: HTMLDivElement | null,
    trailingWidth = 0,
  ) => {
    if (!draggedFieldKey || !element) return;
    const bounds = element.getBoundingClientRect();
    const pinnedWidth = 48 + pinnedFields.reduce((sum, key) => (
      sum + (columnWidths[key] ?? CAMPAIGN_GRID_FIELD_BY_KEY[key]?.width ?? 180)
    ), 0);
    const delta = columnDragAutoScrollDelta(
      event.clientX,
      Math.min(bounds.right, bounds.left + pinnedWidth),
      Math.max(bounds.left, bounds.right - trailingWidth),
    );
    if (!delta) {
      stopColumnAutoScroll();
      return;
    }
    event.preventDefault();
    dragScrollElement.current = element;
    dragScrollVelocity.current = delta;
    if (dragScrollFrame.current === null) dragScrollFrame.current = window.requestAnimationFrame(runColumnAutoScroll);
  };

  const endColumnDrag = () => {
    stopColumnAutoScroll();
    setDraggedFieldKey(null);
    setDragOverFieldKey(null);
    setDropPosition('before');
  };

  const beginCellEdit = (row: DisplayRow, definition: CampaignFieldDefinition) => {
    if (trashMode || !canEditField(row, definition)) return;
    if (!autosave.ready) return;
    if (activeCell && (activeCell.rowKey !== row.key || activeCell.fieldKey !== definition.key)) void autosave.save([activeCell.rowKey]);
    editingSnapshot.current = campaignDraftFieldValue(row.draft, definition.key);
    if (row.campaign) startEdit(row.campaign);
    setFocusedGridItem({kind:'cell',rowKey:row.key,fieldKey:definition.key});
    setActiveCell({ rowKey: row.key, fieldKey: definition.key });
  };

  const saveActiveCell = (row: DisplayRow) => { setActiveCell(null); return autosave.save([row.key]); };
  const focusCell = (rowKey: string, fieldKey: string) => {
    if (activeCell && (activeCell.rowKey !== rowKey || activeCell.fieldKey !== fieldKey)) {
      setActiveCell(null); void autosave.save([activeCell.rowKey]);
    }
    setFocusedGridItem({ kind: 'cell', rowKey, fieldKey });
    window.setTimeout(() => { const cell=gridRoot.current?.querySelector<HTMLElement>('[data-campaign-selected-cell="true"]'); if(cell&&!cell.contains(document.activeElement)) cell.focus(); }, 0);
  };
  const moveCell = (rowKey: string, fieldKey: string, key: string, shift = false) => {
    const next = gridDestination(displayRows.findIndex(row => row.key === rowKey), orderedDefinitions.findIndex(col => col.key === fieldKey), displayRows.length, orderedDefinitions.length, key, shift);
    const row = next && displayRows[next.row], column = next && orderedDefinitions[next.column];
    if (row && column) focusCell(row.key, column.key);
  };
  const editorKey = (event: KeyboardEvent, row: DisplayRow, definition: CampaignFieldDefinition, select = false) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelActiveCell(row); return; }
    if (['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !(select && event.key.startsWith('Arrow'))) {
      event.preventDefault(); event.stopPropagation(); void saveActiveCell(row); moveCell(row.key, definition.key, event.key, event.shiftKey);
    }
  };

  const cancelActiveCell = (row: DisplayRow) => {
    if (activeCell) changeDraft(row.key, activeCell.fieldKey, editingSnapshot.current);
    setActiveCell(null);
  };

  const contextTargets = (rowKey: string) => {
    const savedId = campaigns.find((campaign) => campaign.id === rowKey)?.id;
    return savedId ? [savedId] : [];
  };

  const runContextAction = async (action: 'trash' | 'restore' | 'delete', rowKey: string) => {
    const ids = contextTargets(rowKey);
    setContextMenu(null);
    if (!ids.length) return;
    if (action === 'delete') await onDeletePermanently?.(ids);
    if (action === 'trash') await onMoveToTrash?.(ids);
    if (action === 'restore') await onRestore?.(ids);
    setSelected([]);
  };

  const handleGridKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveAll(); return; }
    if ((event.target as Element).closest('input,select,textarea,[contenteditable=true]')) return;
    if (focusedGridItem?.kind !== 'cell') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      const row = displayRows.find(row => row.key === focusedGridItem.rowKey), col = orderedDefinitions.find(col => col.key === focusedGridItem.fieldKey);
      if (row && col) { event.preventDefault(); beginCellEdit(row, col); } return;
    }
    if (['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); moveCell(focusedGridItem.rowKey, focusedGridItem.fieldKey, event.key, event.shiftKey);
    }
  };

  const rowValue = (row: DisplayRow, key: string) => {
    if (key === 'campaign_code') return row.campaign?.code ?? row.edit?.code ?? 'Tự sinh khi lưu';
    if (row.campaign && [
      'campaign_approval_status',
      'campaign_effective_status',
      'requesting_person',
      'department_approver_summary',
      'division_approver_summary',
    ].includes(key)) return campaignGridDisplayValue(row.campaign, key);
    const value = campaignDraftFieldValue(row.draft, key);
    if (key === 'last_updated_at' && !value) return row.campaign?.updatedAt ?? '';
    return value;
  };

  const renderValue = (row: DisplayRow, definition: CampaignFieldDefinition): ReactNode => {
    const value = rowValue(row, definition.key);
    if (definition.key === 'campaign_code' && row.campaign) {
      return <AppLink className="font-mono text-xs font-semibold text-vna-blue hover:underline" to={campaignDetailPath(row.campaign.id)}>{value}</AppLink>;
    }
    if (definition.key === 'campaign_name' && row.campaign) {
      return <AppLink className="font-semibold text-slate-900 underline-offset-4 hover:text-vna-blue hover:underline" to={campaignDetailPath(row.campaign.id)}>{value}</AppLink>;
    }
    if (definition.key === 'campaign_lifecycle_state') {
      const state = row.draft.lifecycleState;
      const label = row.campaign?.qcttStatus ?? CAMPAIGN_STATE_LABELS[state];
      return <div><StatusBadge tone={label === 'Đã phê duyệt' ? 'positive' : statusTone(state)}>{label}</StatusBadge>{row.campaign?.pendingChangeLabel && <p className="mt-1 text-[10px] text-amber-700">{row.campaign.pendingChangeLabel}</p>}</div>;
    }
    if (definition.kind === 'date') return displayDate(value, false);
    if (definition.kind === 'dateTime') return displayDate(value, true);
    if (definition.kind === 'url' && /^https?:\/\//i.test(value)) {
      return <a className="font-semibold text-vna-blue hover:underline" href={value} target="_blank" rel="noreferrer">Mở link ↗</a>;
    }
    return value || '—';
  };

  const canEditField = (row: DisplayRow, definition: CampaignFieldDefinition) => definition.editable && !isProtectedCampaignField(definition.key) &&
    (row.campaign ? row.campaign.access?.editableFields.includes(canonicalCampaignFieldKey(definition.key)) === true : capabilities['campaign.create'] === true);
  const renderEditor = (row: DisplayRow, definition: CampaignFieldDefinition) => {
    const cellActive = activeCell?.rowKey === row.key && activeCell.fieldKey === definition.key;
    const rowWideEdit = Boolean(row.edit?.editing && !activeCell);
    if (!canEditField(row, definition)) return <span title="Chỉ xem · Không có quyền sửa trường này" className="text-slate-600">{renderValue(row, definition)}</span>;
    if (!cellActive && !rowWideEdit) return renderValue(row, definition);
    const value = rowValue(row, definition.key);
    const errorKey = fieldErrorKey(definition.key);
    const hasError = errorKey ? Boolean(row.edit?.fieldErrors[errorKey]) : false;
    if (definition.key === 'campaign_lifecycle_state') {
      return (
        <select
          autoFocus={cellActive}
          className={`${inputClass} ${hasError ? 'border-rose-400 bg-rose-50' : ''}`}
          value={row.draft.lifecycleState}
          onChange={(event) => changeDraft(row.key, definition.key, event.target.value)}
          onKeyDown={event => editorKey(event, row, definition, true)}
        >
          {CAMPAIGN_LIFECYCLE_STATES.map((state) => <option key={state} value={state}>{CAMPAIGN_STATE_LABELS[state]}</option>)}
        </select>
      );
    }
    const type = definition.kind === 'date' ? 'date' : definition.kind === 'dateTime' ? 'datetime-local' : 'text';
    return (
      <input
        autoFocus={cellActive}
        className={`${inputClass} ${hasError ? 'border-rose-400 bg-rose-50' : ''}`}
        type={type}
        value={definition.kind === 'date' || definition.kind === 'dateTime' ? dateInputValue(value, definition.kind === 'dateTime') : value}
        list={definition.referenceList ? `campaign-options-${definition.referenceList}` : undefined}
        onChange={(event) => changeDraft(row.key, definition.key, event.target.value)}
        onFocus={(event) => { if (cellActive && definition.kind === 'text') event.currentTarget.select(); }}
        onKeyDown={event => editorKey(event, row, definition)}
        title={errorKey ? row.edit?.fieldErrors[errorKey] : undefined}
      />
    );
  };

  const pinOffset = (definition: CampaignFieldDefinition) => {
    const index = pinnedFields.indexOf(definition.key);
    if (index < 0) return undefined;
    return 48 + pinnedFields.slice(0, index).reduce((sum, key) => sum + (columnWidths[key] ?? CAMPAIGN_GRID_FIELD_BY_KEY[key]?.width ?? 180), 0);
  };

  const stickyStyle = (definition: CampaignFieldDefinition): CSSProperties => {
    const left = pinOffset(definition);
    return left === undefined ? {} : { position: 'sticky', left, zIndex: 12, width: definition.width, minWidth: definition.width };
  };

  const headerCell = (definition: CampaignFieldDefinition, compact = false) => {
    const active = sortKey === definition.key;
    const filterActive = Boolean(columnFilters[definition.key]);
    const filterable = columnFiltersEnabled && isCampaignColumnFilterable(definition);
    const nextDirection = active && sortDirection === 'asc' ? 'desc' : 'asc';
    const hint = sortDirectionLabel(definition, nextDirection);
    return (
      <div className="flex w-full items-center gap-1">
        <button
          type="button"
          draggable={false}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left font-semibold hover:text-vna-blue"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onSort(definition.key); }}
          title={`Sắp xếp ${hint}`}
          aria-label={`Sắp xếp ${definition.label}: ${hint}`}
        >
          <span className={compact ? 'truncate' : ''}>{definition.label}</span>
          <span className={active ? 'text-vna-blue' : 'text-slate-300'}>{active ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
        {filterable ? <button
          type="button"
          draggable={false}
          aria-label={`${filterActive ? 'Sửa' : 'Mở'} bộ lọc cột ${definition.label}`}
          aria-pressed={filterActive}
          className={`grid size-7 shrink-0 place-items-center rounded-md transition ${filterActive ? 'bg-cyan-100 text-vna-blue' : 'text-slate-400 hover:bg-white hover:text-vna-blue'}`}
          title={filterActive ? 'Đang lọc cột này' : 'Lọc cột này'}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setColumnFilterMenu({ fieldKey: definition.key, anchor: { left: rect.left, top: rect.bottom + 6 } });
          }}
        ><CpmsIcon name="filter" size={16} /></button> : null}
      </div>
    );
  };

  if (loading && !campaigns.length) return <LoadingBlock label="Đang đồng bộ chiến dịch từ PostgreSQL…" />;

  return (
    <div ref={gridRoot} className="relative" data-campaign-grid onKeyDown={handleGridKeys}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {!trashMode ? <>
            <select className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" aria-label="Số dòng mới sẽ thêm" title="Chọn số dòng trống sẽ được thêm khi bấm nút bên cạnh" value={addCount} onChange={(event) => setAddCount(Number(event.target.value))}>
              {[1, 3, 5, 10, 20].map((count) => <option key={count} value={count}>{count} dòng mới</option>)}
            </select>
            <Button size="sm" onClick={addBlankRows} disabled={!capabilities['campaign.create']} title={!capabilities['campaign.create'] ? 'Cần quyền tạo Campaign' : undefined}><CpmsIcon name="add" />Thêm {addCount} dòng</Button>
            <Button size="sm" variant="secondary" onClick={() => { setActiveCell(null); editSelected(); }} disabled={!selectedSavedIds.length || selectedSavedIds.some((id) => !campaigns.find((campaign) => campaign.id === id)?.access?.canEditAnyField)}>Sửa dòng chọn</Button>
            <Button size="sm" variant="secondary" onClick={duplicateSelected} disabled={!selected.length || !capabilities['campaign.create']}>Nhân bản</Button>
            <Button size="sm" variant="ghost" onClick={resetSelected} disabled={!selectedDirtyCount}>Hoàn tác chọn</Button>
          </> : <span className="text-xs font-semibold text-slate-600">Các dòng trong Thùng rác chỉ có thể phục hồi hoặc xóa vĩnh viễn.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={columnFiltersEnabled ? 'secondary' : 'ghost'}
            className={columnFiltersEnabled ? 'border-cyan-200 bg-cyan-50 text-vna-blue' : ''}
            aria-pressed={columnFiltersEnabled}
            onClick={() => onColumnFiltersEnabledChange(!columnFiltersEnabled)}
            title="Hiện hoặc ẩn bộ lọc tại tiêu đề cột"
          >
            <CpmsIcon name="filter" />
            {columnFiltersEnabled ? 'Tắt bộ lọc' : 'Bật bộ lọc'}
            {Object.keys(columnFilters).length ? <span className="rounded-full bg-vna-blue px-1.5 py-0.5 text-[10px] text-white">{Object.keys(columnFilters).length}</span> : null}
          </Button>
          {columnFiltersEnabled && Object.keys(columnFilters).length ? <Button size="sm" variant="ghost" onClick={() => onColumnFiltersChange({})}>Xóa lọc cột</Button> : null}
          <button
            type="button"
            ref={columnChooser}
            className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-vna-blue/40"
            aria-expanded={columnChooserOpen}
            aria-controls={columnChooserOpen ? columnChooserId : undefined}
            aria-haspopup="dialog"
            onClick={() => columnChooserOpen ? closeColumnChooser() : openColumnChooser()}
          >
            Cột hiển thị <span className="rounded-full bg-slate-100 px-2 py-0.5">{visibleFields.length}</span>
          </button>
          {columnChooserOpen && createPortal(
            <div ref={columnChooserPanel} id={columnChooserId} role="dialog" aria-label="Cột hiển thị" style={columnChooserPosition} className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-panel" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); closeColumnChooser(); } }}>
              <div className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <p className="text-sm font-semibold text-slate-800">Cột hiển thị</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={closeColumnChooser}>Hủy</Button>
                  <Button size="sm" onClick={applyColumnChooser} disabled={!draftVisibleFields.length}>Áp dụng</Button>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-vna-blue" type="search" aria-label="Tìm cột hiển thị" placeholder="Tìm theo tên cột dễ hiểu…" value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} />
                <button type="button" className="shrink-0 text-xs font-semibold text-vna-blue" onClick={() => { setDraftVisibleFields([...DEFAULT_CAMPAIGN_VISIBLE_FIELDS]); setDraftPinnedFields(['campaign_code', 'campaign_name']); }}>Mặc định</button>
              </div>
              <p className="mt-2 shrink-0 text-[10px] text-slate-500">Có thể ghim tối đa 3 cột.</p>
              <div className="mt-3 min-h-0 space-y-3 overflow-auto overscroll-contain pr-1">
                {Array.from(new Set(CAMPAIGN_GRID_FIELD_DEFINITIONS.map((definition) => definition.group))).map((group) => {
                  const normalized = columnQuery.trim().toLocaleLowerCase('vi');
                  const definitions = CAMPAIGN_GRID_FIELD_DEFINITIONS.filter((definition) => definition.group === group && (!normalized || definition.label.toLocaleLowerCase('vi').includes(normalized)));
                  if (!definitions.length) return null;
                  return (
                    <section key={group}>
                      <p className="sticky top-0 bg-white px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-vna-gold-dark">{group}</p>
                      {definitions.map((definition) => (
                        <div key={definition.key} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-slate-700">
                            <input type="checkbox" checked={draftVisibleFields.includes(definition.key)} onChange={() => toggleVisibleField(definition.key)} />
                            <span className="truncate">{definition.label}</span>
                          </label>
                          <button className={`rounded-md px-2 py-1 text-[10px] font-semibold ${draftPinnedFields.includes(definition.key) ? 'bg-cyan-50 text-vna-blue' : 'text-slate-400 hover:bg-slate-100'}`} onClick={() => togglePinnedField(definition.key)}>
                            {draftPinnedFields.includes(definition.key) ? 'Đã ghim' : 'Ghim'}
                          </button>
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            </div>
          , document.body)}
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button className={`rounded-md px-3 py-1.5 text-xs font-semibold ${viewMode === 'table' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => { setFocusedGridItem(null); setViewMode('table'); }}>Bảng</button>
            <button className={`rounded-md px-3 py-1.5 text-xs font-semibold ${viewMode === 'timeline' ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-500'}`} onClick={() => { setFocusedGridItem(null); setViewMode('timeline'); }}>Timeline</button>
          </div>
          {viewMode === 'timeline' ? (
            <select className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" aria-label="Khung thời gian Timeline" value={zoom} onChange={(event) => setZoom(event.target.value as TimelineZoom)}>
              <option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option><option value="quarter">Quý</option><option value="year">Năm</option>
            </select>
          ) : null}
          {!trashMode ? <>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${dirtyRows.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{dirtyRows.length ? `${dirtyRows.length} dòng chưa lưu` : 'Không có thay đổi'}</span>
            <Button size="sm" variant="secondary" onClick={discardAll} disabled={!dirtyRows.length || saving}>Bỏ thay đổi</Button>
            <span role="status" className="text-xs text-slate-600">{autosave.status || "Enter / Tab / Arrow để lưu ô"}</span><Button size="sm" variant="ghost" onClick={() => void saveAll()} disabled={!dirtyRows.length || saving}>Thử lưu lại</Button>
          </> : null}
        </div>
      </div>

      {selected.length && !trashMode ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-100 bg-cyan-50/80 px-5 py-3">
          <div className="flex items-center gap-3"><span className="inline-flex size-8 items-center justify-center rounded-full bg-vna-blue text-xs font-bold text-white">{selected.length}</span><div><p className="text-sm font-semibold text-vna-blue-deep">Chiến dịch đã chọn</p><p className="text-xs text-slate-500">Tối đa 50 dòng mỗi thao tác</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Bỏ chọn</Button>
          </div>
        </div>
      ) : null}

      {message ? <div className="border-b border-slate-100 bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-900" role="status">{message}</div> : null}

      {viewMode === 'table' ? (
        <div
          ref={tableScrollViewport}
          className="min-h-[420px] overflow-x-auto bg-white"
          data-campaign-grid-scroll="table"
          data-campaign-grid-surface
          onDragOver={(event) => updateColumnAutoScroll(event, tableScrollViewport.current, 96)}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest('thead, tbody tr')) return;
            event.preventDefault();
            setContextMenu({ kind: 'empty', x: event.clientX, y: event.clientY });
          }}
        >
          <table className="border-separate border-spacing-0 text-left text-xs" style={{ minWidth: 48 + orderedDefinitions.reduce((sum, definition) => sum + (definition.width ?? 180), 0) + 100 }}>
            <thead className="sticky top-0 z-20 bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-30 w-12 min-w-12 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-center"><input type="checkbox" aria-label="Chọn tất cả dòng đang hiển thị" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
                {orderedDefinitions.map((definition) => (
                  <th
                    key={definition.key}
                    className={`relative cursor-grab select-none border-b border-r border-slate-200 px-3 py-3 transition active:cursor-grabbing ${dragOverFieldKey === definition.key && draggedFieldKey !== definition.key ? `bg-cyan-50 ${dropPosition === 'before' ? 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-vna-blue' : 'after:absolute after:inset-y-0 after:right-0 after:w-1 after:bg-vna-blue'}` : 'bg-slate-50'} ${draggedFieldKey === definition.key ? 'opacity-55' : ''} ${pinnedFields.includes(definition.key) ? 'shadow-[2px_0_0_#e2e8f0]' : ''}`}
                    style={{ width: definition.width, minWidth: definition.width, ...stickyStyle(definition) }}
                    draggable
                    data-campaign-column={definition.key}
                    data-pinned={pinnedFields.includes(definition.key) ? 'true' : 'false'}
                    title={`Kéo để đổi vị trí cột ${definition.label}${pinnedFields.includes(definition.key) ? ' trong nhóm cột ghim' : ''}`}
                    onDragStart={(event) => startColumnDrag(event, definition.key)}
                    onDragOver={(event) => dragOverColumn(event, definition.key)}
                    onDrop={(event) => dropColumn(event, definition.key)}
                    onDragEnd={endColumnDrag}
                    onContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: 'column', x: event.clientX, y: event.clientY, fieldKey: definition.key }); }}
                  >
                    {headerCell(definition)}
                    <button type="button" draggable={false} data-column-resize aria-label={`Kéo để đổi độ rộng cột ${definition.label}`} className="absolute inset-y-0 right-0 z-30 w-2 translate-x-1/2 cursor-col-resize touch-none hover:bg-cyan-300/50" onPointerDown={(event) => startColumnResize(event, definition)} />
                  </th>
                ))}
                <th className="sticky right-0 z-20 w-24 min-w-24 border-b border-slate-200 bg-slate-50 px-3 py-3 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {!trashMode && formDrafts.map((draft) => <tr key={`form-draft-${draft.id}`} className="bg-amber-50/70">
                <td className="border-b border-amber-100 px-3 py-3" />
                <td colSpan={orderedDefinitions.length + 1} className="border-b border-amber-100 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Bản nháp đang nhập · chỉ bạn nhìn thấy</span><span className="ml-3 font-semibold text-slate-800">{draft.title || 'Chưa đặt tên chiến dịch'}</span></div>
                    <AppLink className="text-xs font-semibold text-vna-blue hover:underline" to={`/campaigns/new?draft=${encodeURIComponent(draft.id)}`}>Tiếp tục nhập</AppLink>
                  </div>
                </td>
              </tr>)}
              {displayRows.map((row) => {
                const contextHighlighted = contextMenu?.kind === 'row' && contextMenu.rowKey === row.key;
                const rowBackground = row.edit?.error ? '#fff1f2' : contextHighlighted ? '#dbeafe' : selected.includes(row.key) ? '#ecfeff' : row.edit && dirty(row.edit) ? '#fffbeb' : undefined;
                return (
                  <tr
                    key={row.key}
                    data-campaign-row
                    className="group bg-white transition-colors hover:bg-cyan-50/80"
                    style={{
                      backgroundColor: rowBackground,
                      boxShadow: contextHighlighted ? 'inset 4px 0 0 #0284c7, inset 0 1px 0 #bae6fd, inset 0 -1px 0 #bae6fd' : undefined,
                    }}
                    onContextMenu={(event) => { if (!row.campaign) return; event.preventDefault(); setContextMenu({ kind: 'row', x: event.clientX, y: event.clientY, rowKey: row.key }); }}
                  >
                    <td className="sticky left-0 z-20 border-b border-r border-slate-100 bg-white px-3 py-2 text-center transition-colors group-hover:bg-cyan-50" style={{ backgroundColor: rowBackground }}><input type="checkbox" aria-label={`Chọn ${rowValue(row, 'campaign_code')}`} checked={selected.includes(row.key)} onChange={() => toggleSelected(row.key)} /></td>
                    {orderedDefinitions.map((definition) => <td tabIndex={0} key={definition.key} data-campaign-selected-cell={focusedGridItem?.kind === 'cell' && focusedGridItem.rowKey === row.key && focusedGridItem.fieldKey === definition.key ? 'true' : undefined} className={`h-[58px] max-w-0 border-b border-r border-slate-100 px-3 py-2 text-slate-700 transition-colors group-hover:bg-cyan-50 ${pinnedFields.includes(definition.key) ? 'bg-white' : ''} ${focusedGridItem?.kind === 'cell' && focusedGridItem.rowKey === row.key && focusedGridItem.fieldKey === definition.key ? 'ring-2 ring-inset ring-vna-blue' : ''}`} style={{ width: definition.width, minWidth: definition.width, backgroundColor: pinnedFields.includes(definition.key) ? rowBackground : undefined, ...stickyStyle(definition) }} onClick={() => focusCell(row.key, definition.key)} onDoubleClick={() => beginCellEdit(row, definition)}><div className="truncate" title={typeof renderValue(row, definition) === 'string' ? String(renderValue(row, definition)) : undefined}>{renderEditor(row, definition)}</div></td>)}
                    <td className="sticky right-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-right transition-colors group-hover:bg-cyan-50" style={{ backgroundColor: rowBackground }}>
                      {trashMode && row.campaign ? <button className="text-xs font-semibold text-vna-blue" onClick={() => navigate(campaignDetailPath(row.campaign!.id))}>Xem</button> : row.edit?.editing ? <div className="flex justify-end gap-1"><button className="text-xs font-semibold text-vna-blue" onClick={() => { finishEditing(row.key); void autosave.save([row.key]); }}>Xong</button><button className="text-xs text-slate-500" onClick={() => cancelRow(row.key)}>Hủy</button></div> : <button disabled={!row.campaign?.access?.canEditAnyField} title={row.campaign?.access?.canEditAnyField ? "Sửa trường được phép" : "Chỉ xem"} className="text-xs font-semibold text-vna-blue disabled:text-slate-400" onClick={() => { setActiveCell(null); if (row.campaign) startEdit(row.campaign); }}>Sửa</button>}
                      {row.edit?.error ? <p className="mt-1 max-w-52 text-[10px] text-rose-700" title={row.edit.error}>{row.edit.error}</p> : null}
                    </td>
                  </tr>
                );
              })}
              {!loading && !displayRows.length && !formDrafts.length ? <tr><td className="px-6 py-14 text-center text-slate-500" colSpan={orderedDefinitions.length + 2}>Không có chiến dịch phù hợp với bộ lọc hiện tại.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : (
        <>
        {!trashMode && formDrafts.map((draft) => <div key={draft.id} className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm"><span><strong>Bản nháp đang nhập:</strong> {draft.title || 'Chưa đặt tên chiến dịch'}</span><AppLink to={`/campaigns/new?draft=${encodeURIComponent(draft.id)}`} className="font-semibold text-vna-blue">Tiếp tục nhập</AppLink></div>)}
        <TimelineSplitView
          rows={displayRows}
          definitions={orderedDefinitions}
          pinnedFields={pinnedFields}
          revealFieldKey={revealTimelineField}
          selected={selected}
          zoom={zoom}
          highlightedRowKey={contextMenu?.kind === 'row' ? contextMenu.rowKey : null}
          allVisibleSelected={allVisibleSelected}
          onToggleAll={toggleAllVisible}
          onToggleSelected={toggleSelected}
          onSort={onSort}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onBeginCellEdit={beginCellEdit}
          focusedGridItem={focusedGridItem}
          onFocusGridItem={item => item?.kind === 'cell' ? focusCell(item.rowKey, item.fieldKey) : setFocusedGridItem(item)}
          onRowContextMenu={(event, row) => { if (!row.campaign) return; event.preventDefault(); setContextMenu({ kind: 'row', x: event.clientX, y: event.clientY, rowKey: row.key }); }}
          onEmptyContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: 'empty', x: event.clientX, y: event.clientY }); }}
          onColumnContextMenu={(event, definition) => { event.preventDefault(); setContextMenu({ kind: 'column', x: event.clientX, y: event.clientY, fieldKey: definition.key }); }}
          draggedFieldKey={draggedFieldKey}
          dragOverFieldKey={dragOverFieldKey}
          dropPosition={dropPosition}
          onColumnDragStart={startColumnDrag}
          onColumnDragOver={dragOverColumn}
          onColumnDrop={dropColumn}
          onColumnDragEnd={endColumnDrag}
          onColumnDragAutoScroll={updateColumnAutoScroll}
          onStartColumnResize={startColumnResize}
          renderEditor={renderEditor}
          renderValue={renderValue}
          rowValue={rowValue}
          stickyStyle={stickyStyle}
          headerCell={headerCell}
        />
        </>
      )}

      {loading ? <div className="absolute inset-0 z-40 grid place-items-center bg-white/70 backdrop-blur-[1px]"><div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-panel"><span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" />Đang đồng bộ chiến dịch…</div></div> : null}

      {columnFilterMenu && CAMPAIGN_GRID_FIELD_BY_KEY[columnFilterMenu.fieldKey] ? <CampaignColumnFilterMenu
        key={columnFilterMenu.fieldKey}
        definition={CAMPAIGN_GRID_FIELD_BY_KEY[columnFilterMenu.fieldKey]!}
        campaigns={filterSourceCampaigns}
        filters={columnFilters}
        anchor={columnFilterMenu.anchor}
        onApply={(filter) => {
          onColumnFiltersChange({ ...columnFilters, [columnFilterMenu.fieldKey]: filter });
          setColumnFilterMenu(null);
        }}
        onClear={() => {
          const nextFilters = { ...columnFilters };
          delete nextFilters[columnFilterMenu.fieldKey];
          onColumnFiltersChange(nextFilters);
          setColumnFilterMenu(null);
        }}
        onClose={() => setColumnFilterMenu(null)}
      /> : null}

      {contextMenu ? (
        <div
          className="fixed z-[100] min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-sm shadow-panel"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 340) }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === 'empty' ? <>
            <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50 disabled:text-slate-400" disabled={!capabilities['campaign.create']} onClick={() => { setContextMenu(null); navigate('/campaigns/new'); }}>Thêm chiến dịch mới</button>
            <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:text-slate-400" disabled={trashMode || !capabilities['campaign.create']} onClick={() => { setContextMenu(null); addBlankRows(); }}>Thêm dòng mới</button>
            <div className="my-1 border-t border-slate-100" />
            <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); onRefresh?.(); }}>Làm mới</button>
          </> : contextMenu.kind === 'column' ? (() => {
            const pinned = pinnedFields.includes(contextMenu.fieldKey);
            return <>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50"
                onClick={() => pinned ? unpinColumn(contextMenu.fieldKey) : pinColumn(contextMenu.fieldKey)}
              >
                {pinned ? 'Bỏ ghim cột' : 'Ghim cột'}
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => hideColumn(contextMenu.fieldKey)}>Xóa cột khỏi bảng hiển thị</button>
            </>;
          })() : (() => {
            const campaign = campaigns.find((item) => item.id === contextMenu.rowKey);
            if (!campaign) return null;
            return <>
              <button type="button" className="block w-full px-4 py-2 text-left font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => { setContextMenu(null); navigate(campaignDetailPath(campaign.id)); }}>Xem/Sửa thông tin</button>
              <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); setSelected([campaign.id]); onViewConversation?.(campaign.id); }}>Bình luận</button>
              <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={() => { setContextMenu(null); setSelected([campaign.id]); onViewJournal?.(campaign.id); }}>Xem lịch sử</button>
              {!trashMode ? <>
                <button type="button" className="block w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50" disabled={!capabilities['campaign.create']} onClick={() => { setContextMenu(null); duplicateRows([campaign.id]); }}>Nhân bản</button>
                {campaign.operationalState !== 'CANCELLED' && onLifecycleAction ? <button type="button" className="block w-full px-4 py-2 text-left text-amber-800 hover:bg-amber-50" onClick={() => { setContextMenu(null); void onLifecycleAction(campaign.id, campaign.operationalState === 'PAUSED' ? 'resume' : 'pause'); }}>{campaign.operationalState === 'PAUSED' ? 'Nối lại' : 'Tạm dừng'}</button> : null}
                <button type="button" className="block w-full px-4 py-2 text-left text-rose-700 hover:bg-rose-50" onClick={() => { setContextMenu(null); void onLifecycleAction?.(campaign.id, 'cancel'); }}>Xóa</button>
              </> : (
                <button type="button" className="block w-full px-4 py-2 text-left text-emerald-700 hover:bg-emerald-50" disabled={!campaign.access?.permissions['campaign.restore']} onClick={() => void runContextAction('restore', contextMenu.rowKey)}>Khôi phục</button>
              )}
              <div className="my-1 border-t border-slate-100" />
              <button type="button" className="block w-full px-4 py-2 text-left font-semibold text-rose-800 hover:bg-rose-50" disabled={!campaign.access?.permissions['campaign.purge']} onClick={() => void runContextAction('delete', contextMenu.rowKey)}>Xóa vĩnh viễn</button>
            </>;
          })()}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-500"><span>{displayRows.length} dòng đang hiển thị{trashMode ? ' trong Thùng rác' : ' · chỉnh sửa và lưu tối đa 50 dòng/lần'}</span><span>{trashMode ? 'Nhấp chuột phải để phục hồi hoặc xóa vĩnh viễn' : 'Nhấp đúp ô để sửa · Enter lưu ô · Esc hủy · Tab / Arrow chuyển ô và lưu'}</span></div>
      {Object.entries(CAMPAIGN_REFERENCE_OPTIONS).map(([list, listOptions]) => <datalist key={list} id={`campaign-options-${list}`}>{listOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>)}
    </div>
  );
}

interface TimelineSplitViewProps {
  rows: DisplayRow[];
  definitions: CampaignFieldDefinition[];
  pinnedFields: string[];
  revealFieldKey: string | null;
  selected: string[];
  zoom: TimelineZoom;
  highlightedRowKey: string | null;
  allVisibleSelected: boolean;
  sortKey: string;
  sortDirection: CampaignSortDirection;
  onToggleAll(): void;
  onToggleSelected(key: string): void;
  onSort(key: string): void;
  onBeginCellEdit(row: DisplayRow, definition: CampaignFieldDefinition): void;
  focusedGridItem: FocusedGridItem | null;
  onFocusGridItem(item: FocusedGridItem): void;
  onRowContextMenu(event: ReactMouseEvent<HTMLElement>, row: DisplayRow): void;
  onEmptyContextMenu(event: ReactMouseEvent<HTMLElement>): void;
  onColumnContextMenu(event: ReactMouseEvent<HTMLDivElement>, definition: CampaignFieldDefinition): void;
  draggedFieldKey: string | null;
  dragOverFieldKey: string | null;
  dropPosition: ColumnDropPosition;
  onColumnDragStart(event: ReactDragEvent<HTMLElement>, fieldKey: string): void;
  onColumnDragOver(event: ReactDragEvent<HTMLElement>, fieldKey: string): void;
  onColumnDrop(event: ReactDragEvent<HTMLElement>, fieldKey: string): void;
  onColumnDragEnd(): void;
  onColumnDragAutoScroll(event: ReactDragEvent<HTMLElement>, element: HTMLDivElement | null, trailingWidth?: number): void;
  onStartColumnResize(event: ReactPointerEvent<HTMLButtonElement>, definition: CampaignFieldDefinition): void;
  renderEditor(row: DisplayRow, definition: CampaignFieldDefinition): ReactNode;
  renderValue(row: DisplayRow, definition: CampaignFieldDefinition): ReactNode;
  rowValue(row: DisplayRow, key: string): string;
  stickyStyle(definition: CampaignFieldDefinition): CSSProperties;
  headerCell(definition: CampaignFieldDefinition, compact?: boolean): ReactNode;
}

function TimelineSplitView({
  rows,
  definitions,
  pinnedFields,
  revealFieldKey,
  selected,
  zoom,
  highlightedRowKey,
  allVisibleSelected,
  onToggleAll,
  onToggleSelected,
  onBeginCellEdit,
  focusedGridItem,
  onFocusGridItem,
  onRowContextMenu,
  onEmptyContextMenu,
  onColumnContextMenu,
  draggedFieldKey,
  dragOverFieldKey,
  dropPosition,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDrop,
  onColumnDragEnd,
  onColumnDragAutoScroll,
  onStartColumnResize,
  renderEditor,
  rowValue,
  stickyStyle,
  headerCell,
}: TimelineSplitViewProps) {
  const [leftPanelPercent, setLeftPanelPercent] = useState(52);
  const splitContainer = useRef<HTMLDivElement>(null);
  const leftScrollViewport = useRef<HTMLDivElement>(null);
  const scale = useMemo(() => {
    const dates = rows.flatMap((row) => [utcDate(row.draft.startDate), utcDate(row.draft.endDate)]).filter((value): value is Date => Boolean(value));
    const now = new Date();
    const fallbackStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const fallbackEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    const minimum = dates.length ? new Date(Math.min(...dates.map((date) => date.valueOf()))) : fallbackStart;
    const maximum = dates.length ? new Date(Math.max(...dates.map((date) => date.valueOf()))) : fallbackEnd;
    const start = startOfTimelineUnit(minimum, zoom);
    const end = nextTimelineUnit(startOfTimelineUnit(maximum, zoom), zoom);
    const totalDays = Math.max(1, Math.ceil((end.valueOf() - start.valueOf()) / 86_400_000));
    const pixelsPerDay = { day: 46, week: 10, month: 3.2, quarter: 1.5, year: 0.65 }[zoom];
    const width = Math.max(900, Math.ceil(totalDays * pixelsPerDay));
    const ticks = [];
    for (let tick = new Date(start); tick < end; tick = nextTimelineUnit(tick, zoom)) {
      const next = nextTimelineUnit(tick, zoom);
      ticks.push({
        key: tick.toISOString(),
        label: timelineLabel(tick, zoom),
        date: new Date(tick),
        left: ((tick.valueOf() - start.valueOf()) / (end.valueOf() - start.valueOf())) * width,
        width: ((next.valueOf() - tick.valueOf()) / (end.valueOf() - start.valueOf())) * width,
      });
    }
    const monthGroups = zoom === 'day' ? timelineMonthGroups(ticks.map((tick) => ({ date: tick.date, left: tick.left, width: tick.width }))) : [];
    return { start, end, width, ticks, monthGroups };
  }, [rows, zoom]);

  const leftWidth = 48 + definitions.reduce((sum, definition) => sum + (definition.width ?? 180), 0);
  const timelinePinnedKey = pinnedFields[0];
  const timelinePinnedWidth = 48 + (definitions.find((definition) => definition.key === timelinePinnedKey)?.width ?? 0);
  useLayoutEffect(() => {
    const viewport = leftScrollViewport.current;
    const index = definitions.findIndex((definition) => definition.key === revealFieldKey);
    if (!viewport || index < 0) return;
    const columnLeft = 48 + definitions.slice(0, index).reduce((sum, definition) => sum + (definition.width ?? 180), 0);
    viewport.scrollLeft = timelineColumnRevealScrollLeft({
      currentScrollLeft: viewport.scrollLeft,
      viewportWidth: viewport.clientWidth,
      contentWidth: viewport.scrollWidth,
      columnLeft,
      columnWidth: definitions[index]?.width ?? 180,
      pinnedWidth: definitions[index]?.key === timelinePinnedKey ? 48 : timelinePinnedWidth,
    });
  }, [definitions, revealFieldKey, timelinePinnedKey, timelinePinnedWidth]);
  const scrollInformationColumns = (direction: -1 | 1) => {
    const viewport = leftScrollViewport.current;
    if (viewport) viewport.scrollLeft += direction * Math.max(180, viewport.clientWidth - timelinePinnedWidth - 24);
  };
  const position = (value: Date) => ((value.valueOf() - scale.start.valueOf()) / (scale.end.valueOf() - scale.start.valueOf())) * scale.width;
  const today = position(new Date());

  const startPanelResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const bounds = splitContainer.current?.getBoundingClientRect();
    if (!bounds) return;
    const move = (pointer: PointerEvent) => {
      const percent = ((pointer.clientX - bounds.left) / bounds.width) * 100;
      setLeftPanelPercent(Math.min(70, Math.max(35, percent)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
      <span>Thông tin Chiến dịch · {definitions.length} cột · cuộn ngang để xem thêm</span>
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => scrollInformationColumns(-1)}>Cột trước</button>
        <button type="button" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => scrollInformationColumns(1)}>Cột tiếp</button>
      </div>
    </div>
    <div ref={splitContainer} data-campaign-grid-surface className="relative grid min-h-[420px] min-w-[1120px] divide-x divide-slate-200" style={{ gridTemplateColumns: `${leftPanelPercent}% minmax(520px, 1fr)` }} onContextMenu={(event) => {
      if ((event.target as HTMLElement).closest('[data-campaign-grid-header], [data-campaign-row]')) return;
      onEmptyContextMenu(event);
    }}>
      <button type="button" aria-label="Thay đổi độ rộng hai panel" className="absolute inset-y-0 z-40 w-2 -translate-x-1/2 cursor-col-resize bg-transparent hover:bg-cyan-200/60" style={{ left: `${leftPanelPercent}%` }} onPointerDown={startPanelResize} />
      <div
        ref={leftScrollViewport}
        className="overflow-x-auto bg-white"
        data-campaign-grid-scroll="timeline"
        onDragOver={(event) => onColumnDragAutoScroll(event, leftScrollViewport.current)}
      >
        <div style={{ minWidth: leftWidth }}>
          <div data-campaign-grid-header className="grid h-16 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns: `48px ${definitions.map((definition) => `${definition.width ?? 180}px`).join(' ')}` }}>
            <div className="sticky left-0 z-30 grid place-items-center border-r border-slate-200 bg-slate-50"><input type="checkbox" aria-label="Chọn tất cả dòng đang hiển thị" checked={allVisibleSelected} onChange={onToggleAll} /></div>
            {definitions.map((definition) => <div key={definition.key} data-campaign-column={definition.key} data-pinned={definition.key === timelinePinnedKey ? 'true' : 'false'} className={`relative flex cursor-grab select-none items-center border-r border-slate-200 px-3 transition active:cursor-grabbing ${dragOverFieldKey === definition.key && draggedFieldKey !== definition.key ? `bg-cyan-50 ${dropPosition === 'before' ? 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-vna-blue' : 'after:absolute after:inset-y-0 after:right-0 after:w-1 after:bg-vna-blue'}` : 'bg-slate-50'} ${draggedFieldKey === definition.key ? 'opacity-55' : ''}`} style={definition.key === timelinePinnedKey ? { ...stickyStyle(definition), zIndex: 22 } : undefined} draggable title={`Kéo để đổi vị trí cột ${definition.label}${pinnedFields.includes(definition.key) ? ' trong nhóm cột ghim' : ''}`} onDragStart={(event) => onColumnDragStart(event, definition.key)} onDragOver={(event) => onColumnDragOver(event, definition.key)} onDrop={(event) => onColumnDrop(event, definition.key)} onDragEnd={onColumnDragEnd} onContextMenu={(event) => onColumnContextMenu(event, definition)}>{headerCell(definition, true)}<button type="button" draggable={false} data-column-resize aria-label={`Kéo để đổi độ rộng cột ${definition.label}`} className="absolute inset-y-0 right-0 z-30 w-2 translate-x-1/2 cursor-col-resize touch-none hover:bg-cyan-300/50" onPointerDown={(event) => onStartColumnResize(event, definition)} /></div>)}
          </div>
          {rows.map((row) => {
            const contextHighlighted = highlightedRowKey === row.key;
            const background = row.edit?.error ? '#fff1f2' : contextHighlighted ? '#dbeafe' : selected.includes(row.key) ? '#ecfeff' : row.edit && dirty(row.edit) ? '#fffbeb' : undefined;
            return (
              <div key={row.key} data-campaign-row className="group grid h-[52px] border-b border-slate-100 bg-white text-xs transition-colors hover:bg-cyan-50/80" style={{ gridTemplateColumns: `48px ${definitions.map((definition) => `${definition.width ?? 180}px`).join(' ')}`, backgroundColor: background, boxShadow: contextHighlighted ? 'inset 4px 0 0 #0284c7, inset 0 1px 0 #bae6fd, inset 0 -1px 0 #bae6fd' : undefined }} onContextMenu={(event) => onRowContextMenu(event, row)}>
                <div className="sticky left-0 z-20 grid place-items-center border-r border-slate-100 bg-white transition-colors group-hover:bg-cyan-50" style={{ backgroundColor: background }}><input type="checkbox" aria-label={`Chọn ${rowValue(row, 'campaign_code')}`} checked={selected.includes(row.key)} onChange={() => onToggleSelected(row.key)} /></div>
                {definitions.map((definition) => <div tabIndex={0} key={definition.key} data-campaign-selected-cell={focusedGridItem?.kind === 'cell' && focusedGridItem.rowKey === row.key && focusedGridItem.fieldKey === definition.key ? 'true' : undefined} className={`flex min-w-0 items-center border-r border-slate-100 px-3 text-slate-700 transition-colors group-hover:bg-cyan-50 ${definition.key === timelinePinnedKey ? 'bg-white' : ''} ${focusedGridItem?.kind === 'cell' && focusedGridItem.rowKey === row.key && focusedGridItem.fieldKey === definition.key ? 'ring-2 ring-inset ring-vna-blue' : ''}`} style={{ ...(definition.key === timelinePinnedKey ? stickyStyle(definition) : {}), backgroundColor: definition.key === timelinePinnedKey ? background : undefined }} onClick={() => onFocusGridItem({ kind: 'cell', rowKey: row.key, fieldKey: definition.key })} onDoubleClick={() => onBeginCellEdit(row, definition)}><div className="w-full truncate">{renderEditor(row, definition)}</div></div>)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto bg-white" aria-label={`Timeline theo ${zoom}`}>
        <div className="relative" style={{ width: scale.width, minWidth: scale.width }}>
          <div data-campaign-grid-header className="relative h-16 border-b border-slate-200 bg-slate-50">
            {zoom === 'day' ? <>
              <div className="absolute inset-x-0 top-0 h-6 border-b border-slate-300 bg-slate-100/80">
                {scale.monthGroups.map((group) => <div key={group.key} className="absolute inset-y-0 flex items-center border-l-2 border-slate-400 px-2 text-[10px] font-bold text-slate-700" style={{ left: group.left, width: group.width }}>{group.label}</div>)}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-10">
                {scale.ticks.map((tick) => { const header = timelineDayHeader(tick.date); return <div key={tick.key} role="columnheader" tabIndex={0} title={header.tooltip} aria-label={header.tooltip} className={`absolute inset-y-0 flex flex-col items-center justify-center border-r border-slate-200 text-[10px] font-semibold leading-4 text-slate-700 ${header.isWeekend ? 'bg-slate-200/60' : 'bg-slate-50'} ${header.isMonthStart ? 'border-l-2 border-l-slate-400' : ''}`} style={{ left: tick.left, width: tick.width }}><span className="text-[11px] font-bold">{header.day}</span><span className="text-slate-500">{header.weekday}</span></div>; })}
              </div>
            </> : scale.ticks.map((tick) => <div key={tick.key} className="absolute inset-y-0 flex items-center border-l border-slate-300 px-2 text-[10px] font-semibold text-slate-600" style={{ left: tick.left, width: tick.width }}><span className="truncate">{tick.label}</span></div>)}
          </div>
          {rows.map((row) => {
            const start = utcDate(row.draft.startDate);
            const end = utcDate(row.draft.endDate);
            const valid = start && end && end >= start;
            const barLeft = valid ? position(start) : 0;
            const barWidth = valid ? Math.max(8, position(addUtcDays(end, 1)) - barLeft) : 0;
            return (
              <div key={row.key} data-campaign-row className={`relative h-[52px] border-b border-slate-100 ${selected.includes(row.key) ? 'bg-cyan-50/60' : ''}`}>
                {scale.ticks.map((tick) => { const header = zoom === 'day' ? timelineDayHeader(tick.date) : null; return <span key={tick.key} className={`absolute inset-y-0 border-l ${header?.isMonthStart ? 'border-l-2 border-slate-300' : 'border-slate-100'} ${header?.isWeekend ? 'bg-slate-100/70' : ''}`} style={{ left: tick.left, width: zoom === 'day' ? tick.width : undefined }} />; })}
                {today >= 0 && today <= scale.width ? <span className="absolute inset-y-0 z-10 border-l-2 border-rose-400/70" style={{ left: today }} title="Hôm nay" /> : null}
                {valid ? (
                  <div role="button" tabIndex={0} aria-pressed={focusedGridItem?.kind === 'timeline-bar' && focusedGridItem.rowKey === row.key} aria-label={`Thanh timeline của Chiến dịch ${rowValue(row, 'campaign_name')}`} data-campaign-selected-bar={focusedGridItem?.kind === 'timeline-bar' && focusedGridItem.rowKey === row.key ? 'true' : undefined} onClick={() => onFocusGridItem({ kind: 'timeline-bar', rowKey: row.key })} onDoubleClick={() => { if (row.campaign) navigate(`${campaignDetailPath(row.campaign.id)}?tab=information#campaign-time`); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (row.campaign) navigate(`${campaignDetailPath(row.campaign.id)}?tab=information#campaign-time`); else onFocusGridItem({ kind: 'timeline-bar', rowKey: row.key }); } }} className={`absolute top-2.5 z-20 flex h-8 cursor-pointer items-center rounded-lg px-2 text-[10px] font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vna-blue ${focusedGridItem?.kind === 'timeline-bar' && focusedGridItem.rowKey === row.key ? 'ring-2 ring-vna-blue-deep ring-offset-2 ring-offset-white shadow-md' : ''} ${statusTone(row.draft.lifecycleState) === 'positive' ? 'bg-emerald-500 text-white' : statusTone(row.draft.lifecycleState) === 'warning' ? 'bg-amber-300 text-amber-950' : 'bg-vna-blue text-white'}`} style={{ left: barLeft, width: barWidth }} title={`${rowValue(row, 'campaign_name')} · ${row.draft.startDate} → ${row.draft.endDate}${row.campaign ? ' · Nháy đúp để mở mục Thời gian' : ''}`}><span className="truncate">{rowValue(row, 'campaign_name')}</span></div>
                ) : <span className="absolute left-3 top-4 text-[10px] font-medium text-slate-400">Chưa xác định thời gian</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  </>;
}
