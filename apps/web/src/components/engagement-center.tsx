import { Button, CpmsIcon } from '@cpms/ui';
import type { EngagementView, MissionMode } from '@cpms/domain';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { requestJson } from '../lib/api';
import { navigate } from '../lib/router';
import './engagement.css';

const PLANE = '/brand/mascot/paper-plane-flight.webp';
const VICTORY = '/brand/mascot/paper-plane-reward.webp';
function MissionDialog({ title, onClose, children }: PropsWithChildren<{ title: string; onClose(): void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-label={title} className="cpms-mission-dialog w-[min(680px,calc(100vw-24px))] rounded-3xl bg-white p-0 text-slate-900 shadow-2xl" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-lg font-bold">{title}</h2><button type="button" aria-label={`Đóng ${title}`} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><CpmsIcon name="windowClose" /></button></header>{children}
  </dialog>;
}

export function EngagementCenter({ accountId, pathname }: { accountId: string; pathname: string }) {
  const [view, setView] = useState<EngagementView | null>(null);
  const [open, setOpen] = useState(false), [tab, setTab] = useState<'missions' | 'collection'>('missions');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState('Chiến dịch thực hành của tôi'), [level, setLevel] = useState('1');
  const [flying, setFlying] = useState(false), [planeMenu, setPlaneMenu] = useState(false), [quiet, setQuiet] = useState(false);
  const [guide, setGuide] = useState(true);
  const mounted = useRef(true), refreshing = useRef(false), activeRun = useRef(false);
  const progress = view?.progress;
  const owned = Boolean(view?.inventory.some(item => item.key === 'PAPER_PLANE'));
  const reward = Boolean(view?.enabled && progress?.stage === 'COMPLETED' && !progress.rewardSeenAt);
  activeRun.current = Boolean(progress && progress.stage !== 'COMPLETED');
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      let next = await requestJson<EngagementView>('/engagement');
      if (next.enabled && next.progress?.mode === 'REAL' && next.progress.stage !== 'COMPLETED') next = await requestJson<EngagementView>('/engagement/reconcile', { method: 'POST' });
      if (mounted.current) setView(next);
    } catch { /* An optional reward must not interrupt the user's work. */ }
    finally { refreshing.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const update = () => { void refresh(); };
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
    window.addEventListener('focus', update); window.addEventListener('cpms:workflow-updated', update); window.addEventListener('cpms:engagement-updated', update);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('cpms:workflow-updated', update); window.removeEventListener('cpms:engagement-updated', update); };
  }, [accountId, refresh]);
  useEffect(() => { if (activeRun.current) void refresh(); }, [pathname, refresh]);
  const run = async (path: string, payload?: unknown) => {
    setBusy(true); setError('');
    try { const next = await requestJson<EngagementView>(`/engagement/${path}`, { method: 'POST', ...(payload ? { body: JSON.stringify(payload) } : {}) }); setView(next); return next; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Chưa cập nhật được nhiệm vụ. Hãy thử lại.'); return null; }
    finally { setBusy(false); }
  };
  const start = async (mode: MissionMode, restart = false) => {
    const next = await run('start', { mode, restart }); setGuide(true);
    if (next?.progress?.mode === 'REAL') { setOpen(false); navigate('/campaigns/new'); }
    if (next?.progress?.mode === 'DEMO') { setName('Chiến dịch thực hành của tôi'); setLevel('1'); }
  };
  const acknowledge = async (launch: boolean) => {
    if (!progress) return;
    const next = await run('acknowledge', { runNumber: progress.runNumber });
    if (next) { setOpen(false); if (launch) { setFlying(true); setPlaneMenu(false); } }
  };
  const locate = (selector: string) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) { setOpen(true); return; }
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    target.focus({ preventScroll: true }); target.classList.add('cpms-mission-target'); window.setTimeout(() => target.classList.remove('cpms-mission-target'), 2200);
  };
  if (!view?.enabled) return null;
  const steps = progress?.stage === 'COMPLETED' ? 3 : progress?.stage === 'DRAFT_SAVED' ? 2 : progress ? 1 : 0;
  return <>
    <button type="button" aria-label="Mở Nhiệm vụ và Bộ sưu tập" style={{ right: 'calc(var(--ai-dock-width, 0px) + 20px)' }} title="Nhiệm vụ và Bộ sưu tập" onClick={() => { setOpen(true); void refresh(); }} className="fixed bottom-20 right-5 z-40 flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-950 shadow-lg hover:bg-amber-100"><CpmsIcon name="acceptance" /><span className="hidden sm:inline">Nhiệm vụ</span></button>
    {progress?.mode === 'REAL' && progress.stage !== 'COMPLETED' && pathname.startsWith('/campaigns') && guide && !open && <aside aria-label="Hướng dẫn nhiệm vụ" className="fixed bottom-36 right-5 z-30 w-[min(300px,calc(100vw-110px))] rounded-2xl border border-cyan-200 bg-white p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-vna-blue">Tạo chiến dịch đầu tiên · {steps}/3</p><button type="button" aria-label="Thu gọn hướng dẫn nhiệm vụ" onClick={() => setGuide(false)}><CpmsIcon name="windowMinimize" /></button></div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{progress.stage === 'ACTIVE' ? 'Nhập Tên chiến dịch, chọn Cấp chiến dịch và lưu nháp.' : 'Bản nháp đã lưu. Hoàn thiện thông tin cần thiết rồi gửi Ban TT để nhận Paper Plane.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">{pathname === '/campaigns/new' ? <><Button size="sm" variant="secondary" onClick={() => locate('#campaign-v2-name')}>Đến tên chiến dịch</Button><Button size="sm" variant="secondary" onClick={() => locate(progress.stage === 'ACTIVE' ? '[data-mission-save]' : '[data-mission-submit]')}>{progress.stage === 'ACTIVE' ? 'Đến Lưu nháp' : 'Đến Gửi Ban TT'}</Button></> : <Button size="sm" onClick={() => navigate(progress.campaignId ? `/campaigns/new?saved=${progress.campaignId}` : '/campaigns/new')}>Tiếp tục nhiệm vụ</Button>}</div>
    </aside>}
    {open && !reward && <MissionDialog title="Nhiệm vụ và Bộ sưu tập" onClose={() => setOpen(false)}>
      <div className="flex gap-2 border-b px-6 py-3"><Button size="sm" variant={tab === 'missions' ? 'primary' : 'ghost'} onClick={() => setTab('missions')}>Nhiệm vụ của tôi</Button><Button size="sm" variant={tab === 'collection' ? 'primary' : 'ghost'} onClick={() => setTab('collection')}>Bộ sưu tập vật phẩm</Button></div>
      <div className="space-y-5 p-6">{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {tab === 'missions' ? <>
          <div className="flex gap-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5"><img src={VICTORY} alt="Phần thưởng Paper Plane" className="h-24 w-24 shrink-0 object-contain" /><div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Nhiệm vụ khởi đầu</p><h3 className="mt-1 text-xl font-bold">Tạo chiến dịch đầu tiên</h3><p className="mt-2 text-sm text-slate-600">Tạo, lưu và gửi một Chiến dịch đi phê duyệt.</p><p className="mt-2 text-sm font-semibold text-vna-blue">Phần thưởng: mascot Paper Plane</p></div></div>
          <ol className="space-y-3">{['Bắt đầu và mở form Chiến dịch','Nhập thông tin và lưu bản nháp','Gửi đi phê duyệt · Nhận Paper Plane'].map((text, i) => <li key={text} className={`flex items-center gap-3 rounded-xl p-3 text-sm ${steps > i ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500'}`}><span className="grid size-7 shrink-0 place-items-center rounded-full border font-bold">{steps > i ? <CpmsIcon name="selected" size={16} /> : i + 1}</span>{text}</li>)}</ol>
          {progress?.mode === 'DEMO' && progress.stage !== 'COMPLETED' ? <form onSubmit={e => { e.preventDefault(); void run('demo-draft', { runNumber: progress.runNumber, name, level }); }} className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
            <p className="text-sm font-semibold text-vna-blue">Lượt trình diễn · Không tạo hồ sơ hay folder Drive thật</p>
            <label className="block text-sm font-medium">Tên chiến dịch thử<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2" /></label>
            <label className="block text-sm font-medium">Cấp chiến dịch<select value={level} onChange={e => setLevel(e.target.value)} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2"><option value="1">Cấp 1 – Cấp Phòng</option><option value="2">Cấp 2 – Cấp Ban</option><option value="3">Cấp 3 – Cấp TCT</option></select></label>
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Lưu nháp thử</Button><Button type="button" disabled={busy || progress.stage !== 'DRAFT_SAVED'} onClick={() => void run('demo-submit', { runNumber: progress.runNumber })}><CpmsIcon name="approve" />Gửi duyệt thử</Button></div>
          </form> : null}
          <div className="flex flex-wrap gap-2">{!progress || progress.stage === 'COMPLETED' ? <>{view.canCreateCampaign && <Button disabled={busy} onClick={() => void start('REAL', Boolean(progress))}><CpmsIcon name="campaign" />{progress ? 'Bắt đầu với Chiến dịch mới' : 'Bắt đầu nhiệm vụ'}</Button>}<Button variant="secondary" disabled={busy} onClick={() => void start('DEMO', Boolean(progress))}><CpmsIcon name="refresh" />{progress ? 'Làm lại bản trình diễn' : 'Thực hành trình diễn'}</Button></> : progress.mode === 'REAL' ? <><Button onClick={() => { setOpen(false); setGuide(true); navigate(progress.campaignId ? `/campaigns/new?saved=${progress.campaignId}` : '/campaigns/new'); }}>Tiếp tục nhiệm vụ</Button><Button variant="secondary" disabled={busy} onClick={() => void start('DEMO', true)}>Chuyển sang lượt trình diễn</Button><Button variant="ghost" disabled={busy} onClick={() => void run('reconcile')}>Kiểm tra tiến độ</Button></> : null}</div>
          {progress && <p className="text-xs text-slate-500">Đã hoàn thành {progress.completedCount} lượt. Vật phẩm được giữ trong Bộ sưu tập khi làm lại.</p>}
        </> : <>
          {owned ? <div className="flex items-center gap-5 rounded-2xl border bg-amber-50 p-5"><img src={PLANE} alt="Mascot Paper Plane của bạn" className="h-28 w-28 object-contain" /><div><h3 className="text-xl font-bold">Paper Plane</h3><p className="mt-1 text-sm text-slate-600">Bạn đồng hành đầu tiên trong CPMS.</p><Button className="mt-4" onClick={() => { setFlying(true); setPlaneMenu(false); setOpen(false); }}>Cất cánh</Button></div></div> : <p className="rounded-xl bg-slate-50 p-6 text-sm text-slate-600">Hoàn thành nhiệm vụ để nhận vật phẩm đầu tiên.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} />Giảm chuyển động mascot</label>
          {flying && <Button variant="secondary" onClick={() => { setFlying(false); setPlaneMenu(false); }}>Đóng mascot đang bay</Button>}
        </>}
      </div>
    </MissionDialog>}
    {reward && <MissionDialog title="Nhiệm vụ hoàn thành!" onClose={() => { if (!busy) void acknowledge(false); }}><div className="cpms-reward space-y-4 px-7 py-8 text-center"><img src={VICTORY} alt="Paper Plane ăn mừng hoàn thành nhiệm vụ" className="mx-auto h-44 w-52 object-contain" /><p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Một hành trình mới bắt đầu</p><h3 className="text-3xl font-bold text-vna-blue-deep">Paper Plane đã về đội của bạn!</h3><p className="text-sm leading-6 text-slate-600">Bạn đã hoàn thành nhiệm vụ Tạo chiến dịch đầu tiên{progress?.mode === 'DEMO' ? ' trong lượt trình diễn' : ''}. Paper Plane đã được cất vào Bộ sưu tập vật phẩm cá nhân.</p>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<div className="flex justify-center gap-3 pt-3"><Button variant="secondary" disabled={busy} onClick={() => void acknowledge(false)}>OK</Button><Button disabled={busy} onClick={() => void acknowledge(true)}>Cất cánh</Button></div></div></MissionDialog>}
    {flying && owned && !open && !reward && <div className={`cpms-plane ${quiet ? 'cpms-plane-quiet' : ''}`}>
      <button type="button" className="cpms-plane-mascot" aria-label="Paper Plane · mở tùy chọn" title="Paper Plane · bấm để đóng" onClick={() => setPlaneMenu(!planeMenu)}><img draggable={false} src={PLANE} alt="Paper Plane đang bay" /></button>
      {planeMenu && <div className="absolute bottom-full left-0 mb-2 w-40 rounded-xl border bg-white p-2 shadow-xl"><button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setFlying(false); setPlaneMenu(false); }}><CpmsIcon name="windowClose" />Đóng</button></div>}
    </div>}
  </>;
}

