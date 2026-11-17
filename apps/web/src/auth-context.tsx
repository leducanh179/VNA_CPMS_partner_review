import { Button, Card, Field } from '@cpms/ui';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from 'react';
import { ApiHttpError, requestJson } from './lib/api';
import { navigate } from './lib/router';
import { sharedCampaignId } from './lib/campaign-sharing';
import { currentIdentityEpoch, identityTransitionInProgress, invalidateIdentityRequests } from './lib/identity-network';
import { confirmUnsavedNavigation } from './lib/unsaved-changes';

export interface PublicAccount {
  id: string; displayName: string; email: string | null; employeeCode: string | null;
  accountKind: string;
  profile: { organizationName: string; departmentName: string | null; jobTitle: string | null; gmailEmail: string | null } | null;
  employment: { departmentId: string; divisionId: string | null } | null;
  roles: string[]; isActive: boolean; recordVersion: number; credentialConfigured: boolean; mustChangePassword: boolean;
}
export interface LocalIdentity {
  account: PublicAccount; originalActor: { id: string; displayName: string };
  mode: 'DIRECT' | 'DEMO_IMPERSONATION' | 'ADMIN_ASSIST'; directSuperadmin: boolean; expiresAt: string;
  mustChangePassword: boolean; demoImpersonationEnabled?: boolean; scopedBoundaryReady: boolean;
}
interface AuthContextValue {
  me: LocalIdentity; logout(): Promise<void>; switchDemo(target: string | null): Promise<void>; switchAssist(target: string | null, reason?: string): Promise<void>; refresh(): Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const GuestPreviewApp = lazy(async () => ({ default: (await import('./guest-preview-app')).GuestPreviewApp }));
const SharedCampaignPage = lazy(async () => ({ default: (await import('./pages/shared-campaign-page')).SharedCampaignPage }));
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('Authentication context is required.'); return value; }

function AuthenticatedRedirect() {
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('returnTo') ?? '';
    const pathname = next.split('?')[0] ?? '';
    navigate(sharedCampaignId(pathname) ? next : '/', true, true);
  }, []);
  return null;
}

