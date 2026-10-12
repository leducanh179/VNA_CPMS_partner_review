import { Button, CpmsIcon, StatusBadge, Tooltip } from '@cpms/ui';
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { AppLink } from '../lib/router';
import { useAuth } from '../auth-context';
import { useAccessCapabilities } from '../access-context';
import { requestJson } from '../lib/api';
import { PersonalNotes } from './personal-notes';

const navigation = [
  { path: '/', label: 'Tổng quan', icon: 'overview' },
  { path: '/my-work', label: 'Việc của tôi', icon: 'acceptance' },
  { path: '/campaigns', label: 'Chiến dịch', icon: 'campaign' },
  { path: '/qctt-plans', label: 'Kế hoạch QCTT', icon: 'table' },
  { path: '/materials', label: 'Tư liệu', icon: 'material' },
  { path: '/contracts', label: 'Kênh & Hợp đồng', icon: 'contract' },
  { path: '/bookings', label: 'Đặt chỗ', icon: 'booking' },
  { path: '/directory', label: 'Danh bạ', icon: 'users' },
  { path: '/catalogs/qctt', label: 'Danh mục QCTT', icon: 'table' },
] as const;

function isActive(pathname: string, path: string) {
  if (path === '/') return pathname === '/';
  if (path === '/campaigns') return pathname.startsWith('/campaigns');
  if (path === '/materials') return pathname.startsWith('/materials');
  return pathname.startsWith(path);
}

