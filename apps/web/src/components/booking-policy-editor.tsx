import { BOOKING_APPROVAL_OPERATIONS, bookingApprovalActions, bookingOperationLabels, type BookingApprovalActions, type BookingPolicy } from '@cpms/domain';
import { Button, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/api';

export function BookingOperationPolicyEditor() {
  const [policy, setPolicy] = useState<BookingPolicy | null>(null), [actions, setActions] = useState<BookingApprovalActions>(bookingApprovalActions({ required: true }));
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { void requestJson<BookingPolicy>('/bookings/policy').then(p => { setPolicy(p); setActions(bookingApprovalActions(p)); }).catch(e => setError(String(e.message))); }, []);
  const save = async () => {
    if (!policy) return; setBusy(true); setError('');
    try {
      const next = await requestJson<BookingPolicy>('/bookings/policy', { method: 'POST', body: JSON.stringify({ required: Object.values(actions).some(Boolean), actions, expectedVersion: policy.version, reason }) });
      setPolicy(next); setActions(bookingApprovalActions(next)); setReason(''); setSaved(true); window.dispatchEvent(new Event('cpms:workflow-updated'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được chính sách.'); } finally { setBusy(false); }
  };
  return <section aria-label="Chính sách phê duyệt đặt chỗ" className="space-y-4 border-t p-5 lg:p-6"><h2 className="text-lg font-semibold">Chính sách phê duyệt Đặt chỗ</h2><p className="text-sm text-slate-600">Chọn thao tác cần phê duyệt. Người thực hiện vẫn phải có quyền và được phân công; bỏ yêu cầu phê duyệt không bỏ kiểm tra hạn mức.</p>
    <div className="overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Thao tác</th><th className="p-3">Yêu cầu phê duyệt</th><th className="p-3">Người xử lý khi bật</th></tr></thead><tbody>{BOOKING_APPROVAL_OPERATIONS.map(action => <tr key={action} className="border-t"><td className="p-3 font-medium">{bookingOperationLabels[action]}</td><td className="p-3"><label className="inline-flex items-center gap-2"><input type="checkbox" disabled={busy || !policy} checked={actions[action]} onChange={e => { setActions(v => ({ ...v, [action]: e.target.checked })); setSaved(false); }}/><span>{actions[action] ? 'Bắt buộc' : 'Không bắt buộc'}<span className="sr-only"> phê duyệt {bookingOperationLabels[action]}</span></span></label></td><td className="p-3 text-xs text-slate-600">{['CREATE', 'EDIT'].includes(action) ? 'Vendor gửi: CV phụ trách/CV khai thác → LĐP. CV phụ trách gửi: Vendor → LĐP.' : 'CV phụ trách hoặc Vendor gửi → LĐP quyết định. Trạng thái hiện hành được giữ trong lúc chờ.'}</td></tr>)}</tbody></table></div>
    <p className="text-xs text-slate-500">Đề nghị đã gửi giữ chính sách của lần gửi. Thay đổi cấu hình không tự duyệt đề nghị cũ. Nghiệm thu vẫn cần người có quyền duyệt; xóa vĩnh viễn giữ các điều kiện bảo vệ lịch sử.</p>
    <label className="block text-sm">Lý do thay đổi<input className="mt-1 w-full rounded-lg border p-2" value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></label>{error && <p role="alert" className="text-rose-700">{error}</p>}{saved && <p role="status">Đã lưu chính sách phiên bản {policy?.version}.</p>}<Button disabled={busy || !policy || !reason.trim()} onClick={() => void save()}><CpmsIcon name="save"/>Lưu chính sách đặt chỗ</Button>
  </section>;
}
