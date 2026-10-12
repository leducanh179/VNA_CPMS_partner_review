import { normalizeDirectorySearch } from '@cpms/domain';
import { Button, Card, Field, SelectField, StatusBadge } from '@cpms/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth, type PublicAccount } from '../auth-context';
import { requestJson } from '../lib/api';
import { AccountAccessWorkspace } from '../components/account-access-workspace';
import { ScopeLabel } from '../components/access-editor-controls';
import { type AccessView } from '../lib/access-administration';
import { AppLink } from '../lib/router';
import { confirmUnsavedNavigation } from '../lib/unsaved-changes';

const roleLabels: Record<string, string> = { ADMIN: 'Superadmin', CAMPAIGN_REQUESTER: 'Người yêu cầu', COMM_CAMPAIGN_MANAGER: 'Chuyên viên truyền thông', DEPARTMENT_LEADER: 'Lãnh đạo Ban', DIVISION_LEADER: 'Lãnh đạo Phòng' };
const emptyLeader = { employeeCode: '', fullName: '', email: '', gmailEmail: '', organizationName: 'Ban Truyền thông', departmentName: 'Phòng Thương hiệu', jobTitle: '', gender: 'Nam', birthDate: '', phoneText: '' };
export function AdminAccountsPage() {
  const { me, switchDemo, switchAssist } = useAuth();
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [accessView, setAccessView] = useState<AccessView | null>(null);
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10); const [group, setGroup] = useState<'complete' | 'pending'>('complete');
  const [search, setSearch] = useState(''); const [organization, setOrganization] = useState(''); const [division, setDivision] = useState('');
  const [role, setRole] = useState(''); const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<PublicAccount | null>(null);
  const [action, setAction] = useState<'status' | 'credential' | 'assist' | 'gmail' | null>(null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [gmailEmail, setGmailEmail] = useState('');
  const [password, setPassword] = useState<string | null>(null); const [showPassword, setShowPassword] = useState(false);
  const [passwordMustChange, setPasswordMustChange] = useState(true);
  const [creating, setCreating] = useState<'leader' | 'specialist' | 'pilot' | null>(null); const [leader, setLeader] = useState({ ...emptyLeader });
  const [leaderPassword, setLeaderPassword] = useState(''); const [leaderMustChange, setLeaderMustChange] = useState(true);
  const [leaderReason, setLeaderReason] = useState('');
  const [specialist, setSpecialist] = useState({ employeeCode: '', email: '', password: '', reason: '' });
  const [pilot, setPilot] = useState({ displayName: '', email: '', password: '', reason: '' });
  const load = async () => { const [rows, access] = await Promise.all([requestJson<PublicAccount[]>('/auth/accounts'), requestJson<AccessView>('/access')]); setAccounts(rows); setAccessView(access); };
  useEffect(() => { if (me.directSuperadmin) void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Không tải được tài khoản.')); }, [me.directSuperadmin]);
  const organizations = useMemo(() => [...new Set(accounts.map((account) => account.profile?.organizationName).filter((name): name is string => Boolean(name)))].sort(), [accounts]);
  const divisions = useMemo(() => [...new Set(accounts.filter((account) => !organization || account.profile?.organizationName === organization).map((account) => account.profile?.departmentName).filter((name): name is string => Boolean(name)))].sort(), [accounts, organization]);
  const titlesNeedingReview = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const account of accounts) {
      const title = normalizeDirectorySearch(account.profile?.jobTitle ?? ''); const divisionId = account.employment?.divisionId;
      if (!divisionId || !/(?:^| - )truong phong\b/.test(title)) continue;
      groups.set(divisionId, [...(groups.get(divisionId) ?? []), account.id]);
    }
    return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
  }, [accounts]);
  const visible = useMemo(() => accounts.filter((account) => {
    const query = normalizeDirectorySearch(search);
    return (!query || normalizeDirectorySearch([account.displayName, account.email, account.employeeCode, account.profile?.jobTitle].join(' ')).includes(query)) &&
      (!organization || account.profile?.organizationName === organization) && (!division || account.profile?.departmentName === division) &&
      (!role || account.roles.includes(role)) && (!status || (status === 'LOCKED' ? !account.isActive : status === 'READY' ? account.isActive && account.credentialConfigured : account.isActive && !account.credentialConfigured));
  }), [accounts, search, organization, division, role, status]);
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => { setPage(1); }, [search, organization, division, role, status, pageSize]);
  useEffect(() => { setPage((value) => Math.min(value, totalPages)); }, [totalPages]);
  useEffect(() => { const updated = () => { if (me.directSuperadmin) void load().catch(() => setError('Cần tải lại danh sách quyền.')); }; window.addEventListener('cpms:access-updated', updated); return () => window.removeEventListener('cpms:access-updated', updated); }, [me.directSuperadmin]);
  if (!me.directSuperadmin) return <Card className="p-6"><h1 className="text-xl font-semibold">Quản trị tài khoản</h1><p className="mt-3 text-sm">Cần phiên superadmin trực tiếp để quản trị tài khoản.</p></Card>;
  const select = (account: PublicAccount) => { if (!confirmUnsavedNavigation()) return; setSelected(account); setAction(null); setReason(''); setGmailEmail(account.profile?.gmailEmail ?? ''); setPassword(null); setShowPassword(false); setError(''); };
  const confirm = async () => {
    if (!selected || !action || !reason.trim()) return;
    if (action === 'assist') { await switchAssist(selected.id, reason); return; }
    setBusy(true); setError(''); setPassword(null);
    try {
      if (action === 'gmail') {
        await requestJson(`/auth/accounts/${selected.id}/gmail`, { method: 'POST', body: JSON.stringify({ expectedVersion: selected.recordVersion, gmailEmail: gmailEmail.trim() || null, reason }) });
      } else if (action === 'credential') {
        const result = await requestJson<{ temporaryPassword: string; mustChangePassword: boolean }>(`/auth/accounts/${selected.id}/reset-password`, { method: 'POST', body: JSON.stringify({ expectedVersion: selected.recordVersion, reason }) });
        setPassword(result.temporaryPassword);
        setPasswordMustChange(result.mustChangePassword);
      } else await requestJson(`/auth/accounts/${selected.id}/status`, { method: 'POST', body: JSON.stringify({ expectedVersion: selected.recordVersion, reason, isActive: !selected.isActive }) });
      setAction(null); setReason(''); await load(); setSelected(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể cập nhật tài khoản.'); }
    finally { setBusy(false); }
  };
  const createLeader = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await requestJson('/auth/accounts/division-leaders', { method: 'POST', body: JSON.stringify({
        profile: { ...leader, gmailEmail: leader.gmailEmail.trim() || null }, password: leaderPassword,
        mustChangePassword: leaderMustChange, reason: leaderReason,
      }) });
      setCreating(null); setLeader({ ...emptyLeader }); setLeaderPassword(''); setLeaderReason(''); setLeaderMustChange(true);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo tài khoản lãnh đạo.'); }
    finally { setBusy(false); }
  };
  const createSpecialist = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await requestJson('/auth/accounts/communication-specialists', { method: 'POST', body: JSON.stringify(specialist) });
      setSpecialist({ employeeCode: '', email: '', password: '', reason: '' }); setCreating(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo tài khoản chuyên viên.'); }
    finally { setBusy(false); }
  };
  const createPilot = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await requestJson('/auth/accounts/pilot-admins', { method: 'POST', body: JSON.stringify(pilot) });
      setPilot({ displayName: '', email: '', password: '', reason: '' }); setCreating(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo tài khoản quản trị thử nghiệm.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-wider text-vna-gold-dark">Quản trị CPMS</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Tài khoản và nhân sự</h1>
      <p className="mt-2 text-sm text-slate-600">Hồ sơ, đơn vị công tác, vai trò và trạng thái đăng nhập CPMS.</p><AppLink to="/admin/access" className="mt-3 inline-block text-sm font-semibold text-vna-blue">Quản trị preset vai trò và ma trận quyền</AppLink></header>
    {me.account.accountKind === 'PERSONNEL' && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setCreating(creating === 'leader' ? null : 'leader')}>Thêm lãnh đạo Phòng</Button>
      <Button size="sm" variant="secondary" onClick={() => setCreating(creating === 'specialist' ? null : 'specialist')}>Cấp tài khoản chuyên viên từ danh bạ</Button>
      <Button size="sm" variant="secondary" onClick={() => setCreating(creating === 'pilot' ? null : 'pilot')}>Thêm quản trị thử nghiệm</Button>
    </div>}
    {creating === 'specialist' && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Cấp tài khoản chuyên viên Ban Truyền thông</h2>
      <p className="text-sm text-slate-600">Chỉ dùng hồ sơ nhân sự đã có trong danh bạ. Vai trò Chuyên viên Truyền thông gắn với Phòng hiện hành; mật khẩu ban đầu phải đổi sau lần đăng nhập đầu tiên.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void createSpecialist(event)}>
        <Field label="Mã nhân viên" name="specialist-code" value={specialist.employeeCode} onChange={(event) => setSpecialist({ ...specialist, employeeCode: event.target.value })} required />
        <Field label="Email công việc" name="specialist-email" type="email" value={specialist.email} onChange={(event) => setSpecialist({ ...specialist, email: event.target.value })} required />
        <Field label="Mật khẩu CPMS ban đầu" name="specialist-password" type="password" minLength={8} autoComplete="new-password" value={specialist.password} onChange={(event) => setSpecialist({ ...specialist, password: event.target.value })} required />
        <Field label="Lý do cấp tài khoản" name="specialist-reason" value={specialist.reason} onChange={(event) => setSpecialist({ ...specialist, reason: event.target.value })} required maxLength={1000} />
        <Button type="submit" disabled={busy} className="md:col-span-2">Cấp tài khoản</Button>
      </form></Card>}
    {creating === 'pilot' && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Thêm quản trị thử nghiệm</h2>
      <p className="text-sm text-amber-900">Tài khoản này không gắn nhân sự, có quyền ADMIN trên bản online và có thể bị quản trị viên nhân sự khóa ngay để thu hồi mọi phiên đăng nhập. Chỉ cấp khi cần thiết; tránh mật khẩu dùng chung.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void createPilot(event)}>
        <Field label="Tên hiển thị" name="pilot-name" value={pilot.displayName} onChange={(event) => setPilot({ ...pilot, displayName: event.target.value })} required />
        <Field label="Email công việc" name="pilot-email" type="email" value={pilot.email} onChange={(event) => setPilot({ ...pilot, email: event.target.value })} required />
        <Field label="Mật khẩu CPMS" name="pilot-password" type="password" minLength={8} autoComplete="new-password" value={pilot.password} onChange={(event) => setPilot({ ...pilot, password: event.target.value })} required />
        <Field label="Lý do cấp tài khoản" name="pilot-reason" value={pilot.reason} onChange={(event) => setPilot({ ...pilot, reason: event.target.value })} required maxLength={1000} />
        <Button type="submit" disabled={busy} className="md:col-span-2">Tạo quản trị thử nghiệm</Button>
      </form></Card>}
    {creating === 'leader' && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Thêm lãnh đạo Phòng</h2>
      <p className="text-sm text-slate-600">Tài khoản có vai trò Lãnh đạo Phòng tại Phòng Thương hiệu và quyền xem Chiến dịch, Tư liệu, Kênh & Hợp đồng, Đặt chỗ. Gmail chỉ là thông tin hồ sơ; không tự cấp quyền Google Drive.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void createLeader(event)}>
        {([['employeeCode','Mã nhân viên'],['fullName','Họ tên'],['email','Email công việc'],['gmailEmail','Gmail (có thể để trống)'],['organizationName','Ban'],['departmentName','Phòng'],['jobTitle','Chức danh'],['birthDate','Ngày sinh'],['phoneText','Điện thoại']] as const).map(([key,label]) =>
          <Field key={key} label={label} name={`leader-${key}`} type={key === 'email' || key === 'gmailEmail' ? 'email' : key === 'birthDate' ? 'date' : 'text'}
            value={leader[key]} onChange={(event) => setLeader((current) => ({ ...current, [key]: event.target.value }))} required={key !== 'gmailEmail'} />)}
        <SelectField label="Giới tính" value={leader.gender} onChange={(event) => setLeader((current) => ({ ...current, gender: event.target.value }))}><option>Nam</option><option>Nữ</option><option>Khác</option></SelectField>
        <Field label="Mật khẩu CPMS ban đầu" name="leader-password" type="password" minLength={8} maxLength={1024} autoComplete="new-password" value={leaderPassword} onChange={(event) => setLeaderPassword(event.target.value)} required />
        <Field label="Lý do tạo tài khoản" name="leader-reason" value={leaderReason} onChange={(event) => setLeaderReason(event.target.value)} required maxLength={1000} />
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={leaderMustChange} onChange={(event) => setLeaderMustChange(event.target.checked)} /> Buộc đổi mật khẩu khi đăng nhập lần đầu</label>
        {!leaderMustChange && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">Mật khẩu không đổi lần đầu sẽ tiếp tục có hiệu lực; tránh dùng chung và chỉ chia sẻ trực tiếp cho đúng người.</p>}
        <Button type="submit" disabled={busy} className="md:col-span-2">Tạo tài khoản</Button>
      </form></Card>}
    <div className="flex gap-2" role="tablist" aria-label="Nhóm hồ sơ"><Button role="tab" aria-selected={group === 'complete'} size="sm" variant={group === 'complete' ? 'primary' : 'secondary'} onClick={() => setGroup('complete')}>Hồ sơ đầy đủ ({accounts.length})</Button><Button role="tab" aria-selected={group === 'pending'} size="sm" variant={group === 'pending' ? 'primary' : 'secondary'} onClick={() => setGroup('pending')}>Email chờ bổ sung ({accessView?.pendingContacts.length ?? 0})</Button></div>
    {group === 'pending' && <Card className="space-y-3 p-5"><p className="text-sm text-slate-600">Các liên hệ chưa đủ họ tên hoặc đơn vị không được tạo tài khoản đăng nhập và không xuất hiện trong bộ chọn người nghiệp vụ.</p>{accessView?.pendingContacts.length ? <ul className="list-disc pl-5 text-sm">{accessView.pendingContacts.map((contact) => <li key={contact.email}>{contact.email}</li>)}</ul> : <p className="text-sm">Nguồn danh bạ hiện tại không có liên hệ chờ bổ sung.</p>}</Card>}
    {group === 'complete' && <>
    <Card className="grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-5">
      <Field label="Tìm nhân sự" name="account-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên, email, mã nhân viên…" />
      <SelectField label="Ban / đơn vị" value={organization} onChange={(event) => { setOrganization(event.target.value); setDivision(''); }}><option value="">Tất cả</option>{organizations.map((name) => <option key={name}>{name}</option>)}</SelectField>
      <SelectField label="Phòng" value={division} onChange={(event) => setDivision(event.target.value)}><option value="">Tất cả</option>{divisions.map((name) => <option key={name}>{name}</option>)}</SelectField>
      <SelectField label="Vai trò" value={role} onChange={(event) => setRole(event.target.value)}><option value="">Tất cả</option>{Object.entries(roleLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</SelectField>
      <SelectField label="Đăng nhập" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option><option value="UNCONFIGURED">Chưa thiết lập</option><option value="READY">Đã thiết lập</option><option value="LOCKED">Đã khóa</option></SelectField>
    </Card>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {password && <Card className="space-y-3 border-amber-300 p-5"><h2 className="font-semibold">Mật khẩu CPMS vừa thiết lập</h2><p className="text-sm text-slate-600">Thông tin này chỉ hiển thị trong phiên thao tác hiện tại. {passwordMustChange ? 'Người dùng cần đổi mật khẩu khi đăng nhập.' : 'Đang dùng chính sách demo local; không yêu cầu đổi mật khẩu lần đầu.'}</p>
      <input aria-label="Mật khẩu tạm CPMS" type={showPassword ? 'text' : 'password'} readOnly value={password} className="w-full rounded-lg border border-slate-300 p-3 font-mono" autoComplete="off" />
      <div className="flex gap-3"><Button variant="secondary" size="sm" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</Button><Button size="sm" onClick={() => { setPassword(null); setShowPassword(false); }}>Đã lưu, đóng thông tin</Button></div></Card>}
    {selected && <Card className="space-y-4 border-cyan-200 p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{selected.displayName}</h2><p className="text-sm text-slate-600">{selected.accountKind === 'PILOT_ADMIN' ? 'Quản trị thử nghiệm · không gắn nhân sự' : `${selected.profile?.jobTitle} · ${selected.profile?.departmentName || selected.profile?.organizationName}`}</p>{selected.accountKind === 'PERSONNEL' && <p className="text-xs text-slate-500">Gmail hồ sơ: {selected.profile?.gmailEmail || 'Chưa có'}</p>}</div><Button variant="ghost" size="sm" onClick={() => { if (confirmUnsavedNavigation()) { setSelected(null); setAction(null); } }}>Đóng</Button></div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" disabled={busy || !selected.isActive || selected.id === me.account.id || (me.account.accountKind === 'PILOT_ADMIN' && selected.roles.includes('ADMIN'))} onClick={() => { setAction('credential'); setReason(''); }}>{selected.credentialConfigured ? 'Reset mật khẩu CPMS' : 'Thiết lập đăng nhập'}</Button>
        <Button variant="secondary" size="sm" disabled={busy || selected.id === me.account.id || (me.account.accountKind === 'PILOT_ADMIN' && selected.roles.includes('ADMIN'))} onClick={() => { setAction('status'); setReason(''); }}>{selected.isActive ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</Button>
        {selected.accountKind === 'PERSONNEL' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setAction('gmail'); setReason(''); setGmailEmail(selected.profile?.gmailEmail ?? ''); }}>Cập nhật Gmail</Button>}
        {me.demoImpersonationEnabled && <Button size="sm" disabled={busy || !selected.isActive || selected.id === me.account.id} onClick={() => { void switchDemo(selected.id); }}>Trình diễn tài khoản này</Button>}
        <Button size="sm" disabled={busy || !selected.isActive || selected.id === me.account.id || selected.roles.includes('ADMIN')} onClick={() => { setAction('assist'); setReason(''); }}>Vào tài khoản để hỗ trợ</Button>
      </div>
      {action && <div className="space-y-3 border-t border-slate-200 pt-4"><p className="text-sm">{action === 'credential' ? 'Tạo mật khẩu tạm mới và thu hồi các phiên hiện tại của người này.' : action === 'assist' ? 'Mở phiên hỗ trợ tối đa 29 phút dưới quyền của người này; mọi thao tác ghi cả người quản trị gốc. Không thể đổi mật khẩu, cấu hình quyền hoặc kết nối Google trong phiên hỗ trợ.' : action === 'gmail' ? 'Gmail là thông tin hồ sơ; việc nhập địa chỉ này không tự cấp quyền Google Drive.' : selected.isActive ? 'Khóa đăng nhập, dừng phiên làm việc và quyền trình diễn của người này.' : 'Cho phép tài khoản hoạt động trở lại; trạng thái thiết lập mật khẩu được giữ nguyên.'}</p>
        {action === 'gmail' && <Field label="Gmail (để trống nếu chưa có)" name="account-gmail" type="email" value={gmailEmail} onChange={(event) => setGmailEmail(event.target.value)} />}
        <Field label="Lý do bắt buộc" name="account-change-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="flex gap-3"><Button size="sm" disabled={busy || !reason.trim()} onClick={() => { void confirm(); }}>{action === 'assist' ? 'Bắt đầu hỗ trợ' : 'Xác nhận thay đổi'}</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => setAction(null)}>Hủy</Button></div></div>}
      {titlesNeedingReview.has(selected.id) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Cần xác nhận chức danh: nguồn đang ghi nhiều Trưởng phòng trong cùng Phòng. Giữ nguyên hồ sơ nguồn; chọn Lead riêng cho từng Campaign, không tự đổi chức danh.</p>}
      {selected.accountKind === 'PERSONNEL' && <AccountAccessWorkspace key={selected.id} actorId={selected.id} />}
    </Card>}
    <Card className="overflow-hidden"><div className="border-b border-slate-200 px-5 py-3 text-sm text-slate-600">{visible.length} / {accounts.length} hồ sơ</div>
      <div className="max-h-[66vh] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-600"><tr>{['Nhân sự', 'Ban / Phòng', 'Vai trò', 'Đăng nhập', ''].map((title, index) => <th key={index} className="px-4 py-3">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{visible.slice((page - 1) * pageSize, page * pageSize).map((account) => <tr key={account.id} className={selected?.id === account.id ? 'bg-cyan-50' : 'hover:bg-slate-50'}>
          <td className="px-4 py-3"><strong className="block font-semibold">{account.displayName}</strong><span className="block text-xs text-slate-500">{account.employeeCode} · {account.email}</span><span className="block text-xs text-slate-500">{account.profile?.jobTitle}</span>{titlesNeedingReview.has(account.id) && <span className="mt-1 block text-xs font-medium text-amber-800">Chức danh cần xác nhận</span>}</td>
          <td className="px-4 py-3 text-xs"><span className="block">{account.profile?.organizationName}</span><span className="text-slate-500">{account.profile?.departmentName || '—'}</span></td>
          <td className="max-w-64 px-4 py-3"><div className="flex flex-wrap gap-1">{account.roles.map((code) => <StatusBadge key={code}>{roleLabels[code] || code}</StatusBadge>)}</div><div className="mt-1 space-y-1 text-xs text-slate-500">{accessView?.bindings.filter((binding) => binding.actorId === account.id).map((binding) => <p key={binding.id}><ScopeLabel scope={binding} view={accessView} /></p>)}<p>{accessView?.overrides.filter((override) => override.actorId === account.id).length ?? 0} ngoại lệ</p></div></td>
          <td className="px-4 py-3 text-xs"><StatusBadge tone={!account.isActive ? 'warning' : account.credentialConfigured ? 'positive' : 'neutral'}>{!account.isActive ? 'Đã khóa' : account.credentialConfigured ? 'Đã thiết lập' : 'Chưa thiết lập đăng nhập'}</StatusBadge></td>
          <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => select(account)} aria-label={`Quản lý ${account.displayName}`}>Quản lý</Button></td>
        </tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-xs text-slate-500"><span>Trang {page} / {totalPages}</span><div className="flex items-center gap-2"><select aria-label="Số tài khoản mỗi trang" className="rounded-lg border border-slate-200 px-2 py-2" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>10 dòng</option><option value={20}>20 dòng</option></select><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trước</Button><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Sau</Button></div></div></Card>
    </>}
  </div>;
}
