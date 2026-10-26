import { MATERIAL_PUBLICATION_LABELS, type AccessPermission, type MaterialPortalBootstrap, type MaterialSummary } from '@cpms/domain';
import { Button, Card, CpmsIcon, SectionHeading } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialCollaborationPanel } from '../components/material-collaboration-panel';
import { defaultMaterialGroupMode, type MaterialGroupMode } from '../lib/material-grouping';
import { MaterialSpreadsheet } from '../components/material-spreadsheet';
import { useAuth } from '../auth-context';
import { useAccessCapabilities } from '../access-context';
import { getCampaign, getMaterialBootstrap, getMaterials, requestJson } from '../lib/api';
import { materialsForCampaign } from '../lib/campaign-materials';
import { materialCompletionInRange, materialRowFromSummary, matchesMaterialSearch, type MaterialGridRow } from '../lib/material-grid';
import { AppLink } from '../lib/router';

interface MaterialCampaignScope { id: string; code: string; name: string }
interface MaterialFormDraftSummary { id: string; materialId: string | null; title: string; updatedAt: string }
function rangeLabel(range: { from: string; to: string }) {
  const format = (value: string) => value ? value.split('-').reverse().join('/') : '';
  if (range.from && range.to) return `${format(range.from)} – ${format(range.to)}`;
  if (range.from) return `Từ ${format(range.from)}`;
  if (range.to) return `Đến ${format(range.to)}`;
  return 'Chọn khoảng thời gian';
}
export function MaterialPortalPage({ notify, campaignScope, embedded = false }: { notify(message: string): void; campaignScope?: MaterialCampaignScope; embedded?: boolean }) {
  const { me } = useAuth();
  const [routeCampaignId, setRouteCampaignId] = useState(() => embedded ? '' : new URLSearchParams(window.location.search).get('campaignId') || '');
  const [routeMaterialId, setRouteMaterialId] = useState(() => embedded ? '' : new URLSearchParams(window.location.search).get('material') || '');
  useEffect(() => { if (embedded) return; const update = () => { setRouteCampaignId(new URLSearchParams(window.location.search).get('campaignId') || ''); setRouteMaterialId(new URLSearchParams(window.location.search).get('material') || ''); }; window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, [embedded]);
  return <MaterialPortalContent key={`${me.account.id}:${me.mode}:${campaignScope?.id || routeCampaignId}:${routeMaterialId}`} notify={notify} embedded={embedded} routeCampaignId={routeCampaignId} routeMaterialId={routeMaterialId} {...(campaignScope ? { campaignScope } : {})}/>;
}
function MaterialPortalContent({ notify, campaignScope, embedded, routeCampaignId, routeMaterialId }: { notify(message: string): void; campaignScope?: MaterialCampaignScope; embedded: boolean; routeCampaignId: string; routeMaterialId: string }) {
  const { me } = useAuth(), capabilities = useAccessCapabilities();
  const can = useCallback((permission: AccessPermission) => capabilities[permission] === true, [capabilities]);
  const [scopedCampaign, setScopedCampaign] = useState<MaterialCampaignScope | null>(campaignScope || null);
  const [records, setRecords] = useState<MaterialSummary[]>([]), [bootstrap, setBootstrap] = useState<MaterialPortalBootstrap | null>(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [showTrash, setShowTrash] = useState(false);
  const [formDrafts, setFormDrafts] = useState<MaterialFormDraftSummary[]>([]);
  const [searchDraft, setSearchDraft] = useState(''), [search, setSearch] = useState('');
  const [completionRangeDraft, setCompletionRangeDraft] = useState({ from: '', to: '' }), [completionRange, setCompletionRange] = useState({ from: '', to: '' });
  const [publicationFilterDraft, setPublicationFilterDraft] = useState('ALL'), [publicationFilter, setPublicationFilter] = useState('ALL');
  const [columnStats, setColumnStats] = useState<{ count: number; active: number } | null>(null);
  const onFilterResult = useCallback((count: number, active: number) => setColumnStats(previous => previous?.count === count && previous.active === active ? previous : { count, active }), []);
  const [groupMode, setGroupMode] = useState<MaterialGroupMode>(() => defaultMaterialGroupMode(embedded));
  const [dateOpen, setDateOpen] = useState(false), [pageSize, setPageSize] = useState(10);
  const [collaboration, setCollaboration] = useState<MaterialGridRow | null>(null), [focusComment, setFocusComment] = useState(0), [focusJournal, setFocusJournal] = useState(0);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setLoadError('');
    try {
      const scope = campaignScope ?? (routeCampaignId ? await getCampaign(routeCampaignId).then(value => ({ id: value.id, code: value.code, name: value.name })) : null);
      const [next, options, drafts] = await Promise.all([routeMaterialId ? requestJson<MaterialSummary>(`/materials/${encodeURIComponent(routeMaterialId)}`).then(row => [row]) : getMaterials(showTrash), getMaterialBootstrap(), embedded || scope || showTrash ? Promise.resolve([]) : requestJson<MaterialFormDraftSummary[]>('/material-form-drafts')]);
      if (request !== sequence.current) return;
      setScopedCampaign(scope ?? null); setRecords(scope ? materialsForCampaign(next, scope, showTrash && !embedded) : next); setBootstrap(options); setFormDrafts(drafts);
    } catch (error) { if (request === sequence.current) setLoadError(error instanceof Error ? error.message : 'Không tải được dữ liệu Tư liệu.'); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [campaignScope, routeCampaignId, routeMaterialId, showTrash, embedded]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  function refreshList() { void load(); }
  function resetViewControls() { setSearchDraft(''); setSearch(''); setCompletionRangeDraft({ from: '', to: '' }); setCompletionRange({ from: '', to: '' }); setPublicationFilterDraft('ALL'); setPublicationFilter('ALL'); setDateOpen(false); setPageSize(10); }
  function applySearch() { setSearch(searchDraft); setCompletionRange(completionRangeDraft); setPublicationFilter(publicationFilterDraft); setDateOpen(false); }
  const rows = records.filter(record => record.isDeleted === showTrash).map(record => materialRowFromSummary(record));
  const filteredRows = rows.filter(row => matchesMaterialSearch(row, search) && materialCompletionInRange(row, completionRange) && (publicationFilter === 'ALL' || row.fields.publish_status === publicationFilter));
  const activeFilterCount = Number(Boolean(search)) + Number(Boolean(completionRange.from || completionRange.to)) + Number(publicationFilter !== 'ALL') + (columnStats?.active || 0);
  const mergeRecords = (updated: MaterialSummary[]) => setRecords(current => {
    const byId = new Map(current.map(row => [row.materialId, row]));
    for (const row of updated) { if ((row.fields as Record<string, unknown>).__purged || row.capabilities?.view === false) byId.delete(row.materialId); else byId.set(row.materialId, row); }
    const next = [...byId.values()]; return scopedCampaign ? materialsForCampaign(next, scopedCampaign, showTrash && !embedded) : next;
  });
  if (!bootstrap && loading) return <Card className="p-5 text-sm text-slate-600">Đang tải Tư liệu…</Card>;
  return <div className="min-w-0 w-full space-y-5">
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
          {can('material.create') && <AppLink className="inline-flex min-h-10 items-center rounded-xl bg-vna-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-vna-blue/90" to="/materials/new">Tạo tư liệu mới</AppLink>}
        </div>
      </header> : null}

      {scopedCampaign && !embedded ? <Card className="flex flex-wrap items-center justify-between gap-3 border-cyan-200 bg-cyan-50 p-4">
        <p className="text-sm text-slate-700">Đang hiển thị Tư liệu của Chiến dịch <strong>{scopedCampaign.code} · {scopedCampaign.name}</strong>, gồm cả Tư liệu gắn nhiều Chiến dịch.</p>
        <AppLink to="/materials" className="text-sm font-semibold text-vna-blue hover:underline">Xem toàn bộ Tư liệu</AppLink>
      </Card> : null}
      {routeMaterialId && <Card className="flex items-center justify-between gap-3 border-cyan-200 bg-cyan-50 p-4 text-sm">
        <span>Tư liệu được mở từ nguồn dẫn</span><AppLink to="/materials" className="font-semibold text-vna-blue">Xem toàn bộ Tư liệu</AppLink>
      </Card>}

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


    {loadError && <Card role="alert" className="flex items-center justify-between border-rose-200 p-4 text-rose-700">{loadError}<Button variant="secondary" onClick={refreshList}>Thử lại</Button></Card>}
    {!embedded && !showTrash && records.some(record => record.sharing?.mode === 'LEGACY' && record.capabilities?.manageSharing) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {records.filter(record => record.sharing?.mode === 'LEGACY' && record.capabilities?.manageSharing).length} tư liệu lịch sử trong danh sách đang giữ quyền cũ, chưa công khai. Dùng nút Chia sẻ trên từng tư liệu để xác nhận phạm vi; tác giả chưa xác định không được suy đoán.
    </p>}
    {bootstrap && <section className="min-w-0 w-full rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div><SectionHeading>Tư liệu QCTT</SectionHeading><div className="mt-3 flex gap-2"><Button size="sm" variant={showTrash ? 'ghost' : 'primary'} onClick={() => setShowTrash(false)}>Đang sử dụng</Button>{!embedded && can('material.manage') && <Button size="sm" variant={showTrash ? 'primary' : 'ghost'} onClick={() => setShowTrash(true)}>Thùng rác</Button>}</div>
        <p className="mt-1 text-xs text-slate-500">Hiển thị {columnStats?.count ?? filteredRows.length} / {rows.length} tư liệu{scopedCampaign ? ' của Chiến dịch này' : ''}{loading ? ' · Đang làm mới…' : ''}</p></div>
        <div className="flex items-center gap-2">{embedded && scopedCampaign && <AppLink to={`/materials?campaignId=${encodeURIComponent(scopedCampaign.id)}`} className="rounded-lg bg-vna-blue px-3 py-2 text-xs font-semibold text-white">Chỉnh sửa Tư liệu</AppLink>}
        <select aria-label={groupMode === 'NONE' ? "Số tư liệu mỗi trang" : "Số nhóm mỗi trang"} className="rounded-lg border p-2 text-xs" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>{[10,20,50].map(count => <option key={count} value={count}>{count} {groupMode === 'NONE' ? 'dòng' : 'nhóm'}</option>)}</select></div>
      </div>
      <MaterialSpreadsheet key={`${showTrash}`} actorId={me.account.id} records={records.filter(record => record.isDeleted === showTrash)} bootstrap={bootstrap} {...(scopedCampaign ? { campaign: scopedCampaign } : {})}
        embedded={embedded} trash={showTrash} can={can} directSuperadmin={me.directSuperadmin} notify={notify} onRecords={mergeRecords}
        onCollaboration={(row, tab) => { setCollaboration(row); if (tab === 'comments') setFocusComment(value => value + 1); else setFocusJournal(value => value + 1); }}
        search={search} dateRange={completionRange} publication={publicationFilter} pageSize={pageSize} onFilterResult={onFilterResult} onResetControls={resetViewControls} onGroupModeChange={setGroupMode}/>
    </section>}
    {!embedded && !showTrash && formDrafts.map(draft => <Card key={draft.id} className="flex justify-between gap-3 border-amber-200 bg-amber-50 p-4 text-sm"><span>Bản nháp form riêng · {draft.title || 'Chưa đặt tiêu đề'}</span><AppLink to={`${draft.materialId ? '/materials/' + encodeURIComponent(draft.materialId) + '/edit' : '/materials/new'}?draft=${encodeURIComponent(draft.id)}`} className="font-semibold text-vna-blue">Tiếp tục nhập</AppLink></Card>)}
    {!embedded && <MaterialCollaborationPanel materialId={collaboration?.materialId || null} materialTitle={collaboration?.fields.material_name || ''} focusComment={focusComment} focusJournal={focusJournal} canEdit={Boolean(records.find(record => record.materialId === collaboration?.materialId)?.capabilities?.edit)} notify={notify}/>}
  </div>;
}
