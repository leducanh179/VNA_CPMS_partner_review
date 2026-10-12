import { Button, Card, CpmsIcon, LoadingBlock, StatusBadge, type CpmsIconName } from '@cpms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCampaignWorkspace } from '../campaign-context';
import { CampaignApprovalWorkspace } from '../components/campaign-approval-workspace';
import { CampaignDriveWorkspaceCard } from '../components/campaign-drive-workspace-card';
import { CampaignMaterialsTable } from '../components/campaign-materials-table';
import { CampaignGlobalActions } from '../components/campaign-global-actions';
import { CampaignDetailDock } from '../components/campaign-detail-dock';
import { CampaignGovernanceSummary } from '../components/campaign-governance-summary';
import { CampaignRecordForm, type CampaignRecordFormHandle } from '../components/campaign-record-form';
import { campaignRecordValue, toCreateCommand, toUpdateCommand, type CampaignRecordValue } from '../lib/campaign-v2-form';
import { CAMPAIGN_STATE_LABELS } from '../lib/campaign-presentation';
import { AppLink, navigate } from '../lib/router';
import { useAccessCapabilities } from '../access-context';
import { useAuth } from '../auth-context';
import { confirmUnsavedNavigation, hasUnsavedChanges } from '../lib/unsaved-changes';
import { isCampaignCodeCompliant, type CampaignAccessCapabilities } from '@cpms/domain';
import { requestJson } from '../lib/api';

import { QcttPlanWorkspace } from '../components/qctt-plan-workspace';
import { useWorkflow } from '../lib/campaign-workflow';
import { canAccessCampaignApprovalTab, shouldOpenCampaignApprovalTab } from '../lib/campaign-detail-access';

const SYSTEM_FIELDS = new Set(['campaign_code', 'created_at', 'created_by', 'last_updated_at', 'last_updated_by', 'campaign_folder_id', 'campaign_folder_link']);
type CampaignDetailTab = 'approval' | 'information' | 'documents' | 'planning' | 'results';
const DETAIL_TABS: { id: CampaignDetailTab; label: string; icon: CpmsIconName }[] = [
  { id: 'approval', label: 'Phê duyệt', icon: 'approve' },
  { id: 'information', label: 'Thông tin', icon: 'info' },
  { id: 'documents', label: 'Tư liệu', icon: 'folder' },
  { id: 'planning', label: 'Kế hoạch', icon: 'planning' },
  { id: 'results', label: 'Kết quả', icon: 'report' },
];

function initialDetailTab(deleted: boolean): CampaignDetailTab {
  const candidate = new URLSearchParams(window.location.search).get('tab');
  if (DETAIL_TABS.some((tab) => tab.id === candidate) && candidate !== 'approval' && !(deleted && candidate === 'planning')) return candidate as CampaignDetailTab;
  return 'information';
}

