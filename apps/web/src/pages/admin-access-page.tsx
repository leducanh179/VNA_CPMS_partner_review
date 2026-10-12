import { normalizeDirectorySearch } from '@cpms/domain';
import { Button, Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useState } from 'react';
import { useAuth } from '../auth-context';
import { AccessCommitControls, AccessHistory, accessInput } from '../components/access-editor-controls';
import { roleLabels, useAccessEditor, type ManagedPreset } from '../lib/access-administration';
import { AppLink } from '../lib/router';

export function AdminAccessPage() {
  const { me } = useAuth();
  if (!me.directSuperadmin) return <Card className="p-6"><h1 className="text-xl font-semibold">Vai trò và phân quyền</h1><p className="mt-3 text-sm">Cần phiên superadmin trực tiếp để quản trị quyền.</p></Card>;
  return <RolePresetWorkspace />;
}
function RolePresetWorkspace() {
  const editor = useAccessEditor(); const [roleCode, setRoleCode] = useState('CAMPAIGN_REQUESTER'); const [tab, setTab] = useState<'presets' | 'history'>('presets');
  const [module, setModule] = useState('CAMPAIGN'); const [query, setQuery] = useState('');
  const { view } = editor; const role = view?.roles.find((item) => item.code === roleCode);
  const staged = editor.changes[`ROLE_PRESET:${roleCode}`];
  const rows = staged?.kind === 'ROLE_PRESET' ? staged.permissions : role?.permissionPresets ?? [];
  const stage = (permissions: ManagedPreset[]) => editor.stage({ kind: 'ROLE_PRESET', roleCode, permissions: permissions.map(({ permissionCode, effect, relation, defaultScope }) => ({ permissionCode, effect, relation, defaultScope })) });
  const changeRow = (permissionCode: string, index: number, patch: Partial<ManagedPreset> | null) => {
    const matches = rows.filter((row) => row.permissionCode === permissionCode); const current = matches[index];
    const after = [...rows]; const target = current ? rows.indexOf(current) : -1;
    if (patch === null) { if (target >= 0) after.splice(target, 1); }
    else if (target >= 0) after[target] = { ...current!, ...patch };
    else after.push({ permissionCode, effect: 'ALLOW', relation: 'ALL', defaultScope: 'MODULE', ...patch });
    stage(after);
  };
  return <div className="space-y-5"><header><p className="text-xs font-bold uppercase tracking-wider text-vna-gold-dark">Quản trị CPMS</p><h1 className="mt-1 text-2xl font-semibold">Vai trò và ma trận quyền</h1><p className="mt-2 text-sm text-slate-600">Preset xác định quyền của vai trò. Phạm vi thực tế đến từ mỗi lần gắn vai trò cho tài khoản.</p><AppLink to="/admin/accounts" className="mt-3 inline-block text-sm font-semibold text-vna-blue">Tài khoản và nhân sự</AppLink></header>
    <Card className="overflow-hidden"><div className="flex gap-2 border-b border-slate-200 p-3"><Button size="sm" variant={tab === 'presets' ? 'primary' : 'secondary'} onClick={() => setTab('presets')}>Preset vai trò</Button><Button size="sm" variant={tab === 'history' ? 'primary' : 'secondary'} onClick={() => setTab('history')}>Lịch sử cấu hình</Button></div>
      {!view ? <p className="p-5 text-sm">{editor.error || 'Đang tải ma trận quyền…'}</p> : tab === 'history' ? <div className="p-5"><AccessHistory view={view} /></div> : <div className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-semibold">Vai trò<select aria-label="Vai trò preset" className={`${accessInput} mt-1 w-full`} value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>{view.roles.map((item) => <option key={item.code} value={item.code}>{roleLabels[item.code] ?? item.displayName}</option>)}</select></label><label className="text-xs font-semibold">Phân hệ<select aria-label="Phân hệ preset" className={`${accessInput} mt-1 w-full`} value={module} onChange={(event) => setModule(event.target.value)}><option value="">Tất cả phân hệ</option>{[...new Set(view.definitions.map((definition) => definition.module))].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Tìm thao tác<input aria-label="Tìm quyền preset" className={`${accessInput} mt-1 w-full`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc mã quyền…" /></label></div>
        <p className="text-xs text-slate-500">{view.bindings.filter((binding) => binding.roleCode === roleCode).length} phạm vi đang gắn vai trò này · phiên bản preset {role?.recordVersion}. Xóa dòng quyền sẽ trở về không cấp quyền từ preset; ngoại lệ cụ thể vẫn được xét riêng.</p>
        {roleCode === 'ADMIN' ? <p className="rounded-xl bg-cyan-50 p-4 text-sm">Superadmin trực tiếp là đặc quyền đã xác minh. Không chỉnh sửa hoặc nhân bản đặc quyền này bằng preset nghiệp vụ.</p> : <>
          <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Thao tác', 'Quyền từ vai trò', 'Điều kiện', 'Phạm vi gợi ý', ''].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{view.definitions.filter((definition) => (!module || definition.module === module) && normalizeDirectorySearch(`${definition.label} ${definition.code}`).includes(normalizeDirectorySearch(query))).flatMap((definition) => {
            const permissions = rows.filter((row) => row.permissionCode === definition.code); const entries = permissions.length ? permissions : [null];
            return entries.map((permission, index) => <tr key={`${definition.code}:${index}`} className="border-t border-slate-100 align-top"><td className="p-3"><p className="font-medium">{definition.label}</p><p className="mt-1 text-xs text-slate-400">{definition.code}</p>{definition.implementationStatus === 'RESERVED' && <StatusBadge tone="warning">Dự phòng, chưa thực thi</StatusBadge>}</td><td className="p-3"><select className={accessInput} aria-label={`Preset ${definition.label} ${index + 1}`} disabled={editor.busy} value={permission?.effect ?? 'NONE'} onChange={(event) => changeRow(definition.code, index, event.target.value === 'NONE' ? null : { effect: event.target.value as 'ALLOW' | 'DENY' })}><option value="NONE">Không cấp</option><option value="ALLOW">Cho phép</option><option value="DENY">Từ chối</option></select></td><td className="p-3"><select className={accessInput} aria-label={`Điều kiện ${definition.label} ${index + 1}`} disabled={editor.busy || !permission} value={permission?.relation ?? 'ALL'} onChange={(event) => changeRow(definition.code, index, { relation: event.target.value })}>{[['ALL','Trong toàn phạm vi'],['OWN','Tự tạo'],['OWN_DRAFT','Tự tạo, còn nháp'],['ASSIGNED','Được phân công'],['UNIT','Đơn vị tham gia']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td className="p-3"><select className={accessInput} aria-label={`Phạm vi gợi ý ${definition.label} ${index + 1}`} disabled={editor.busy || !permission} value={permission?.defaultScope ?? 'MODULE'} onChange={(event) => changeRow(definition.code, index, { defaultScope: event.target.value })}>{definition.supportedScopes.filter((value) => value !== 'FIELD').map((value) => <option key={value} value={value}>{value === 'SYSTEM' ? 'Hệ thống' : value === 'MODULE' ? 'Phân hệ' : value === 'MODULE_ORG' ? 'Phân hệ / đơn vị' : 'Record'}</option>)}</select></td><td className="p-3">{permission && <Button size="sm" variant="ghost" disabled={editor.busy} aria-label={`Xóa dòng preset ${definition.label} ${index + 1}`} onClick={() => changeRow(definition.code, index, null)}><CpmsIcon name="delete" />Xóa</Button>}</td></tr>);
          })}</tbody></table></div>
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Quyền dự phòng chỉ lưu cấu hình; không tạo chức năng chưa triển khai. Các thao tác quản trị và kết nối bên ngoài vẫn có điều kiện bắt buộc riêng.</p>
        </>}
      </div>}
      <AccessCommitControls editor={editor} />
    </Card>
  </div>;
}