export function EngagementSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void requestJson<{ enabled: boolean }>('/engagement/settings').then(r => setEnabled(r.enabled)).catch(e => setError(String(e.message))); }, []);
  const toggle = async () => {
    setBusy(true); setError('');
    try { const result = await requestJson<{ enabled: boolean }>('/engagement/settings', { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) }); setEnabled(result.enabled); window.dispatchEvent(new Event('cpms:engagement-updated')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không cập nhật được cài đặt.'); } finally { setBusy(false); }
  };
  return <section className="space-y-4 p-6"><h2 className="text-xl font-bold">Nhiệm vụ và phần thưởng</h2><p className="text-sm leading-6 text-slate-600">Khuyến khích người dùng học luồng tạo và gửi duyệt Chiến dịch, nhận Paper Plane và mở Bộ sưu tập cá nhân. Mọi tài khoản đăng nhập đều có lượt thực hành trình diễn.</p><Button disabled={busy || enabled === null} variant={enabled ? 'primary' : 'secondary'} onClick={() => void toggle()}>{busy ? 'Đang cập nhật…' : enabled ? 'Đang bật · Bấm để tắt' : 'Đang tắt · Bấm để bật'}</Button><p className="text-xs text-slate-500">Tắt sẽ ẩn bảng nhiệm vụ và mascot. Tiến độ và vật phẩm đã nhận vẫn được giữ lại. Các phiên đang mở cập nhật trong tối đa một phút hoặc khi quay lại tab.</p>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}</section>;
}
