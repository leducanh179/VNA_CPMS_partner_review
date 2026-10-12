import type { CampaignAccessCapabilities, CampaignSummary } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requestJson } from '../lib/api';
import { changeLabels, type CampaignChangeRequest, type CampaignOperationsView } from '../lib/campaign-operations';
import { navigate } from '../lib/router';
import { hasUnsavedChanges, useUnsavedChanges } from '../lib/unsaved-changes';
import { useWorkflow, workflowChanged } from '../lib/campaign-workflow';

type RequestOperation = 'REQUEST_PAUSE' | 'REQUEST_CANCEL' | 'REQUEST_RESUME' | 'REQUEST_RESTORE' | 'REQUEST_PURGE';
type Dialog = { kind: RequestOperation } | { kind: 'WITHDRAW_REQUEST'; request: CampaignChangeRequest } | { kind: 'TRASH' } | { kind: 'PURGE' };

export function CampaignGlobalActions({ campaign, proposalActive, proposalRequiresApproval, proposalDirty, proposalSaving, onStartEdit, onSubmitProposal, onCancelProposal, onDuplicate, onMoveToTrash, onRestoreTrash, onDeletePermanently, onSaved, notify }: {
  campaign: CampaignSummary;
  proposalActive: boolean;
  proposalRequiresApproval: boolean;
  proposalDirty: boolean;
  proposalSaving: boolean;
  onStartEdit(access: CampaignAccessCapabilities, requiresApproval: boolean): void;
  onSubmitProposal(): Promise<void>;
  onCancelProposal(): void;
  onDuplicate?(): Promise<void>;
  onMoveToTrash?(reason: string): Promise<void>;
  onRestoreTrash?(): Promise<void>;
  onDeletePermanently?(reason: string): Promise<void>;
  onSaved(): void;
  notify(message: string): void;
}) {
  const { view: workflow, load: loadWorkflow } = useWorkflow(campaign.id);
  const [operations, setOperations] = useState<CampaignOperationsView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reason, setReason] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useUnsavedChanges(Boolean(dialog) && !busy);

  const loadOperations = useCallback(async () => {
    const token = ++epoch.current;
    try { const next = await requestJson<CampaignOperationsView>(`/campaign-operations/${encodeURIComponent(campaign.id)}`); if (epoch.current === token) setOperations(next); }
    catch { if (epoch.current === token) setOperations(null); }
  }, [campaign.id, campaign.isDeleted]);

  useEffect(() => { void loadOperations(); return () => { epoch.current++; }; }, [loadOperations, campaign.recordVersion]);
  useEffect(() => { const refresh = () => void loadOperations(); window.addEventListener('cpms:workflow-updated', refresh); return () => window.removeEventListener('cpms:workflow-updated', refresh); }, [loadOperations]);

  const refresh = async () => { workflowChanged(); await Promise.all([loadWorkflow(), loadOperations()]); onSaved(); };
  const runWorkflow = async (operation: 'SUBMIT' | 'WITHDRAW') => {
    if (!workflow || busy) return;
    if (hasUnsavedChanges()) { setError('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); return; }
    setBusy(true); setError('');
    try {
      await requestJson(`/campaign-workflow/${encodeURIComponent(campaign.id)}/commands`, { method: 'POST', body: JSON.stringify({ operation, idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version, expectedSubjectRevision: workflow.campaign.businessRevision, reason: operation === 'WITHDRAW' ? 'Người gửi lấy lại hồ sơ đang chờ duyệt.' : '', ...(operation === 'SUBMIT' ? { receivingDivisionId: null } : {}) }) });
      notify(operation === 'SUBMIT' ? 'Đã gửi Chiến dịch đến Ban TT.' : 'Đã lấy lại Chiến dịch về bản nháp.');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không hoàn tất thao tác.'); }
    finally { setBusy(false); }
  };

  const runDialog = async () => {
    if (!dialog || busy) return;
    setBusy(true); setError('');
    try {
      if (dialog.kind === 'TRASH') await onMoveToTrash?.(reason.trim());
      else if (dialog.kind === 'PURGE') await onDeletePermanently?.(reason.trim());
      else if (dialog.kind === 'WITHDRAW_REQUEST') {
        if (!operations) return;
        await requestJson(`/campaign-operations/${encodeURIComponent(campaign.id)}/commands`, { method: 'POST', body: JSON.stringify({ operation: 'WITHDRAW_REQUEST', idempotencyKey: crypto.randomUUID(), expectedVersion: operations.version, expectedSubjectRevision: operations.subjectRevision, requestId: dialog.request.id, expectedRequestVersion: dialog.request.recordVersion, reason }) });
        notify(`Đã lấy lại yêu cầu “${changeLabels[dialog.request.kind]}”.`);
        await refresh();
      } else {
        if (!operations) return;
        await requestJson(`/campaign-operations/${encodeURIComponent(campaign.id)}/commands`, { method: 'POST', body: JSON.stringify({ operation: dialog.kind, idempotencyKey: crypto.randomUUID(), expectedVersion: operations.version, expectedSubjectRevision: operations.subjectRevision, reason }) });
        const message = dialog.kind === 'REQUEST_PURGE' ? 'Đã gửi yêu cầu phê duyệt Xóa vĩnh viễn.' : dialog.kind === 'REQUEST_PAUSE' ? 'Đã gửi yêu cầu tạm dừng.' : dialog.kind === 'REQUEST_CANCEL' ? 'Đã gửi yêu cầu xóa Chiến dịch.' : dialog.kind === 'REQUEST_RESUME' ? 'Đã gửi yêu cầu nối lại Chiến dịch.' : 'Đã gửi yêu cầu khôi phục Chiến dịch.';
        const action = dialog.kind.replace('REQUEST_', '');
        notify(operations.approvalRequired?.[action] === false ? `Đã áp dụng: ${changeLabels[action as CampaignChangeRequest['kind']]}.` : message); await refresh();
      }
      setDialog(null); setReason(''); setConfirmCode('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không hoàn tất thao tác.'); }
    finally { setBusy(false); }
  };

  const pending = operations?.requests.filter((request) => request.state === 'PENDING') ?? [];
  const withdrawable = pending.filter((request) => request.canWithdraw);
  const initialPending = Boolean(workflow?.capabilities.withdraw && workflow.revision && ['PENDING','NEEDS_ASSIGNEE'].includes(workflow.revision.state));
  const draftLike = !workflow?.revision || ['DRAFT', 'RETURNED', 'REJECTED', 'NEEDS_ROUTING', 'NEEDS_ASSIGNEE', 'CANCELLED'].includes(workflow.revision.state);
  const canSubmit = Boolean(workflow?.capabilities.submit && draftLike);
  const canRequest = Boolean(operations?.capabilities.requestChange);
  const hasPending = (kind: CampaignChangeRequest['kind']) => pending.some((request) => request.kind === kind);
  const open = (next: Dialog) => { if (hasUnsavedChanges()) { setError('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); return; } setError(''); setReason(''); setConfirmCode(''); setDialog(next); };

  return <>
    <Card className="overflow-hidden border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 sm:px-5">
        <div><h2 className="text-sm font-semibold text-slate-950">Thao tác với toàn bộ Chiến dịch</h2><p className="mt-1 hidden text-xs text-slate-500 sm:block">Áp dụng cho Thông tin, Tư liệu, Kế hoạch và Kết quả của hồ sơ.</p></div>
        {campaign.pendingChangeLabel ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{campaign.pendingChangeLabel}</span> : null}
      </div>
      <div role="group" aria-label="Thao tác với toàn bộ Chiến dịch" className="flex gap-2 overflow-x-auto px-4 py-2 [&>button]:shrink-0 [&>button]:whitespace-nowrap sm:flex-wrap sm:px-5">
        {campaign.isDeleted ? <>
          {onRestoreTrash ? <button type="button" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void onRestoreTrash()}><CpmsIcon name="restore" />KHÔI PHỤC</button> : null}
          {onDeletePermanently ? <button type="button" disabled={busy || hasPending('PURGE')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-800 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => open({ kind: operations?.capabilities.purge && operations.approvalRequired?.PURGE !== false && !operations.capabilities.purgeApproved ? 'REQUEST_PURGE' : 'PURGE' })}><CpmsIcon name="delete" />{hasPending('PURGE') ? 'CHỜ DUYỆT XÓA VĨNH VIỄN' : 'XÓA VĨNH VIỄN'}</button> : null}
        </> : proposalActive ? <>
          <button type="button" disabled={busy || proposalSaving || !proposalDirty} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void onSubmitProposal()}><CpmsIcon name={proposalRequiresApproval ? 'approve' : 'save'} />{proposalRequiresApproval ? 'HOÀN THÀNH & GỬI BAN TT' : 'LƯU THAY ĐỔI'}</button>
          <Button variant="secondary" disabled={busy || proposalSaving} onClick={onCancelProposal}>Hủy sửa đổi</Button>
        </> : <>
          {canSubmit ? <button type="button" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void runWorkflow('SUBMIT')}><CpmsIcon name="approve" />GỬI BAN TT</button> : null}
          {campaign.lifecycleState === 'DRAFT' && campaign.access?.permissions['campaign.update'] ? <Button variant="secondary" disabled={busy} onClick={() => navigate(`/campaigns/new?saved=${encodeURIComponent(campaign.id)}`)}><CpmsIcon name="edit" />SỬA ĐỔI</Button> : null}
          {initialPending ? <Button variant="secondary" disabled={busy} onClick={() => void runWorkflow('WITHDRAW')}><CpmsIcon name="back" />LẤY LẠI</Button> : null}
          {withdrawable.map((request) => <Button key={request.id} variant="secondary" disabled={busy} onClick={() => open({ kind: 'WITHDRAW_REQUEST', request })}><CpmsIcon name="back" />LẤY LẠI · {changeLabels[request.kind]}</Button>)}
          {canRequest && operations?.operationalState === 'ACTIVE' && operations.proposalAccess?.canEditAnyField ? <Button variant="secondary" disabled={busy || hasPending('EDIT') || withdrawable.length > 0} onClick={() => { if (hasUnsavedChanges()) setError('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); else onStartEdit(operations.proposalAccess!, operations.approvalRequired?.EDIT !== false); }}><CpmsIcon name="edit" />SỬA ĐỔI</Button> : null}
          {canRequest && operations?.operationalState === 'ACTIVE' ? <button type="button" disabled={busy || hasPending('PAUSE') || withdrawable.length > 0} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50" onClick={() => open({ kind: 'REQUEST_PAUSE' })}><CpmsIcon name="pending" />TẠM DỪNG</button> : null}
          {canRequest && operations?.operationalState !== 'CANCELLED' ? <button type="button" disabled={busy || hasPending('CANCEL') || withdrawable.length > 0} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" onClick={() => open({ kind: operations?.approvalRequired?.CANCEL === false && onMoveToTrash ? 'TRASH' : 'REQUEST_CANCEL' })}><CpmsIcon name="delete" />XÓA</button> : null}
          {operations?.capabilities.resume ? <button type="button" disabled={busy || hasPending('RESUME')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => open({ kind: 'REQUEST_RESUME' })}><CpmsIcon name="refresh" />NỐI LẠI</button> : null}
          {operations?.capabilities.restore ? <button type="button" disabled={busy || hasPending('RESTORE')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => open({ kind: 'REQUEST_RESTORE' })}><CpmsIcon name="restore" />KHÔI PHỤC</button> : null}
          {onMoveToTrash && draftLike ? <button type="button" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" onClick={() => open({ kind: 'TRASH' })}><CpmsIcon name="delete" />XÓA</button> : null}
          {onDuplicate ? <Button variant="ghost" disabled={busy} onClick={() => { if (hasUnsavedChanges()) setError('Hãy lưu hoặc hủy nội dung đang sửa trước khi tiếp tục.'); else void onDuplicate(); }}><CpmsIcon name="duplicate" />Nhân bản</Button> : null}
        </>}
      </div>
      {error ? <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</p> : null}
    </Card>
    {dialog ? createPortal(<ActionDialog campaign={campaign} dialog={dialog} direct={operations?.approvalRequired?.[dialog.kind.replace('REQUEST_', '')] === false} reason={reason} confirmCode={confirmCode} busy={busy} onReason={setReason} onConfirmCode={setConfirmCode} onCancel={() => { if (!busy) setDialog(null); }} onConfirm={() => void runDialog()} />, document.body) : null}
  </>;
}

function ActionDialog({ campaign, dialog, direct, reason, confirmCode, busy, onReason, onConfirmCode, onCancel, onConfirm }: { campaign: CampaignSummary; dialog: Dialog; direct: boolean; reason: string; confirmCode: string; busy: boolean; onReason(value: string): void; onConfirmCode(value: string): void; onCancel(): void; onConfirm(): void }) {
  const title = dialog.kind === 'REQUEST_PAUSE' ? 'Tạm dừng Chiến dịch' : dialog.kind === 'REQUEST_CANCEL' ? 'Xóa Chiến dịch' : dialog.kind === 'REQUEST_RESUME' ? 'Nối lại Chiến dịch' : dialog.kind === 'REQUEST_RESTORE' ? 'Khôi phục Chiến dịch' : dialog.kind === 'WITHDRAW_REQUEST' ? `Lấy lại · ${changeLabels[dialog.request.kind]}` : dialog.kind === 'PURGE' ? 'Xóa vĩnh viễn Chiến dịch' : 'Xóa Chiến dịch';
  const message = dialog.kind === 'REQUEST_PAUSE' ? 'Yêu cầu sẽ được gửi đến Lãnh đạo Phòng phụ trách phê duyệt.' : dialog.kind === 'REQUEST_CANCEL' ? 'Yêu cầu xóa sẽ được gửi đến Lãnh đạo Phòng; dữ liệu tại các phân hệ nguồn không bị xóa theo.' : dialog.kind === 'REQUEST_RESUME' ? 'Chỉ nối lại sau khi Lãnh đạo Phòng phê duyệt.' : dialog.kind === 'REQUEST_RESTORE' ? 'Chỉ khôi phục trạng thái hoạt động sau khi Lãnh đạo Phòng phê duyệt.' : dialog.kind === 'WITHDRAW_REQUEST' ? 'Yêu cầu đang chờ sẽ được rút lại và không còn xuất hiện trong danh sách cần phê duyệt.' : dialog.kind === 'PURGE' ? 'Chiến dịch sẽ không thể khôi phục. Nhập đúng mã chiến dịch để xác nhận.' : 'Chiến dịch sẽ được chuyển vào Thùng rác và có thể khôi phục.';
  const requiresCode = dialog.kind === 'PURGE' || dialog.kind === 'REQUEST_PURGE';
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><Card role="dialog" aria-modal="true" aria-labelledby="campaign-action-title" className="w-full max-w-xl p-6 shadow-2xl"><h2 id="campaign-action-title" className="text-xl font-semibold text-slate-950">{dialog.kind === 'REQUEST_PURGE' ? 'Yêu cầu Xóa vĩnh viễn' : title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{dialog.kind === 'REQUEST_PURGE' ? 'Gửi Lãnh đạo Phòng phê duyệt quyền xóa vĩnh viễn. Sau khi được duyệt, bạn vẫn phải xác nhận xóa và đáp ứng kiểm tra an toàn dữ liệu.' : direct && dialog.kind.startsWith('REQUEST_') ? 'Thao tác sẽ được áp dụng ngay theo chính sách hiện hành, không cần Lãnh đạo Phòng phê duyệt.' : message}</p>
    <label className="mt-5 block text-sm font-semibold text-slate-700">Lý do <span className="font-normal text-slate-500">(không bắt buộc)</span><textarea autoFocus={!requiresCode} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-vna-blue focus:ring-4 focus:ring-cyan-100" rows={3} maxLength={1000} value={reason} onChange={(event) => onReason(event.target.value)} /></label>
    {requiresCode ? <label className="mt-4 block text-sm font-semibold text-slate-700">Nhập mã <span className="font-mono">{campaign.code}</span><input autoFocus className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono outline-none focus:border-vna-blue focus:ring-4 focus:ring-cyan-100" value={confirmCode} onChange={(event) => onConfirmCode(event.target.value)} /></label> : null}
    <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onCancel}>Hủy</Button><button type="button" disabled={busy || (requiresCode && confirmCode !== campaign.code)} className={`min-h-10 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-50 ${dialog.kind === 'PURGE' || dialog.kind === 'REQUEST_CANCEL' || dialog.kind === 'TRASH' ? 'bg-rose-700' : 'bg-vna-blue'}`} onClick={onConfirm}>{busy ? 'Đang xử lý…' : 'OK'}</button></div>
  </Card></div>;
}
