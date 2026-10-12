import { useCallback, useEffect, useRef, useState } from 'react';
import { useCampaignWorkspace } from '../campaign-context';
import { CampaignRecordForm, type CampaignRecordFormHandle } from '../components/campaign-record-form';
import { campaignRecordValue, toCreateCommand, toUpdateCommand, type CampaignRecordValue } from '../lib/campaign-v2-form';
import type { CampaignSummary } from '@cpms/domain';
import { requestJson } from '../lib/api';
import { navigate, registerPendingNavigationGuard } from '../lib/router';
import type { WorkflowView } from '../lib/campaign-workflow';

interface SavedFormDraft { id: string; formData: CampaignRecordValue; recordVersion: number }

export function CampaignNewPage({ notify }: { notify(message: string): void }) {
  const { store } = useCampaignWorkspace();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedCampaignId = new URLSearchParams(window.location.search).get('saved');
  const requestedDraftId = new URLSearchParams(window.location.search).get('draft');
  const draftId = useRef(requestedDraftId ?? crypto.randomUUID());
  const draftVersion = useRef(0);
  const draftExists = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const finishing = useRef(false);
  const formRef = useRef<CampaignRecordFormHandle>(null);
  const [initialDraft, setInitialDraft] = useState<CampaignRecordValue | null>(requestedDraftId || requestedCampaignId ? null : campaignRecordValue());
  const [savedCampaign, setSavedCampaign] = useState<CampaignSummary | null>(null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const submission = useRef({ payload: '', key: crypto.randomUUID() });

  useEffect(() => {
    if (!requestedCampaignId) return;
    let active = true;
    void store.loadOne(requestedCampaignId, true).then((campaign) => { if (active) setSavedCampaign(campaign); })
      .catch((caught: unknown) => { if (active) setDraftLoadError(caught instanceof Error ? caught.message : 'Không mở được Chiến dịch đã lưu.'); });
    return () => { active = false; };
  }, [requestedCampaignId, store]);

  useEffect(() => {
    if (!requestedDraftId) return;
    let active = true;
    void requestJson<SavedFormDraft>(`/campaign-form-drafts/${encodeURIComponent(requestedDraftId)}`).then((draft) => {
      if (!active) return;
      draftVersion.current = draft.recordVersion;
      draftExists.current = true;
      setInitialDraft({ ...campaignRecordValue(), ...draft.formData });
    }).catch((caught: unknown) => { if (active) setDraftLoadError(caught instanceof Error ? caught.message : 'Không mở được bản nhập dở.'); });
    return () => { active = false; };
  }, [requestedDraftId]);

  const saveDraft = useCallback((value: CampaignRecordValue) => {
    if (finishing.current) return Promise.resolve();
    const save = saveQueue.current.catch(() => undefined).then(async () => {
      const row = await requestJson<SavedFormDraft>(`/campaign-form-drafts/${draftId.current}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: draftVersion.current, value }) });
      draftVersion.current = row.recordVersion;
      draftExists.current = true;
    });
    saveQueue.current = save;
    return save;
  }, []);

  useEffect(() => {
    if (savedCampaign) return;
    return registerPendingNavigationGuard(async () => {
    if (finishing.current) return false;
    try {
      if (formRef.current?.isDirty()) await saveDraft(formRef.current.currentValue());
      else await saveQueue.current;
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa lưu được bản nhập dở.');
      return false;
    }
    });
  }, [saveDraft, savedCampaign]);

  const exit = async () => {
    if (savedCampaign) { navigate('/campaigns'); return; }
    try {
      if (formRef.current?.isDirty()) await saveDraft(formRef.current.currentValue());
      else await saveQueue.current;
      navigate('/campaigns', false, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa lưu được bản nhập dở.');
    }
  };

  const discardDraft = async () => {
    if (!window.confirm('Bỏ bản nhập dở này? Dữ liệu chưa tạo thành Chiến dịch sẽ không thể khôi phục.')) return;
    finishing.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveQueue.current;
      if (draftExists.current) await requestJson(`/campaign-form-drafts/${draftId.current}`, { method: 'DELETE' });
      draftExists.current = false;
      navigate('/campaigns', false, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa bỏ được bản nhập dở.');
    } finally {
      setSaving(false);
      finishing.current = false;
    }
  };

  const persist = async (value: CampaignRecordValue, sendToComm = false) => {
    setSaving(true);
    setError(null);
    finishing.current = true;
    try {
      await saveQueue.current;
      let created: CampaignSummary;
      if (savedCampaign && sendToComm) {
        const workflow = await requestJson<WorkflowView>(`/campaign-workflow/${encodeURIComponent(savedCampaign.id)}`);
        await requestJson(`/campaign-workflow/${encodeURIComponent(savedCampaign.id)}/commands`, { method: 'POST', body: JSON.stringify({
          operation: 'SUBMIT', idempotencyKey: crypto.randomUUID(), expectedVersion: workflow.version,
          expectedSubjectRevision: workflow.campaign.businessRevision, receivingDivisionId: null,
        }) });
        created = await store.loadOne(savedCampaign.id, true);
      } else if (savedCampaign) created = await store.update(savedCampaign.id, toUpdateCommand(value, savedCampaign.recordVersion));
      else if (!sendToComm) created = await store.create(toCreateCommand(value));
      else {
        const command = toCreateCommand(value); const payload = JSON.stringify(command);
        if (submission.current.payload !== payload) submission.current = { payload, key: crypto.randomUUID() };
        created = await requestJson<CampaignSummary>('/campaign-operations/create-and-submit', { method: 'POST', body: JSON.stringify({ ...command, idempotencyKey: submission.current.key }) });
        await store.loadOne(created.id, true);
      }
      if (!savedCampaign && draftExists.current) {
        try { await requestJson(`/campaign-form-drafts/${draftId.current}`, { method: 'DELETE' }); draftExists.current = false; }
        catch { notify('Chiến dịch đã tạo nhưng chưa dọn được bản nhập dở; vui lòng làm mới danh sách và xóa bản nhập dở nếu còn.'); }
      }
      if (!sendToComm) {
        setSavedCampaign(created);
        if (!savedCampaign) window.history.replaceState(null, '', `/campaigns/new?saved=${encodeURIComponent(created.id)}`);
      }
      return created;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Không thể tạo chiến dịch.';
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
      finishing.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Quản lý Chiến dịch</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{savedCampaign ? `Bản nháp ${savedCampaign.code}` : 'Tạo chiến dịch mới'}</h1>
      </div>
      {draftLoadError ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">{draftLoadError}</p> : savedCampaign || initialDraft ? <CampaignRecordForm ref={formRef} {...(savedCampaign ? { campaign: savedCampaign, saveLabel: 'Lưu nháp', successMessage: 'Đã lưu bản nháp.' } : { initialDraftValue: initialDraft!, onAutoSave: saveDraft, onDiscardDraft: discardDraft })} onExit={exit} saving={saving} error={error} onPersist={persist} onSubmitToComm={(value) => persist(value, true)} onDuplicate={(value) => store.create(toCreateCommand(value))} saveBarAtTop notify={notify} /> : <p role="status">Đang mở bản nhập dở…</p>}
    </div>
  );
}
