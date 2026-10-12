import { type CampaignBatchSaveItem } from '@cpms/domain';
import { Button, Card, CpmsIcon, SectionHeading } from '@cpms/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCampaignWorkspace } from '../campaign-context';
import { CampaignInlineTable } from '../components/campaign-inline-table';
import { CampaignQuickFilters } from '../components/campaign-quick-filters';
import { CampaignBatchWorkflowActions } from '../components/campaign-batch-workflow-actions';
import { useAuth } from '../auth-context';
import { useAccessCapabilities } from '../access-context';
import { CampaignCollaborationPanel, type CampaignCollaborationFocusRequest, type CampaignCollaborationTab } from '../components/campaign-collaboration-panel';
import { CampaignSpreadsheetExchange, type ExchangeTab } from '../components/campaign-spreadsheet-exchange';
import { selectCockpitCampaigns } from '../lib/campaign-workspace';
import {
  applyCampaignColumnFilters,
  campaignMatchesCommunicationRange,
  campaignMatchesGlobalSearch,
  type CampaignColumnFilterModel,
  type CampaignCommunicationRange,
} from '../lib/campaign-filters';
import {
  CAMPAIGN_PAGE_SIZES,
  campaignPageSize,
  compareCampaigns,
  nextSortDirection,
  type CampaignSortDirection,
} from '../lib/campaign-grid';
import { AppLink } from '../lib/router';
import { requestJson } from '../lib/api';
import { type CampaignOperationsView } from '../lib/campaign-operations';
import { workflowChanged } from '../lib/campaign-workflow';
import type { CampaignFormDraftSummary } from '../lib/campaign-form-drafts';

