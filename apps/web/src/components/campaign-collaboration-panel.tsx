import {
  type CampaignCommentItem,
  type CampaignCommentReactionSummary,
  type CampaignCommentReactionType,
  type CampaignCommentThread,
  type CampaignJournalItem,
  type CampaignSummary,
} from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  createCampaignComment,
  deleteCampaignComment,
  getCampaignComments,
  getCampaignJournal,
  removeCampaignCommentReaction,
  setCampaignCommentReaction,
  updateCampaignComment,
  requestJson,
} from '../lib/api';
import {
  campaignCollaborationSelectionMessage,
  createLatestRequestGuard,
  resolveCampaignCollaborationSelection,
} from '../lib/campaign-collaboration-selection';
import { AppLink, campaignDetailPath } from '../lib/router';

export type CampaignCollaborationTab = 'comments' | 'journal';

export interface CampaignCollaborationFocusRequest {
  tab: CampaignCollaborationTab;
  nonce: number;
  campaignId?: string;
}

interface CampaignCollaborationPanelProps {
  campaigns: readonly CampaignSummary[];
  selectedCampaignIds: readonly string[];
  focusRequest: CampaignCollaborationFocusRequest | null;
  notify(message: string): void;
}

const PAGE_SIZE = 10;
const MAX_COMMENT_LENGTH = 5_000;
const journalActions = [
  ['campaign.created', 'Tạo chiến dịch'],
  ['campaign.updated', 'Cập nhật chiến dịch'],
  ['campaign.moved_to_trash', 'Xóa tạm'],
  ['campaign.restored', 'Phục hồi'],
  ['campaign.approved', 'Phê duyệt'],
] as const;

function friendlyTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).valueOf());
  const minute = 60_000;
  if (elapsed < minute) return 'Vừa xong';
  if (elapsed < 60 * minute) return `${Math.floor(elapsed / minute)} phút trước`;
  if (elapsed < 24 * 60 * minute) return `${Math.floor(elapsed / (60 * minute))} giờ trước`;
  if (elapsed < 7 * 24 * 60 * minute) return `${Math.floor(elapsed / (24 * 60 * minute))} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function fullTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date(value));
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((word) => word[0]?.toLocaleUpperCase('vi')).join('') || 'NS';
}

function textWithSafeLinks(body: string) {
  const lines = body.split('\n');
  return lines.map((line, lineIndex) => (
    <span key={`${lineIndex}-${line.slice(0, 12)}`}>
      {line.split(/(https:\/\/[^\s]+)/g).map((part, index) => part.startsWith('https://')
        ? <a key={`${part}-${index}`} className="break-all font-medium text-vna-blue underline" href={part} target="_blank" rel="noreferrer">{part}</a>
        : <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>)}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function replaceComment(threads: CampaignCommentThread[], id: string, update: (comment: CampaignCommentItem) => CampaignCommentItem) {
  return threads.map((thread) => thread.id === id
    ? { ...thread, ...update(thread) }
    : { ...thread, replies: thread.replies.map((reply) => reply.id === id ? update(reply) : reply) });
}

export function CampaignCollaborationPanel({ campaigns, selectedCampaignIds, focusRequest, notify }: CampaignCollaborationPanelProps) {
  const headingId = useId();
  const [activeTab, setActiveTab] = useState<CampaignCollaborationTab>('comments');
  const [collapsed, setCollapsed] = useState(false);
  const selection = useMemo(
    () => resolveCampaignCollaborationSelection(campaigns, selectedCampaignIds),
    [campaigns, selectedCampaignIds],
  );
  const selectedCampaign = selection.kind === 'single' ? selection.campaign : null;
  const selectedCampaignId = selectedCampaign?.id ?? null;
  const selectedCampaignIdRef = useRef<string | null>(selectedCampaignId);
  selectedCampaignIdRef.current = selectedCampaignId;
  const selectionMessage = campaignCollaborationSelectionMessage(selection);
  const [threads, setThreads] = useState<CampaignCommentThread[]>([]);
  const [commentPage, setCommentPage] = useState(1);
  const [commentTotalPages, setCommentTotalPages] = useState(1);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const focusedRequest = useRef<CampaignCollaborationFocusRequest | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CampaignCommentItem | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [editTarget, setEditTarget] = useState<CampaignCommentItem | null>(null);
  const [editBody, setEditBody] = useState('');
  const [expandedThreads, setExpandedThreads] = useState<string[]>([]);
  const [pendingReactionIds, setPendingReactionIds] = useState<string[]>([]);
  const pendingReactionIdsRef = useRef(new Set<string>());
  const commentRequestGuard = useRef(createLatestRequestGuard());
  const journalRequestGuard = useRef(createLatestRequestGuard());
  const [journalItems, setJournalItems] = useState<CampaignJournalItem[]>([]);
  const [journalPage, setJournalPage] = useState(1);
  const [journalTotalPages, setJournalTotalPages] = useState(1);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [journalActors, setJournalActors] = useState<Array<{ id: string; displayName: string }>>([]);
  const [journalActorId, setJournalActorId] = useState('');
  const [journalAction, setJournalAction] = useState('');
  const [journalDateFrom, setJournalDateFrom] = useState('');
  const [journalDateTo, setJournalDateTo] = useState('');

  useEffect(() => {
    if (!focusRequest) return;
    setActiveTab(focusRequest.tab);
    setCollapsed(false);
  }, [focusRequest]);
  useEffect(() => {
    if (!focusRequest || focusRequest.tab !== 'comments' || collapsed || activeTab !== 'comments' || !selectedCampaignId
      || (focusRequest.campaignId && focusRequest.campaignId !== selectedCampaignId) || focusedRequest.current === focusRequest) return;
    const frame = window.requestAnimationFrame(() => {
      if (!commentInput.current || commentInput.current.disabled) return;
      focusedRequest.current = focusRequest;
      commentInput.current.focus({ preventScroll: true });
      commentInput.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, collapsed, activeTab, selectedCampaignId]);
  useEffect(() => {
    setCommentBody('');
    setReplyTarget(null); setReplyBody('');
    setEditTarget(null); setEditBody('');
    setExpandedThreads([]);
  }, [selectedCampaignId]);

  useEffect(() => {
    if (collapsed || activeTab !== 'comments' || !selectedCampaignId) {
      commentRequestGuard.current.invalidate();
      setThreads([]); setCommentPage(1); setCommentTotalPages(1); setCommentTotal(0); setCommentLoading(false); setCommentError(null);
      return;
    }
    const requestId = commentRequestGuard.current.next();
    setCommentLoading(true);
    setThreads([]); setCommentTotal(0);
    setCommentError(null);
    void getCampaignComments({ campaignId: selectedCampaignId, page: 1, pageSize: PAGE_SIZE })
      .then((page) => { if (commentRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) { setThreads(page.items); setCommentPage(1); setCommentTotalPages(page.totalPages); setCommentTotal(page.total); } })
      .catch((error: unknown) => { if (commentRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setCommentError(error instanceof Error ? error.message : 'Không thể tải bình luận.'); })
      .finally(() => { if (commentRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setCommentLoading(false); });
  }, [activeTab, collapsed, selectedCampaignId]);

  useEffect(() => {
    if (collapsed || activeTab !== 'journal' || !selectedCampaignId) {
      journalRequestGuard.current.invalidate();
      setJournalItems([]); setJournalPage(1); setJournalTotalPages(1); setJournalLoading(false); setJournalError(null); setJournalActors([]);
      return;
    }
    const requestId = journalRequestGuard.current.next();
    setJournalLoading(true);
    setJournalError(null);
    void getCampaignJournal({
      campaignId: selectedCampaignId,
      ...(journalActorId ? { actorId: journalActorId } : {}),
      ...(journalAction ? { action: journalAction } : {}),
      ...(journalDateFrom ? { dateFrom: journalDateFrom } : {}),
      ...(journalDateTo ? { dateTo: journalDateTo } : {}),
      page: 1,
      pageSize: PAGE_SIZE,
    }).then((page) => {
      if (!journalRequestGuard.current.isCurrent(requestId) || selectedCampaignIdRef.current !== selectedCampaignId) return;
      setJournalItems(page.items);
      setJournalPage(1);
      setJournalTotalPages(page.totalPages);
      setJournalActors(page.actors);
    }).catch((error: unknown) => { if (journalRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setJournalError(error instanceof Error ? error.message : 'Không thể tải nhật ký.'); })
      .finally(() => { if (journalRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setJournalLoading(false); });
  }, [activeTab, collapsed, journalAction, journalActorId, journalDateFrom, journalDateTo, selectedCampaignId]);

  const refreshComments = async (campaignId: string) => {
    if (selectedCampaignIdRef.current !== campaignId) return;
    const requestId = commentRequestGuard.current.next();
    const page = await getCampaignComments({ campaignId, page: 1, pageSize: PAGE_SIZE });
    if (!commentRequestGuard.current.isCurrent(requestId) || selectedCampaignIdRef.current !== campaignId) return;
    setThreads(page.items); setCommentPage(1); setCommentTotalPages(page.totalPages); setCommentTotal(page.total);
  };

  const submitComment = async () => {
    if (!selectedCampaign || !commentBody.trim() || commentSaving) return;
    const campaignId = selectedCampaign.id;
    setCommentSaving(true); setCommentError(null);
    try {
      await createCampaignComment(campaignId, commentBody);
      if (selectedCampaignIdRef.current !== campaignId) return;
      setCommentBody('');
      await refreshComments(campaignId);
      if (selectedCampaignIdRef.current !== campaignId) return;
      notify('Đã đăng bình luận.');
    } catch (error) { if (selectedCampaignIdRef.current === campaignId) setCommentError(error instanceof Error ? error.message : 'Không thể đăng bình luận.'); }
    finally { setCommentSaving(false); }
  };

  const submitReply = async () => {
    if (!replyTarget || !replyBody.trim() || commentSaving) return;
    const campaignId = replyTarget.campaign.id;
    const expandedThreadId = replyTarget.parentCommentId ?? replyTarget.id;
    if (selectedCampaignIdRef.current !== campaignId) return;
    setCommentSaving(true); setCommentError(null);
    try {
      await createCampaignComment(campaignId, replyBody, replyTarget.id);
      if (selectedCampaignIdRef.current !== campaignId) return;
      setReplyTarget(null); setReplyBody('');
      await refreshComments(campaignId);
      if (selectedCampaignIdRef.current !== campaignId) return;
      setExpandedThreads((current) => [...new Set([...current, expandedThreadId])]);
      notify('Đã đăng phản hồi.');
    } catch (error) { if (selectedCampaignIdRef.current === campaignId) setCommentError(error instanceof Error ? error.message : 'Không thể đăng phản hồi.'); }
    finally { setCommentSaving(false); }
  };

  const submitEdit = async () => {
    if (!editTarget || !editBody.trim() || commentSaving) return;
    const campaignId = editTarget.campaign.id;
    if (selectedCampaignIdRef.current !== campaignId) return;
    setCommentSaving(true); setCommentError(null);
    try {
      await updateCampaignComment(campaignId, editTarget.id, editBody, editTarget.recordVersion);
      if (selectedCampaignIdRef.current !== campaignId) return;
      setEditTarget(null); setEditBody('');
      await refreshComments(campaignId);
      if (selectedCampaignIdRef.current !== campaignId) return;
      notify('Đã cập nhật bình luận.');
    } catch (error) { if (selectedCampaignIdRef.current === campaignId) setCommentError(error instanceof Error ? error.message : 'Không thể cập nhật bình luận.'); }
    finally { setCommentSaving(false); }
  };

  const removeComment = async (comment: CampaignCommentItem) => {
    if (!window.confirm('Xóa tạm bình luận này?')) return;
    const campaignId = comment.campaign.id;
    if (selectedCampaignIdRef.current !== campaignId) return;
    try {
      await deleteCampaignComment(campaignId, comment.id, comment.recordVersion);
      await refreshComments(campaignId);
      if (selectedCampaignIdRef.current !== campaignId) return;
      notify('Đã xóa bình luận.');
    } catch (error) { if (selectedCampaignIdRef.current === campaignId) setCommentError(error instanceof Error ? error.message : 'Không thể xóa bình luận.'); }
  };

  const moderateComment = async (comment: CampaignCommentItem) => {
    const reason = window.prompt('Kiểm duyệt: xóa mềm bình luận, giữ nguyên tác giả và lịch sử. Nhập lý do bắt buộc:')?.trim();
    if (!reason || selectedCampaignIdRef.current !== comment.campaign.id) return;
    setCommentSaving(true);
    try {
      await requestJson(`/campaigns/${comment.campaign.id}/comments/${comment.id}/moderation`, { method: 'POST', body: JSON.stringify({ expectedVersion: comment.recordVersion, reason }) });
      await refreshComments(comment.campaign.id);
      if (selectedCampaignIdRef.current === comment.campaign.id) notify('Đã kiểm duyệt bằng xóa mềm; lý do được ghi trong audit.');
    } catch (error) { if (selectedCampaignIdRef.current === comment.campaign.id) setCommentError(error instanceof Error ? error.message : 'Không thể kiểm duyệt bình luận.'); }
    finally { setCommentSaving(false); }
  };

  const react = async (comment: CampaignCommentItem, type: CampaignCommentReactionType) => {
    const campaignId = comment.campaign.id;
    if (selectedCampaignIdRef.current !== campaignId || pendingReactionIdsRef.current.has(comment.id)) return;
    pendingReactionIdsRef.current.add(comment.id);
    setPendingReactionIds((current) => [...current, comment.id]);
    const before = comment.reactions;
    const same = before.actorReaction === type;
    const optimistic: CampaignCommentReactionSummary = {
      likeCount: before.likeCount + (type === 'LIKE' ? (same ? -1 : before.actorReaction === 'DISLIKE' ? 1 : 1) : before.actorReaction === 'LIKE' ? -1 : 0),
      dislikeCount: before.dislikeCount + (type === 'DISLIKE' ? (same ? -1 : before.actorReaction === 'LIKE' ? 1 : 1) : before.actorReaction === 'DISLIKE' ? -1 : 0),
      actorReaction: same ? null : type,
    };
    setThreads((current) => replaceComment(current, comment.id, (item) => ({ ...item, reactions: optimistic })));
    try {
      const confirmed = same
        ? await removeCampaignCommentReaction(campaignId, comment.id)
        : await setCampaignCommentReaction(campaignId, comment.id, type);
      if (selectedCampaignIdRef.current !== campaignId) return;
      setThreads((current) => replaceComment(current, comment.id, (item) => ({ ...item, reactions: confirmed })));
    } catch (error) {
      if (selectedCampaignIdRef.current !== campaignId) return;
      setThreads((current) => replaceComment(current, comment.id, (item) => ({ ...item, reactions: before })));
      setCommentError(error instanceof Error ? error.message : 'Không thể cập nhật cảm xúc.');
    } finally {
      pendingReactionIdsRef.current.delete(comment.id);
      setPendingReactionIds((current) => current.filter((id) => id !== comment.id));
    }
  };

  const loadMoreComments = async () => {
    if (!selectedCampaignId || commentLoading || commentPage >= commentTotalPages) return;
    const requestId = commentRequestGuard.current.next();
    setCommentLoading(true);
    try {
      const next = commentPage + 1;
      const result = await getCampaignComments({ campaignId: selectedCampaignId, page: next, pageSize: PAGE_SIZE });
      if (!commentRequestGuard.current.isCurrent(requestId) || selectedCampaignIdRef.current !== selectedCampaignId) return;
      setThreads((current) => [...current, ...result.items]); setCommentPage(next); setCommentTotalPages(result.totalPages);
    } catch (error) { if (commentRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setCommentError(error instanceof Error ? error.message : 'Không thể tải thêm bình luận.'); }
    finally { if (commentRequestGuard.current.isCurrent(requestId)) setCommentLoading(false); }
  };

  const loadMoreJournal = async () => {
    if (!selectedCampaignId || journalLoading || journalPage >= journalTotalPages) return;
    const requestId = journalRequestGuard.current.next();
    setJournalLoading(true);
    try {
      const next = journalPage + 1;
      const result = await getCampaignJournal({ campaignId: selectedCampaignId, ...(journalActorId ? { actorId: journalActorId } : {}), ...(journalAction ? { action: journalAction } : {}), ...(journalDateFrom ? { dateFrom: journalDateFrom } : {}), ...(journalDateTo ? { dateTo: journalDateTo } : {}), page: next, pageSize: PAGE_SIZE });
      if (!journalRequestGuard.current.isCurrent(requestId) || selectedCampaignIdRef.current !== selectedCampaignId) return;
      setJournalItems((current) => [...current, ...result.items]); setJournalPage(next); setJournalTotalPages(result.totalPages);
    } catch (error) { if (journalRequestGuard.current.isCurrent(requestId) && selectedCampaignIdRef.current === selectedCampaignId) setJournalError(error instanceof Error ? error.message : 'Không thể tải thêm nhật ký.'); }
    finally { if (journalRequestGuard.current.isCurrent(requestId)) setJournalLoading(false); }
  };

  return (
    <Card className="mt-5 overflow-hidden" data-campaign-collaboration-panel>
      <div className="relative border-b border-slate-100 px-5 py-4">
        <button type="button" className="absolute inset-0 w-full cursor-pointer text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vna-blue" aria-labelledby={headingId} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} />
        <div className="pointer-events-none relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name={activeTab === 'comments' ? 'comments' : 'history'} /></span>
            <div className="min-w-0"><h2 id={headingId} className="text-base font-semibold text-slate-950">Bình luận và Lịch sử làm việc</h2>{selectedCampaign ? <AppLink className="pointer-events-auto block truncate text-xs font-semibold text-vna-blue hover:underline" to={campaignDetailPath(selectedCampaign.id)}>{selectedCampaign.code} · {selectedCampaign.name}</AppLink> : <p className="truncate text-xs text-slate-500">{selectionMessage}</p>}</div>
          </div>
          <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-vna-blue">{collapsed ? 'Mở rộng' : 'Thu gọn'}</span>
        </div>
      </div>
      {!collapsed ? <>
        <div className="flex gap-2 border-b border-slate-100 px-5 pt-3">
          <button type="button" className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'comments' ? 'border-vna-blue text-vna-blue' : 'border-transparent text-slate-500'}`} onClick={() => setActiveTab('comments')}>Bình luận</button>
          <button type="button" className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'journal' ? 'border-vna-blue text-vna-blue' : 'border-transparent text-slate-500'}`} onClick={() => setActiveTab('journal')}>Lịch sử</button>
        </div>
        {activeTab === 'comments' ? <div className="p-5">
          {!selectedCampaign ? <div className="mb-4 rounded-xl border border-cyan-100 bg-cyan-50/60 px-4 py-5 text-center text-sm font-medium text-slate-700" role="status">{selectionMessage}</div> : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-800">Bình luận mới</p><span className={`text-xs ${commentBody.length >= 4_500 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{commentBody.length}/{MAX_COMMENT_LENGTH}</span></div>
            <textarea ref={commentInput} aria-label="Bình luận mới" className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-vna-blue focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-100" maxLength={MAX_COMMENT_LENGTH} placeholder={selectedCampaign ? `Trao đổi về ${selectedCampaign.code}…` : 'Chọn một chiến dịch để bắt đầu bình luận'} disabled={!selectedCampaign || commentSaving} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); void submitComment(); } }} />
            <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Chỉ hỗ trợ văn bản thuần và liên kết HTTPS. Nhấn Ctrl+Enter để đăng.</p><Button size="sm" className="gap-2" disabled={!selectedCampaign || !commentBody.trim() || commentSaving} onClick={() => void submitComment()}><CpmsIcon name="comments" />{commentSaving ? 'Đang đăng…' : 'Đăng bình luận'}</Button></div>
          </div>
          {selectedCampaign && commentError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{commentError}</div> : null}
          {selectedCampaign ? <div className="mt-5 space-y-4">
            {threads.map((thread) => <CommentThread key={thread.id} thread={thread} expanded={expandedThreads.includes(thread.id)} editingId={editTarget?.id ?? null} editBody={editBody} replyTargetId={replyTarget?.id ?? null} replyBody={replyBody} saving={commentSaving} pendingReactionIds={pendingReactionIds} onToggleExpanded={() => setExpandedThreads((current) => current.includes(thread.id) ? current.filter((id) => id !== thread.id) : [...current, thread.id])} onReply={(comment) => { setReplyTarget(comment); setReplyBody(''); }} onReplyBody={setReplyBody} onSubmitReply={() => void submitReply()} onCancelReply={() => { setReplyTarget(null); setReplyBody(''); }} onEdit={(comment) => { setEditTarget(comment); setEditBody(comment.body ?? ''); }} onEditBody={setEditBody} onSubmitEdit={() => void submitEdit()} onCancelEdit={() => { setEditTarget(null); setEditBody(''); }} onDelete={(comment) => void removeComment(comment)} canModerate={Boolean(selectedCampaign?.access?.permissions['campaign.comment.moderate'])} onModerate={(comment) => void moderateComment(comment)} onReact={(comment, type) => void react(comment, type)} />)}
            {!commentLoading && !threads.length ? <p className="py-8 text-center text-sm text-slate-500">Chưa có bình luận cho Chiến dịch này.</p> : null}
            {commentLoading ? <p className="py-4 text-center text-sm text-slate-500">Đang tải bình luận…</p> : null}
          </div> : null}
          {selectedCampaign ? <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500"><span>{commentTotal} luồng bình luận</span>{commentPage < commentTotalPages ? <Button size="sm" variant="secondary" disabled={commentLoading} onClick={() => void loadMoreComments()}>Tải thêm</Button> : null}</div> : null}
        </div> : selectedCampaign ? <div className="p-5">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold text-slate-600">Người thực hiện<select className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={journalActorId} onChange={(event) => setJournalActorId(event.target.value)}><option value="">Tất cả</option>{journalActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Hành động<select className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={journalAction} onChange={(event) => setJournalAction(event.target.value)}><option value="">Tất cả</option>{journalActions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Từ ngày<input type="date" className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={journalDateFrom} onChange={(event) => setJournalDateFrom(event.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={journalDateTo} onChange={(event) => setJournalDateTo(event.target.value)} /></label>
          </div>
          {journalError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{journalError}</div> : null}
          <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {journalItems.map((item) => <JournalRow key={item.id} item={item} />)}
            {!journalLoading && !journalItems.length ? <p className="px-4 py-10 text-center text-sm text-slate-500">Chưa có sự kiện phù hợp.</p> : null}
            {journalLoading ? <p className="px-4 py-5 text-center text-sm text-slate-500">Đang tải nhật ký…</p> : null}
          </div>
          {journalPage < journalTotalPages ? <div className="mt-4 text-center"><Button size="sm" variant="secondary" disabled={journalLoading} onClick={() => void loadMoreJournal()}>Tải thêm</Button></div> : null}
        </div> : <div className="p-5"><div className="rounded-xl border border-cyan-100 bg-cyan-50/60 px-4 py-8 text-center text-sm font-medium text-slate-700" role="status">{selectionMessage}</div></div>}
      </> : null}
    </Card>
  );
}

