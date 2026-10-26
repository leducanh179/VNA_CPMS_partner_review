import { useEffect, useRef, useState } from 'react';
import { requestJson } from './api';

/** Saves only the actor-private input buffer, never a BookingRecord or inventory reservation. */
export function usePartnerBookingDraft(enabled: boolean, value: Record<string, unknown>, restore: (value: Record<string, unknown>) => void) {
  const path = '/grid-drafts/cpms.booking.partner-form.v1';
  const latest = useRef({ value, restore }); latest.current = { value, restore };
  const version = useRef(0), saved = useRef('{}'), queue = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(!enabled), [status, setStatus] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void requestJson<{ value: Record<string, unknown>; recordVersion: number }>(path).then(draft => {
      if (!active) return;
      version.current = draft.recordVersion; saved.current = JSON.stringify(draft.value);
      if (Object.keys(draft.value).length) latest.current.restore(draft.value);
      else saved.current = JSON.stringify(latest.current.value);
      setReady(true);
    }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : 'Không mở được bản nhập dở.'); });
    return () => { active = false; };
  }, [enabled]);
  const save = () => {
    if (!enabled || !ready) return Promise.resolve();
    const input = structuredClone(latest.current.value);
    const next = queue.current.catch(() => undefined).then(async () => {
      const encoded = JSON.stringify(input);
      if (encoded === saved.current) return;
      const draft = await requestJson<{ recordVersion: number }>(path, { method: 'PUT', body: JSON.stringify({ expectedVersion: version.current, value: input }) });
      version.current = draft.recordVersion; saved.current = encoded; setStatus('Đã lưu bản nhập dở riêng; chưa tạo đặt chỗ.');
    });
    queue.current = next;
    return next;
  };
  const encoded = JSON.stringify(value);
  useEffect(() => {
    if (!enabled || !ready || encoded === saved.current) return;
    const timer = window.setTimeout(() => { void save().catch(error => setStatus(error instanceof Error ? error.message : 'Chưa lưu được bản nhập dở.')); }, 1200);
    return () => window.clearTimeout(timer);
  }, [enabled, ready, encoded]);
  return { ready, status, save };
}