export function AppShell({ pathname, children }: PropsWithChildren<{ pathname: string }>) {
  const { me, logout, switchDemo, switchAssist } = useAuth();
  const capabilities = useAccessCapabilities();
  const bookingWorkspaceOnly = !me.directSuperadmin && Boolean(capabilities['booking.read']) && !capabilities['material.read'] && !capabilities['contract.read'];
  const [pendingWork, setPendingWork] = useState(0);
  const refreshPendingWork = useCallback(async () => {
    try {
      const results=await Promise.allSettled([
        ...['/campaign-workflow/inbox','/bookings/inbox'].map(url=>requestJson<{items:Array<{section:string;canRespond:boolean}>}>(url).then(r=>r.items.filter(i=>i.section==='PENDING'&&i.canRespond).length)),
        requestJson<Array<{section:string;canDecide:boolean}>>('/contracts/management/inbox').then(rows=>rows.filter(r=>r.section==='PENDING'&&r.canDecide).length),
      ]);
      setPendingWork(results.reduce((sum,r)=>sum+(r.status==='fulfilled'?r.value:0),0));
    } catch { setPendingWork(0); }
  }, []);
  useEffect(() => {
    void refreshPendingWork();
    const refresh = () => void refreshPendingWork();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh); window.addEventListener('cpms:workflow-updated', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('cpms:workflow-updated', refresh); };
  }, [refreshPendingWork, me.account.id]);
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(215,170,56,0.12),_transparent_26%),linear-gradient(180deg,#f8fafc_0%,#edf7f7_100%)]">
      <aside className="fixed inset-y-0 left-0 z-50 flex w-20 flex-col border-r border-slate-200 bg-white lg:w-64">
        <AppLink className="border-b border-slate-100 px-3 py-5 lg:px-5" to="/" aria-label="Về Tổng quan CPMS">
          <div className="hidden overflow-hidden rounded-xl bg-[#086985] lg:block">
            <img className="h-auto w-full" src="/brand/vna-logo-horizontal-blue.png" alt="Vietnam Airlines" />
          </div>
          <div className="mx-auto grid size-11 place-items-center rounded-xl bg-vna-blue-deep text-xs font-bold text-vna-gold lg:hidden">VNA</div>
          <div className="mt-3 hidden lg:block">
            <p className="font-semibold tracking-tight text-vna-blue-deep">CPMS</p>
            <p className="text-[11px] leading-4 text-slate-500">Communication Program Management</p>
          </div>
        </AppLink>

        <nav className="flex-1 space-y-1 px-2 py-5 lg:px-3" aria-label="Điều hướng chính">
          {navigation.filter(item=>!bookingWorkspaceOnly||item.path==='/bookings'||item.path==='/campaigns'||item.path==='/qctt-plans'||item.path==='/my-work').filter((item) => item.path === '/materials' ? capabilities['material.read'] : item.path === '/contracts' ? capabilities['contract.read'] : item.path === '/bookings' ? capabilities['booking.read'] : item.path === '/campaigns' ? capabilities['campaign.read'] : true).map((item) => {
            const active = isActive(pathname, item.path);
            return (
              <AppLink
                key={item.path}
                to={item.path}
                className={`flex min-h-12 items-center justify-center gap-3 rounded-xl px-2 text-sm font-semibold transition lg:justify-start lg:px-3 ${active ? 'bg-cyan-50 text-vna-blue' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                aria-current={active ? 'page' : undefined}
                title={item.label}
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-vna-blue text-white' : 'bg-slate-100 text-slate-500'}`}><CpmsIcon name={item.icon} size={20} /></span>
                <span className="hidden lg:inline">{item.label}</span>
                {item.path === '/my-work' && pendingWork > 0 ? <span className="ml-auto hidden min-w-6 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white lg:inline">{pendingWork > 99 ? '99+' : pendingWork}</span> : null}
              </AppLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-2 lg:p-3">
          {(me.directSuperadmin || capabilities['contract.approve']) && <AppLink to="/admin/system" title="Quản trị hệ thống" aria-current={pathname.startsWith('/admin/')?'page':undefined} className={`mb-2 flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold lg:justify-start ${pathname.startsWith('/admin/')?'bg-cyan-50 text-vna-blue':'text-slate-600 hover:bg-slate-50'}`}><CpmsIcon name="admin" size={20}/><span className="hidden lg:inline">Quản trị hệ thống</span></AppLink>}
          <Tooltip label="Mọi mutation được ghi audit theo actor hiện tại">
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 lg:justify-start lg:px-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-vna-blue-deep text-xs font-bold text-white">{me.account.displayName.split(' ').slice(-2).map((part) => part[0]).join('')}</span>
              <span className="hidden min-w-0 flex-1 text-left lg:block">
                <span className="block truncate text-xs font-semibold text-slate-900">{me.account.displayName}</span>
                <span className="block text-[10px] text-slate-500">{me.account.profile?.departmentName || me.account.profile?.organizationName}</span>
              </span>
              <span className="hidden lg:block"><StatusBadge>{me.directSuperadmin ? 'ADMIN' : 'CPMS'}</StatusBadge></span>
            </div>
          </Tooltip>
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => { void logout(); }}>Đăng xuất</Button>
        </div>
      </aside>

      <div className="min-h-screen pl-20 lg:pl-64">
        {me.mode === 'DEMO_IMPERSONATION' && <div role="status" data-cpms-session-banner className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-7 py-3 text-sm text-amber-950">
          <span>Đang trình diễn: <strong>{me.account.displayName}</strong> · Phiên gốc: {me.originalActor.displayName}</span>
          <Button size="sm" variant="secondary" onClick={() => { void switchDemo(null); }}>Trở về superadmin</Button>
        </div>}
        {me.mode === 'ADMIN_ASSIST' && <div role="status" data-cpms-session-banner className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-7 py-3 text-sm text-amber-950">
          <span>Đang hỗ trợ <strong>{me.account.displayName}</strong> · Người quản trị: {me.originalActor.displayName} · Mọi thao tác được ghi nhận theo cả hai danh tính.</span>
          <Button size="sm" variant="secondary" onClick={() => { void switchAssist(null); }}>Kết thúc hỗ trợ</Button>
        </div>}
        <main className="w-full px-4 py-6 lg:px-7 lg:py-7">{children}</main>
        <PersonalNotes key={me.account.id}/>
      </div>
    </div>
  );
}
