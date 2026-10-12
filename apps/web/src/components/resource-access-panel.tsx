import { CAMPAIGN_FIELD_DEFINITIONS, canonicalCampaignFieldKey, isProtectedCampaignField, normalizeDirectorySearch, type CampaignSummary } from '@cpms/domain';
import { Button, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { campaignDraftFieldValue, campaignToRowDraft } from '../lib/campaign-inline-edit';
import { overrideChange, recordScope, useAccessEditor, type AccessEditor, type AccessView, type ManagedScope } from '../lib/access-administration';
import { AccessCommitControls, AccessHistory, EffectiveAccess, PeoplePicker, ThreeState, accessInput } from './access-editor-controls';
import { CampaignWorkflowWorkspace } from './campaign-workflow-workspace';

/** Resource-specific fields are supplied by an adapter; selection in a business grid is never read here. */
export interface ResourceAccessAdapter {
  entityType: 'CAMPAIGN'; id: string; code: string; name: string; recordVersion: number;
  fields: { key: string; label: string; currentValue: string }[];
}
const tabs = ['Theo thao tác', 'Theo tài khoản', 'Theo trường', 'Người tham gia', 'Chế độ phê duyệt', 'Lịch sử'] as const;
export function CampaignResourceAccessPanel({ campaign, onClose, onSaved }: { campaign: CampaignSummary; onClose(): void; onSaved(): void }) {
  const adapter = useMemo<ResourceAccessAdapter>(() => {
    const draft = campaignToRowDraft(campaign); const seen = new Set<string>();
    return { entityType: 'CAMPAIGN', id: campaign.id, code: campaign.code, name: campaign.name, recordVersion: campaign.recordVersion,
      fields: CAMPAIGN_FIELD_DEFINITIONS.flatMap((definition) => {
        const key = canonicalCampaignFieldKey(definition.key); if (isProtectedCampaignField(key) || seen.has(key)) return []; seen.add(key);
        return [{ key, label: definition.label, currentValue: String(campaignDraftFieldValue(draft, definition.key) ?? '') }];
      }) };
  }, [campaign]);
  return <ResourceAccessPanel resource={adapter} onClose={onClose} onSaved={onSaved} />;
}
export function ResourceAccessPanel({ resource, onClose, onSaved }: { resource: ResourceAccessAdapter; onClose(): void; onSaved(): void }) {
  const editor = useAccessEditor({ campaignId: resource.id }); const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<typeof tabs[number]>('Theo thao tác'); const [actorId, setActorId] = useState(''); const [search, setSearch] = useState('');
  const [workflowDirty, setWorkflowDirty] = useState(false); const [workflowBusy, setWorkflowBusy] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const close = () => { if (!editor.busy && !workflowBusy && (!(editor.dirty || workflowDirty) || window.confirm('Có thay đổi quyền hoặc workflow chưa lưu. Đóng và bỏ thay đổi?'))) onClose(); };
  const { view } = editor; const scope = recordScope(resource.id);
  const selectedAccount = view?.accounts.find((account) => account.id === actorId);
  const fields = resource.fields.filter((field) => normalizeDirectorySearch(`${field.label} ${field.key}`).includes(normalizeDirectorySearch(search)));
  return <dialog ref={dialog} aria-labelledby="resource-access-title" onCancel={(event) => { event.preventDefault(); close(); }} className="fixed inset-y-0 left-auto right-0 m-0 h-screen max-h-screen w-[min(1160px,96vw)] max-w-none border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40">
    <div className="flex h-full flex-col"><header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-4"><div className="min-w-0"><h2 id="resource-access-title" className="flex items-center gap-2 text-xl font-semibold"><CpmsIcon name="locked" />Phân quyền đặc biệt</h2><p className="mt-2 break-words text-sm font-semibold">{resource.code} · {resource.name}</p><p className="mt-1 text-xs text-slate-500">Chỉ áp dụng cho Campaign này. Các dòng được đánh dấu ở bảng không ảnh hưởng phạm vi thao tác.</p></div><Button variant="ghost" size="sm" disabled={editor.busy || workflowBusy} onClick={close}>Đóng</Button></header>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 py-2" role="tablist" aria-label="Cách xem phân quyền">{tabs.map((label) => <button key={label} role="tab" aria-selected={tab === label} disabled={workflowBusy || (workflowDirty && label !== tab) || (editor.dirty && ['Người tham gia','Chế độ phê duyệt'].includes(label))} title={editor.dirty || workflowDirty ? 'Lưu hoặc hủy thay đổi hiện tại trước khi chuyển cấu hình' : label} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${tab === label ? 'bg-cyan-50 text-vna-blue' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setTab(label)}>{label}</button>)}</div>
      <div className="min-h-0 flex-1 overflow-auto p-5" role="tabpanel">
        {!view ? <p className="text-sm">{editor.error || 'Đang tải cấu hình quyền…'}</p> : <>
          {tab === 'Theo thao tác' && <ActionPermissionMatrix editor={editor} scope={scope} />}
          {(tab === 'Theo tài khoản' || tab === 'Theo trường') && <div className="space-y-4">
            <AccountChoice view={view} actorId={actorId} onChange={setActorId} />
            {selectedAccount && <p className="text-xs text-slate-500">{selectedAccount.loginEmail} · {selectedAccount.personnelEmployeeCode} · {selectedAccount.personnel?.departmentName || selectedAccount.personnel?.organizationName} · {selectedAccount.personnel?.jobTitle}</p>}
            {actorId && tab === 'Theo tài khoản' && <><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Thao tác</th><th className="p-3">Ngoại lệ tại Campaign</th></tr></thead><tbody>{view.definitions.filter((definition) => definition.module === 'CAMPAIGN' && definition.supportedScopes.includes('RECORD') && definition.code !== 'campaign.create').map((definition) => <tr key={definition.code} className="border-t border-slate-100"><td className="p-3">{definition.label}{definition.implementationStatus === 'RESERVED' && <span className="ml-2 text-xs text-amber-700">Dự phòng, chưa thực thi</span>}</td><td className="p-3"><ThreeState label={`${definition.label} cho tài khoản`} value={editor.state(actorId, definition.code, scope)} disabled={editor.busy} onChange={(state) => editor.stage(overrideChange(actorId, definition.code, scope, state))} /></td></tr>)}</tbody></table></div><EffectiveAccess actorId={actorId} campaignId={resource.id} view={view} /></>}
            {actorId && tab === 'Theo trường' && <><p className="rounded-lg bg-cyan-50 p-3 text-xs">Chỉ cấu hình quyền sửa. Người dùng vẫn cần xem được Campaign. Trường hệ thống và trạng thái workflow không chỉnh sửa tại đây.</p><input className={`${accessInput} w-full`} type="search" aria-label="Tìm trường Campaign" placeholder="Tìm tên trường…" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Trường</th><th className="p-3">Giá trị hiện tại</th><th className="p-3">Quyền sửa riêng</th></tr></thead><tbody>{fields.map((field) => <tr key={field.key} className="border-t border-slate-100"><td className="p-3">{field.label}</td><td className="max-w-80 p-3"><p className="line-clamp-3 break-words text-xs text-slate-500">{field.currentValue || 'Chưa có giá trị'}</p></td><td className="p-3"><ThreeState label={`Quyền sửa ${field.label}`} disabled={editor.busy} value={editor.state(actorId, 'campaign.update', recordScope(resource.id, field.key))} onChange={(state) => editor.stage(overrideChange(actorId, 'campaign.update', recordScope(resource.id, field.key), state))} /></td></tr>)}</tbody></table></div><EffectiveAccess actorId={actorId} campaignId={resource.id} view={view} /></>}
          </div>}
          {(tab === 'Người tham gia' || tab === 'Chế độ phê duyệt') && <CampaignWorkflowWorkspace key={tab} campaignId={resource.id} resourceVersion={resource.recordVersion} section={tab === 'Người tham gia' ? 'participants' : 'approval'} onDirtyChange={setWorkflowDirty} onBusyChange={setWorkflowBusy} onSaved={() => { onSaved(); void editor.load(); }} />}
          {tab === 'Lịch sử' && <AccessHistory view={view} campaignId={resource.id} />}
        </>}
      </div>
      {!['Người tham gia','Chế độ phê duyệt'].includes(tab) && <div className="max-h-[48vh] shrink-0 overflow-auto"><AccessCommitControls editor={editor} onSaved={onSaved} /></div>}
    </div>
  </dialog>;
}
export function AccountChoice({ view, actorId, onChange }: { view: AccessView; actorId: string; onChange(id: string): void }) {
  const [query, setQuery] = useState(''); const normalized = normalizeDirectorySearch(query);
  const accounts = view.accounts.filter((account) => account.id === actorId || normalizeDirectorySearch([account.displayName, account.loginEmail, account.personnelEmployeeCode].join(' ')).includes(normalized));
  return <div className="grid gap-2 md:grid-cols-2"><input aria-label="Tìm tài khoản phân quyền" type="search" className={accessInput} placeholder="Tên, email, mã nhân viên…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Tài khoản phân quyền" className={`${accessInput} min-w-0`} value={actorId} onChange={(event) => onChange(event.target.value)}><option value="">Chọn tài khoản…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.personnelEmployeeCode}{!account.isActive ? ' · Đã khóa' : ''}</option>)}</select></div>;
}
export function ActionPermissionMatrix({ editor, scope }: { editor: AccessEditor; scope: ManagedScope }) {
  const view = editor.view!; const [group, setGroup] = useState(''); const [search, setSearch] = useState('');
  const definitions = view.definitions.filter((definition) => definition.module === scope.module && definition.supportedScopes.includes(scope.scopeType) && definition.code !== 'campaign.create');
  const groups = [...new Set(definitions.map((definition) => definition.groupLabel))];
  const visible = definitions.filter((definition) => (!group || definition.groupLabel === group) && normalizeDirectorySearch(`${definition.label} ${definition.code}`).includes(normalizeDirectorySearch(search)));
  const selected = (permission: string, effect: 'ALLOW' | 'DENY') => view.accounts.filter((account) => editor.state(account.id, permission, scope) === effect).map((account) => account.id);
  return <div className="space-y-4"><p className="text-sm text-slate-600">Chọn người cho từng thao tác. Bỏ khỏi cả hai danh sách để kế thừa. Chuyển sang Cho phép hoặc Từ chối sẽ thay lựa chọn đối lập tại cùng phạm vi.</p>
    <div className="grid gap-3 md:grid-cols-2"><input type="search" aria-label="Tìm thao tác phân quyền" className={accessInput} placeholder="Tìm thao tác…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Nhóm thao tác phân quyền" className={accessInput} value={group} onChange={(event) => setGroup(event.target.value)}><option value="">Mọi nhóm thao tác</option>{groups.map((label) => <option key={label}>{label}</option>)}</select></div>
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="min-w-52 p-3">Thao tác</th><th className="p-3">Cho phép</th><th className="p-3">Từ chối</th></tr></thead><tbody>{visible.map((definition) => <tr key={definition.code} className="border-t border-slate-100 align-top"><td className="p-3"><p className="font-medium">{definition.label}</p><p className="mt-1 text-xs text-slate-400">{definition.code}</p>{definition.implementationStatus === 'RESERVED' && <StatusBadge tone="warning">Dự phòng, chưa thực thi</StatusBadge>}<p className="mt-2 max-w-72 text-xs text-slate-500">{definition.description}</p></td>{(['ALLOW', 'DENY'] as const).map((effect) => <td key={effect} className="p-3"><PeoplePicker label={`${effect === 'ALLOW' ? 'Cho phép' : 'Từ chối'} ${definition.label}`} accounts={view.accounts} selected={selected(definition.code, effect)} disabled={editor.busy} onToggle={(id, checked) => editor.stage(overrideChange(id, definition.code, scope, checked ? effect : 'INHERIT'))} /><p className="mt-2 max-w-72 text-xs text-slate-500">{selected(definition.code, effect).map((id) => view.accounts.find((account) => account.id === id)?.displayName).join('; ') || 'Không có ngoại lệ'}</p></td>)}</tr>)}</tbody></table></div>
  </div>;
}
