import { CAMPAIGN_FIELD_BY_KEY, normalizeDirectorySearch } from '@cpms/domain';
import { Button, CpmsIcon, Field, StatusBadge } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';
import { reasonLabels, roleLabels, stateLabels, type AccessAccount, type AccessEditor, type AccessExplanation, type AccessView, type ManagedScope, type OverrideState } from '../lib/access-administration';

export const accessInput = 'min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100 disabled:text-slate-400';
export function ScopeLabel({ scope, view }: { scope: ManagedScope; view: AccessView }) {
  const org = view.organizations.find((item) => item.id === scope.orgId);
  return <span>{scope.scopeType === 'SYSTEM' ? 'Toàn hệ thống' : scope.scopeType === 'MODULE' ? `Phân hệ ${scope.module}` : scope.scopeType === 'MODULE_ORG' ? `${scope.module} · ${org?.sourceName ?? 'Đơn vị đã chọn'}` : scope.scopeType === 'FIELD' ? `Trường ${CAMPAIGN_FIELD_BY_KEY[scope.fieldKey ?? '']?.label ?? scope.fieldKey} · một Campaign` : 'Một Campaign'}</span>;
}
export function ThreeState({ value, onChange, label, disabled = false }: { value: OverrideState; onChange(value: OverrideState): void; label: string; disabled?: boolean }) {
  return <select aria-label={label} className={`${accessInput} ${value === 'DENY' ? 'border-rose-300 text-rose-700' : value === 'ALLOW' ? 'border-emerald-300 text-emerald-800' : ''}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as OverrideState)}>
    {Object.entries(stateLabels).map(([state, text]) => <option key={state} value={state}>{text}</option>)}
  </select>;
}
export function PeoplePicker({ accounts, selected, onToggle, label, disabled = false }: { accounts: AccessAccount[]; selected: string[]; onToggle(id: string, checked: boolean): void; label: string; disabled?: boolean }) {
  const [query, setQuery] = useState(''); const search = normalizeDirectorySearch(query);
  const visible = accounts.filter((account) => !search || normalizeDirectorySearch([account.displayName, account.loginEmail, account.personnelEmployeeCode, account.personnel?.departmentName, account.personnel?.organizationName, account.personnel?.jobTitle].join(' ')).includes(search));
  return <details className="min-w-52 max-w-80 rounded-lg border border-slate-200 bg-white">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold" aria-label={label}>{label} · {selected.length} người</summary>
    <div className="border-t border-slate-100 p-2"><input aria-label={`Tìm ${label}`} placeholder="Tên, email, mã nhân viên…" className={`${accessInput} w-full`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="mt-2 max-h-56 overflow-auto">{visible.slice(0, 40).map((account) => <label key={account.id} className="flex gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
        <input type="checkbox" className="mt-1" checked={selected.includes(account.id)} disabled={disabled || (!selected.includes(account.id) && (!account.isActive || !account.employment))} onChange={(event) => onToggle(account.id, event.target.checked)} />
        <span className="min-w-0"><strong className="block font-medium">{account.displayName}{!account.isActive ? ' · Đã khóa' : ''}</strong><span className="block break-all text-slate-500">{account.loginEmail} · {account.personnelEmployeeCode}</span><span className="block text-slate-500">{account.personnel?.departmentName || account.personnel?.organizationName} · {account.personnel?.jobTitle}</span></span>
      </label>)}{visible.length > 40 && <p className="p-2 text-xs text-slate-500">Hiển thị 40 / {visible.length}. Nhập thêm để thu hẹp.</p>}{!visible.length && <p className="p-2 text-xs">Không tìm thấy hồ sơ đủ thông tin.</p>}</div>
    </div>
  </details>;
}
export function AccessCommitControls({ editor, onSaved }: { editor: AccessEditor; onSaved?(): void }) {
  const { view, preview } = editor;
  const label = (code: string) => view?.definitions.find((definition) => definition.code === code)?.label ?? code;
  return <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-4">
    {editor.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{editor.error} <button className="underline" onClick={() => { if (!editor.dirty || window.confirm('Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?')) void editor.load(); }}>Tải lại cấu hình</button></p>}
    {editor.message && <p role="status" className="text-sm text-emerald-800">{editor.message}</p>}
    <div className="grid gap-3 md:grid-cols-[1fr_15rem]"><Field label="Lý do thay đổi quyền (bắt buộc)" name="access-reason" value={editor.reason} maxLength={1000} disabled={editor.busy} onChange={(event) => editor.setReason(event.target.value)} />
      <Field label="Hết hiệu lực (tùy chọn)" name="access-expiry" type="datetime-local" value={editor.expires} disabled={editor.busy} onChange={(event) => editor.setExpires(event.target.value)} /></div>
    {preview && <section aria-label="Xem trước tác động phân quyền" className="max-h-[min(14rem,24vh)] space-y-3 overflow-auto rounded-xl border border-cyan-200 bg-white p-4">
      <h3 className="font-semibold">Xem trước · {preview.changes.length} thay đổi · phiên bản {preview.version}</h3>
      {preview.impacts.map((impact) => <div key={`${impact.actorId}:${impact.campaignId}`} className="rounded-lg border border-slate-200 p-3 text-sm">
        <h4 className="font-semibold">{view?.accounts.find((account) => account.id === impact.actorId)?.displayName ?? 'Tài khoản được cấu hình'}</h4>
        <p className="mt-1 text-xs text-slate-500">{impact.campaignId ? 'Tác động tại Campaign này' : 'Tác động ở phân hệ; quyền có điều kiện cần xét thêm từng Campaign.'}</p>
        <p className="mt-2"><strong>Sau khi lưu, được phép:</strong> {impact.decisions.filter((decision) => decision.after.allowed).map((decision) => label(decision.permission)).join('; ') || 'Chưa có thao tác phù hợp trong ngữ cảnh này.'}</p>
        {impact.campaignId && <><p className="mt-2"><strong>Sửa trường:</strong> {impact.editableFieldsAfter.length ? impact.editableFieldsAfter.map((key) => CAMPAIGN_FIELD_BY_KEY[key]?.label ?? key).join('; ') : 'Không có trường được sửa.'}</p>
          <p className="mt-1"><strong>Xóa mềm:</strong> {impact.decisions.find((decision) => decision.permission === 'campaign.delete')?.after.allowed ? 'Có quyền' : 'Không có quyền'}. <strong>Duyệt:</strong> {impact.decisions.find((decision) => decision.permission === 'campaign.approve')?.after.allowed ? 'Có quyền; vẫn cần task được giao đang mở' : 'Không có quyền'}.</p></>}
        <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-vna-blue">So sánh trước / sau và nguồn quyết định</summary><div className="mt-2 space-y-1 text-xs">{impact.decisions.filter((decision) => decision.before.allowed !== decision.after.allowed || decision.before.reason !== decision.after.reason).map((decision) => <p key={decision.permission}>{label(decision.permission)}: {decision.before.allowed ? 'Cho phép' : 'Không cho phép'} → {decision.after.allowed ? 'Cho phép' : 'Không cho phép'} · {reasonLabels[decision.after.reason]} ({decision.after.tier ?? 'Điều kiện bắt buộc'})</p>)}{impact.changedFields.map((field) => <p key={field.fieldKey}>{CAMPAIGN_FIELD_BY_KEY[field.fieldKey]?.label ?? field.fieldKey}: {field.before.allowed ? 'Được sửa' : 'Không sửa'} → {field.after.allowed ? 'Được sửa' : 'Không sửa'}</p>)}</div></details>
      </div>)}
      {preview.changes.some((change) => change.kind === 'ROLE_PRESET') && <p className="text-sm">Preset vai trò sẽ được thay bằng các dòng đã cấu hình; các tài khoản đang gắn vai trò được đánh giá ở trên.</p>}
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">{preview.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>}
    <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="secondary" disabled={editor.busy || !editor.dirty || !editor.reason.trim()} onClick={() => { void editor.run(false); }}>Xem trước tác động</Button>
      <Button size="sm" disabled={editor.busy || !preview || !preview.changes.length} onClick={() => { void editor.run(true).then(() => onSaved?.()); }}><CpmsIcon name="save" />Lưu phân quyền</Button>
      <Button size="sm" variant="ghost" disabled={editor.busy || !editor.dirty} onClick={() => { if (window.confirm('Bỏ toàn bộ thay đổi quyền chưa lưu?')) void editor.load(); }}>Hủy thay đổi</Button>
      <span className="text-xs text-slate-500">{Object.keys(editor.changes).length} thay đổi đang soạn · phiên bản {view?.version ?? '…'}</span>
    </div>
  </div>;
}
export function EffectiveAccess({ actorId, campaignId, view }: { actorId: string; campaignId?: string; view: AccessView }) {
  const [data, setData] = useState<AccessExplanation | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; setData(null); setError(''); if (!actorId) return;
    void requestJson<AccessExplanation>(`/access/explain?${new URLSearchParams({ actorId, ...(campaignId ? { campaignId } : {}) })}`).then((result) => { if (active) setData(result); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Không giải thích được quyền.'); });
    return () => { active = false; };
  }, [actorId, campaignId, view.version]);
  if (!actorId) return <p className="text-sm text-slate-500">Chọn một tài khoản để xem quyền hiệu lực.</p>;
  if (error) return <p role="alert" className="text-sm text-rose-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Đang đánh giá quyền hiện hành…</p>;
  return <div className="space-y-3"><p className="text-xs text-slate-500">Quyền đã lưu, phiên bản {data.version}. {campaignId ? 'Đã xét Campaign này.' : 'Chưa chọn Campaign; các quyền theo người tạo, đơn vị và người tham gia cần xét thêm tại record.'}</p>
    <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50"><tr><th className="p-2">Thao tác</th><th className="p-2">Hiệu lực</th><th className="p-2">Vì sao / nguồn</th></tr></thead><tbody>{data.decisions.map((decision) => <tr key={decision.permission} className="border-t border-slate-100"><td className="p-2">{view.definitions.find((definition) => definition.code === decision.permission)?.label ?? decision.permission}</td><td className="p-2"><StatusBadge tone={decision.allowed ? 'positive' : 'neutral'}>{decision.allowed ? 'Cho phép' : 'Không cho phép'}</StatusBadge></td><td className="p-2">{reasonLabels[decision.reason] ?? decision.reason}{decision.tier ? ` · ${decision.tier}` : ''}{decision.ruleIds.length > 0 && <details><summary className="cursor-pointer text-vna-blue">Quy tắc nguồn</summary>{decision.ruleIds.map((id) => { const source = data.sources.find((rule) => rule.id === id); return <p key={id} className="mt-1 text-slate-500">{source?.source === 'ROLE_BINDING' ? 'Vai trò được gắn' : 'Ngoại lệ tài khoản'} · {source?.effect === 'ALLOW' ? 'Cho phép' : 'Từ chối'} · {source?.relation} {source?.validUntil ? `· đến ${new Date(source.validUntil).toLocaleString('vi-VN')}` : ''}</p>; })}</details>}</td></tr>)}</tbody></table></div>
    {data.fields.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">Trường được sửa ({data.fields.filter((field) => field.allowed).length})</summary><p className="mt-2 text-xs">{data.fields.filter((field) => field.allowed).map((field) => CAMPAIGN_FIELD_BY_KEY[field.fieldKey]?.label ?? field.fieldKey).join('; ') || 'Không có.'}</p></details>}
    <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">{data.notes.map((note) => <li key={note}>{note}</li>)}</ul>
  </div>;
}
export function AccessHistory({ view, actorId, campaignId }: { view: AccessView; actorId?: string; campaignId?: string }) {
  const events = view.history.filter((event) => (!actorId || event.payload.changes?.some((change) => change.actorId === actorId || change.key.startsWith('preset:'))) && (!campaignId || event.payload.changes?.some((change) => change.key.includes(campaignId))));
  return <div className="space-y-3"><p className="text-xs text-slate-500">Lịch sử cấu hình quyền, tối đa 100 sự kiện gần nhất. Thay đổi nghiệp vụ có nhật ký riêng.</p>{events.map((event) => <article key={event.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{event.action === 'ACCESS_POLICY_CHANGED' ? 'Cập nhật quyền' : 'Khởi tạo danh mục quyền'}</strong><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString('vi-VN')}</time></div><p className="mt-1">{event.payload.reason || 'Khởi tạo danh mục triển khai'}</p><p className="mt-1 text-xs text-slate-500">{view.accounts.find((account) => account.id === event.actorId)?.displayName ?? 'Quản trị viên'} · phiên bản {event.payload.version ?? 'khởi tạo'}</p><details className="mt-2"><summary className="cursor-pointer text-xs">Chi tiết trước / sau</summary>{event.payload.changes?.map((change) => <div key={change.key} className="mt-2 overflow-auto text-xs"><p>{change.actorId ? view.accounts.find((account) => account.id === change.actorId)?.displayName : roleLabels[change.key.slice(7)] ?? 'Preset vai trò'}</p><pre className="mt-1 whitespace-pre-wrap break-words text-slate-500">{JSON.stringify({ before: change.before, after: change.after }, null, 2)}</pre></div>)}</details></article>)}{!events.length && <p className="text-sm text-slate-500">Chưa có thay đổi quyền phù hợp trong lịch sử gần đây.</p>}</div>;
}
