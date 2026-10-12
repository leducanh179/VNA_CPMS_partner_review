import { Button, Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth-context';
import { WorkflowPolicyEditor } from '../components/workflow-policy-editor';
import { requestJson } from '../lib/api';
import { presetLabels, workflowTime, type WorkflowConfiguration } from '../lib/campaign-workflow';
import { AppLink, campaignDetailPath } from '../lib/router';

export function AdminWorkflowPage() {
  const { me } = useAuth();
  return me.directSuperadmin ? <WorkflowAdministration /> : <Card className="p-6">Cần phiên superadmin trực tiếp để cấu hình luồng phê duyệt.</Card>;
}
function WorkflowAdministration() {
  const [config, setConfig] = useState<WorkflowConfiguration | null>(null); const [error, setError] = useState('');
  const [departmentId, setDepartmentId] = useState(''); const [initializing, setInitializing] = useState(false);
  const load = useCallback(async () => { try { setConfig(await requestJson<WorkflowConfiguration>('/campaign-workflow/configuration')); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không tải được cấu hình.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const active = config?.policies.filter((p) => new Date(p.effectiveFrom).getTime() <= Date.now()) ?? [];
  const latestOverrides = active.filter((p, i) => p.campaignId && active.findIndex((other) => other.campaignId === p.campaignId) === i && p.preset);
  const system = active.find((p) => !p.campaignId);
  const departments = config?.organizations.filter((org) => org.kind === 'DEPARTMENT') ?? [];
  const chosenDepartment = departments.some((org) => org.id === departmentId) ? departmentId : departments.length === 1 ? departments[0]!.id : '';
  const initialize = async () => {
    if (!chosenDepartment || initializing) return;
    setInitializing(true); setError('');
    try {
      await requestJson('/campaign-workflow/initialize', { method: 'POST', body: JSON.stringify({ commDepartmentId: chosenDepartment, demo: false }) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không khởi tạo được luồng phê duyệt.'); }
    finally { setInitializing(false); }
  };
  return <div className="space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-vna-gold-dark">Quản trị CPMS</p><h1 className="mt-1 text-2xl font-semibold">Luồng phê duyệt</h1><p className="mt-2 text-sm text-slate-600">Chọn chính sách mặc định và theo dõi ngoại lệ của từng Campaign.</p></div><Button size="sm" variant="secondary" onClick={() => void load()}><CpmsIcon name="refresh" />Tải lại danh sách</Button></header>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {config && !config.version && <Card className="space-y-4 border-amber-200 bg-amber-50 p-5"><div><h2 className="font-semibold text-amber-950">Chưa khởi tạo luồng phê duyệt Chiến dịch</h2><p className="mt-1 text-sm text-amber-900">Chưa thể dùng “Tạo và gửi Ban TT” hoặc phê duyệt. Khởi tạo sẽ kích hoạt các quyền workflow và chính sách STANDARD mặc định; không tạo Chiến dịch hay dữ liệu nghiệp vụ.</p></div><label className="block text-sm font-medium text-amber-950">Ban tiếp nhận<select className="mt-2 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3" value={chosenDepartment} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Chọn Ban tiếp nhận</option>{departments.map((org) => <option key={org.id} value={org.id}>{org.sourceName}</option>)}</select></label><Button disabled={!chosenDepartment || initializing} onClick={() => void initialize()}>{initializing ? 'Đang khởi tạo…' : 'Khởi tạo luồng phê duyệt'}</Button></Card>}
    <div className="grid gap-4 md:grid-cols-3"><Card className="p-4"><p className="text-xs text-slate-500">Chính sách đang có hiệu lực</p><p className="mt-2 font-semibold">{system?.preset ? presetLabels[system.preset] : 'Chưa khởi tạo'}</p><p className="mt-1 text-xs">{system ? `Phiên bản ${system.version} · ${workflowTime(system.effectiveFrom)}` : ''}</p></Card><Card className="p-4"><p className="text-xs text-slate-500">Campaign có ngoại lệ đang hiệu lực</p><p className="mt-2 text-2xl font-semibold">{latestOverrides.length}</p></Card><Card className="p-4"><p className="text-xs text-slate-500">Ban tiếp nhận</p><p className="mt-2 font-semibold">{config?.organizations.find((o) => o.id === config.commDepartmentId)?.sourceName ?? 'Chưa cấu hình'}</p>{config?.demoInitialized && <StatusBadge>Cấu hình demo local</StatusBadge>}</Card></div>
    <Card className="p-5"><WorkflowPolicyEditor campaignId={null} onSaved={() => void load()} /></Card>
    <Card className="overflow-hidden"><div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Lịch sử chính sách và ngoại lệ</h2><p className="mt-1 text-xs text-slate-500">Mở Campaign để cấu hình ngoại lệ trong “Phân quyền đặc biệt”. Kế thừa sẽ kết thúc ngoại lệ cho các lần trình mới, vẫn giữ lịch sử cũ.</p></div><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Phạm vi', 'Chế độ', 'Phiên bản / hiệu lực', 'Người thay đổi', 'Lý do'].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{config?.policies.map((policy) => <tr className="border-t border-slate-100" key={policy.id}><td className="max-w-72 p-3">{policy.campaignId ? <AppLink className="font-semibold text-vna-blue" to={campaignDetailPath(policy.campaignId)}>{policy.campaign?.code} · {policy.campaign?.name ?? 'Mở Campaign'}</AppLink> : 'Toàn hệ thống'}</td><td className="p-3">{policy.preset ? presetLabels[policy.preset] : 'Kế thừa'}</td><td className="p-3 text-xs">v{policy.version}<br />{workflowTime(policy.effectiveFrom)}{new Date(policy.effectiveFrom).getTime() > Date.now() && <p className="text-amber-700">Chưa đến ngày hiệu lực</p>}</td><td className="p-3">{policy.createdBy?.displayName ?? 'Tài khoản quản trị'}</td><td className="max-w-96 break-words p-3 text-xs">{policy.reason}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
