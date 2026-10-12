import type { MaterialCommentItem, MaterialJournalItem } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth-context';
import { createMaterialComment, deleteMaterialComment, getMaterialComments, getMaterialJournal, updateMaterialComment } from '../lib/api';
import { MATERIAL_COLUMNS } from '../lib/material-grid';

const actionLabels: Record<string, string> = {
  'material.batch_saved': 'Lưu tư liệu',
  'material.bulk_submit': 'Gửi phê duyệt',
  'material.bulk_reject': 'Từ chối',
  'material.bulk_approve': 'Phê duyệt',
  'material.bulk_publish': 'Xuất bản',
  'material.bulk_pause_publish': 'Tạm dừng xuất bản',
  'material.bulk_unpublish': 'Hủy xuất bản',
  'material.bulk_soft_delete': 'Chuyển vào Thùng rác',
  'material.bulk_restore': 'Phục hồi',
  'material.purged': 'Xóa vĩnh viễn',
  'material.comment_created': 'Bình luận mới',
  'material.comment_updated': 'Sửa bình luận',
  'material.comment_deleted': 'Xóa bình luận',
};

export function MaterialCollaborationPanel({ materialId, materialTitle, focusComment, focusJournal, notify }: {
  materialId: string | null; materialTitle: string; focusComment: number; focusJournal: number; notify(message: string): void;
}) {
  const { me } = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'comments' | 'journal'>('comments');
  const [comments, setComments] = useState<MaterialCommentItem[]>([]);
  const [journal, setJournal] = useState<MaterialJournalItem[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<MaterialCommentItem | null>(null);
  const [editing, setEditing] = useState<MaterialCommentItem | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!materialId) { setComments([]); setJournal([]); return; }
    let active = true;
    setLoading(true);
    void Promise.all([getMaterialComments(materialId), getMaterialJournal(materialId)]).then(([nextComments, nextJournal]) => {
      if (active) { setComments(nextComments); setJournal(nextJournal); }
    }).catch((error: unknown) => { if (active) notify(error instanceof Error ? error.message : 'Không tải được Bình luận và Lịch sử.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [materialId, notify]);

  useEffect(() => {
    if (!focusComment) return;
    setTab('comments');
    window.setTimeout(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); input.current?.focus(); }, 0);
  }, [focusComment]);

  useEffect(() => {
    if (!focusJournal) return;
    setTab('journal');
    window.setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [focusJournal]);

  async function refresh(id: string) {
    const [nextComments, nextJournal] = await Promise.all([getMaterialComments(id), getMaterialJournal(id)]);
    setComments(nextComments); setJournal(nextJournal);
  }

  async function submit() {
    if (!materialId || !body.trim() || busy) return;
    setBusy(true);
    try {
      await createMaterialComment(materialId, body.trim(), replyTo?.id);
      setBody(''); setReplyTo(null);
      await refresh(materialId);
      notify('Đã lưu bình luận.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Không lưu được bình luận.'); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!materialId || !editing || !editBody.trim() || busy) return;
    setBusy(true);
    try { await updateMaterialComment(materialId, editing.id, editBody.trim(), editing.recordVersion); setEditing(null); await refresh(materialId); }
    catch (error) { notify(error instanceof Error ? error.message : 'Không sửa được bình luận.'); }
    finally { setBusy(false); }
  }

  async function remove(comment: MaterialCommentItem) {
    if (!materialId || !window.confirm('Xóa bình luận này?')) return;
    setBusy(true);
    try { await deleteMaterialComment(materialId, comment.id, comment.recordVersion); await refresh(materialId); }
    catch (error) { notify(error instanceof Error ? error.message : 'Không xóa được bình luận.'); }
    finally { setBusy(false); }
  }

  return <div ref={panel}><Card className="mt-5 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name="comments" /></span><div><h2 className="font-semibold text-slate-950">Bình luận và Lịch sử làm việc</h2><p className="mt-1 text-xs text-slate-500">{materialId ? `${materialId} · ${materialTitle}` : 'Chọn một tư liệu đã lưu trong bảng để xem trao đổi và nhật ký.'}</p></div></div>{materialId ? <Button size="sm" variant="secondary" disabled={loading} onClick={() => void refresh(materialId)}>Làm mới</Button> : null}</div>
    <div className="flex gap-2 border-b border-slate-100 px-5"><button type="button" className={`border-b-2 px-3 py-3 text-sm font-semibold ${tab === 'comments' ? 'border-vna-blue text-vna-blue' : 'border-transparent text-slate-500'}`} onClick={() => setTab('comments')}>Bình luận ({comments.filter((item) => !item.deletedAt).length})</button><button type="button" className={`border-b-2 px-3 py-3 text-sm font-semibold ${tab === 'journal' ? 'border-vna-blue text-vna-blue' : 'border-transparent text-slate-500'}`} onClick={() => setTab('journal')}>Lịch sử ({journal.length})</button></div>
    {loading ? <p className="px-5 py-6 text-sm text-slate-500">Đang tải dữ liệu…</p> : tab === 'comments' ? <div className="space-y-4 p-5">
      {materialId ? <div className="rounded-xl border border-slate-200 p-4"><label className="text-sm font-semibold text-slate-800" htmlFor="material-comment-body">{replyTo ? `Trả lời ${replyTo.authorName}` : 'Bình luận mới'}</label>{replyTo ? <button type="button" className="ml-3 text-xs text-vna-blue" onClick={() => setReplyTo(null)}>Bỏ trả lời</button> : null}<textarea ref={input} id="material-comment-body" className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-vna-blue focus:ring-4 focus:ring-cyan-100" maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Trao đổi về tư liệu này…" onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); void submit(); } }} /><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-400">{body.length}/5000 · Ctrl+Enter để gửi</span><Button size="sm" disabled={!body.trim() || busy} onClick={() => void submit()}>Gửi bình luận</Button></div></div> : null}
      {!comments.length ? <p className="text-sm text-slate-500">Chưa có bình luận.</p> : <div className="space-y-3">{comments.map((comment) => <article key={comment.id} className={`rounded-xl border border-slate-200 p-4 ${comment.parentId ? 'ml-6 bg-slate-50/60' : 'bg-white'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{comment.authorName} <span className="font-normal text-slate-400">· {new Date(comment.createdAt).toLocaleString('vi-VN')}{comment.editedAt ? ' · đã sửa' : ''}</span></p>{!comment.deletedAt ? <div className="flex gap-3 text-xs font-semibold"><button className="text-vna-blue" onClick={() => { setReplyTo(comment); input.current?.focus(); }}>Trả lời</button>{(comment.authorActorId === me.account.id || me.directSuperadmin) ? <><button className="text-vna-blue" onClick={() => { setEditing(comment); setEditBody(comment.body); }}>Sửa</button><button className="text-rose-700" onClick={() => void remove(comment)}>Xóa</button></> : null}</div> : null}</div>{editing?.id === comment.id ? <div className="mt-3"><textarea className="min-h-24 w-full rounded-lg border border-slate-200 p-2 text-sm" maxLength={5000} value={editBody} onChange={(event) => setEditBody(event.target.value)} /><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Hủy</Button><Button size="sm" disabled={!editBody.trim() || busy} onClick={() => void saveEdit()}>Lưu</Button></div></div> : <p className={`mt-2 whitespace-pre-wrap text-sm ${comment.deletedAt ? 'italic text-slate-400' : 'text-slate-700'}`}>{comment.deletedAt ? 'Bình luận đã xóa.' : comment.body}</p>}</article>)}</div>}
    </div> : <div className="p-5">{!journal.length ? <p className="text-sm text-slate-500">Chưa có lịch sử.</p> : <ol className="space-y-3">{journal.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 p-4 text-sm"><p className="font-semibold text-slate-800">{actionLabels[item.action] || item.action}</p><p className="mt-1 text-xs text-slate-500">{item.actorName} · {new Date(item.createdAt).toLocaleString('vi-VN')}{typeof item.payload.recordVersion === 'number' ? ` · Phiên bản ${item.payload.recordVersion}` : ''}</p>{Array.isArray(item.payload.changedFields) && item.payload.changedFields.length ? <p className="mt-2 text-xs text-slate-600">Trường thay đổi: {item.payload.changedFields.filter((key): key is string => typeof key === 'string').map((key) => MATERIAL_COLUMNS.find((column) => column.key === key)?.label || key).join(', ')}</p> : null}</li>)}</ol>}</div>}
  </Card></div>;
}