interface CommentThreadProps {
  thread: CampaignCommentThread;
  expanded: boolean;
  editingId: string | null;
  editBody: string;
  replyTargetId: string | null;
  replyBody: string;
  saving: boolean;
  pendingReactionIds: string[];
  onToggleExpanded(): void;
  onReply(comment: CampaignCommentItem): void;
  onReplyBody(value: string): void;
  onSubmitReply(): void;
  onCancelReply(): void;
  onEdit(comment: CampaignCommentItem): void;
  onEditBody(value: string): void;
  onSubmitEdit(): void;
  onCancelEdit(): void;
  onDelete(comment: CampaignCommentItem): void;
  canModerate?: boolean;
  onModerate?(comment: CampaignCommentItem): void;
  onReact(comment: CampaignCommentItem, type: CampaignCommentReactionType): void;
}

function CommentThread(props: CommentThreadProps) {
  const visibleReplies = props.expanded ? props.thread.replies : props.thread.replies.slice(0, 3);
  return <article className="rounded-xl border border-slate-200 bg-white p-4">
    <CommentContent comment={props.thread} {...props} />
    {visibleReplies.length ? <div className="ml-5 mt-4 space-y-3 border-l-2 border-cyan-100 pl-4 sm:ml-10">{visibleReplies.map((reply) => <CommentContent key={reply.id} comment={reply} {...props} />)}</div> : null}
    {props.thread.replyCount > 3 ? <button type="button" className="ml-10 mt-3 text-xs font-semibold text-vna-blue hover:underline" onClick={props.onToggleExpanded}>{props.expanded ? 'Thu gọn phản hồi' : `Xem thêm ${props.thread.replyCount - 3} phản hồi`}</button> : null}
  </article>;
}