export function CampaignCockpitPage({ notify }: { notify(message: string): void }) {
  const { store, snapshot } = useCampaignWorkspace();
  const { me } = useAuth();
  const capabilities = useAccessCapabilities();
  const [listMode, setListMode] = useState<'active' | 'trash'>('active');
  const campaigns = listMode === 'trash' ? snapshot.trashCampaigns : selectCockpitCampaigns(snapshot);
  const [query, setQuery] = useState('');
  const [communicationRange, setCommunicationRange] = useState<CampaignCommunicationRange>({ from: '', to: '' });
  const [columnFiltersEnabled, setColumnFiltersEnabled] = useState(false);
  const [columnFilters, setColumnFilters] = useState<CampaignColumnFilterModel>({});
  const [sortKey, setSortKey] = useState('last_updated_at');
  const [sortDirection, setSortDirection] = useState<CampaignSortDirection>('desc');
  const [pageSize, setPageSize] = useState(() => campaignPageSize(null));
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>([]);
  const [exchangeTab, setExchangeTab] = useState<ExchangeTab>('export');
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [collaborationFocus, setCollaborationFocus] = useState<CampaignCollaborationFocusRequest | null>(null);
  const [formDrafts, setFormDrafts] = useState<CampaignFormDraftSummary[]>([]);
  const loadFormDrafts = useCallback(() => {
    if (!capabilities['campaign.create']) return;
    void requestJson<CampaignFormDraftSummary[]>('/campaign-form-drafts').then(setFormDrafts).catch(() => setFormDrafts([]));
  }, [capabilities]);
  useEffect(() => { loadFormDrafts(); }, [loadFormDrafts]);
  const openExchange = (tab: ExchangeTab) => { setExchangeTab(tab); setExchangeOpen(true); };
  const handleSelectionChange = useCallback((ids: string[]) => setSelectedIds((current) => current.join('|') === ids.join('|') ? current : ids), []);
  const handleVisibleFieldsChange = useCallback((keys: string[]) => setVisibleFieldKeys((current) => current.join('|') === keys.join('|') ? current : keys), []);
  const openCollaboration = useCallback((tab: CampaignCollaborationTab, campaignId?: string) => {
    if (campaignId) setSelectedIds([campaignId]);
    setCollaborationFocus({ tab, nonce: Date.now(), ...(campaignId ? { campaignId } : {}) });
    if (tab !== 'comments') window.setTimeout(() => document.querySelector('[data-campaign-collaboration-panel]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, []);

  const quickFilteredCampaigns = useMemo(() => campaigns.filter((campaign) => (
    campaignMatchesGlobalSearch(campaign, query)
    && campaignMatchesCommunicationRange(campaign, communicationRange)
  )), [campaigns, communicationRange, query]);

  const filtered = useMemo(() => {
    const candidates = columnFiltersEnabled
      ? applyCampaignColumnFilters(quickFilteredCampaigns, columnFilters)
      : quickFilteredCampaigns;
    return [...candidates].sort((left, right) => compareCampaigns(left, right, sortKey, sortDirection));
  }, [columnFilters, columnFiltersEnabled, quickFilteredCampaigns, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedCampaigns = filtered.slice((page - 1) * pageSize, page * pageSize);
  const quickFilterCount = Number(Boolean(query.trim()))
    + Number(Boolean(communicationRange.from || communicationRange.to));
  const columnFilterCount = columnFiltersEnabled ? Object.keys(columnFilters).length : 0;

  useEffect(() => setPage(1), [columnFilters, columnFiltersEnabled, communicationRange, pageSize, query, sortDirection, sortKey]);
  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages]);
  useEffect(() => {
    if (listMode === 'trash') void store.loadTrash().catch(() => undefined);
  }, [listMode, store]);
  const saveBatch = async (items: CampaignBatchSaveItem[]) => {
    const result = await store.batchSave(items);
    notify(result.failed
      ? `Đã lưu ${result.succeeded}/${result.total} chiến dịch; ${result.failed} dòng cần kiểm tra.`
      : `Đã lưu ${result.succeeded} chiến dịch trong một lần và ghi audit.`);
    return result;
  };

  const sortByColumn = (key: string) => {
    setSortDirection((current) => nextSortDirection(sortKey, current, key));
    setSortKey(key);
  };

  const moveToTrash = async (ids: string[]) => {
    if (!window.confirm(`Chuyển ${ids.length} chiến dịch vào Thùng rác? Bạn có thể phục hồi sau.`)) return;
    await Promise.all(ids.map((id) => store.moveToTrash(id)));
    notify(`Đã chuyển ${ids.length} chiến dịch vào Thùng rác.`);
  };

  const restore = async (ids: string[]) => {
    await Promise.all(ids.map((id) => store.restore(id)));
    notify(`Đã phục hồi ${ids.length} chiến dịch.`);
  };

  const deletePermanently = async (ids: string[]) => {
    const phrase = ids.length === 1 ? 'XOA' : `XOA ${ids.length}`;
    const input = window.prompt(`Thao tác này không thể hoàn tác. Nhập “${phrase}” để xóa vĩnh viễn.`);
    if (input !== phrase) return;
    if (listMode === 'active') {
      for (const id of ids) await store.moveToTrash(id);
    }
    for (const id of ids) await store.deletePermanently(id);
    notify(`Đã xóa vĩnh viễn ${ids.length} chiến dịch.`);
  };

  const runLifecycleAction = async (campaignId: string, action: 'pause' | 'resume' | 'cancel') => {
    const campaign = campaigns.find((item) => item.id === campaignId);
    if (!campaign) return;
    const label = action === 'pause' ? 'Tạm dừng' : action === 'resume' ? 'Nối lại' : 'Xóa';
    const reason = window.prompt(`${label} Chiến dịch “${campaign.name}”?\nNhập lý do nếu cần (không bắt buộc).`);
    if (reason === null) return;
    try {
      const operations = await requestJson<CampaignOperationsView>(`/campaign-operations/${encodeURIComponent(campaignId)}`);
      const operation = action === 'pause' ? 'REQUEST_PAUSE' : action === 'resume' ? 'REQUEST_RESUME' : 'REQUEST_CANCEL';
      const allowed = action === 'resume' ? operations.capabilities.resume : operations.capabilities.requestChange;
      if (!allowed) {
        if (action === 'cancel' && campaign.access?.permissions['campaign.delete']) {
          await store.moveToTrash(campaignId);
          notify('Đã chuyển Chiến dịch vào Thùng rác.');
          return;
        }
        throw new Error(`Tài khoản hiện tại không được ${label.toLocaleLowerCase('vi')} Chiến dịch này.`);
      }
      if (action === 'cancel' && operations.approvalRequired?.CANCEL === false && campaign.access?.permissions['campaign.delete']) {
        await store.moveToTrash(campaignId);
        notify('Đã chuyển Chiến dịch vào Thùng rác.');
        return;
      }
      await requestJson(`/campaign-operations/${encodeURIComponent(campaignId)}/commands`, {
        method: 'POST',
        body: JSON.stringify({ operation, idempotencyKey: crypto.randomUUID(), expectedVersion: operations.version, expectedSubjectRevision: operations.subjectRevision, reason }),
      });
      workflowChanged();
      await store.load(true);
      notify(action === 'pause' ? 'Đã gửi yêu cầu tạm dừng.' : action === 'resume' ? 'Đã gửi yêu cầu nối lại.' : 'Đã gửi yêu cầu xóa Chiến dịch.');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Không hoàn tất được thao tác.');
    }
  };

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Không gian quản lý</p>
            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-vna-blue">{me.directSuperadmin ? 'Quản trị viên' : me.mode === 'DEMO_IMPERSONATION' ? 'Trình diễn' : me.mode === 'ADMIN_ASSIST' ? 'Đang hỗ trợ' : 'Không gian của bạn'}</span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Chiến dịch</h1>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" disabled={snapshot.loading} onClick={() => { void (listMode === 'trash' ? store.loadTrash() : store.load(true)); loadFormDrafts(); }}>{snapshot.loading ? 'Đang tải…' : 'Làm mới'}</Button>
          {listMode === 'active' ? <Button variant="secondary" className="gap-2" disabled={!capabilities['campaign.export']} onClick={() => openExchange('export')}><CpmsIcon name="export" />Xuất dữ liệu</Button> : null}
          {listMode === 'active' ? <Button variant="secondary" className="gap-2" disabled={!capabilities['campaign.import']} onClick={() => openExchange('import')}><CpmsIcon name="import" />Nhập dữ liệu</Button> : null}
          {capabilities['campaign.create'] && <AppLink className="inline-flex min-h-10 items-center rounded-xl bg-vna-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-vna-blue/90" to="/campaigns/new">Tạo chiến dịch mới</AppLink>}
        </div>
      </div>

      {snapshot.error ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900" role="alert">
          <span>{snapshot.error}</span>
          <Button size="sm" variant="secondary" onClick={() => void store.load(true)}>Thử lại</Button>
        </div>
      ) : null}

      <Card className="mb-5 overflow-visible">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <SectionHeading>Tìm kiếm</SectionHeading>
          <p className="text-xs text-slate-500">
            {quickFilterCount + columnFilterCount
              ? `${quickFilterCount + columnFilterCount} nhóm điều kiện đang áp dụng`
              : 'Chưa áp dụng bộ lọc'}
          </p>
        </div>
        <CampaignQuickFilters
          campaigns={campaigns}
          query={query}
          range={communicationRange}
          onApply={(nextQuery, nextRange) => {
            setQuery(nextQuery);
            setCommunicationRange(nextRange);
          }}
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <SectionHeading>Chiến dịch</SectionHeading>
            <div className="mt-3 flex items-center gap-2">
              <button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${listMode === 'active' ? 'bg-vna-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setListMode('active')}>Đang hoạt động</button>
              <button disabled={!capabilities['campaign.trash.read']} className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:text-slate-300 ${listMode === 'trash' ? 'bg-vna-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setListMode('trash')}>Thùng rác</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Hiển thị {filtered.length} / {campaigns.length} chiến dịch</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Số chiến dịch mỗi trang" className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700" value={pageSize} onChange={(event) => setPageSize(campaignPageSize(event.target.value))}>
              {CAMPAIGN_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} dòng</option>)}
            </select>
          </div>
        </div>

        {listMode === 'active' && <CampaignBatchWorkflowActions selectedIds={selectedIds} campaigns={campaigns} onSaved={() => { void store.load(true); }} />}
        <CampaignInlineTable
          campaigns={pagedCampaigns}
          filterSourceCampaigns={quickFilteredCampaigns}
          columnFiltersEnabled={columnFiltersEnabled}
          columnFilters={columnFilters}
          loading={snapshot.loading}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={sortByColumn}
          onColumnFiltersEnabledChange={(enabled) => {
            setColumnFiltersEnabled(enabled);
            if (!enabled) setColumnFilters({});
          }}
          onColumnFiltersChange={setColumnFilters}
          onSave={saveBatch}
          trashMode={listMode === 'trash'}
          onMoveToTrash={moveToTrash}
          onRestore={restore}
          onDeletePermanently={deletePermanently}
          onSelectionChange={handleSelectionChange}
          onVisibleFieldsChange={handleVisibleFieldsChange}
          onViewConversation={(campaignId) => openCollaboration('comments', campaignId)}
          onViewJournal={(campaignId) => openCollaboration('journal', campaignId)}
          onLifecycleAction={runLifecycleAction}
          formDrafts={listMode === 'active' ? formDrafts : []}
          onRefresh={() => { void (listMode === 'trash' ? store.loadTrash() : store.load(true)); loadFormDrafts(); }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>Trang {page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Trước</Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Sau</Button>
          </div>
        </div>
      </Card>
      <CampaignCollaborationPanel campaigns={selectCockpitCampaigns(snapshot)} selectedCampaignIds={selectedIds} focusRequest={collaborationFocus} notify={notify} />
      <CampaignSpreadsheetExchange open={exchangeOpen} initialTab={exchangeTab} filteredIds={filtered.map((campaign) => campaign.id)} selectedIds={selectedIds} visibleFieldKeys={visibleFieldKeys} onClose={() => setExchangeOpen(false)} onImported={async () => { await store.load(true); }} notify={notify} showGoogleSheets={false} />
    </>
  );
}
