import { CAMPAIGN_SHARE_MODES, CAMPAIGN_SHARE_TABS, type CampaignShareMode, type CampaignShareSettings, type CampaignShareSpreadsheet } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';
import { campaignShareLabels, campaignSharePath } from '../lib/campaign-sharing';

const modes: Record<CampaignShareMode, { label: string; description: string }> = {
  RESTRICTED: { label: 'Restricted · Hạn chế', description: 'Người tạo, người phê duyệt tương ứng và quản trị viên hệ thống.' },
  ACCOUNTS: { label: 'Accounts in CPMS', description: 'Mọi người đã đăng nhập CPMS.' },
  PUBLIC: { label: 'Public · Công khai', description: 'Bất kỳ ai có liên kết đều có thể xem.' },
};

export function CampaignSharingDialog({ id, name, onClose }: { id: string; name: string; onClose(): void }) {
  const endpoint = `/campaign-shares/${id}/settings`;
  const spreadsheetEndpoint = `/campaign-shares/${id}/spreadsheet`;
  const url = new URL(campaignSharePath(id), window.location.origin).href;
  const [saved, setSaved] = useState<CampaignShareSettings>();
  const [draft, setDraft] = useState<CampaignShareSettings>();
  const [busy, setBusy] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState<CampaignShareSpreadsheet>();
  const [spreadsheetError, setSpreadsheetError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [viewerEmail, setViewerEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<CampaignShareSettings>(endpoint, { signal: controller.signal })
      .then(value => { setSaved(value); setDraft(value); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<CampaignShareSpreadsheet>(spreadsheetEndpoint, { signal: controller.signal })
      .then(setSpreadsheet)
      .catch((cause: Error) => { if (!controller.signal.aborted) setSpreadsheetError(cause.message); });
    return () => controller.abort();
  }, [spreadsheetEndpoint]);

  async function publishSpreadsheet() {
    if (!saved) return;
    setExporting(true);
    setSpreadsheetError('');
    setStatus('');
    try {
      const result = await requestJson<CampaignShareSpreadsheet>(spreadsheetEndpoint, {
        method: 'POST', body: JSON.stringify({ version: saved.version, ...(viewerEmail.trim() ? { viewerEmail: viewerEmail.trim() } : {}) }),
      });
      setSpreadsheet(result);
      setStatus(viewerEmail.trim() ? 'Đã cập nhật bản xuất và quyền xem Google Sheet.' : 'Đã cập nhật bản xuất Google Sheet.');
      setViewerEmail('');
    } catch (cause) {
      setSpreadsheetError(cause instanceof Error ? cause.message : 'Không thể xuất Google Sheet.');
    } finally {
      setExporting(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const value = await requestJson<CampaignShareSettings>(endpoint, { method: 'PATCH', body: JSON.stringify(draft) });
      setSaved(value);
      setDraft(value);
      setSpreadsheet(previous => previous?.url ? { ...previous, sharingChanged: true } : previous);
      setStatus('Đã lưu quyền chia sẻ.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu quyền chia sẻ.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(link = url) {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Đã sao chép liên kết.');
    } catch {
      setStatus('Chọn và sao chép đường dẫn trong ô bên dưới.');
    }
  }

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="campaign-share-title"
    onKeyDown={event => { if (event.key === 'Escape' && !busy && !exporting) onClose(); }}>
    <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="campaign-share-title" className="text-xl font-semibold">Chia sẻ chiến dịch</h2><p className="mt-1 text-sm text-slate-600">{name}</p></div>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy || exporting} aria-label="Đóng" title="Đóng"><CpmsIcon name="windowClose" /></Button>
      </div>
      {!draft && !error && <p role="status" className="my-5 text-sm">Đang tải quyền chia sẻ…</p>}
      {draft && <fieldset disabled={busy || exporting} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold">Phạm vi truy cập
          <select className="mt-2 block w-full rounded-xl border border-slate-200 bg-white p-2.5" value={draft.mode}
            onChange={event => { setStatus(''); setDraft({ ...draft, mode: event.target.value as CampaignShareMode }); }}>
            {CAMPAIGN_SHARE_MODES.map(mode => <option key={mode} value={mode}>{modes[mode].label}</option>)}
          </select>
        </label>
        {CAMPAIGN_SHARE_MODES.map(mode => <fieldset key={mode} className="rounded-xl border border-slate-200 px-3 pb-3">
          <legend className="px-1 text-sm font-semibold">{modes[mode].label}</legend>
          <p className="mb-2 text-xs text-slate-600">{modes[mode].description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {CAMPAIGN_SHARE_TABS.map(tab => <label key={tab} className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={draft.tabs[mode].includes(tab)} onChange={event => {
                const selected = event.target.checked ? [...draft.tabs[mode], tab] : draft.tabs[mode].filter(item => item !== tab);
                setStatus('');
                setDraft({ ...draft, tabs: { ...draft.tabs, [mode]: CAMPAIGN_SHARE_TABS.filter(item => selected.includes(item)) } });
              }} />{campaignShareLabels[tab]}
            </label>)}
          </div>
        </fieldset>)}
        <input readOnly aria-label="Liên kết chia sẻ" value={url} onFocus={event => event.currentTarget.select()} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm" />
      </fieldset>}
      {saved && (saved.mode === 'PUBLIC' || spreadsheet?.url) && <section className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Google Sheet cho VNA Quick">
        <h3 className="text-sm font-semibold">Google Sheet cho VNA Quick</h3>
        <p className="text-xs text-slate-600">Bản xuất chỉ chứa các tab Public đã lưu. Có thể cấp quyền Người xem cho tài khoản Google kết nối với Quick.</p>
        {spreadsheet?.url && <p className="text-xs text-slate-600">
          Cập nhật lần cuối {spreadsheet.exportedAt ? new Date(spreadsheet.exportedAt).toLocaleString('vi-VN') : '—'}.
          {' '}Quyền của file được quản lý trên Google Drive.
        </p>}
        {spreadsheet?.sharingChanged && <p className="text-xs font-medium text-amber-800">Quyền CPMS đã đổi sau lần xuất. Hãy cập nhật file khi còn dùng Public. Muốn ngừng chia sẻ bản xuất, thu hồi quyền trên Google Drive.</p>}
        {changed && <p className="text-xs text-slate-600">Lưu quyền chia sẻ trước khi xuất.</p>}
        {spreadsheet && !spreadsheet.enabled && saved.mode === 'PUBLIC' && <p className="text-xs text-slate-600">{spreadsheet.unavailableReason}</p>}
        {spreadsheetError && <p role="alert" className="text-sm text-rose-700">{spreadsheetError}</p>}
        {saved.mode === 'PUBLIC' && <label className="block text-xs font-medium text-slate-700">Email Google được xem (tùy chọn)
          <input type="email" value={viewerEmail} maxLength={254} disabled={busy || exporting} onChange={event => setViewerEmail(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-2 text-sm" />
        </label>}
        <div className="flex flex-wrap items-center gap-2">
          {saved.mode === 'PUBLIC' && <Button size="sm" variant="secondary" disabled={!spreadsheet?.enabled || !saved.tabs.PUBLIC.length || changed || busy || exporting}
            onClick={() => void publishSpreadsheet()}><CpmsIcon name="table" />{exporting ? 'Đang xuất…' : spreadsheet?.url ? 'Cập nhật Google Sheet' : 'Xuất Google Sheet'}</Button>}
          {spreadsheet?.url && <>
            <a className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-vna-blue hover:underline" href={spreadsheet.url} target="_blank" rel="noreferrer">
              <CpmsIcon name="externalLink" />Mở Google Sheet
            </a>
            <Button size="sm" variant="ghost" onClick={() => void copy(spreadsheet.url ?? url)}><CpmsIcon name="link" />Sao chép link Sheet</Button>
          </>}
        </div>
        {spreadsheet?.url && <input readOnly aria-label="Link Google Sheet" value={spreadsheet.url} onFocus={event => event.currentTarget.select()}
          className="w-full rounded-xl border border-slate-200 bg-white p-2 text-sm" />}
      </section>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm text-emerald-700">{status}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" disabled={!saved || changed || busy || exporting} onClick={() => void copy()}><CpmsIcon name="link" />Sao chép liên kết</Button>
        <div className="flex gap-2"><Button variant="secondary" disabled={busy || exporting} onClick={onClose}>Đóng</Button>
          <Button disabled={!draft || !changed || busy || exporting} onClick={() => void save()}><CpmsIcon name="save" />{busy ? 'Đang lưu…' : 'Lưu'}</Button></div>
      </div>
    </Card>
  </div>;
}
