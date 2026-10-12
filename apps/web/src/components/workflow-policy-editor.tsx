import { CAMPAIGN_APPROVAL_ACTIONS, CAMPAIGN_APPROVAL_ACTION_LABELS, campaignRequiredApprovals, type ApprovalPreset, type CampaignRequiredApprovals } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/api';
import { workflowChanged, type WorkflowConfiguration } from '../lib/campaign-workflow';
import { useUnsavedChanges } from '../lib/unsaved-changes';

type ApprovalMode = 'HARD' | 'NONE';
type Applicability = 'ALL' | 'LEVEL_1_ONLY';

function settingsFromPreset(preset: ApprovalPreset | null | undefined): { mode: ApprovalMode; applicability: Applicability } {
  if (preset?.startsWith('NO_APPROVAL')) return { mode: 'NONE', applicability: preset.endsWith('LEVEL_1_ONLY') ? 'LEVEL_1_ONLY' : 'ALL' };
  return { mode: 'HARD', applicability: preset?.endsWith('LEVEL_1_ONLY') ? 'LEVEL_1_ONLY' : 'ALL' };
}

function presetFromSettings(mode: ApprovalMode, applicability: Applicability): ApprovalPreset {
  if (mode === 'NONE') return applicability === 'ALL' ? 'NO_APPROVAL' : 'NO_APPROVAL_LEVEL_1_ONLY';
  return applicability === 'ALL' ? 'DIVISION_ONLY' : 'DIVISION_LEVEL_1_ONLY';
}

const modeOptions: Array<{ value: ApprovalMode; title: string; description: string; tone: string }> = [
  { value: 'HARD', title: 'Phê duyệt bắt buộc', description: 'Các thao tác được tick bên dưới chỉ áp dụng sau khi Lãnh đạo Phòng phê duyệt.', tone: 'border-emerald-200 bg-emerald-50/50' },
  { value: 'NONE', title: 'Luồng không cần phê duyệt', description: 'Requester thao tác trực tiếp; hệ thống vẫn ghi audit đầy đủ.', tone: 'border-slate-200 bg-slate-50/70' },
];

export function WorkflowPolicyEditor({ campaignId, onSaved, onDirtyChange, onBusyChange }: { campaignId: string | null; onSaved?(): void; onDirtyChange?(value: boolean): void; onBusyChange?(value: boolean): void }) {
  const [config, setConfig] = useState<WorkflowConfiguration | null>(null);
  const [mode, setMode] = useState<ApprovalMode>('HARD');
  const [applicability, setApplicability] = useState<Applicability>('ALL');
  const [requiredApprovals, setRequiredApprovals] = useState(campaignRequiredApprovals);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  useUnsavedChanges(dirty);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  const load = useCallback(async () => {
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const next = await requestJson<WorkflowConfiguration>('/campaign-workflow/configuration');
      if (token !== generation.current) return;
      setConfig(next);
      const active = next.policies.filter((policy) => policy.campaignId === campaignId && new Date(policy.effectiveFrom).getTime() <= Date.now()).sort((left, right) => right.version - left.version)[0];
      const settings = settingsFromPreset(active?.preset);
      setRequiredApprovals(campaignRequiredApprovals(active?.requiredApprovals));
      setMode(settings.mode); setApplicability(settings.applicability); setDirty(false); setMessage('');
    } catch (caught) { if (token === generation.current) setError(caught instanceof Error ? caught.message : 'Không tải được chính sách.'); }
    finally { if (token === generation.current) setBusy(false); }
  }, [campaignId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const save = async () => {
    if (!config || busy || !dirty) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await requestJson('/campaign-workflow/policy/save', { method: 'POST', body: JSON.stringify({
        campaignId, expectedVersion: config.version, preset: presetFromSettings(mode, applicability), effectiveFrom: new Date().toISOString(),
        requiredApprovals,
        reason: `Cập nhật chính sách mặc định: ${mode}; phạm vi ${applicability}.`,
      }) });
      workflowChanged(); await load(); onSaved?.(); setMessage('Đã lưu chính sách. Các hồ sơ trình mới sẽ dùng cấu hình này.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không lưu được chính sách.'); setBusy(false); }
  };

  return <section aria-label="Chính sách phê duyệt mặc định" className="space-y-6">
    <div><h3 className="text-lg font-semibold text-slate-950">Luồng phê duyệt Lãnh đạo Phòng</h3><p className="mt-1 text-sm leading-6 text-slate-600">Cấu hình mặc định cho toàn bộ Chiến dịch. Quyết định cũ và hồ sơ đang chờ không bị thay đổi.</p></div>
    <fieldset disabled={busy} className="space-y-5">
      <div><p className="text-sm font-semibold text-slate-800">Cấp chiến dịch áp dụng</p><div className="mt-3 grid gap-3 md:grid-cols-2">
        <PolicyChoice checked={applicability === 'ALL'} title="Áp dụng cho toàn bộ cấp chiến dịch" description="Mọi cấp đều dùng chế độ được chọn bên dưới." onSelect={() => { setApplicability('ALL'); setDirty(true); setMessage(''); }} />
        <PolicyChoice checked={applicability === 'LEVEL_1_ONLY'} title="Áp dụng cho đúng Cấp 1 – Cấp Phòng" description="Chỉ Chiến dịch Cấp 1 đi qua luồng Lãnh đạo Phòng này." onSelect={() => { setApplicability('LEVEL_1_ONLY'); setDirty(true); setMessage(''); }} />
      </div></div>
      <div><p className="text-sm font-semibold text-slate-800">Chế độ</p><div className="mt-3 grid gap-3 xl:grid-cols-2">
        {modeOptions.map((option) => <label key={option.value} className={`cursor-pointer rounded-2xl border p-4 transition ${option.tone} ${mode === option.value ? 'ring-2 ring-vna-blue ring-offset-2' : 'hover:border-vna-blue/40'}`}><span className="flex items-center gap-2"><input type="radio" name="approval-mode" checked={mode === option.value} onChange={() => { setMode(option.value); setDirty(true); setMessage(''); }} /><span className="font-semibold text-slate-950">{option.title}</span></span><span className="mt-2 block text-sm leading-6 text-slate-600">{option.description}</span></label>)}
      </div></div>
      {mode === 'HARD' && <CampaignApprovalActionChoices value={requiredApprovals} onChange={value => { setRequiredApprovals(value); setDirty(true); setMessage(''); }} />}
    </fieldset>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="secondary" disabled={busy || !dirty} onClick={() => void load()}>Hủy thay đổi</Button><Button disabled={busy || !dirty} onClick={() => void save()}><CpmsIcon name="save" />{busy ? 'Đang lưu…' : 'Lưu chính sách'}</Button></div>
  </section>;
}

