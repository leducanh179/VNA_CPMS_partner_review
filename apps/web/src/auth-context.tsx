import { Button, Card, Field } from '@cpms/ui';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from 'react';
import { requestJson } from './lib/api';
import { invalidateIdentityRequests } from './lib/identity-network';
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
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('Authentication context is required.'); return value; }

export function AuthProvider({ children }: PropsWithChildren) {
  const [me, setMe] = useState<LocalIdentity | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const clear = useCallback((changing: boolean) => { invalidateIdentityRequests(changing); setMe(undefined); setGeneration((value) => value + 1); }, []);
  const refresh = useCallback(async () => {
    try { setMe(await requestJson<LocalIdentity>('/auth/me')); }
    catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setMe(null); }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => { clear(false); setMe(null); setError('Phiên đã hết hạn hoặc bị thu hồi. Hãy đăng nhập lại.'); };
    const focus = () => { void refresh(); };
    channel.current = new BroadcastChannel('cpms-session');
    channel.current.onmessage = (event: MessageEvent) => {
      if (event.data !== 'changing' && event.data !== 'changed') return;
      clear(event.data === 'changing');
      if (event.data === 'changed') void refresh();
    };
    window.addEventListener('cpms:session-expired', expired);
    window.addEventListener('focus', focus);
    return () => { channel.current?.close(); window.removeEventListener('cpms:session-expired', expired); window.removeEventListener('focus', focus); };
  }, [clear, refresh]);
  useEffect(() => {
    if (!me) return;
    const timeout = window.setTimeout(() => { clear(false); setMe(null); }, Math.max(1, new Date(me.expiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [me, clear]);

  const command = async (path: string, body: object = {}) => {
    setBusy(true); setError(''); clear(true); channel.current?.postMessage('changing');
    try { await requestJson(path, { method: 'POST', body: JSON.stringify(body) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể thay đổi phiên.'); }
    finally { invalidateIdentityRequests(false); channel.current?.postMessage('changed'); await refresh(); setBusy(false); }
  };
  const logout = async () => { if (confirmUnsavedNavigation()) await command('/auth/logout'); };
  const switchDemo = async (target: string | null) => { if (confirmUnsavedNavigation()) await command(target ? '/auth/demo/start' : '/auth/demo/end', target ? { targetActorId: target } : {}); };
  const switchAssist = async (target: string | null, reason?: string) => { if (confirmUnsavedNavigation()) await command(target ? '/auth/assist/start' : '/auth/assist/end', target ? { targetActorId: target, reason } : {}); };

  if (!me || me.mustChangePassword) return <AuthenticationForm loading={me === undefined} busy={busy} error={error} changePassword={Boolean(me?.mustChangePassword)}
    onSubmit={(body) => command(me?.mustChangePassword ? '/auth/change-password' : '/auth/login', body)} />;
  return <AuthContext.Provider value={{ me, logout, switchDemo, switchAssist, refresh }}>
    <div key={`${me.account.id}:${me.mode}:${me.account.recordVersion}:${generation}`}>{children}</div>
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
    </Card>
  </main>;
}
