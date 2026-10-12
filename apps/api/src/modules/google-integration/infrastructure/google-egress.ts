type Group = 'data' | 'identity';
type Event = { event: string; group: Group; host?: string; method?: string; status?: number; elapsedMs?: number; responseBytes?: number };
type Job = { enqueuedAt: number; execute: () => Promise<void>; reject: (error: Error) => void };
type State = { active: number; nextStart: number; failures: number; pausedUntil: number; queue: Job[]; timer?: ReturnType<typeof setTimeout> };

export class GoogleEgressLimitError extends Error {}
export class GoogleEgressResponseLimitError extends Error {}

export function retryAfterMs(response: Response): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, Number.MAX_SAFE_INTEGER);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export function googleRetryDelayMs(attempt: number, response?: Response): number {
  return Math.max(retryAfterMs(response ?? new Response()), 1_000 * 2 ** attempt + Math.floor(Math.random() * 250));
}

/** Process-wide admission control. Identity has its own budget so a Sheets outage does not block OAuth. */
export class GoogleEgress {
  private readonly states = new Map<Group, State>();
  constructor(private readonly options: {
    intervalMs?: number; maxConcurrent?: number; maxQueue?: number; queueTimeoutMs?: number;
    failureThreshold?: number; cooldownMs?: number; log?: (event: Event) => void;
  } = {}) {}

  async fetch(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
    const host = new URL(url).hostname;
    const group: Group = host === 'oauth2.googleapis.com' || host === 'openidconnect.googleapis.com' ? 'identity' : 'data';
    const state = this.state(group);
    if (state.pausedUntil > Date.now()) throw new GoogleEgressLimitError('Dịch vụ Google đang tạm nghỉ sau lỗi. Hãy thử lại sau.');
    if (state.queue.length >= (this.options.maxQueue ?? 20)) throw new GoogleEgressLimitError('Có nhiều tác vụ Google đang chờ. Hãy thử lại sau.');
    return new Promise<Response>((resolve, reject) => {
      state.queue.push({ enqueuedAt: Date.now(), reject, execute: async () => {
        const started = Date.now();
        const method = init.method?.toUpperCase() ?? 'GET';
        let status: number | undefined;
        let responseBytes = 0;
        try {
          const deadline = AbortSignal.timeout(timeoutMs);
          const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
          const response = await fetch(url, { ...init, signal });
          status = response.status;
          if (status === 429 || status >= 500) {
            state.failures += 1;
            const retryAfter = retryAfterMs(response);
            if (retryAfter > 0) state.pausedUntil = Math.max(state.pausedUntil, Date.now() + retryAfter);
            this.openIfNeeded(group, state);
          }
          // Hold the concurrency slot through the response body, with the same deadline and a size bound.
          if (!response.body) {
            if (response.ok || status === 308) state.failures = 0;
            resolve(response); return;
          }
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              responseBytes += chunk.value.byteLength;
              if (responseBytes > 2_000_000) {
                await reader.cancel();
                throw new GoogleEgressResponseLimitError('Phản hồi Google vượt giới hạn 2 MB.');
              }
              chunks.push(chunk.value);
            }
          } finally { reader.releaseLock(); }
          if (response.ok || status === 308) state.failures = 0;
          resolve(new Response(Buffer.concat(chunks), { status, statusText: response.statusText, headers: response.headers }));
        } catch (error) {
          if (!(error instanceof GoogleEgressResponseLimitError)) {
            state.failures += 1;
            this.openIfNeeded(group, state);
          }
          reject(error);
        } finally {
          this.options.log?.({ event: 'request', group, host, method, ...(status === undefined ? {} : { status }), elapsedMs: Date.now() - started, responseBytes });
        }
      } });
      this.pump(group, state);
    });
  }

  /** Test/runtime shutdown helper; never retain queued credentials after cancellation. */
  reset() {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      for (const job of state.queue) job.reject(new GoogleEgressLimitError('Tác vụ Google đã dừng.'));
    }
    this.states.clear();
  }

  private state(group: Group): State {
    let state = this.states.get(group);
    if (!state) {
      state = { active: 0, nextStart: 0, failures: 0, pausedUntil: 0, queue: [] };
      this.states.set(group, state);
    }
    return state;
  }

  private openIfNeeded(group: Group, state: State) {
    if (state.failures < (this.options.failureThreshold ?? 5)) return;
    state.pausedUntil = Math.max(state.pausedUntil, Date.now() + (this.options.cooldownMs ?? 300_000));
    state.failures = 0;
    this.options.log?.({ event: 'cooldown', group });
  }

  private pump(group: Group, state: State) {
    if (state.timer) { clearTimeout(state.timer); delete state.timer; }
    const now = Date.now();
    const timeout = this.options.queueTimeoutMs ?? 15_000;
    while (state.queue.length && (state.pausedUntil > now || now - state.queue[0]!.enqueuedAt >= timeout)) {
      state.queue.shift()!.reject(new GoogleEgressLimitError('Tác vụ Google đang quá tải hoặc tạm nghỉ. Hãy thử lại sau.'));
    }
    if (!state.queue.length) return;
    if (state.active < (this.options.maxConcurrent ?? 2) && now >= state.nextStart) {
      const job = state.queue.shift()!;
      state.active += 1;
      state.nextStart = now + (this.options.intervalMs ?? 1_100);
      void job.execute().finally(() => { state.active -= 1; this.pump(group, state); });
    }
    if (!state.queue.length) return;
    const deadline = state.queue[0]!.enqueuedAt + timeout;
    const next = state.active >= (this.options.maxConcurrent ?? 2) ? deadline : Math.min(deadline, state.nextStart);
    state.timer = setTimeout(() => this.pump(group, state), Math.max(1, next - Date.now()));
  }
}

export const googleEgress = new GoogleEgress({ log: (event) => {
  // Host/method/status only: no tokens, resource IDs, query strings, bodies or user information.
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), component: 'google-egress', pid: process.pid, ...event }));
} });
