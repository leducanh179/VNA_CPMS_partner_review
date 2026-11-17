import { QCTT_PROGRESS, type CampaignShareTab, type SharedCampaign } from '@cpms/domain';
import { Card, CpmsIcon, LoadingBlock } from '@cpms/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiHttpError, requestJson } from '../lib/api';
import { campaignShareLabels, campaignSharePath } from '../lib/campaign-sharing';
import { workflowLabel } from '../lib/campaign-workflow';

function ReadTable({ headers, rows, empty }: { headers: string[]; rows: { id: string | number; cells: ReactNode[] }[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm">
    <thead className="bg-slate-50 text-slate-600"><tr>{headers.map(title => <th scope="col" key={title} className="p-3">{title}</th>)}</tr></thead>
    <tbody>{rows.map(({ id, cells }) => <tr key={id} className="border-t border-slate-100">{cells.map((cell, index) => <td key={index} className="whitespace-pre-wrap break-words p-3">{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

const day = (value: string | null) => value ? new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

export function SharedCampaignPage({ id, signedIn = false, standalone = true }: { id: string; signedIn?: boolean; standalone?: boolean }) {
  const [campaign, setCampaign] = useState<SharedCampaign>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab'));
  const login = `/login?returnTo=${encodeURIComponent(campaignSharePath(id) + window.location.search)}`;
  useEffect(() => {
    const controller = new AbortController();
    const path = signedIn ? '/campaign-shares' : '/public/guest/campaigns';
    void requestJson<SharedCampaign>(`${path}/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(setCampaign)
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause instanceof ApiHttpError && [403, 404].includes(cause.status)
          ? 'Bạn chưa có quyền xem chiến dịch qua liên kết này hoặc liên kết đã hết hiệu lực.' : cause.message);
      });
    return () => controller.abort();
  }, [id, signedIn]);

  const signIn = <a className="inline-flex items-center gap-1.5 text-sm font-semibold text-vna-blue hover:underline" href={login}><CpmsIcon name="locked" />Đăng nhập CPMS</a>;
  const active = campaign?.tabs.find(item => item === tab) ?? campaign?.tabs.find(item => item === 'information') ?? campaign?.tabs[0];
  const select = (next: CampaignShareTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return <main className={standalone ? 'min-h-screen bg-slate-50 p-4 sm:p-8' : ''}>
    <div className="mx-auto max-w-5xl space-y-5">
      {standalone && <header className="flex flex-wrap items-center justify-between gap-3">
        <a href="/" className="inline-flex items-center gap-2 font-semibold text-vna-blue"><CpmsIcon name="campaign" />CPMS</a>
        {signedIn ? <a className="text-sm font-semibold text-vna-blue hover:underline" href="/campaigns">Mở phân hệ Chiến dịch</a> : signIn}
      </header>}
      {error ? <Card className="space-y-3 p-6"><p role="alert">{error}</p>{!standalone && !signedIn && signIn}</Card> :
        !campaign ? <LoadingBlock label="Đang mở chiến dịch…" /> : <>
          <header><p className="font-mono text-sm text-slate-600">{campaign.code}</p><h1 className="mt-1 text-3xl font-semibold">{campaign.name}</h1></header>
          {campaign.tabs.length > 0 && <nav aria-label="Nội dung được chia sẻ" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
            {campaign.tabs.map(item => <button key={item} type="button" aria-current={active === item ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${active === item ? 'bg-cyan-50 text-vna-blue' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => select(item)}>{campaignShareLabels[item]}</button>)}
          </nav>}
          <Card className="space-y-4 p-5">
            {!active && <p className="text-sm text-slate-600">Chưa có tab nào được chia sẻ cho nhóm của bạn.</p>}
            {active === 'information' && <dl className="grid gap-4 sm:grid-cols-2">{campaign.information?.map(({ label, value }, index) =>
              <div key={index}><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>}
            {active === 'approval' && campaign.approval && <>
              <h2 className="font-semibold">{workflowLabel(campaign.approval.status)}</h2>
              <ReadTable headers={['Bước phê duyệt', 'Tình trạng', 'Hoàn tất']} empty="Chưa có bước phê duyệt."
                rows={campaign.approval.tasks.map((item, index) => ({ id: index, cells: [workflowLabel(item.kind), workflowLabel(item.state), day(item.completedAt)] }))} />
              {campaign.approval.history.length > 0 && <ReadTable headers={['Lần trình', 'Tình trạng', 'Ngày trình']} empty=""
                rows={campaign.approval.history.map(item => ({ id: item.number, cells: [item.number, workflowLabel(item.state), day(item.createdAt)] }))} />}
            </>}
            {active === 'documents' && campaign.documents && <>
              {campaign.documents.driveUrl && <a className="inline-flex items-center gap-2 text-sm font-semibold text-vna-blue hover:underline" href={campaign.documents.driveUrl} target="_blank" rel="noreferrer"><CpmsIcon name="folder" />Mở thư mục Google Drive</a>}
              <ReadTable headers={['Tên tư liệu', 'Loại']} empty="Chưa có tư liệu được chia sẻ."
                rows={campaign.documents.materials.map(item => ({ id: item.id, cells: [item.url
                  ? <a className="font-semibold text-vna-blue hover:underline" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                  : item.title, item.type || '—'] }))} />
            </>}
            {active === 'planning' && <ReadTable headers={['Hạng mục', 'Kênh', 'Thời gian', 'Nội dung', 'Tiến độ']} empty="Chưa có hạng mục kế hoạch."
              rows={(campaign.planning ?? []).map(item => ({ id: item.id, cells: [item.activity, item.channel || '—', `${day(item.start)} – ${day(item.end)}`, item.content || '—',
                QCTT_PROGRESS[item.progress as keyof typeof QCTT_PROGRESS] ?? item.progress] }))} />}
            {active === 'results' && <p className="text-sm text-slate-600">Dữ liệu kết quả sẽ được bổ sung khi phân hệ liên quan hoàn thiện.</p>}
          </Card>
        </>}
    </div>
  </main>;
}
