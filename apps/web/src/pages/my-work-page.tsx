import { Button, Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkflowCommandReview, operationLabels } from '../components/campaign-workflow-workspace';
import { accessInput } from '../components/access-editor-controls';
import { requestJson } from '../lib/api';
import { workflowChanged, workflowLabel, workflowTime } from '../lib/campaign-workflow';
import { AppLink, campaignDetailPath } from '../lib/router';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { inboxDecisionKind, type InboxDecision, type InboxItem } from '../lib/my-work';
import { InboxDecisionButtons, MyWorkDecisionPanel } from '../components/my-work-decision';
import { BookingInbox, bookingChanged } from '../components/booking-workflow-controls';
import { ContractInbox } from '../components/contract-management';
import { contractsChanged } from '../lib/contract-management';

interface Inbox { items: InboxItem[]; policyVersion: number; people: { id: string; displayName: string }[]; organizations: { id: string; sourceName: string }[] }
const sections = { PENDING: 'Chờ tôi xử lý', FOLLOWING: 'Tôi đã gửi / đang theo dõi', ASSIGNED: 'Được giao', FYI: 'Thông báo để biết' } as const;
export function MyWorkPage() {
  const [bookingCounts,setBookingCounts]=useState<Record<string,number>>({});
  const [contractCounts,setContractCounts]=useState<Record<string,number>>({});
  const [data, setData] = useState<Inbox | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<keyof typeof sections>('PENDING'); const [page, setPage] = useState(1);
  const [reply, setReply] = useState<{ item: InboxItem; operation: string } | null>(null);
  const [decision, setDecision] = useState<{ item: InboxItem; value: InboxDecision } | null>(null);
  const [success, setSuccess] = useState('');
  const editing = Boolean(reply || decision);
  const generation = useRef(0);
  const load = useCallback(async () => { const epoch = ++generation.current; setBusy(true); try { const next = await requestJson<Inbox>('/campaign-workflow/inbox'); if (generation.current === epoch) { setData(next); setError(''); } } catch (caught) { if (generation.current === epoch) { setData(null); setError(caught instanceof Error ? caught.message : 'Không tải được việc của tôi.'); } } finally { if (generation.current === epoch) setBusy(false); } }, []);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { const refresh = () => { if (!editing) void load(); }; const events = ['focus','cpms:policy-version-changed','cpms:workflow-updated']; events.forEach((name) => window.addEventListener(name, refresh)); const timer = window.setInterval(refresh, 30_000); return () => { window.clearInterval(timer); events.forEach((name) => window.removeEventListener(name, refresh)); }; }, [editing, load]);
  const items = data?.items.filter((item) => item.section === tab) ?? []; const totalPages = Math.max(1, Math.ceil(items.length / 10));
  const currentPage = Math.min(page, totalPages); const visible = items.slice((currentPage - 1) * 10, currentPage * 10);
  const name = (id: string | null) => data?.people.find((p) => p.id === id)?.displayName ?? 'Lãnh đạo Ban TT';
  return <div className="space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Việc của tôi</h1><p className="mt-2 text-sm text-slate-600">Nhiệm vụ và phạm vi trách nhiệm của tài khoản đang đăng nhập.</p></div><Button size="sm" variant="secondary" disabled={busy || editing} onClick={() => {bookingChanged();contractsChanged();void load();}}><CpmsIcon name="refresh" />Tải lại</Button></header>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Nhóm việc của tôi">{(Object.keys(sections) as (keyof typeof sections)[]).map((key) => <button key={key} role="tab" aria-selected={tab === key} disabled={editing} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === key ? 'bg-vna-blue text-white' : 'bg-white text-slate-600'}`} onClick={() => { setTab(key); setPage(1); }}>{sections[key]} ({(data?.items.filter((item) => item.section === key).length ?? 0)+(bookingCounts[key]??0)+(contractCounts[key]??0)})</button>)}</div>
    <BookingInbox section={tab} onCounts={setBookingCounts}/>
    <ContractInbox section={tab} onCounts={setContractCounts}/>
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{success}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {reply && <Card className="p-5"><InvitationReply item={reply.item} operation={reply.operation} onClose={() => setReply(null)} onSaved={() => { setReply(null); void load(); }} /></Card>}
    <div role="tabpanel" className="space-y-3">{visible.map((item) => <Card key={item.id} data-inbox-item-id={item.id} className="p-5"><div className="flex flex-wrap justify-between gap-3"><div>{item.campaign ? <AppLink className="font-semibold text-vna-blue" to={campaignDetailPath(item.campaignId)}>{item.campaign.code} · {item.campaign.name}</AppLink> : <h2 className="font-semibold">Đề nghị phối hợp đang chờ chấp nhận</h2>}<p className="mt-1 text-sm">{item.kind === 'COOPERATION_INVITATION' ? 'Lời mời phối hợp ngang phòng' : item.kind === 'SUBMITTED' ? 'Theo dõi hồ sơ đã gửi' : item.kind === 'DIVISION_ROUTE_FYI' ? 'Chiến dịch gửi Ban TT' : workflowLabel(item.kind)}</p></div><StatusBadge>{workflowLabel(item.state)}</StatusBadge></div>
      <p className="mt-3 text-xs text-slate-500">{data?.organizations.find((o) => o.id === item.orgId)?.sourceName ?? 'Phạm vi Campaign'} · {workflowTime(item.createdAt)}</p><p className="mt-1 text-xs text-slate-500">Người giao/gửi: {name(item.assignedByActorId)} · {item.assigneeActorId ? `Giao đích danh: ${name(item.assigneeActorId)}` : item.pool === 'ANY_ONE' ? 'Lãnh đạo Phòng tiếp nhận xử lý' : 'Theo dõi thông tin'}</p>
      {item.reason && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.reason}</p>}
      {!item.campaign && <p className="mt-2 text-xs text-slate-500">Chưa có quyền mở nội dung Campaign từ lời mời này. Chấp nhận sẽ tạo trách nhiệm tham gia và bước tiếp nhận riêng.</p>}
      {item.kind === 'COOPERATION_INVITATION' && item.canRespond ? <div className="mt-4 space-y-2"><p className="text-xs text-slate-600">Phối hợp ngang phòng đang tạm dừng. Bạn có thể đóng lời mời cũ; lịch sử được giữ nguyên.</p><Button size="sm" variant="secondary" disabled={editing} onClick={() => { generation.current++; setBusy(false); setReply({ item, operation: 'DECLINE_COOPERATION' }); }}>Từ chối lời mời cũ</Button></div>
        : inboxDecisionKind(item) ? <InboxDecisionButtons item={item} disabled={editing} onSelect={(value) => { generation.current++; setBusy(false); setSuccess(''); setDecision({ item, value }); }} />
        : item.section === 'PENDING' && item.canRespond && item.campaign ? <AppLink className="mt-4 inline-block text-sm font-semibold text-vna-blue" to={campaignDetailPath(item.campaignId)}>Mở hồ sơ để xử lý</AppLink> : null}
      {decision?.item.id === item.id && <MyWorkDecisionPanel key={`${item.id}:${decision.value}`} item={decision.item} decision={decision.value} onClose={() => { setDecision(null); void load(); }} onSaved={() => { setSuccess(`${decision.value === 'approve' ? 'Đã phê duyệt' : 'Đã từ chối'} · ${item.campaign?.code} · ${workflowLabel(item.kind)}.`); setDecision(null); workflowChanged(); void load(); }} />}
    </Card>)}{!busy && !visible.length && !bookingCounts[tab] && !contractCounts[tab] && <Card className="p-8 text-center text-sm text-slate-500">Không có công việc trong nhóm này.</Card>}</div>
    {items.length>0&&<div className="flex items-center justify-between gap-3 text-sm"><span>{items.length} mục · Trang {currentPage}/{totalPages}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={currentPage <= 1 || editing} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button size="sm" variant="secondary" disabled={currentPage >= totalPages || editing} onClick={() => setPage(currentPage + 1)}>Sau</Button></div></div>}
  </div>;
}
function InvitationReply({ item, operation, onClose, onSaved }: { item: InboxItem; operation: string; onClose(): void; onSaved(): void }) {
  const [key] = useState(() => crypto.randomUUID()); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  useUnsavedChanges(true);
  const body = { operation, idempotencyKey: key, expectedVersion: item.workflowVersion, expectedSubjectRevision: item.subjectRevision, requestId: item.id, expectedRequestVersion: item.taskVersion, reason };
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{operationLabels[operation]}</h2><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Hủy</Button></div><label className="block text-sm">Lý do phản hồi {operation === 'DECLINE_COOPERATION' ? '(không bắt buộc)' : '(bắt buộc)'}<textarea aria-label="Lý do phản hồi phối hợp" className={`${accessInput} mt-1 w-full`} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} /></label><WorkflowCommandReview campaignId={item.campaignId} body={body} valid={operation === 'DECLINE_COOPERATION' || Boolean(reason.trim())} onSaved={onSaved} onBusyChange={setBusy} /></div>;
}