export function CampaignDetailPage({ id, notify }: { id: string; notify(message: string): void }) {
  const { store, snapshot } = useCampaignWorkspace();
  const capabilities = useAccessCapabilities();
  const { me } = useAuth();
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codeRepairing, setCodeRepairing] = useState(false);
  const [codeRepairConfirming, setCodeRepairConfirming] = useState(false);
  const [codeRepairError, setCodeRepairError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalAccess, setProposalAccess] = useState<CampaignAccessCapabilities | null>(null);
  const [proposalRequiresApproval, setProposalRequiresApproval] = useState(true);
  const [proposalReason, setProposalReason] = useState('');
  const [proposalKey, setProposalKey] = useState(() => crypto.randomUUID());
  const [proposalDirty, setProposalDirty] = useState(false);
  const formRef = useRef<CampaignRecordFormHandle>(null);
  const campaign = [...snapshot.campaigns, ...snapshot.trashCampaigns].find((item) => item.id === id);
  const formCampaign = useMemo(
    () => campaign && proposalAccess ? { ...campaign, access: proposalAccess } : campaign,
    [campaign, proposalAccess],
  );
  const [activeTab, setActiveTab] = useState<CampaignDetailTab>(() => initialDetailTab(Boolean(campaign?.isDeleted)));
  const { view: pageWorkflow } = useWorkflow(id);
  const canSeeApproval = canAccessCampaignApprovalTab({ directSuperadmin: me.directSuperadmin, actorId: me.account.id, workflow: pageWorkflow, deleted: Boolean(campaign?.isDeleted) });
  const visibleTabs = DETAIL_TABS.filter((tab) => tab.id !== 'approval' || canSeeApproval);

  useEffect(() => {
    if (snapshot.initialized && !campaign && !requested) {
      setRequested(true);
      void store.loadOne(id).catch(() => undefined);
    }
  }, [campaign, id, requested, snapshot.initialized, store]);

  useEffect(() => {
    if (campaign?.isDeleted && (activeTab === 'approval' || activeTab === 'planning')) { setActiveTab('information'); return; }
    if (!canSeeApproval && activeTab === 'approval') { setActiveTab('information'); return; }
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (!campaign?.isDeleted && activeTab === 'information' && shouldOpenCampaignApprovalTab(requestedTab, canSeeApproval, Boolean(pageWorkflow))) setActiveTab('approval');
  }, [activeTab, campaign?.isDeleted, canSeeApproval, pageWorkflow]);

  if (!campaign && (!snapshot.initialized || snapshot.loading)) return <Card><LoadingBlock label="Đang mở hồ sơ chiến dịch…" /></Card>;
  if (!campaign) return <Card className="mx-auto max-w-2xl p-8 text-center"><p className="font-semibold text-rose-700">Không tìm thấy chiến dịch.</p><p className="mt-2 text-sm text-slate-600">{snapshot.error ?? 'Hồ sơ không tồn tại hoặc đã bị xóa.'}</p></Card>;

  const persist = async (value: CampaignRecordValue) => {
    setSaving(true);
    setError(null);
    try {
      if (proposalAccess) {
        if (proposalRequiresApproval && !proposalReason.trim()) throw new Error('Cần nhập lý do sửa đổi chiến dịch trước khi gửi phê duyệt.');
        await requestJson(`/campaign-operations/${campaign.id}/changes`, { method: 'POST', body: JSON.stringify({ ...toUpdateCommand(value, campaign.recordVersion), reason: proposalReason, idempotencyKey: proposalKey }) });
        setProposalAccess(null); setProposalRequiresApproval(true); setProposalReason(''); setProposalKey(crypto.randomUUID());
        return await store.loadOne(campaign.id, true);
      }
      return await store.update(campaign.id, toUpdateCommand(value, campaign.recordVersion));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Không thể lưu chiến dịch.';
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (value: CampaignRecordValue) => {
    setSaving(true);
    setError(null);
    try {
      const fieldValues = Object.fromEntries(Object.entries(value.fieldValues).filter(([key]) => !SYSTEM_FIELDS.has(key)));
      return await store.create(toCreateCommand({ ...value, lifecycleState: 'DRAFT', fieldValues }));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Không thể nhân bản chiến dịch.';
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
    }
  };

  const moveToTrash = async (_reason: string) => {
    await store.moveToTrash(campaign.id);
    notify(`Đã chuyển ${campaign.code} vào Thùng rác.`);
    navigate('/campaigns', false, true);
  };

  const deletePermanently = async (_reason: string) => {
    await store.deletePermanently(campaign.id);
    notify(`Đã xóa vĩnh viễn ${campaign.code}.`);
    navigate('/campaigns', false, true);
  };

  const restoreTrash = async () => {
    await store.restore(campaign.id);
    notify(`Đã khôi phục ${campaign.code}.`);
    navigate(`/campaigns/${campaign.id}?tab=information`, false, true);
  };

  const selectTab = (next: CampaignDetailTab) => {
    if (next === activeTab || (!canSeeApproval && next === 'approval') || (campaign.isDeleted && (next === 'approval' || next === 'planning'))) return;
    if (!confirmUnsavedNavigation()) return;
    setActiveTab(next);
    const url = new URL(window.location.href);
    if (next === 'approval') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refreshCampaign = () => { void store.loadOne(campaign.id, true).catch(() => undefined); };

  const regenerateCode = async () => {
    setCodeRepairError(null); setCodeRepairing(true);
    try {
      const updated = await requestJson<{ code: string }>(`/campaigns/${campaign.id}/regenerate-code`, { method: 'POST', body: JSON.stringify({ expectedVersion: campaign.recordVersion }) });
      await store.loadOne(campaign.id, true);
      setCodeRepairConfirming(false);
      notify(`Đã chuẩn hóa mã Chiến dịch thành ${updated.code}.`);
    } catch (cause) { setCodeRepairError(cause instanceof Error ? cause.message : 'Không thể chuẩn hóa mã Chiến dịch.'); }
    finally { setCodeRepairing(false); }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex flex-wrap items-center gap-3"><p className="font-mono text-sm font-bold text-vna-blue">{campaign.code}</p>{me.directSuperadmin && !campaign.isDeleted && !isCampaignCodeCompliant(campaign.code) ? <button type="button" disabled={codeRepairing} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-vna-blue hover:bg-cyan-50 disabled:opacity-50" onClick={() => setCodeRepairConfirming(true)}>{codeRepairing ? 'Đang đổi mã…' : 'Chuẩn hóa mã'}</button> : null}<StatusBadge>{campaign.isDeleted ? 'Trong Thùng rác' : campaign.qcttStatus ?? CAMPAIGN_STATE_LABELS[campaign.lifecycleState]}</StatusBadge>{campaign.pendingChangeLabel && <span className="text-xs text-amber-700">{campaign.pendingChangeLabel}</span>}</div><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{campaign.name}</h1>{codeRepairError ? <p role="alert" className="mt-2 text-sm text-rose-700">{codeRepairError}</p> : null}</div>
        <div className="flex flex-wrap items-center gap-2">
          <AppLink className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-vna-blue/40 hover:text-vna-blue" to="/campaigns"><CpmsIcon name="back" />Trở lại danh sách</AppLink>
          {capabilities['booking.read']&&<AppLink className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-vna-blue" to={`/bookings?campaignId=${campaign.id}`}><CpmsIcon name="booking"/>Đặt chỗ của chiến dịch</AppLink>}
        </div>
      </div>
      {codeRepairConfirming && me.directSuperadmin && !campaign.isDeleted && !isCampaignCodeCompliant(campaign.code) ? (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4">
          <div role="group" aria-label="Xác nhận chuẩn hóa mã Chiến dịch">
            <p className="text-sm font-semibold text-slate-900">Đổi mã {campaign.code} sang mã mới đúng quy tắc?</p>
            <p className="mt-1 text-sm text-slate-700">Mã cũ sẽ không còn dùng để tra cứu. Mã chiến dịch mới được ghi vào lịch sử kiểm toán.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={codeRepairing} onClick={() => setCodeRepairConfirming(false)}>Hủy</Button>
              <Button disabled={codeRepairing} onClick={() => void regenerateCode()}>{codeRepairing ? 'Đang đổi mã…' : 'Xác nhận đổi mã'}</Button>
            </div>
          </div>
        </Card>
      ) : null}
      <CampaignDetailDock>
        <CampaignGlobalActions campaign={campaign} proposalActive={Boolean(proposalAccess)} proposalRequiresApproval={proposalRequiresApproval} proposalDirty={proposalDirty} proposalSaving={saving}
          onStartEdit={(access, requiresApproval) => { if (activeTab !== 'information') selectTab('information'); setProposalAccess(access); setProposalRequiresApproval(requiresApproval); setProposalKey(crypto.randomUUID()); setError(null); }}
          onSubmitProposal={async () => { await formRef.current?.submit(); }}
          onCancelProposal={() => { if (!hasUnsavedChanges() || window.confirm('Bỏ nội dung sửa đổi chưa lưu?')) { setProposalAccess(null); setProposalRequiresApproval(true); setProposalReason(''); } }}
          {...(capabilities['campaign.create'] && !proposalAccess ? { onDuplicate: () => duplicate(campaignRecordValue(campaign)).then(() => undefined) } : {})}
          {...(!campaign.isDeleted && campaign.access?.permissions['campaign.delete'] && !proposalAccess ? { onMoveToTrash: moveToTrash } : {})}
          {...(campaign.isDeleted && campaign.access?.permissions['campaign.restore'] ? { onRestoreTrash: restoreTrash } : {})}
          {...(campaign.isDeleted && campaign.access?.permissions['campaign.purge'] ? { onDeletePermanently: deletePermanently } : {})}
          onSaved={refreshCampaign} notify={notify} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto border-b border-slate-200 bg-slate-50/70">
          <div role="tablist" aria-label="Nội dung Chiến dịch" className="flex min-w-max items-end gap-1 px-3 pt-2 sm:px-5">
            {visibleTabs.map((tab) => { const disabled = campaign.isDeleted && tab.id === 'planning'; return <button key={tab.id} id={`campaign-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`campaign-tabpanel-${tab.id}`} disabled={disabled} title={tab.label} className={`inline-flex min-h-12 items-center gap-2 rounded-t-xl border border-b-0 px-4 py-3 text-sm font-semibold transition ${activeTab === tab.id ? 'border-slate-200 bg-white text-vna-blue shadow-sm' : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900'} disabled:cursor-not-allowed disabled:opacity-40`} onClick={() => selectTab(tab.id)}><CpmsIcon name={tab.icon} /><span className="hidden sm:inline">{tab.label}</span></button>; })}
          </div>
        </div>
        {canSeeApproval && activeTab !== 'approval' ? <div className="flex justify-end bg-white px-4 py-2 sm:px-5"><button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-vna-blue px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-vna-blue/90" onClick={() => selectTab('approval')}><CpmsIcon name="back" />Trở lại Phê duyệt</button></div> : null}
      </Card>
      </CampaignDetailDock>

      <section id={`campaign-tabpanel-${activeTab}`} role="tabpanel" aria-labelledby={`campaign-tab-${activeTab}`}>
        {activeTab === 'approval' && !campaign.isDeleted ? <CampaignApprovalWorkspace campaign={campaign} onNavigateInformation={() => selectTab('information')} onSaved={refreshCampaign} /> : null}

        {activeTab === 'information' ? <>
          <CampaignGovernanceSummary campaign={campaign} />
          {proposalAccess && <Card className="mb-4 border-cyan-200 bg-cyan-50 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">{proposalRequiresApproval ? 'Đề nghị sửa đổi Chiến dịch' : 'Sửa trực tiếp Chiến dịch'}</h2><p className="mt-1 text-xs text-slate-600">{proposalRequiresApproval ? 'Nội dung sẽ được gửi Lãnh đạo Phòng phê duyệt.' : 'Thay đổi sẽ được lưu ngay theo chính sách hiện hành.'}</p></div><Button variant="ghost" disabled={saving} onClick={() => { if (!hasUnsavedChanges() || window.confirm('Bỏ nội dung sửa đổi chưa lưu?')) { setProposalAccess(null); setProposalRequiresApproval(true); setProposalReason(''); } }}>Hủy sửa đổi</Button></div><label className="mt-3 block text-sm">Lý do sửa đổi <span className="text-slate-500">({proposalRequiresApproval ? 'bắt buộc' : 'không bắt buộc'})</span><textarea className="mt-1 w-full rounded-xl border border-slate-200 p-3" aria-label="Lý do sửa đổi" rows={2} maxLength={1000} value={proposalReason} onChange={(event) => setProposalReason(event.target.value)} /></label></Card>}
          <CampaignRecordForm ref={formRef} key={`${campaign.id}:${proposalAccess ? 'proposal' : 'effective'}`} campaign={formCampaign!} saving={saving} error={error} onPersist={persist} showDriveWorkspace={false} showSaveBar={!proposalAccess} onDirtyChange={setProposalDirty} {...(proposalAccess ? { successMessage: proposalRequiresApproval ? 'Đã gửi đề nghị sửa đổi.' : 'Đã lưu thay đổi.' } : {})} notify={notify} />
        </> : null}

        {activeTab === 'documents' ? <>{capabilities['material.read'] ? <CampaignMaterialsTable campaign={campaign} notify={notify} /> : null}{campaign.access?.permissions['campaign.drive.read'] ? <CampaignDriveWorkspaceCard campaign={campaign} notify={notify} /> : !capabilities['material.read'] ? <UnavailableTab icon="folder" title="Tư liệu" message="Tài khoản hiện tại không có quyền xem tư liệu của Chiến dịch này." /> : null}</> : null}
        {activeTab === 'planning' && !campaign.isDeleted ? <QcttPlanWorkspace campaignId={campaign.id} onInitialized={refreshCampaign} /> : null}
        {activeTab === 'results' ? <UnavailableTab icon="report" title="Kết quả" message="Dữ liệu kết quả sẽ được bổ sung khi phân hệ liên quan hoàn thiện." /> : null}
      </section>
    </div>
  );
}

function UnavailableTab({ icon, title, message }: { icon: CpmsIconName; title: string; message: string }) {
  return <Card className="p-10 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-cyan-50 text-vna-blue"><CpmsIcon name={icon} /></span><h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-500">{message}</p></Card>;
}