export function AuthProvider({ children, pathname }: PropsWithChildren<{ pathname: string }>) {
  const [me, setMe] = useState<LocalIdentity | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionWarning, setSessionWarning] = useState('');
  const lastKnownIdentity = useRef(me);
  lastKnownIdentity.current = me;
  const refreshFlight = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const clear = useCallback((changing: boolean) => { invalidateIdentityRequests(changing); setMe(undefined); setGeneration((value) => value + 1); }, []);
  const refresh = useCallback((): Promise<void> => {
    if (identityTransitionInProgress()) return Promise.resolve();
    const epoch = currentIdentityEpoch();
    const hadIdentity = Boolean(lastKnownIdentity.current);
    if (refreshFlight.current?.epoch === epoch) return refreshFlight.current.promise;
    const promise = (async () => {
      try {
        const identity = await requestJson<LocalIdentity>('/auth/me', { signal: AbortSignal.timeout(15000) });
        if (epoch !== currentIdentityEpoch()) return;
        setMe(identity); setSessionWarning('');
      } catch (caught) {
        if (epoch !== currentIdentityEpoch()) return;
        if (caught instanceof ApiHttpError && caught.status === 401) {
          clear(false); setMe(null); setSessionWarning('');
          if (hadIdentity) setError('Phiên đã hết hạn hoặc bị thu hồi. Hãy đăng nhập lại.');
        } else if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          // A failed probe is not evidence of logout. Keep the authenticated editor mounted.
          setSessionWarning('Chưa kiểm tra được phiên do kết nối gián đoạn. Nội dung đang nhập được giữ; thao tác lưu vẫn cần máy chủ xác nhận.');
        }
      } finally { if (refreshFlight.current?.epoch === epoch) refreshFlight.current = null; }
    })();
    refreshFlight.current = { epoch, promise };
    return promise;
  }, [clear]);
  useEffect(() => {
    void refresh();
    const expired = () => { void refresh(); };
    const focus = () => { void refresh(); };
    channel.current = new BroadcastChannel('cpms-session');
    channel.current.onmessage = (event: MessageEvent) => {
      if (event.data !== 'changing' && event.data !== 'changed') return;
      clear(event.data === 'changing');
      if (event.data === 'changed') void refresh();
    };
    window.addEventListener('cpms:session-expired', expired);
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => { channel.current?.close(); window.removeEventListener('cpms:session-expired', expired); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); };
  }, [clear, refresh]);
  useEffect(() => {
    if (!me) return;
    const timeout = window.setTimeout(() => { clear(false); setMe(null); setError('Phiên đã hết hạn. Hãy đăng nhập lại.'); }, Math.max(1, new Date(me.expiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [me, clear]);

  const command = async (path: string, body: object = {}) => {
    setBusy(true); setError(''); setSessionWarning(''); clear(true); channel.current?.postMessage('changing');
    let signedIn: LocalIdentity | undefined;
    try {
      const result = await requestJson<LocalIdentity>(path, { method: 'POST', body: JSON.stringify(body) });
      if (path === '/auth/login') signedIn = result;
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể thay đổi phiên.'); }
    finally {
      invalidateIdentityRequests(false); channel.current?.postMessage('changed');
      if (signedIn) { setMe(signedIn); setSessionWarning(''); } else await refresh();
      setBusy(false);
    }
  };
  const logout = async () => { if (confirmUnsavedNavigation()) await command('/auth/logout'); };
  const switchDemo = async (target: string | null) => { if (confirmUnsavedNavigation()) await command(target ? '/auth/demo/start' : '/auth/demo/end', target ? { targetActorId: target } : {}); };
  const switchAssist = async (target: string | null, reason?: string) => { if (confirmUnsavedNavigation()) await command(target ? '/auth/assist/start' : '/auth/assist/end', target ? { targetActorId: target, reason } : {}); };

  if (me === undefined && sessionWarning) return <main className="grid min-h-screen place-items-center bg-slate-50 p-8"><Card className="max-w-lg p-8"><p role="alert">Chưa kết nối được CPMS để kiểm tra phiên. Vui lòng thử lại.</p><Button className="mt-4" onClick={() => { void refresh(); }}>Thử kết nối lại</Button></Card></main>;
  if (me === undefined) return <main role="status" className="grid min-h-screen place-items-center bg-slate-50 p-8 text-sm text-slate-600">Đang mở CPMS…</main>;
  const shareId = sharedCampaignId(pathname);
  if (shareId && !me?.mustChangePassword) return <Suspense fallback={<main role="status" className="p-8">Đang mở chiến dịch…</main>}>
    <SharedCampaignPage key={`${shareId}:${me?.account.id ?? 'guest'}:${me?.mode ?? ''}`} id={shareId} signedIn={Boolean(me)} />
  </Suspense>;
  if (me === null && pathname !== '/login') return <Suspense fallback={<main role="status" className="p-8">Đang mở bản xem thử CPMS…</main>}><GuestPreviewApp pathname={pathname}/></Suspense>;
  if (!me || me.mustChangePassword) return <AuthenticationForm loading={false} busy={busy} error={error} changePassword={Boolean(me?.mustChangePassword)}
    onSubmit={(body) => command(me?.mustChangePassword ? '/auth/change-password' : '/auth/login', body)} />;
  if (pathname === '/login') return <AuthenticatedRedirect/>;
  return <AuthContext.Provider value={{ me, logout, switchDemo, switchAssist, refresh }}>
    <div key={`${me.account.id}:${me.mode}:${me.account.recordVersion}:${generation}`}>{sessionWarning && <div data-inline-save-surface role="alert" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><span>{sessionWarning}</span><Button size="sm" variant="secondary" onClick={() => { void refresh(); }}>Thử kết nối lại</Button></div>}{me.account.accountKind === 'PARTNER_DEMO' && <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">Tài khoản demo IT · Được xem và thử nhập bản nháp riêng. Không được tạo, sửa, xóa hoặc gửi duyệt dữ liệu nghiệp vụ.</p>}{children}</div>
  </AuthContext.Provider>;
}

function AuthenticationForm({ loading, busy, error, changePassword, onSubmit }: {
  loading: boolean; busy: boolean; error: string; changePassword: boolean; onSubmit(body: object): Promise<void>;
}) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault(); setLocalError('');
    if (changePassword && Array.from(next).length < 8) { setLocalError('Mật khẩu mới cần ít nhất 8 ký tự.'); return; }
    if (changePassword && next !== confirm) { setLocalError('Mật khẩu xác nhận chưa khớp.'); return; }
    const body = changePassword ? { currentPassword: password, nextPassword: next } : { email, password };
    setPassword(''); setNext(''); setConfirm(''); void onSubmit(body);
  };
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
    <Card className="w-full max-w-md p-8">
      <img src="/brand/vna-logo-horizontal-blue.png" alt="Vietnam Airlines" className="mb-7 w-full rounded-xl bg-[#086985]" />
      <h1 className="text-2xl font-semibold text-vna-blue-deep">{changePassword ? 'Đặt mật khẩu CPMS' : 'Đăng nhập CPMS'}</h1>
      <p className="mb-6 mt-2 text-sm text-slate-600">{changePassword ? 'Đổi mật khẩu tạm trước khi sử dụng tài khoản. Sau đó đăng nhập lại.' : 'Sử dụng email công việc và mật khẩu CPMS đã được thiết lập.'}</p>
      {loading ? <p role="status" className="py-5 text-sm text-slate-600">Đang kiểm tra phiên CPMS…</p> : <form className="space-y-5" onSubmit={submit}>
        {!changePassword && <Field label="Email công việc" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />}
        <Field label={changePassword ? 'Mật khẩu hiện tại' : 'Mật khẩu CPMS'} name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={1024} />
        {changePassword && <><Field label="Mật khẩu mới" name="new-password" type="password" autoComplete="new-password" maxLength={1024} hint="Ít nhất 8 ký tự; không bắt buộc chữ hoa, số hay ký tự đặc biệt." value={next} onChange={(event) => setNext(event.target.value)} required />
          <Field label="Xác nhận mật khẩu mới" name="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></>}
        {(error || localError) && <p role="alert" className="text-sm text-rose-700">{localError || error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{changePassword ? 'Đổi mật khẩu' : 'Đăng nhập'}</Button>
      </form>}
      {!changePassword && <a href="/" className="mt-5 block text-center text-sm font-semibold text-vna-blue hover:underline">Xem thử CPMS không cần đăng nhập</a>}
    </Card>
  </main>;
}
