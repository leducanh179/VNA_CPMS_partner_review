import type { LookupAnswer, LookupConversation, LookupConversationDetail, LookupConversations, LookupStatus } from '@cpms/ai-contracts';
import { Button, CpmsIcon } from '@cpms/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth-context';
import { requestJson } from '../lib/api';
import type { LookupContext, LookupContextPreview, LookupRecordKind } from '@cpms/ai-contracts';
import { aiRecordFromPath, publishAiSelection, useAiSelection } from '../lib/ai-selection';
import { AiProposalCard } from './ai-proposal-card';
import { AiLibraryResults } from './ai-library-results';
import { AiMessage } from './ai-message';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
const suggestions = [
  { icon: 'campaign' as const, title: 'Nắm nhanh chiến dịch', question: 'Tổng hợp số chiến dịch tôi được xem theo từng trạng thái.' },
  { icon: 'material' as const, title: 'Tìm tư liệu đang có', question: 'Tìm giúp tôi các tư liệu video đang có trên CPMS.' },
  { icon: 'search' as const, title: 'Tra cứu theo tên', question: 'Tìm các chiến dịch có tên Tết và cho biết thời gian truyền thông.' },
];

type AssistantProps = { home: boolean; path: string; onDockWidthChange: (width: number) => void };
const chatUrl = (id: string | null) => {
  // A chat opened beside a form must never replace the business route or its query.
  if (window.location.pathname === '/') window.history.replaceState(null, '', id ? `/?chat=${encodeURIComponent(id)}` : '/');
};

