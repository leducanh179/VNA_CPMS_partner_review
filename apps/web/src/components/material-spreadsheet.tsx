import { MATERIAL_CAMPAIGN_DATE_COLUMNS, materialCampaignDates, materialCampaignDateProjection } from '../lib/material-campaign-dates';
import { MATERIAL_GROUPS, MATERIAL_PUBLICATION_LABELS, parseMaterialCampaignRefs, type AccessPermission, type MaterialBulkAction, type MaterialFields, type MaterialPortalBootstrap, type MaterialSummary } from '@cpms/domain';
import { Button, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchSaveMaterials, bulkMaterialAction, purgeMaterial } from '../lib/api';
import { inheritedMaterialMarkets } from '../lib/material-form';
import { duplicateMaterialRow, materialCompletionInRange, materialDisplayValue, materialRowFromSummary, matchesMaterialSearch, newMaterialRow, type MaterialGridRow } from '../lib/material-grid';
import { MATERIAL_CONTENT_KEYS, MATERIAL_SHEET_COLUMNS, defaultMaterialLayout, materialClipboardValue, materialContent, materialDraftReason, materialLayoutKey, materialSheetPatch, materialSheetRow, migrateMaterialLayout, normalizeMaterialSheetPatch } from '../lib/material-spreadsheet';
import { appendRevealedColumns } from '../lib/column-reveal';
import { defaultMaterialGroupMode, MATERIAL_GROUP_MODES, materialGrouping, materialGroupPage, readMaterialGroupMode, type MaterialGroupMode } from '../lib/material-grouping';
import { applyMaterialColumnFilters, materialColumnFilterOptions } from '../lib/material-column-filters';
import type { CampaignColumnFilterModel } from '../lib/campaign-filters';
import { ColumnFilterMenu, type ColumnFilterDefinition, type CampaignColumnFilterAnchor } from './campaign-column-filter-menu';
import { navigate } from '../lib/router';
import { MaterialTypeEditor, MaterialPublicationEditor } from './material-inline-editors';
import { materialInlineTitleSuggestion, materialPublicationAction } from '../lib/material-inline-input';
import { MaterialCampaignEditor, MaterialDescriptionEditor, MaterialLanguageEditor, MaterialMarketEditor } from './material-cell-editors';
import { QcttPlanColumnSelector } from './qctt-plan-column-selector';
import { SupplyGrid, type SupplyGridAction, type SupplyGridColumn, type SupplyGridCommitRequest, type SupplyGridPatch, type SupplyGridSaveResult } from './supply-grid';
import type { SupplyColumnLayout } from './supply-column-chooser';
import { MaterialSharingDialog } from './material-sharing';
import { MATERIAL_SHARING_LABELS, type MaterialCapabilities } from '@cpms/domain';

const actionLabels: Record<MaterialBulkAction, string> = { PUBLISH: 'Xuất bản', PAUSE_PUBLISH: 'Tạm dừng xuất bản', UNPUBLISH: 'Đưa về Chưa xuất bản', SOFT_DELETE: 'Xóa tạm', RESTORE: 'Phục hồi' };
const readJson = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const scopeReference = (campaign?: { id: string; name: string }) => campaign ? JSON.stringify([{ kind: 'SYSTEM', id: campaign.id, name: campaign.name }]) : '';

