import { useEffect, useRef, useState, type RefObject } from 'react';
import { requestJson } from './api';
import { registerPendingNavigationGuard } from './router';
import { useUnsavedChanges } from './unsaved-changes';

type Draft = { value: Record<string, unknown>; recordVersion: number };
const tick = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));
const warning = 'Bạn có thay đổi chưa lưu. Bạn có muốn lưu trước khi rời bảng?\nOK: Lưu và tiếp tục. Hủy: Tiếp tục chỉnh sửa.';
const completionHandlers = new Map<string, () => Promise<boolean>>();
export async function completeGridDraft(scope: string) { return await completionHandlers.get(scope)?.() ?? true; }

/** Serializes module commands and persists unfinished input without applying business side effects. */
export function useGridSave({ scope, enabled, value, restore, commit, root, editing = false }: {
  scope: string; enabled: boolean; value: Record<string, unknown>; restore(value: Record<string, unknown>): void;
  commit(ids?: string[]): Promise<boolean>; root: RefObject<HTMLElement | null>; editing?: boolean;
}) {
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(!enabled);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ value, restore, commit, editing }); latest.current = { value, restore, commit, editing };
  const persisted = useRef('{}');
  const version = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const initialization = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const replay = useRef(false);
  const epoch = useRef(0);
  const completed = useRef(false);
  const encoded = JSON.stringify(value);

  useEffect(() => {
    mounted.current = true;
    epoch.current++;
    completed.current = false;
    let active = true;
    if (!enabled) { setReady(true); return; }
    setReady(false);
    initialization.current = requestJson<Draft>(`/grid-drafts/${encodeURIComponent(scope)}`).then(draft => {
      if (!active) return;
      version.current = draft.recordVersion;
      if (Object.keys(draft.value).length) {
        latest.current.restore(draft.value);
        setStatus('Đã khôi phục bản nhập dở riêng của bạn.');
      }
      persisted.current = JSON.stringify(draft.value);
      setReady(true);
    }).catch(error => { if (active) { setStatus(error instanceof Error ? error.message : 'Không tải được bản nhập dở.'); } throw error; });
    void initialization.current.catch(() => undefined);
    return () => { active = false; mounted.current = false; };
  }, [enabled, scope]);

  const checkpoint = async () => {
    if (completed.current) return;
    const generation = epoch.current;
    const next = structuredClone(latest.current.value), serialized = JSON.stringify(next);
    if (serialized === persisted.current) return;
    const draft = await requestJson<Draft>(`/grid-drafts/${encodeURIComponent(scope)}`, {
      method: 'PUT', body: JSON.stringify({ expectedVersion: version.current, value: next }),
    });
    if (generation !== epoch.current || !mounted.current) throw new Error('Bảng đã chuyển sang phạm vi khác; nội dung cũ được giữ trong bản nhập dở.');
    version.current = draft.recordVersion;
    persisted.current = serialized;
  };
  const enqueue = (work: () => Promise<boolean>) => {
    const generation = epoch.current;
    const task = queue.current.catch(() => undefined).then(async () => {
      try {
        await initialization.current;
        await tick();
        if (!mounted.current || generation !== epoch.current) return false;
        if (completed.current) return true;
        setBusy(true);
        return await work();
      }
      catch (error) { setStatus(error instanceof Error ? error.message : 'Lưu thất bại. Nội dung vẫn được giữ để thử lại.'); return false; }
      finally { if (mounted.current) setBusy(false); }
    });
    queue.current = task;
    return task;
  };
  const save = (ids?: string[]) => enqueue(async () => {
    const generation = epoch.current;
    setStatus('Đang lưu…');
    await checkpoint();
    if (generation !== epoch.current || !mounted.current) return false;
    const applied = await latest.current.commit(ids);
    await tick();
    if (generation !== epoch.current || !mounted.current) return false;
    await checkpoint();
    setStatus(applied ? (Object.keys(latest.current.value).length ? 'Đã lưu bản nhập dở riêng.' : 'Đã lưu') : 'Đã lưu bản nhập dở · Chưa áp dụng, kiểm tra ô lỗi.');
    return applied;
  });
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (!enabled) return;
    const complete = () => enqueue(async () => {
      completed.current = true;
      try {
        const draft = await requestJson<Draft>(`/grid-drafts/${encodeURIComponent(scope)}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: version.current, value: {} }) });
        version.current = draft.recordVersion; persisted.current = '{}'; return true;
      } catch (error) { completed.current = false; throw error; }
    });
    completionHandlers.set(scope, complete);
    return () => { if (completionHandlers.get(scope) === complete) completionHandlers.delete(scope); };
  }, [enabled, scope]);

  useEffect(() => {
    if (!enabled || !ready || encoded === persisted.current) return;
    const timer = window.setTimeout(() => { void enqueue(async () => {
      await checkpoint(); setStatus(Object.keys(latest.current.value).length ? 'Đã lưu bản nhập dở riêng · Enter để chốt ô.' : 'Đã lưu'); return true;
    }); }, 1200);
    return () => window.clearTimeout(timer);
  }, [encoded, enabled, ready]);

  useUnsavedChanges(enabled && (busy || encoded !== persisted.current));
  useEffect(() => {
    if (!enabled) return;
    const leave = async () => {
      await queue.current;
      if (JSON.stringify(latest.current.value) === persisted.current && !latest.current.editing) return true;
      if (!window.confirm(warning)) return false;
      return saveRef.current();
    };
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (replay.current || !(target instanceof Element) || root.current?.contains(target)
        || target.closest('[data-inline-save-surface]') || (JSON.stringify(latest.current.value) === persisted.current && !busy && !latest.current.editing)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!window.confirm(warning)) return;
      void saveRef.current().then(ok => {
        if (!ok || !target.isConnected) return;
        replay.current = true;
        try { (target.closest<HTMLElement>('button,a,input,select,label,[role="button"]') ?? target as HTMLElement).click(); }
        finally { replay.current = false; }
      });
    };
    const keepEditorFocus = (event: PointerEvent) => {
      const target = event.target;
      if (latest.current.editing && target instanceof Element && !root.current?.contains(target) && !target.closest('[data-inline-save-surface]')) event.preventDefault();
    };
    document.addEventListener('pointerdown', keepEditorFocus, true);
    document.addEventListener('click', outside, true);
    const unregister = registerPendingNavigationGuard(leave);
    return () => { document.removeEventListener('pointerdown', keepEditorFocus, true); document.removeEventListener('click', outside, true); unregister(); };
  }, [enabled, root, busy]);

  return { save, ready, busy, status };
}
