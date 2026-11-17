/** One palette for Campaign timeline bars and the approval-status chip. */
export function campaignApprovalBarClass(value: string | null | undefined) {
  switch (value) {
    case 'Đã duyệt': return 'bg-emerald-500 text-white';
    case 'Chờ duyệt': return 'bg-amber-300 text-amber-950';
    case 'Trả lại để sửa': case 'Từ chối': return 'bg-rose-500 text-white';
    case 'Không yêu cầu duyệt': return 'bg-cyan-600 text-white';
    default: return 'bg-slate-500 text-white';
  }
}
export function campaignApprovalChipClass(value: string | null | undefined) {
  switch (value) {
    case 'Đã duyệt': return 'border-emerald-400 bg-emerald-100 text-emerald-950';
    case 'Chờ duyệt': return 'border-amber-400 bg-amber-100 text-amber-950';
    case 'Trả lại để sửa': case 'Từ chối': return 'border-rose-400 bg-rose-100 text-rose-950';
    case 'Không yêu cầu duyệt': return 'border-cyan-400 bg-cyan-100 text-cyan-950';
    default: return 'border-slate-300 bg-slate-100 text-slate-800';
  }
}