export function MaterialSpreadsheet({ actorId, records, bootstrap, campaign, embedded, trash, can, directSuperadmin, notify, onRecords, onCollaboration, search, dateRange, publication, pageSize, onFilterResult, onResetControls, onGroupModeChange }: {
  actorId: string; records: MaterialSummary[]; bootstrap: MaterialPortalBootstrap; campaign?: { id: string; name: string };
  embedded: boolean; trash: boolean; can(permission: AccessPermission): boolean; directSuperadmin: boolean; notify(message: string): void;
  onRecords(records: MaterialSummary[]): void; onCollaboration(row: MaterialGridRow, tab: 'comments' | 'journal'): void;
  onResetControls?(): void; onGroupModeChange?(mode: MaterialGroupMode): void;
  onFilterResult?(count: number, activeFilters: number): void;
  search: string; dateRange: { from: string; to: string }; publication: string; pageSize: number;
}) {
  const storageKey = materialLayoutKey(actorId, campaign?.id || '', embedded) + (trash ? ':trash' : '');
  const [groupMode, setGroupMode] = useState<MaterialGroupMode>(() => readMaterialGroupMode(localStorage, storageKey, embedded));
  const [viewResetToken, setViewResetToken] = useState(0);
  useEffect(() => { localStorage.setItem(storageKey + ':grouping', groupMode); onGroupModeChange?.(groupMode); }, [groupMode, storageKey, onGroupModeChange]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [layout, setLayout] = useState(() => migrateMaterialLayout(localStorage, storageKey, actorId, campaign?.id || '', embedded));
  const aliases = useRef(readJson<Record<string, string>>(storageKey + ':identities', {}));
  const positions = useRef(readJson<Record<string, number>>(storageKey + ':positions', {}));
  const [rows, updateRows] = useState<MaterialGridRow[]>([]);
  const rowsRef = useRef(rows);
  const setRows = useCallback((action: MaterialGridRow[] | ((current: MaterialGridRow[]) => MaterialGridRow[])) => {
    rowsRef.current = typeof action === 'function' ? action(rowsRef.current) : action; updateRows(rowsRef.current);
  }, []);
  const cellDrafts = useRef<Record<string, Record<string, string>>>({});
  const [columnFiltersEnabled, setColumnFiltersEnabled] = useState(false);
  const [columnFilters, setColumnFilters] = useState<CampaignColumnFilterModel>({});
  const [filterMenu, setFilterMenu] = useState<{ definition: ColumnFilterDefinition; anchor: CampaignColumnFilterAnchor } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [page, setPage] = useState(1);
  const [addCount, setAddCount] = useState(1), [commit, setCommit] = useState<SupplyGridCommitRequest | null>(null);
  const [sharingRecord, setSharingRecord] = useState<MaterialSummary | null>(null);
  const rowAllowed = (materialId: unknown, action: keyof MaterialCapabilities) => Boolean(records.find(record => record.materialId === materialId)?.capabilities?.[action]);
  const publicationEditable = !embedded && !trash && records.some(record => record.capabilities?.publish);
  const editable = !embedded && !trash && (records.some(record => record.capabilities?.edit) || can('material.create'));
  useEffect(() => {
    setRows(old => {
      const saved = records.map((record, index) => {
        const prior = old.find(row => row.materialId === record.materialId);
        const key = prior?.clientKey ?? aliases.current[record.materialId] ?? record.materialId;
        if (!positions.current[key]) positions.current[key] = index + 1;
        // Pending input keeps the baseline it was actually authored against.
        return prior && cellDrafts.current[key] ? prior : materialRowFromSummary(record, key);
      });
      return [...saved, ...old.filter(row => !row.materialId)];
    });
  }, [records, setRows]);
  useEffect(() => setPage(1), [search, dateRange, publication, pageSize, columnFilters, columnFiltersEnabled, groupMode]);
  const persistPositions = () => localStorage.setItem(storageKey + ':positions', JSON.stringify(positions.current));
  const snapshotLayout = () => readJson<SupplyColumnLayout>(storageKey, layout);
  const changeLayout = (next: SupplyColumnLayout, reset = false) => {
    if (!reset) { const prior = snapshotLayout(); const visible = next.order.filter(key => !next.hidden.includes(key)); next = { ...next, order: [...appendRevealedColumns(prior.order.filter(key => !prior.hidden.includes(key)), visible, next.pinned), ...next.order.filter(key => next.hidden.includes(key))] }; }
    localStorage.setItem(storageKey, JSON.stringify(next)); setLayout(next); setLayoutVersion(value => value + 1); };
  const resetView = () => {
    changeLayout(defaultMaterialLayout(embedded), true); setGroupMode(defaultMaterialGroupMode(embedded));
    setColumnFilters({}); setColumnFiltersEnabled(false); setFilterMenu(null); setSelected([]); setPage(1); setNotice('Đã trở lại giao diện mặc định. Bản nhập dở vẫn được giữ.');
    const ordered = [...rowsRef.current].sort((a, b) => !a.materialId ? 1 : !b.materialId ? -1 : String(b.fields.material_update_date || '').localeCompare(String(a.fields.material_update_date || '')) || a.clientKey.localeCompare(b.clientKey));
    positions.current = Object.fromEntries(ordered.map((row, index) => [row.clientKey, index + 1])); persistPositions();
    setViewResetToken(value => value + 1); onResetControls?.();
  };
  const insertAtPosition = (position: number, count = 1) => {
    if (!editable || !can('material.create')) return [];
    const added = Array.from({ length: count }, (_, index) => {
      const row = newMaterialRow('material-draft-' + crypto.randomUUID());
      if (campaign) row.fields.campaign_refs = scopeReference(campaign);
      positions.current[row.clientKey] = position + index;
      return row;
    });
    const addedIds = new Set(added.map(row => row.clientKey));
    for (const key of Object.keys(positions.current)) if (!addedIds.has(key) && positions.current[key]! >= position) positions.current[key]! += count;
    setRows(current => [...current, ...added]); persistPositions();
    return added.map(row => row.clientKey);
  };
  const save = async (patches: SupplyGridPatch[]): Promise<SupplyGridSaveResult> => {
    const result: SupplyGridSaveResult = { kind: 'canonical', errors: {}, versions: {}, deferred: [], acknowledged: {} };
    const items = patches.flatMap(patch => {
      const row = rowsRef.current.find(value => value.clientKey === patch.id);
      if (!row) { result.errors[patch.id] = 'Không tìm thấy dòng đích.'; return []; }
      if (!editable || !(row.materialId ? rowAllowed(row.materialId, 'edit') : can('material.create'))) { result.errors[patch.id] = 'Không có quyền lưu dòng này.'; return []; }
      const changed = materialSheetPatch(patch.fields);
      const fields = { ...row.fields, ...changed };
      const pending = materialDraftReason(fields, Boolean(row.materialId));
      if (pending) { result.deferred!.push(patch.id); setNotice(pending); return []; }
      return [{ clientKey: row.clientKey, ...(row.materialId ? { materialId: row.materialId, expectedVersion: patch.recordVersion, baselineFields: row.baselineFields } : {}),
        fields: row.materialId ? changed : materialContent(fields) }];
    });
    if (!items.length) return result;
    const response = await batchSaveMaterials(items);
    const updated: MaterialSummary[] = [];
    for (const item of items) {
      const responseItem = response.items.find(value => value.clientKey === item.clientKey);
      if (!responseItem?.ok || !responseItem.material) { result.errors[item.clientKey] = responseItem?.message || 'Không nhận được xác nhận lưu. Nội dung vẫn được giữ.'; continue; }
      const material = responseItem.material;
      const sent = patches.find(patch => patch.id === item.clientKey)!.fields;
      result.acknowledged![item.clientKey] = responseItem.replayed
        ? Object.fromEntries(Object.entries(sent).filter(([key, value]) => String(material.fields[key === 'campaign' ? 'campaign_refs' : key as keyof MaterialFields] ?? '').trim() === value.trim()))
        : sent;
      result.versions[item.clientKey] = material.recordVersion;
      aliases.current[material.materialId] = item.clientKey;
      setRows(current => [...current.filter(row => row.materialId !== material.materialId || row.clientKey === item.clientKey)].map(row => row.clientKey === item.clientKey ? materialRowFromSummary(material, item.clientKey) : row));
      updated.push(material);
    }
    localStorage.setItem(storageKey + ':identities', JSON.stringify(aliases.current)); persistPositions();
    if (updated.length) { onRecords(updated); setNotice(result.deferred?.length ? 'Các dòng chưa đủ thông tin đang được giữ trong bản nhập dở riêng.' : ''); }
    return result;
  };
  const onDraftsChange = useCallback((drafts: Record<string, Record<string, string>>) => { cellDrafts.current = drafts; }, []);
  const restoreRows = (restored: Array<Record<string, unknown> & { id: string }>) => {
    setRows(current => {
      const next = [...current];
      for (const raw of restored) {
        if (raw.__sheetBlank || typeof raw.id !== 'string') continue;
        const index = next.findIndex(row => row.clientKey === raw.id || row.materialId && row.materialId === raw.materialId);
        const restoredFields = Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'string' || value === null)) as MaterialFields;
        const existing = index >= 0 ? next[index] : undefined;
        const row: MaterialGridRow = { ...(existing ?? newMaterialRow(raw.id)), clientKey: raw.id,
          materialId: typeof raw.materialId === 'string' ? raw.materialId : null, recordVersion: Number(raw.recordVersion || 0),
          fields: existing?.fields ?? { ...materialSheetPatch(restoredFields as Record<string, string>), campaign_refs: String(raw.campaign || raw.campaign_refs || '') },
          baselineFields: (raw.baselineFields ?? {}) as MaterialFields };
        if (index >= 0) next[index] = row; else next.push(row);
        positions.current[row.clientKey] = Number(raw.sortOrder) || positions.current[row.clientKey] || next.length;
      }
      return next;
    });
  };
  const projected = (row: MaterialGridRow) => ({ ...row, fields: { ...row.fields, ...materialSheetPatch(cellDrafts.current[row.clientKey] || {}) } });
  const batchAction = async (action: MaterialBulkAction, targets: MaterialGridRow[]) => {
    const permission = action === 'RESTORE' ? 'restore' : action === 'SOFT_DELETE' ? 'delete' : 'publish';
    if (embedded || !targets.every(row => rowAllowed(row.materialId, permission)) || !targets.length) return false;
    if (targets.length > 50) { notify('Mỗi thao tác tối đa 50 tư liệu.'); return false; }
    if (targets.some(row => cellDrafts.current[row.clientKey])) { notify('Hãy hoàn tất lưu các ô đang sửa trước khi đổi trạng thái.'); return false; }
    if (!window.confirm(`Xác nhận ${actionLabels[action].toLocaleLowerCase('vi')} ${targets.length} tư liệu?`)) return false;
    const reason = action === 'SOFT_DELETE' ? window.prompt('Lý do xóa tạm:', 'Xóa từ bảng Tư liệu') : undefined;
    if (reason === null) return false;
    setBusy(true);
    try {
      const response = await bulkMaterialAction(targets.map(row => ({ materialId: row.materialId!, expectedVersion: row.recordVersion })), action, reason);
      const saved = response.items.flatMap(item => item.ok && item.material ? [item.material] : []);
      onRecords(saved); notify(`Đã xử lý ${response.succeeded}/${response.total} tư liệu.${response.failed ? ' ' + response.items.filter(item => !item.ok).map(item => item.message).join('; ') : ''}`);
      return response.failed === 0;
    } catch (error) { notify(error instanceof Error ? error.message : 'Không thực hiện được thao tác.'); return false; }
    finally { setBusy(false); }
  };
  const duplicate = (sources: MaterialGridRow[]) => {
    if (!editable || !can('material.create')) return;
    if (sources.length > 50) return notify('Mỗi lần nhân bản tối đa 50 dòng.');
    let position = Math.max(0, ...Object.values(positions.current)) + 1;
    const added = sources.map(row => { const copy = duplicateMaterialRow(projected(row), 'material-draft-' + crypto.randomUUID()); positions.current[copy.clientKey] = position++; return copy; });
    setRows(current => [...current, ...added]); persistPositions();
    setCommit({ ids: added.map(row => row.clientKey), onComplete: () => setCommit(null) });
  };
  const rowActions = (values: Array<Record<string, unknown> & { id: string }>): SupplyGridAction[] => {
    const targets = values.flatMap(value => rowsRef.current.find(row => row.clientKey === value.id) || []);
    const saved = targets.filter(row => row.materialId), first = saved[0];
    const actions: SupplyGridAction[] = [];
    if (first && targets.length === 1) {
      const record = records.find(record => record.materialId === first.materialId);
      if (record?.capabilities?.manageSharing) actions.push({ label: 'Chia sẻ', icon: 'users', run: () => setSharingRecord(record) });
      if (record) actions.push({ label: 'Sao chép liên kết tư liệu', icon: 'copy', run: () => {
        const path = record.sharing?.mode === 'SHARED' ? `/public/materials/${encodeURIComponent(record.materialId)}` : `/materials/${encodeURIComponent(record.materialId)}/edit`;
        void navigator.clipboard.writeText(new URL(path, window.location.origin).href).then(() => notify('Đã sao chép liên kết.')).catch(() => notify('Chưa sao chép được liên kết.'));
      } });
      actions.push({ label: 'Xem/Sửa đầy đủ', icon: 'edit', tone: 'primary', run: () => navigate(`/materials/${encodeURIComponent(first.materialId!)}/edit`) });
      actions.push({ label: 'Bình luận', icon: 'comments', run: () => onCollaboration(first, 'comments') }, { label: 'Lịch sử', icon: 'history', run: () => onCollaboration(first, 'journal') });
    }
    if (!embedded && !trash && can('material.create')) actions.push({ label: 'Nhân bản', icon: 'duplicate', disabled: !targets.length || busy, run: () => duplicate(targets) });
    if (!embedded && saved.length === targets.length && saved.length) {
      const lifecycle: MaterialBulkAction[] = trash ? ['RESTORE'] : ['PUBLISH', 'PAUSE_PUBLISH', 'UNPUBLISH', 'SOFT_DELETE'];
      for (const action of lifecycle) {
        const permission = action === 'RESTORE' ? 'restore' : action === 'SOFT_DELETE' ? 'delete' : 'publish';
        if (!saved.every(row => rowAllowed(row.materialId, permission))) continue;
        if (action === 'PUBLISH' && !saved.every(row => row.fields.publish_status !== 'PUBLISHED')) continue;
        if (action === 'PAUSE_PUBLISH' && !saved.every(row => row.fields.publish_status === 'PUBLISHED')) continue;
        if (action === 'UNPUBLISH' && !saved.every(row => ['PUBLISHED', 'PAUSED'].includes(row.fields.publish_status || ''))) continue;
        actions.push({ label: actionLabels[action], icon: action === 'SOFT_DELETE' ? 'delete' : action === 'RESTORE' ? 'restore' : 'approve', tone: action === 'SOFT_DELETE' ? 'danger' : 'positive', disabled: busy, run: () => { void batchAction(action, saved); } });
      }
      if (directSuperadmin && first && rowAllowed(first.materialId, 'purge') && saved.length === 1) actions.push({ label: 'Xóa vĩnh viễn', icon: 'delete', tone: 'danger', run: () => {
        if (window.prompt(`Xóa vĩnh viễn, không thể khôi phục. Nhập mã ${first.materialId} để xác nhận:`) !== first.materialId) return;
        void purgeMaterial(first.materialId!, first.recordVersion).then(() => { setRows(current => current.filter(row => row.clientKey !== first.clientKey)); onRecords([{ ...records.find(record => record.materialId === first.materialId)!, isDeleted: true, materialId: first.materialId!, fields: { __purged: 'true' } as MaterialFields }]); notify('Đã xóa vĩnh viễn. Nhật ký được giữ.'); }).catch(error => notify(error.message));
      } });
    }
    return actions;
  };
  const insertColumns = (anchor: string, after: boolean, count: number) => {
    const current = snapshotLayout(); const next = [...current.order]; const index = next.indexOf(anchor);
    next.splice(Math.max(0, index + Number(after)), 0, ...Array.from({ length: count }, () => 'blank:' + crypto.randomUUID()));
    changeLayout({ ...current, order: next });
  };
  const toggleColumn = (key: string) => {
    const current = snapshotLayout(), visible = current.order.filter(field => !current.hidden.includes(field));
    if (!current.hidden.includes(key) && visible.length <= 1) return setNotice('Giữ ít nhất một cột trong bảng.');
    changeLayout({ ...current, hidden: current.hidden.includes(key) ? current.hidden.filter(field => field !== key) : [...current.hidden, key] });
  };
  const bindColumn = (key: string, next: string) => {
    if (key === next) return;
    if (!key.startsWith('blank:')) { window.alert('Cột này đã có dữ liệu hoặc chưa đủ dữ liệu để đổi binding an toàn. Hãy thêm cột trống và chọn trường khác. Ẩn cột hiện tại nếu không cần hiển thị.'); return; }
    const current = snapshotLayout(), order = current.order.filter(field => field !== next);
    order.splice(order.indexOf(key), 1, next);
    changeLayout({ ...current, order, hidden: current.hidden.filter(field => field !== next && field !== key), pinned: current.pinned.filter(field => field !== key) });
  };
  const definitions = [...MATERIAL_SHEET_COLUMNS, ...layout.order.filter(key => key.startsWith('blank:')).map(key => ({ key, label: 'Cột trống', editable: false, width: '12rem' }))];
  const columns: SupplyGridColumn[] = definitions.map(definition => {
    const key = definition.key;
    const column: SupplyGridColumn = {
      key, label: definition.label, width: Number.parseFloat(definition.width) * 16, editable: (MATERIAL_CONTENT_KEYS as readonly string[]).includes(key) || key === 'campaign',
      headerControl: <QcttPlanColumnSelector label={`Trường cột ${definition.label}`} value={key} choices={[...(key.startsWith('blank:') ? [{ value: key, label: 'Chọn trường…' }] : []), ...MATERIAL_SHEET_COLUMNS.map(field => ({ value: field.key, label: field.label }))]} onChange={value => bindColumn(key, value)}/>,
      parseClipboard: value => materialClipboardValue(key, value, bootstrap),
      clearValue: row => row.materialId && ['material_link', 'campaign', 'market_codes', 'material_group', 'material_type', 'material_type_other'].includes(key) ? null : key === 'material_languages' || key === 'campaign' ? '[]' : '',
    };
    if (MATERIAL_CAMPAIGN_DATE_COLUMNS.some(field => field.key === key)) {
      column.type = 'date';
      column.hint = 'Tham chiếu từ Chiến dịch; chỉnh sửa trong thông tin Chiến dịch.';
      column.clipboardValue = row => materialCampaignDates({ ...row, campaign_refs: row.campaign }, key, bootstrap.campaigns).map(item => item.date).filter(Boolean).join('; ');
      column.render = row => { const values = materialCampaignDates({ ...row, campaign_refs: row.campaign }, key, bootstrap.campaigns); return <span className="whitespace-pre-wrap">{values.length ? values.map(item => <span key={item.id} className="block" title={item.name}>{values.length > 1 && <span className="text-slate-500">{item.name}: </span>}{item.date ? item.date.split('-').reverse().join('/') : '—'}</span>) : '—'}</span>; };
    }
    if (key === 'campaign') { column.editor = props => <MaterialCampaignEditor {...props} campaigns={bootstrap.campaigns}/>; column.clipboardValue = row => parseMaterialCampaignRefs(String(row.campaign || '')).map(ref => ref.name).join('; ') || String(row.campaign_name || ''); column.render = row => <span>{parseMaterialCampaignRefs(String(row.campaign || '')).map(ref => <span key={ref.id} className="mr-2">{ref.name}{ref.kind === 'SYSTEM' && <button type="button" aria-label={`Mở Chiến dịch ${ref.name}`} className="ml-1 text-vna-blue" onClick={() => navigate(`/campaigns/${encodeURIComponent(ref.id)}`)}><CpmsIcon name="externalLink" size={14}/></button>}</span>)}</span>; }
    if (key === 'material_languages') { column.editor = props => <MaterialLanguageEditor {...props}/>; column.clipboardValue = row => materialDisplayValue(row as MaterialFields, 'material_languages').replace(/^—$/, ''); column.render = row => column.clipboardValue!(row); }
    if (key === 'material_description_rich_text') { column.editor = props => <MaterialDescriptionEditor {...props}/>; column.clipboardValue = row => materialDisplayValue(row as MaterialFields, 'material_description_rich_text').replace(/^—$/, ''); column.render = row => <div className="line-clamp-3 whitespace-pre-wrap">{column.clipboardValue!(row)}</div>; }
    if (key === 'material_group') column.options = MATERIAL_GROUPS.map(value => ({ value, label: value }));
    if (key === 'material_type') column.editor = props => <MaterialTypeEditor {...props}/>;
    if (key === 'material_type_other') column.editableWhen = row => row.material_type === 'Khác' || row.material_group === 'Khác';
    if (key === 'market_codes') { column.editableWhen = row => !parseMaterialCampaignRefs(String(row.campaign || row.campaign_refs || '')).some(ref => ref.kind === 'SYSTEM'); column.editor = props => <MaterialMarketEditor {...props} markets={bootstrap.options.markets}/>; }
    if (key === 'material_update_date') column.type = 'date';
    if (key === 'record_version') column.type = 'number';
    if (key === 'material_name') column.completion = materialInlineTitleSuggestion;
    if (key === 'material_name') column.render = row => <span><span className="font-semibold text-slate-900">{String(row.material_name || '')}{Boolean(row.materialId) && <button type="button" aria-label="Xem/Sửa đầy đủ tư liệu" className="ml-2 text-vna-blue" onClick={() => navigate(`/materials/${encodeURIComponent(String(row.materialId))}/edit`)}><CpmsIcon name="externalLink" size={14}/></button>}</span><span className="mt-1 block text-[10px] text-slate-500">{row.materialId ? MATERIAL_SHARING_LABELS[records.find(record => record.materialId === row.materialId)?.sharing?.mode || 'LEGACY'] : 'Nháp riêng · Dùng chung khi lưu chính thức'}</span></span>;
    if (key === 'material_link') column.render = row => { const link = String(row.material_link || ''); return <span className="flex items-start gap-2"><span className="line-clamp-2 break-all">{link}</span>{/^https?:\/\//.test(link) && <a href={link} target="_blank" rel="noreferrer" aria-label="Mở Link tư liệu" className="shrink-0 text-vna-blue"><CpmsIcon name="externalLink" size={16}/></a>}</span>; };
    if (key === 'publish_status') {
      column.editable = true; column.editableWhen = row => Boolean(row.materialId) && rowAllowed(row.materialId, 'publish');
      column.clearValue = () => null; column.parseClipboard = () => { throw Error('Nháy đúp ô Tình trạng xuất bản để đổi và xác nhận.'); };
      column.editor = props => <MaterialPublicationEditor value={props.value} onCancel={props.onCancel} onApply={async status => { const target = rowsRef.current.find(row => row.clientKey === props.row.id); return target ? batchAction(materialPublicationAction(status), [target]) : false; }}/>;
      column.render = row => <StatusBadge tone={row.publish_status === 'PUBLISHED' ? 'positive' : 'warning'}>{MATERIAL_PUBLICATION_LABELS[String(row.publish_status)] || 'Chưa xuất bản'}</StatusBadge>; column.clipboardValue = row => MATERIAL_PUBLICATION_LABELS[String(row.publish_status)] || 'Chưa xuất bản'; }
    return column;
  });
  const orderedRows = [...rows].sort((a, b) => (positions.current[a.clientKey] || 0) - (positions.current[b.clientKey] || 0));
  const filterSource = orderedRows.filter(row => !row.materialId || row.isDeleted === trash && matchesMaterialSearch(row, search) && materialCompletionInRange(row, dateRange) && (publication === 'ALL' || row.fields.publish_status === publication));
  const matching = columnFiltersEnabled ? applyMaterialColumnFilters(filterSource, columnFilters, bootstrap.campaigns) : filterSource;
  const saved = matching.filter(row => row.materialId);
  const grouping = materialGrouping(groupMode);
  const groupedPage = grouping ? materialGroupPage(matching.map(row => materialSheetRow(row, positions.current[row.clientKey] || 1, bootstrap.campaigns)), grouping, page, pageSize) : null;
  const pages = groupedPage?.pages ?? Math.max(1, Math.ceil(saved.length / pageSize)), currentPage = groupedPage?.currentPage ?? Math.min(page, pages);
  const activeColumnFilterCount = columnFiltersEnabled ? Object.keys(columnFilters).length : 0;
  useEffect(() => { onFilterResult?.(saved.length, activeColumnFilterCount); }, [saved.length, activeColumnFilterCount, onFilterResult]);
  const pageIds = new Set(groupedPage?.rows.map(row => row.id));
  const pageRows = groupedPage ? matching.filter(row => pageIds.has(row.clientKey)) : [...saved.slice((currentPage - 1) * pageSize, currentPage * pageSize), ...matching.filter(row => !row.materialId)];
  // Personal row positions never change the business update date.
  const displayedIds = new Set(pageRows.map(row => row.clientKey));
  const excluded = orderedRows.filter(row => !displayedIds.has(row.clientKey));
  const sheetRows = pageRows.map(row => materialSheetRow(row, (positions.current[row.clientKey] || 1) - excluded.filter(other => positions.current[other.clientKey]! < positions.current[row.clientKey]!).length, bootstrap.campaigns)).sort((a, b) => a.sortOrder - b.sortOrder);
  const createRows = (position: number, count = 1) => {
    const next = sheetRows.find(row => row.sortOrder >= position), last = sheetRows.at(-1);
    const absolute = next ? positions.current[next.id]! - (next.sortOrder - position) : last ? positions.current[last.id]! + position - last.sortOrder : position;
    return insertAtPosition(absolute, count);
  };
  return <div className="min-w-0 w-full">
    {sharingRecord && <MaterialSharingDialog record={sharingRecord} campaigns={bootstrap.campaigns} onClose={() => setSharingRecord(null)} onSaved={value => { onRecords([value]); notify('Đã cập nhật chia sẻ.'); }}/>}
    {notice && <p role="status" className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">{notice}</p>}
    <div data-inline-save-surface className="flex h-12 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-cyan-100 bg-cyan-50 p-3">{selected.length ? <><strong className="sr-only">Thao tác hàng</strong><strong className="mr-2 text-xs">Đã chọn {selected.length} hàng</strong>{rowActions(sheetRows.filter(row => selected.includes(row.id))).map(action => <Button key={action.label} size="sm" variant="secondary" disabled={action.disabled} onClick={action.run}>{action.label}</Button>)}</> : <span className="text-xs text-slate-500">Chọn hàng để nhân bản, xuất bản hoặc chuyển vào Thùng rác.</span>}</div>
    <SupplyGrid aiRecord={row=>row.materialId?{kind:'MATERIAL',id:String(row.materialId)}:undefined} rows={sheetRows} columns={columns} storageKey={storageKey} layoutVersion={layoutVersion} viewResetToken={viewResetToken} {...(grouping ? { grouping: { ...grouping, pageKeys: groupedPage!.keys } } : {})} canonicalSave expandable viewKey={JSON.stringify([currentPage, search, dateRange, publication, columnFiltersEnabled, columnFilters])} draftRowsSnapshot={rows.map(row => materialSheetRow(row, positions.current[row.clientKey] || 1, bootstrap.campaigns))}
      spreadsheet rowNumbers columnLetters selectionStyle="campaign" columnReordering manualColumnPinning viewportClassName="min-h-[420px]"
      canEdit={editable || publicationEditable} canEditRow={(row, column) => !row.isDeleted && (column?.key === 'publish_status' ? publicationEditable && rowAllowed(row.materialId, 'publish') : editable && (row.materialId ? rowAllowed(row.materialId, 'edit') : can('material.create')))}
      {...(editable ? { onSave: save } : {})} onDraftsChange={onDraftsChange} onSelectionChange={setSelected}
      draftRowIds={rows.filter(row => !row.materialId).map(row => row.clientKey)} onRestoreRows={restoreRows}
      onDiscard={() => setRows(current => current.filter(row => row.materialId))} commitRequest={commit}
      normalizePatch={normalizeMaterialSheetPatch}
      columnFilters={{
        enabled: columnFiltersEnabled, count: Object.keys(columnFilters).length,
        onToggle: () => { setColumnFiltersEnabled(value => !value); setFilterMenu(null); },
        onClear: () => { setColumnFilters({}); setFilterMenu(null); },
        render: column => column.key.startsWith('blank:') ? null : <button type="button" draggable={false}
          aria-label={`${columnFilters[column.key] ? 'Sửa' : 'Mở'} bộ lọc cột ${column.label}`} aria-pressed={Boolean(columnFilters[column.key])}
          className={`grid size-7 shrink-0 place-items-center rounded-md transition ${columnFilters[column.key] ? 'bg-cyan-100 text-vna-blue' : 'text-slate-400 hover:bg-white hover:text-vna-blue'}`}
          title={columnFilters[column.key] ? 'Đang lọc cột này' : 'Lọc cột này'}
          onPointerDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
          onClick={event => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            const kind = column.type === 'date' ? 'date' : ['created_at', 'updated_at', 'deleted_at'].includes(column.key) ? 'dateTime' : 'text';
            setFilterMenu({ definition: { key: column.key, label: column.label, kind, supportsCondition: kind === 'text' }, anchor: { left: rect.left, top: rect.bottom + 6, element: event.currentTarget } });
          }}><CpmsIcon name="filter" size={16}/></button>,
      }}
      projectDraft={(row, patch) => { const merged = { ...row, ...patch }; if (!Object.hasOwn(patch, 'campaign')) return {}; const market = inheritedMaterialMarkets(parseMaterialCampaignRefs(String(merged.campaign || '')), bootstrap.campaigns); return { ...materialCampaignDateProjection({ ...merged, campaign_refs: merged.campaign }, bootstrap.campaigns), ...(market ? { market_codes: market.market_codes.join(',') } : {}) }; }}
      rowClipboard={{ scope: 'MATERIAL', fields: row => ({ ...materialContent(row as MaterialFields), campaign: String(row.campaign || row.campaign_refs || '') }) }}
      contextActions={rowActions}
      sheet={{
        createRow: position => createRows(position)[0] || null, insertRows: createRows, insertColumn: insertColumns,
        removeRows: async values => { const targets = rowsRef.current.filter(row => values.some(value => value.id === row.clientKey)); const real = targets.filter(row => row.materialId); if (real.length && !await batchAction('SOFT_DELETE', real)) return false; setRows(current => current.filter(row => row.materialId || !targets.some(target => target.clientKey === row.clientKey))); return true; },
        removeColumns: async keys => { const current = snapshotLayout(); if (current.order.filter(key => !keys.includes(key) && !current.hidden.includes(key)).length < 1) return false; changeLayout({ ...current, order: current.order.filter(key => !keys.includes(key) || !key.startsWith('blank:')), hidden: [...new Set([...current.hidden, ...keys.filter(key => !key.startsWith('blank:'))])] }); return true; },
        clearRow: row => { if (row.materialId) setNotice('Giữ Link tư liệu và các trường phụ thuộc; chỉ xóa tiêu đề, mô tả, ngôn ngữ, ghi chú.'); return Object.fromEntries((row.materialId ? ['material_name', 'material_description_rich_text', 'material_languages', 'note'] : MATERIAL_CONTENT_KEYS).map(key => [key, key === 'material_languages' || key === 'campaign_refs' ? '[]' : ''])); },
      }}
      viewActions={preserve => <div data-inline-save-surface className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">Gộp nhóm<select aria-label="Gộp nhóm" value={groupMode} className="rounded-lg border border-slate-200 bg-white p-2 text-xs" onChange={async event => { const mode = event.target.value as MaterialGroupMode; if (await preserve()) setGroupMode(mode); }}>{MATERIAL_GROUP_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
        <Button size="sm" variant="ghost" onClick={async () => { if (!window.confirm('Bạn có muốn đưa giao diện phân hệ Tư liệu trở lại Mặc định?')) return; if (await preserve()) resetView(); }}><CpmsIcon name="restore" size={18}/>Trở lại giao diện mặc định</Button>
      </div>}
      toolbar={() => <><div data-inline-save-surface className="flex items-center gap-2">{editable && can('material.create') && <><select aria-label="Số dòng mới" className="rounded border p-1.5 text-xs" value={addCount} onChange={event => setAddCount(Number(event.target.value))}>{[1,3,5,10,20,50].map(count => <option key={count} value={count}>{count} dòng mới</option>)}</select><Button size="sm" onClick={() => createRows(Math.max(0, ...sheetRows.map(row => row.sortOrder)) + 1, addCount)}><CpmsIcon name="add" size={16}/>Thêm {addCount} dòng</Button></>}
      <div className="w-44"><QcttPlanColumnSelector label="Thêm/hiện cột" value="" choices={MATERIAL_SHEET_COLUMNS.map(column => ({ value: column.key, label: column.label, visibility: snapshotLayout().hidden.includes(column.key) ? 'hidden' : 'visible' }))} toggleVisibility onChange={toggleColumn}/></div></div></>}
    />
    {filterMenu && columnFiltersEnabled && <ColumnFilterMenu materialSelectionMode key={filterMenu.definition.key} definition={filterMenu.definition}
      filters={columnFilters} anchor={filterMenu.anchor} {...materialColumnFilterOptions(filterSource, columnFilters, filterMenu.definition.key, bootstrap.campaigns)}
      onApply={filter => { setColumnFilters(current => ({ ...current, [filterMenu.definition.key]: filter })); setFilterMenu(null); }}
      onClear={() => { setColumnFilters(current => { const next = { ...current }; delete next[filterMenu.definition.key]; return next; }); setFilterMenu(null); }}
      onClose={() => setFilterMenu(null)}/>}
    <div data-inline-save-surface className="flex items-center justify-between border-t p-3 text-xs text-slate-500"><span>{saved.length} tư liệu{groupedPage ? ` · ${groupedPage.totalGroups} nhóm` : ''} · Trang {currentPage}/{pages}. Dòng nhập mới giữ vị trí riêng và luôn hiện khi đang lọc.</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button size="sm" variant="ghost" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></div>
  </div>;
}