export function AiAssistant(props: AssistantProps) {
  const { me } = useAuth();
  // Remount on identity change: never retain another account's chat in component state.
  return <ChatWorkspace key={`${me.account.id}:${me.mode}`} {...props} />;
}
function ChatWorkspace({ home, path, onDockWidthChange }: AssistantProps) {
  const selection = useAiSelection();
  const selectedRecord = selection?.record ?? aiRecordFromPath(path);
  const recordKey = selectedRecord ? `${selectedRecord.kind}:${selectedRecord.id}` : '';
  const [contextMode,setContextMode] = useState<'RECORD'|'CELL'|'NONE'>('RECORD');
  const [contextRefresh,setContextRefresh] = useState(0);
  const [attachment, setAttachment] = useState<{ context: LookupContext; preview: LookupContextPreview } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const contextSequence = useRef(0);
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(440), [unread, setUnread] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const visible = home || open;
  const visibleRef = useRef(visible), homeRef = useRef(home);
  visibleRef.current = visible; homeRef.current = home;
  const panel = useRef<HTMLElement>(null), transcript = useRef<HTMLDivElement>(null);
  const businessFocus = useRef<HTMLElement | null>(null), resizing = useRef(false);
  const initialized = useRef(false), conversationRef = useRef<string | null>(null);
  const [status, setStatus] = useState<LookupStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<LookupAnswer[]>([]);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(() => home && window.innerWidth >= 1024);
  const [conversations, setConversations] = useState<LookupConversation[]>([]);
  const [conversation, setConversation] = useState<LookupConversation | null>(null);
  const [listCursor, setListCursor] = useState<string | null>(null), [turnCursor, setTurnCursor] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null), [newTitle, setNewTitle] = useState('');
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null), mounted = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null), bottom = useRef<HTMLDivElement>(null);
  conversationRef.current = conversation?.id ?? null;
  const scrollAnswer = useCallback(() => {
    if (!visibleRef.current) return;
    if (homeRef.current) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    else if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, []);
  const show = () => { setOpen(true); setUnread(false); setHistoryOpen(false); };
  const hide = () => {
    setOpen(false);
    if (businessFocus.current?.isConnected) businessFocus.current.focus({ preventScroll: true });
  };
  useLayoutEffect(() => { publishAiSelection(null); }, [path]);
  useLayoutEffect(() => () => { contextSequence.current++; publishAiSelection(null); }, []);
  useEffect(() => {
    onDockWidthChange(!home && open && !expanded ? width + 24 : 0);
    return () => onDockWidthChange(0);
  }, [home, open, expanded, width, onDockWidthChange]);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !panel.current?.contains(target) && !target.closest('[data-ai-launcher]')) businessFocus.current = target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
  useEffect(() => {
    if (visible) { setUnread(false); if (!home) textarea.current?.focus({ preventScroll: true }); }
  }, [visible, home]);
  const refresh = useCallback(async () => {
    const next = await requestJson<LookupStatus>('/ai/lookup/status');
    if (mounted.current) setStatus(next);
    return next;
  }, []);
  const refreshConversations = useCallback(async (cursor?: string) => {
    const result = await requestJson<LookupConversations>(`/ai/lookup/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (mounted.current) {
      setConversations(current => cursor ? [...new Map([...current, ...result.items].map(item => [item.id, item])).values()] : result.items);
      setListCursor(result.nextCursor);
    }
  }, []);
  const openConversation = useCallback(async (id: string, before?: string) => {
    const request = ++sequence.current;
    setLoadingChat(true); setError('');
    try {
      const result = await requestJson<LookupConversationDetail>(`/ai/lookup/conversations/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      if (!mounted.current || request !== sequence.current) return;
      setConversation(result.conversation); setTurns(current => before ? [...result.items, ...current] : result.items);
      setTurnCursor(result.nextCursor);
      if (!before) { setPreviousId(result.items.filter(item => item.state === 'COMPLETE').at(-1)?.id ?? null); setQuestion(''); setAttachment(null); contextSequence.current++; setContextBusy(false); setContextRefresh(n=>n+1); }
      chatUrl(id);
    } catch (e) { if (mounted.current && request === sequence.current) setError((e as Error).message); }
    finally { if (mounted.current && request === sequence.current) setLoadingChat(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    void refresh().catch(e => { if (mounted.current) setError(e.message); });
    void refreshConversations().catch(e => { if (mounted.current) setError(e.message); });
    if (!initialized.current) {
      initialized.current = true;
    }
  }, [visible, home, refresh, refreshConversations, openConversation]);
  useEffect(() => {
    if (!home) return;
    const id = new URLSearchParams(window.location.search).get('chat');
    if (id && id !== conversationRef.current && initialized.current && !active.current) void openConversation(id);
    else if (!id && conversationRef.current) chatUrl(conversationRef.current);
  }, [home, openConversation]);
  useEffect(() => { if (pending) scrollAnswer(); }, [pending, scrollAnswer]);
  const startNew = () => {
    sequence.current++; setConversation(null); setTurns([]); setPreviousId(null); setTurnCursor(null); setError(''); setQuestion('');
    setAttachment(null); contextSequence.current++; setContextBusy(false); setCopyStatus('');
    setContextRefresh(n=>n+1);
    chatUrl(null); textarea.current?.focus({ preventScroll: true });
  };
  const send = async () => {
    if (!question.trim() || active.current || loadingChat || contextBusy || !status?.allowed || !status.ready) return;
    if (!home && contextMode === 'RECORD' && selectedRecord && (attachment?.context.type !== 'RECORD' || attachment.context.record.id !== selectedRecord.id || attachment.context.record.kind !== selectedRecord.kind)) return;
    const text = question.trim(), controller = new AbortController();
    active.current = controller; setPending(text); setQuestion(''); setError('');
    try {
      const answer = await requestJson<LookupAnswer>('/ai/lookup/ask', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ id: crypto.randomUUID(), question: text, previousId, conversationId: conversation?.id ?? null, ...(attachment ? { context: attachment.context } : {}) }) });
      if (mounted.current) {
        setTurns(current => [...current, answer]); setPreviousId(answer.id);
        setConversation(current => current ?? { id: answer.conversationId, title: text.slice(0, 100), version: 1, updatedAt: answer.createdAt });
        chatUrl(answer.conversationId);
        if (!visibleRef.current) setUnread(true);
        window.setTimeout(scrollAnswer, 0);
      }
    } catch (e) {
      if (mounted.current) {
        setError(controller.signal.aborted ? 'Đã dừng chờ trả lời. Phần đã gửi đến AI có thể vẫn phát sinh chi phí; xem Lịch sử để kiểm tra.' : (e as Error).message);
        setQuestion(text);
      }
    } finally {
      active.current = null;
      if (mounted.current) { setPending(''); void refresh().catch(() => {}); void refreshConversations().catch(() => {}); }
    }
  };
  const rename = async (item: LookupConversation) => {
    setError('');
    try {
      const updated = await requestJson<LookupConversation>(`/ai/lookup/conversations/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle, version: item.version }) });
      if (mounted.current) { setRenaming(null); if (conversation?.id === item.id) setConversation(updated); await refreshConversations(); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
  };
  const remove = async (item: LookupConversation) => {
    if (!window.confirm(`Xóa cuộc trò chuyện “${item.title}”? Nội dung sẽ không thể mở lại. Chi phí đã sử dụng vẫn được ghi nhận.`)) return;
    try {
      await requestJson(`/ai/lookup/conversations/${item.id}`, { method: 'DELETE' });
      if (mounted.current) { if (conversation?.id === item.id) startNew(); await refreshConversations(); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
  };
  const enabled = Boolean(status?.allowed && status.ready);
  const busy = Boolean(pending) || loadingChat;
  const attach = async (type: 'CELL' | 'RECORD') => {
    setContextMode(type);
    const context: LookupContext | null = type === 'RECORD' ? selectedRecord ? { type, record: selectedRecord } : null :
      selection?.label ? { type, text: selection.readText?.() ?? selection.text ?? '', label: selection.label,
        ...(selection.fieldKey ? { fieldKey: selection.fieldKey } : {}), ...(selection.record ? { record: selection.record } : {}) } : null;
    if (!context) return;
    const current = ++contextSequence.current; setContextBusy(true); setError('');
    setAttachment(null);
    try {
      const preview = await requestJson<LookupContextPreview>('/ai/lookup/context', { method: 'POST', body: JSON.stringify(context) });
      if (mounted.current && current === contextSequence.current) setAttachment({ context, preview });
    } catch (error) { if (mounted.current && current === contextSequence.current) setError((error as Error).message); }
    finally { if (mounted.current && current === contextSequence.current) setContextBusy(false); }
  };
  useEffect(() => {
    if (home || !visible || !enabled || contextMode !== 'RECORD') return;
    const current = ++contextSequence.current;
    setAttachment(null); setContextBusy(false);
    if (!recordKey) return;
    const [kind,id] = recordKey.split(':');
    const context: LookupContext = { type:'RECORD',record:{kind:kind as LookupRecordKind,id:id!} };
    setContextBusy(true);
    void requestJson<LookupContextPreview>('/ai/lookup/context',{method:'POST',body:JSON.stringify(context)})
      .then(preview => { if (mounted.current && current === contextSequence.current) setAttachment({context,preview}); })
      .catch(e => { if (mounted.current && current === contextSequence.current) setError(e.message); })
      .finally(() => { if (mounted.current && current === contextSequence.current) setContextBusy(false); });
    return () => { if (current === contextSequence.current) contextSequence.current++; };
  },[home,visible,enabled,contextMode,recordKey,conversation?.id,contextRefresh]);
  useLayoutEffect(() => { contextSequence.current++;setAttachment(null);setContextBusy(false);setContextMode('RECORD'); },[home,path]);
  const copy = async (answer: string) => {
    try { await navigator.clipboard.writeText(answer); setCopyStatus('Đã sao chép câu trả lời.'); }
    catch { setCopyStatus('Chưa sao chép được. Bạn có thể chọn nội dung và nhấn Ctrl+C.'); }
  };
  return <>
    {!home && !open && <button type="button" data-ai-launcher aria-label="Mở Trợ lý AI" aria-expanded={false} aria-controls="cpms-ai-workspace" onClick={show}
      className="fixed bottom-5 right-[76px] z-[80] flex h-11 items-center gap-2 rounded-full border border-cyan-200 bg-white px-4 text-sm font-semibold text-vna-blue shadow-lg hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-vna-gold">
      <CpmsIcon name={pending ? 'pending' : 'comments'} size={20}/>{pending ? 'AI đang trả lời…' : 'Trợ lý AI'}
      {unread && <span role="status" className="rounded-full bg-vna-blue px-2 py-0.5 text-xs text-white">Có trả lời mới</span>}
    </button>}
    <section ref={panel} id="cpms-ai-workspace" aria-label={home ? 'Trợ lý AI' : 'Trợ lý AI bên cạnh'} hidden={!visible}
      className={home ? 'mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-6xl flex-col' : `cpms-ai-panel ${expanded ? 'cpms-ai-expanded' : ''}`}
      style={!home ? { width: expanded ? undefined : `min(${width}px, calc(100vw - 96px))` } : undefined}>
    {!home && !expanded && <div role="separator" tabIndex={0} aria-label="Điều chỉnh chiều rộng Trợ lý AI" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={640} aria-valuenow={width}
      className="absolute -left-1 inset-y-4 hidden w-2 cursor-col-resize rounded-full hover:bg-cyan-200 focus:bg-cyan-200 xl:block"
      onPointerDown={event => { resizing.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (resizing.current) setWidth(Math.max(360, Math.min(640, window.innerWidth - event.clientX - 16))); }}
      onPointerUp={() => { resizing.current = false; }} onPointerCancel={() => { resizing.current = false; }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setWidth(value => event.key === 'Home' ? 360 : event.key === 'End' ? 640 : Math.max(360, Math.min(640, value + (event.key === 'ArrowLeft' ? 24 : -24)))); } }}/>}
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-vna-blue text-white"><CpmsIcon name="comments" size={22}/></span>
        <div><h1 className="text-base font-semibold text-slate-900">Trợ lý AI</h1>
          <p className="mt-0.5 text-xs text-slate-500">{status?.mode === 'MOCK' ? 'Mô phỏng · Không gọi AI' : 'Soạn thảo và tra cứu CPMS'} · Thử nghiệm</p></div>
      </div>
      {!home && <div className="flex gap-1">
        <button type="button" aria-label={expanded ? 'Thu về bảng bên phải' : 'Mở rộng Trợ lý AI'} title={expanded ? 'Thu về bảng bên phải' : 'Mở rộng Trợ lý AI'} className="rounded-lg p-2 text-slate-600 hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-vna-gold" onClick={() => setExpanded(value => !value)}><CpmsIcon name={expanded ? 'windowPanel' : 'windowMaximize'}/></button>
        <button type="button" aria-label="Thu nhỏ Trợ lý AI" title="Thu nhỏ, giữ nguyên hội thoại" className="rounded-lg p-2 text-slate-600 hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-vna-gold" onClick={hide}><CpmsIcon name="windowMinimize"/></button>
      </div>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setHistoryOpen(value => !value); void refreshConversations().catch(() => {}); }}><CpmsIcon name="history"/>Lịch sử</Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={startNew}><CpmsIcon name="add"/>Hội thoại mới</Button>
      </div>
    </header>
    <div className={`flex min-h-0 flex-1 flex-col gap-4 ${home ? 'lg:flex-row' : ''}`}>
      {historyOpen && <aside aria-label="Hội thoại đã lưu" className={`mt-4 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white/70 p-3 ${home ? 'max-h-64 lg:sticky lg:top-5 lg:max-h-[85dvh] lg:w-56 lg:self-start' : 'max-h-48'}`}>
        <h2 className="mb-3 px-2 text-xs font-semibold text-slate-500">Hội thoại của bạn</h2>
        {!conversations.length && <p className="px-2 py-4 text-xs leading-5 text-slate-400">Các cuộc chat được lưu tại đây để bạn mở lại và tiếp tục.</p>}
        <div className="space-y-1">
          {conversations.map(item => <div key={item.id} className={`rounded-xl p-2 ${conversation?.id === item.id ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}>
            {renaming === item.id ? <form onSubmit={event => { event.preventDefault(); void rename(item); }} className="space-y-2">
              <input autoFocus aria-label="Tên hội thoại" value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={100} className="w-full rounded-lg border px-2 py-2 text-sm"/>
              <div className="flex gap-2"><Button size="sm" type="submit" disabled={!newTitle.trim()}>Lưu tên</Button><Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>Hủy</Button></div>
            </form> : <>
              <button type="button" disabled={busy} onClick={() => { void openConversation(item.id); if (!home || window.innerWidth < 1024) setHistoryOpen(false); }}
                title={item.title} className="block w-full truncate text-left text-sm font-medium text-slate-700">{item.title}</button>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400">{new Date(item.updatedAt).toLocaleDateString('vi-VN')}</span>
                <div className="flex gap-1">
                  <button type="button" disabled={busy} title="Đổi tên" aria-label={`Đổi tên ${item.title}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-vna-blue" onClick={() => { setRenaming(item.id); setNewTitle(item.title); }}><CpmsIcon name="edit" size={16}/></button>
                  <button type="button" disabled={busy} title="Xóa hội thoại" aria-label={`Xóa ${item.title}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600" onClick={() => { void remove(item); }}><CpmsIcon name="delete" size={16}/></button>
                </div>
              </div>
            </>}
          </div>)}
        </div>
        {listCursor && <Button variant="ghost" size="sm" onClick={() => { void refreshConversations(listCursor).catch(e => setError(e.message)); }}>Tải thêm hội thoại</Button>}
      </aside>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={transcript} className={!home ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1' : ''}>
      {conversation && <h2 className="mt-5 truncate text-sm font-semibold text-slate-600" title={conversation.title}>{conversation.title}</h2>}
      {loadingChat && <p role="status" className="mt-4 text-sm text-slate-500">Đang mở hội thoại…</p>}

    {!turns.length && !pending ? <div className={`flex flex-1 flex-col justify-center ${home ? 'py-14' : 'py-7'}`}>
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.22em] text-vna-blue">Thông tin của bạn, trong một cuộc trò chuyện</p>
      <h2 className={`text-center font-semibold tracking-tight text-slate-900 ${home ? 'text-3xl lg:text-4xl' : 'text-xl'}`}>Hôm nay, bạn cần hỗ trợ gì?</h2>
      <p className="mx-auto mt-4 max-w-lg text-center text-sm leading-6 text-slate-500">Dán nội dung để biên tập, tóm tắt hoặc soạn nháp.<br/>Khi tra cứu Chiến dịch và Tư liệu, câu trả lời có nguồn bạn được xem.</p>
      <div className={`mt-6 grid gap-3 ${home ? 'sm:grid-cols-3' : ''}`}>
        {suggestions.map(item => <button key={item.title} type="button" onClick={() => { setQuestion(item.question); textarea.current?.focus(); }}
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-cyan-400 hover:shadow-sm">
          <CpmsIcon name={item.icon} size={21} className="text-vna-blue"/><span className="mt-4 block text-sm font-semibold text-slate-800">{item.title}</span>
          <span className="mt-2 block text-xs leading-5 text-slate-500">{item.question}</span>
        </button>)}
      </div>
    </div> : <div className="flex-1 space-y-8 py-7" aria-label="Nội dung hội thoại" aria-live="polite">
      {turnCursor && conversation && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void openConversation(conversation.id, turnCursor); }}>Tải tin nhắn cũ hơn</Button>}
      {turns.map(turn => <article key={turn.id} className="space-y-4">
        <div className="ml-auto max-w-[85%] rounded-2xl bg-slate-200/70 px-5 py-3 text-sm leading-6 text-slate-900 whitespace-pre-wrap">
          {turn.question.split('\n\n[Ngữ cảnh ')[0]}
          {turn.question.includes('\n\n[Ngữ cảnh ') && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Ngữ cảnh đã gửi</summary><p className="mt-2 break-words">{turn.question.slice(turn.question.indexOf('[Ngữ cảnh '))}</p></details>}
        </div>
        <div className="flex gap-3"><span className="mt-1 text-vna-blue"><CpmsIcon name="comments" size={20}/></span>
          <div className="min-w-0 flex-1"><AiMessage text={turn.answer}/>
            {turn.sources.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Nguồn CPMS">
              {turn.sources.map(source => <a key={`${source.kind}:${source.id}`} href={source.href} target="_blank" rel="noopener noreferrer" title="Mở nguồn trong tab mới"
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-vna-blue hover:border-cyan-400">
                <CpmsIcon name={source.kind === 'CAMPAIGN' ? 'campaign' : source.kind === 'CONTRACT' ? 'contract' : source.kind === 'BOOKING' ? 'booking' : 'material'} size={16}/><span className="truncate">{source.title}</span><CpmsIcon name="expand" size={14}/>
              </a>)}
            </div>}
            <p className="mt-3 text-[11px] text-slate-400">{new Date(turn.createdAt).toLocaleString('vi-VN')} · {turn.mode === 'MOCK' ? 'Mô phỏng' : `Chi phí dự tính: ${money(turn.estimatedCostVnd)}`}</p>
            {turn.state === 'COMPLETE' && <Button variant="ghost" size="sm" onClick={() => { void copy(turn.answer); }}><CpmsIcon name="copy" size={16}/>Sao chép</Button>}
            {turn.state === 'COMPLETE' && turn.artifacts?.library && <AiLibraryResults artifacts={turn.artifacts}/>}
            {turn.state === 'COMPLETE' && turn.artifacts?.proposalId && <AiProposalCard id={turn.artifacts.proposalId}/>}
            {turn.artifacts?.questions?.map((item,index) => <section key={index} className="mt-3 rounded-xl border bg-white p-3">
              <p className="text-sm font-medium">{item.question}</p><div className="mt-2 flex flex-wrap gap-1">{item.options.map(option => <Button key={option} variant="secondary" size="sm" disabled={busy} onClick={() => {setQuestion(text => `${text}${text ? '\n' : ''}${item.question} ${option}`);textarea.current?.focus();}}>{option}</Button>)}</div>
            </section>)}
            {turn.artifacts?.questions?.length ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => {setQuestion('Cứ đề xuất tư liệu trước dựa trên thông tin hiện có.');textarea.current?.focus();}}>Cứ đề xuất trước</Button> : null}
          </div>
        </div>
      </article>)}
      {pending && <div className="space-y-4"><p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-slate-200/70 px-5 py-3 text-sm">{pending}</p>
        <p role="status" className="flex items-center gap-2 text-sm text-vna-blue"><CpmsIcon name="pending"/>Đang xử lý yêu cầu của bạn…</p></div>}
      <div ref={bottom}/>
    </div>}
      </div>
    <div className={`${home ? 'sticky bottom-0' : 'shrink-0'} bg-gradient-to-t from-[#edf7f7] via-[#edf7f7] to-transparent pb-1 pt-3`}>
      {(selection || selectedRecord) && <div className="mb-2 rounded-xl border border-cyan-100 bg-white/80 p-2 text-xs">
        <p className="mb-1 truncate text-slate-500" title={selection?.title}>Ngữ cảnh: {selection?.title || 'Hồ sơ đang mở'}</p>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={busy || contextBusy || !enabled || !selection?.label} onClick={() => { void attach('CELL'); }}>Dùng ô đang chọn</Button>
          <Button size="sm" variant={contextMode==='RECORD' ? 'secondary':'ghost'} disabled={busy || contextBusy || !enabled || !selectedRecord} onClick={() => { void attach('RECORD'); }}>Cả hồ sơ (mặc định)</Button>
          <Button size="sm" variant={contextMode==='NONE' ? 'secondary':'ghost'} disabled={busy} onClick={() => {setContextMode('NONE');setAttachment(null);contextSequence.current++;setContextBusy(false);}}>Không đính kèm</Button>
        </div>
      </div>}
      {contextBusy && <p role="status" className="mb-2 text-xs text-vna-blue">Đang kiểm tra quyền và lấy ngữ cảnh…</p>}
      {attachment && <div className="mb-2 rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-xs">
        <div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{attachment.context.type === 'RECORD' ? 'Hồ sơ đã lưu' : 'Nội dung ô'}: {attachment.preview.title}</strong>
          <button type="button" aria-label="Bỏ ngữ cảnh đính kèm" title="Bỏ ngữ cảnh đính kèm" disabled={busy} onClick={() => { setContextMode('NONE'); setAttachment(null); contextSequence.current++; setContextBusy(false); }} className="rounded p-1 hover:bg-white"><CpmsIcon name="windowClose" size={16}/></button></div>
        <details className="mt-1"><summary className="cursor-pointer text-vna-blue">Xem ngữ cảnh trước khi gửi</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans">{attachment.preview.text}</pre>
          {attachment.context.type === 'RECORD' && <p className="mt-1 text-slate-500">Thông tin chính đã lưu; chưa gồm thay đổi đang nhập và nội dung file. Kiểm tra lại khi gửi.</p>}
        </details>
        {attachment.preview.truncated && <p className="mt-1 text-amber-800">Ngữ cảnh được rút gọn theo giới hạn dung lượng.</p>}
      </div>}
      {copyStatus && <p role="status" className="mb-2 text-xs text-vna-blue">{copyStatus}</p>}
      {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {status?.reason && <p role="status" className="mb-3 text-center text-sm text-slate-500">{status.reason} Bạn vẫn có thể mở các phân hệ ở menu bên trái.</p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm focus-within:border-cyan-500">
        <textarea ref={textarea} value={question} onChange={event => setQuestion(event.target.value)} maxLength={1600} rows={home ? 3 : 2}
          aria-label="Câu hỏi cho Trợ lý AI" placeholder="Nhờ biên tập, soạn nháp hoặc tra cứu CPMS…"
          className="w-full resize-none bg-transparent px-3 pt-2 text-sm leading-6 outline-none placeholder:text-slate-400"
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
        <div className="flex items-center justify-between gap-2 px-2">
          <span className="text-[11px] text-slate-400">Chỉ ghi dữ liệu khi bạn xác nhận · {question.length}/1.600</span>
          {pending ? <Button type="button" variant="secondary" onClick={() => active.current?.abort()}>Dừng</Button> :
            <Button type="submit" disabled={!enabled || busy || contextBusy || !question.trim()}><CpmsIcon name="reply"/>Gửi</Button>}
        </div>
      </form>
      {status?.allowed && <p className={`mt-3 text-center text-[11px] ${status.warning ? 'text-amber-800' : 'text-slate-500'}`}>
        Tháng {status.period}: {money(status.chargedVnd)} / {money(status.limitVnd)} dự tính{status.reservedVnd > 0 ? ` · Đang giữ trước ${money(status.reservedVnd)}` : ''}
        {status.warning ? ' · Sắp hết ngân sách' : ''}
      </p>}
    </div>
    </div></div>
  </section></>;
}
