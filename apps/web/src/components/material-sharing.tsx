import { MATERIAL_SHARING_LABELS, type MaterialSharing, type MaterialSummary, type MaterialPortalBootstrap, type MaterialGrant } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';
import { materialFormReferences } from '../lib/material-form';

export type SharingSelection = Pick<MaterialSharing, 'mode' | 'campaignIds' | 'grants'>;
export const newMaterialSharing = (): SharingSelection => ({ mode: 'SHARED', campaignIds: [], grants: [] });
const control = 'rounded-lg border border-slate-200 bg-white p-2 text-sm';
type Directory = { accounts: { id: string; name: string }[]; organizations: { id: string; name: string }[] };

export function MaterialSharingEditor({ value, onChange, campaigns, materialId, suggestedIds = [] }: {
  value: SharingSelection; onChange(value: SharingSelection): void;
  campaigns: MaterialPortalBootstrap['campaigns']; materialId?: string; suggestedIds?: string[];
}) {
  const [query, setQuery] = useState(''), [directory, setDirectory] = useState<Directory>({ accounts: [], organizations: [] });
  const [error, setError] = useState(''), [target, setTarget] = useState(''), [permission, setPermission] = useState<MaterialGrant['permission']>('VIEW');
  useEffect(() => {
    if (value.mode !== 'RESTRICTED') return;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, ...(materialId ? { materialId } : {}) });
      void requestJson<Directory>(`/materials/sharing-directory?${params}`).then(result => { if (active) { setDirectory(result); setError(''); } }).catch(e => { if (active) setError(e.message); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, materialId, value.mode]);
  const changeMode = (mode: SharingSelection['mode']) => onChange({ mode, campaignIds: mode === 'CAMPAIGN' ? suggestedIds.filter(id => campaigns.some(c => c.campaign_id === id)) : [], grants: [] });
  const names = new Map([...directory.accounts.map(a => [`ACCOUNT:${a.id}`, a.name] as const), ...directory.organizations.map(o => [`ORG:${o.id}`, o.name] as const)]);
  return <div className="space-y-4">
    <label className="block text-sm font-semibold">Phạm vi truy cập
      <select className={`${control} mt-2 block w-full`} value={value.mode} onChange={e => changeMode(e.target.value as SharingSelection['mode'])}>
        {value.mode === 'LEGACY' && <option value="LEGACY">Phạm vi cũ · Chờ xác nhận</option>}
        {(['SHARED', 'CAMPAIGN', 'RESTRICTED'] as const).map(mode => <option key={mode} value={mode}>{MATERIAL_SHARING_LABELS[mode]}</option>)}
      </select>
    </label>
    {value.mode === 'SHARED' && <p className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-vna-blue">Mọi người, kể cả khách chưa đăng nhập, đều có thể xem.</p>}
    {value.mode === 'LEGACY' && <p className="text-sm text-amber-800">Tư liệu lịch sử giữ nguyên quyền cũ, chưa được công khai. Quản trị viên cần xác nhận phạm vi phù hợp.</p>}
    {value.mode === 'CAMPAIGN' && <div className="space-y-2">
      <p className="text-sm text-slate-600">Người có quyền xem ít nhất một Chiến dịch được chọn có thể xem tư liệu. Đây là danh sách chia sẻ riêng, không tự thay đổi khi sửa Chiến dịch sử dụng tư liệu.</p>
      <div className="max-h-56 overflow-auto rounded-lg border p-2">{campaigns.map(c => <label key={c.campaign_id} className="flex gap-2 rounded p-2 text-sm hover:bg-cyan-50">
        <input type="checkbox" checked={value.campaignIds.includes(c.campaign_id)} onChange={e => onChange({ ...value, campaignIds: e.target.checked ? [...value.campaignIds, c.campaign_id] : value.campaignIds.filter(id => id !== c.campaign_id) })}/>{c.campaign_name}
      </label>)}</div>
      {!value.campaignIds.length && <p className="text-sm text-amber-800">Chọn ít nhất một Chiến dịch chuẩn. Tên Chiến dịch tự nhập không dùng để cấp quyền.</p>}
    </div>}
    {value.mode === 'RESTRICTED' && <div className="space-y-3">
      <label className="block text-sm">Tìm người / nhóm, đơn vị<input className={`${control} mt-1 w-full`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Nhập tên để tìm (tối đa 50 kết quả mỗi nhóm)"/></label>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Người hoặc đơn vị" className={`${control} min-w-40 flex-1`} value={target} onChange={e => setTarget(e.target.value)}><option value="">Chọn người / đơn vị</option>
          <optgroup label="Tài khoản">{directory.accounts.map(a => <option key={a.id} value={`ACCOUNT:${a.id}`}>{a.name}</option>)}</optgroup>
          <optgroup label="Nhóm / đơn vị (thành viên hiện hành)">{directory.organizations.map(o => <option key={o.id} value={`ORG:${o.id}`}>{o.name}</option>)}</optgroup>
        </select>
        <select aria-label="Quyền được cấp" className={control} value={permission} onChange={e => setPermission(e.target.value as MaterialGrant['permission'])}><option value="VIEW">Xem</option><option value="EDIT">Xem và sửa</option><option value="MANAGE_SHARING">Xem và quản lý chia sẻ</option></select>
        <Button variant="secondary" disabled={!target} onClick={() => { const [kind, id] = target.split(':') as [MaterialGrant['kind'], string]; onChange({ ...value, grants: [...value.grants.filter(g => !(g.kind === kind && g.id === id)), { kind, id, permission }] }); setTarget(''); }}>Thêm</Button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {value.grants.map(g => <div key={`${g.kind}:${g.id}`} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2 text-sm"><span className="flex-1">{names.get(`${g.kind}:${g.id}`) || `${g.kind === 'ORG' ? 'Đơn vị' : 'Tài khoản'} · ${g.id}`}</span><span>{g.permission === 'VIEW' ? 'Xem' : g.permission === 'EDIT' ? 'Xem và sửa' : 'Quản lý chia sẻ'}</span><Button size="sm" variant="ghost" onClick={() => onChange({ ...value, grants: value.grants.filter(item => item !== g) })}>Bỏ</Button></div>)}
      {!value.grants.length && <p className="text-sm text-slate-600">Chỉ người tạo và người quản trị có quyền quản lý tư liệu được xem.</p>}
    </div>}
    <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong>Quyền hiệu lực sau khi lưu:</strong> {value.mode === 'SHARED' ? 'Khách được xem nội dung và đường dẫn; không sửa, xem bình luận hay lịch sử.' : value.mode === 'CAMPAIGN' ? `${value.campaignIds.length} Chiến dịch được chọn (hợp quyền xem), người tạo và quản trị viên.` : value.mode === 'RESTRICTED' ? `${value.grants.length} người/nhóm được cấp quyền, người tạo và quản trị viên.` : 'Giữ phạm vi cũ.'} Quyền xem không tự cấp quyền sửa. Giới hạn tài khoản và chế độ chỉ xem vẫn áp dụng. Quyền Google Drive của đường dẫn không thay đổi.</div>
  </div>;
}

export function MaterialSharingDialog({ record, campaigns, onSaved, onClose }: {
  record: MaterialSummary; campaigns: MaterialPortalBootstrap['campaigns']; onSaved(value: MaterialSummary): void; onClose(): void;
}) {
  const [current, setCurrent] = useState(record);
  const [value, setValue] = useState<SharingSelection>(record.sharing || { mode: 'LEGACY', campaignIds: [], grants: [] });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const saved = await requestJson<MaterialSummary>(`/materials/${encodeURIComponent(record.materialId)}/sharing`, { method: 'PATCH', body: JSON.stringify({ mode: value.mode, campaignIds: value.campaignIds, grants: value.grants, expectedVersion: current.recordVersion }) });
      onSaved(saved); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được chia sẻ.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Chia sẻ tư liệu">
    <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto p-5">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><CpmsIcon name="users"/>Chia sẻ tư liệu</h2>
      <p className="mb-4 text-sm text-slate-600">{record.fields.material_name || record.materialId}</p>
      <fieldset disabled={busy}><MaterialSharingEditor value={value} onChange={setValue} campaigns={campaigns} materialId={record.materialId} suggestedIds={materialFormReferences(record.fields, campaigns).filter(ref => ref.kind === 'SYSTEM').map(ref => ref.id)}/></fieldset>
      {error && <div role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}<p>Lựa chọn chưa lưu vẫn được giữ.</p><Button variant="secondary" size="sm" onClick={() => { void requestJson<MaterialSummary>(`/materials/${encodeURIComponent(record.materialId)}`).then(next => { setCurrent(next); setError(next.capabilities?.manageSharing ? 'Đã tải phiên bản mới. Kiểm tra lại lựa chọn trước khi lưu.' : 'Bạn không còn quyền quản lý chia sẻ.'); }).catch(e => setError(e.message)); }}>Tải phiên bản để đối chiếu</Button><p>Phạm vi hiện tại: {MATERIAL_SHARING_LABELS[current.sharing?.mode || 'LEGACY']} · {current.sharing?.campaignIds.length || 0} Chiến dịch · {current.sharing?.grants.length || 0} cấp quyền</p></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>Hủy</Button><Button disabled={busy || value.mode === 'LEGACY' || current.capabilities?.manageSharing === false} onClick={() => void save()}><CpmsIcon name="save"/>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</Button></div>
    </Card>
  </div>;
}