function CommentContent({ comment, editingId, editBody, replyTargetId, replyBody, saving, pendingReactionIds, onReply, onReplyBody, onSubmitReply, onCancelReply, onEdit, onEditBody, onSubmitEdit, onCancelEdit, onDelete, onReact, canModerate, onModerate }: CommentThreadProps & { comment: CampaignCommentItem }) {
  const deleted = Boolean(comment.deletedAt);
  return <div className="flex gap-3">
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-vna-blue text-[11px] font-bold text-white">{initials(comment.author.displayName)}</span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold text-slate-900">{comment.author.displayName}</span><time className="text-xs text-slate-400" dateTime={comment.createdAt} title={fullTime(comment.createdAt)}>{friendlyTime(comment.createdAt)}</time>{comment.editedAt && !deleted ? <span className="text-[11px] italic text-slate-400">đã chỉnh sửa</span> : null}</div>
      <p className="mt-0.5 text-xs text-slate-500"><AppLink className="font-medium text-vna-blue hover:underline" to={campaignDetailPath(comment.campaign.id)}>{comment.campaign.code} · {comment.campaign.name}</AppLink></p>
      {comment.demonstration ? <p className="mt-1 text-xs text-amber-800">Có thao tác thay mặt bởi {comment.demonstration.originalActor?.displayName ?? 'superadmin'}</p> : null}
      {editingId === comment.id ? <div className="mt-2"><textarea className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" maxLength={MAX_COMMENT_LENGTH} value={editBody} onChange={(event) => onEditBody(event.target.value)} onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); onSubmitEdit(); } }} /><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancelEdit}>Hủy</Button><Button size="sm" disabled={!editBody.trim() || saving} onClick={onSubmitEdit}>Lưu</Button></div></div> : <p className={`mt-2 text-sm leading-6 ${deleted ? 'italic text-slate-500' : 'text-slate-700'}`}>{deleted ? 'Bình luận này đã bị xóa.' : <>{comment.replyToAuthorName ? <span className="mr-1 font-medium text-vna-blue">Trả lời {comment.replyToAuthorName}:</span> : null}{textWithSafeLinks(comment.body ?? '')}</>}</p>}
      {!deleted && editingId !== comment.id ? <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <button type="button" aria-label={`Thích, ${comment.reactions.likeCount} lượt`} aria-pressed={comment.reactions.actorReaction === 'LIKE'} disabled={pendingReactionIds.includes(comment.id)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 disabled:cursor-wait disabled:opacity-60 ${comment.reactions.actorReaction === 'LIKE' ? 'bg-cyan-50 font-semibold text-vna-blue' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => onReact(comment, 'LIKE')}><CpmsIcon name="like" size={15} /><span>Thích</span><span>{comment.reactions.likeCount}</span></button>
        <button type="button" aria-label={`Không thích, ${comment.reactions.dislikeCount} lượt`} aria-pressed={comment.reactions.actorReaction === 'DISLIKE'} disabled={pendingReactionIds.includes(comment.id)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 disabled:cursor-wait disabled:opacity-60 ${comment.reactions.actorReaction === 'DISLIKE' ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => onReact(comment, 'DISLIKE')}><CpmsIcon name="dislike" size={15} /><span>Không thích</span><span>{comment.reactions.dislikeCount}</span></button>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-50" onClick={() => onReply(comment)}><CpmsIcon name="reply" size={15} />Trả lời</button>
        {comment.isOwner ? <><button type="button" className="rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-50" onClick={() => onEdit(comment)}>Sửa</button><button type="button" className="rounded-lg px-2 py-1 font-medium text-rose-700 hover:bg-rose-50" onClick={() => onDelete(comment)}>Xóa</button></> : null}
        {canModerate && !comment.isOwner && <button type="button" disabled={saving} className="rounded-lg px-2 py-1 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50" onClick={() => onModerate?.(comment)}>Kiểm duyệt: xóa mềm</button>}
      </div> : null}
      {replyTargetId === comment.id ? <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Phản hồi {comment.author.displayName}</span><span className="text-[11px] text-slate-400">{replyBody.length}/{MAX_COMMENT_LENGTH}</span></div><textarea autoFocus className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" maxLength={MAX_COMMENT_LENGTH} value={replyBody} onChange={(event) => onReplyBody(event.target.value)} onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); onSubmitReply(); } }} /><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancelReply}>Hủy</Button><Button size="sm" disabled={!replyBody.trim() || saving} onClick={onSubmitReply}>Phản hồi</Button></div></div> : null}
    </div>
  </div>;
}

function JournalRow({ item }: { item: CampaignJournalItem }) {
  return <article className="grid gap-3 px-4 py-4 md:grid-cols-[11rem_1fr_auto] md:items-start">
    <div><time className="text-xs font-medium text-slate-600" dateTime={item.createdAt} title={fullTime(item.createdAt)}>{friendlyTime(item.createdAt)}</time><p className="mt-1 text-xs text-slate-400">{item.actor.displayName}</p></div>
    <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-bold text-vna-blue">{item.actionLabel}</span><span className="text-xs text-slate-400">Nguồn: {item.sourceLabel}</span></div><p className="mt-2 text-sm text-slate-700">{item.summary}</p>{item.changes.length ? <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-vna-blue">Xem {item.changes.length} trường thay đổi</summary><dl className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">{item.changes.map((change) => <div key={change.fieldKey} className="grid gap-1 text-xs sm:grid-cols-[10rem_1fr]"><dt className="font-semibold text-slate-600">{change.label}</dt><dd className="break-words text-slate-600"><span className="text-slate-400">{change.before ?? '—'}</span> thành <span className="text-slate-800">{change.after ?? '—'}</span></dd></div>)}</dl></details> : null}</div>
    <AppLink className="text-xs font-semibold text-vna-blue hover:underline" to={campaignDetailPath(item.campaign.id)}>{item.campaign.code} · {item.campaign.name}</AppLink>
  </article>;
}