export function CampaignApprovalActionChoices({ value, onChange }: { value: CampaignRequiredApprovals; onChange(value: CampaignRequiredApprovals): void }) {
  const all = CAMPAIGN_APPROVAL_ACTIONS.every(action => value[action]);
  const some = CAMPAIGN_APPROVAL_ACTIONS.some(action => value[action]);
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = some && !all; }, [some, all]);
  return <section aria-label="Phân hệ Quản lý Chiến dịch" className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-5">
    <h4 className="font-semibold text-slate-950">Phân hệ Quản lý Chiến dịch</h4>
    <p className="mt-2 text-sm leading-6 text-slate-600">Phân quyền chi tiết cho thao tác trong phân hệ Quản lý Chiến dịch. Tick thao tác cần Lãnh đạo Phòng phê duyệt trước khi áp dụng trạng thái. Bỏ tick để người có quyền thao tác thực hiện trực tiếp.</p>
    <label className="mt-4 flex cursor-pointer items-center gap-3 border-b border-cyan-200 pb-4 text-sm font-semibold"><input ref={selectAll} type="checkbox" checked={all} onChange={() => onChange({ DEPLOY: !all, EDIT: !all, PAUSE: !all, RESUME: !all, CANCEL: !all, PURGE: !all })} />Chọn/Bỏ chọn tất cả thao tác trong phân hệ</label>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{CAMPAIGN_APPROVAL_ACTIONS.map(action => <label key={action} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" className="mt-1" checked={value[action]} onChange={event => onChange({ ...value, [action]: event.target.checked })} /><span><span className="font-semibold">{CAMPAIGN_APPROVAL_ACTION_LABELS[action]}</span>{action === 'DEPLOY' && <span className="mt-1 block text-xs leading-5 text-slate-500">Phê duyệt triển khai và giao chuyên viên phụ trách chính.</span>}</span></label>)}</div>
    <p className="mt-4 text-xs leading-5 text-slate-500">Không thay đổi quyền tài khoản, quyết định cũ hoặc tự xử lý các yêu cầu đang chờ. Xóa vĩnh viễn vẫn phải qua xác nhận và các kiểm tra bảo vệ dữ liệu.</p>
  </section>;
}

function PolicyChoice({ checked, title, description, onSelect }: { checked: boolean; title: string; description: string; onSelect(): void }) {
  return <label className={`cursor-pointer rounded-xl border p-4 ${checked ? 'border-vna-blue bg-cyan-50 ring-1 ring-vna-blue/20' : 'border-slate-200 hover:border-vna-blue/40'}`}><span className="flex items-center gap-2"><input type="radio" name="approval-applicability" checked={checked} onChange={onSelect} /><span className="font-semibold text-slate-900">{title}</span></span><span className="mt-2 block text-sm leading-5 text-slate-600">{description}</span></label>;
}
