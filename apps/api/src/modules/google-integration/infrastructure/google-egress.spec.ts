import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleApiAdapter } from './google-api.adapter';
import { GoogleEgress, googleEgress, googleRetryDelayMs, retryAfterMs } from './google-egress';

beforeEach(() => { vi.useFakeTimers(); googleEgress.reset(); });
afterEach(() => { googleEgress.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Google egress admission and cooldown', () => {
  it('spaces starts and limits active requests even when callers arrive together', async () => {
    const releases: Array<() => void> = [];
    const fetch = vi.fn(() => new Promise<Response>((resolve) => releases.push(() => resolve(new Response('{}')))));
    vi.stubGlobal('fetch', fetch);
    const guard = new GoogleEgress({ intervalMs: 1_000, maxConcurrent: 2 });
    const first = guard.fetch('https://sheets.googleapis.com/test', {});
    const second = guard.fetch('https://sheets.googleapis.com/test', {});
    const third = guard.fetch('https://sheets.googleapis.com/test', {});
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    releases[0]!();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    releases[1]!(); releases[2]!();
    await Promise.all([second, third]);
    guard.reset();
  });

  it('rejects excess and expired queued work without making network requests', async () => {
    let release!: () => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { release = () => resolve(new Response('{}')); }));
    vi.stubGlobal('fetch', fetch);
    const guard = new GoogleEgress({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 100 });
    const active = guard.fetch('https://sheets.googleapis.com/test', {});
    const queued = guard.fetch('https://sheets.googleapis.com/test', {}).catch((error: Error) => error);
    await expect(guard.fetch('https://sheets.googleapis.com/test', {})).rejects.toThrow('đang chờ');
    await vi.advanceTimersByTimeAsync(100);
    expect(await queued).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledTimes(1);
    release(); await active;
    guard.reset();
  });

  it('pauses data after repeated network failures, leaves identity available and recovers after cooldown', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    const guard = new GoogleEgress({ intervalMs: 1, failureThreshold: 2, cooldownMs: 300_000 });
    await expect(guard.fetch('https://sheets.googleapis.com/test', {})).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(1);
    await expect(guard.fetch('https://sheets.googleapis.com/test', {})).rejects.toThrow('offline');
    await expect(guard.fetch('https://sheets.googleapis.com/test', {})).rejects.toThrow('tạm nghỉ');
    await guard.fetch('https://oauth2.googleapis.com/token', {});
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300_000);
    await guard.fetch('https://sheets.googleapis.com/test', {});
    expect(fetch).toHaveBeenCalledTimes(4);
    guard.reset();
  });

  it('honors provider Retry-After and logs no credentials or resource URLs', async () => {
    const events: unknown[] = [];
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const guard = new GoogleEgress({ log: (event) => events.push(event) });
    await guard.fetch('https://sheets.googleapis.com/private-id?access_token=secret', { headers: { Authorization: 'Bearer secret' } });
    await expect(guard.fetch('https://sheets.googleapis.com/other', {})).rejects.toThrow('tạm nghỉ');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toMatch(/secret|private-id|access_token/);
    await vi.advanceTimersByTimeAsync(120_000);
    await guard.fetch('https://sheets.googleapis.com/other', {});
    guard.reset();
  });

  it('parses date Retry-After and adds growing randomized retry waits', () => {
    const date = new Date(Date.now() + 30_000).toUTCString();
    expect(retryAfterMs(new Response('', { headers: { 'Retry-After': date } }))).toBeGreaterThan(29_000);
    expect(googleRetryDelayMs(0)).toBeGreaterThanOrEqual(1_000);
    expect(googleRetryDelayMs(1)).toBeGreaterThanOrEqual(2_000);
  });

  it('holds the active slot while a response streams and rejects oversized bodies without retry', async () => {
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) { close = () => { controller.enqueue(new Uint8Array([1])); controller.close(); }; } });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(body)).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const guard = new GoogleEgress({ intervalMs: 1, maxConcurrent: 1 });
    const first = guard.fetch('https://sheets.googleapis.com/test', {});
    const second = guard.fetch('https://sheets.googleapis.com/test', {});
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    close(); await first; await vi.runAllTimersAsync(); await second;
    expect(fetch).toHaveBeenCalledTimes(2);
    guard.reset(); googleEgress.reset();
    fetch.mockReset().mockResolvedValue(new Response('x'.repeat(2_000_001)));
    await expect(new GoogleApiAdapter().identity('fixture-token')).rejects.toMatchObject({ code: 'LIMIT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Google adapter retry boundaries', () => {
  it('coalesces identical reads only for the same credential and clears completed work', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ sub: 'fixture', email: 'fixture@example.test' }))));
    vi.stubGlobal('fetch', fetch);
    const adapter = new GoogleApiAdapter();
    const first = adapter.identity('fixture-token-a');
    const duplicate = adapter.identity('fixture-token-a');
    const otherCredential = adapter.identity('fixture-token-b');
    await vi.runAllTimersAsync();
    await Promise.all([first, duplicate, otherCredential]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const fresh = adapter.identity('fixture-token-a');
    await vi.runAllTimersAsync(); await fresh;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops a transient read at three calls and does not retry a mutation', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('temporary', { status: 503 })));
    vi.stubGlobal('fetch', fetch);
    const read = new GoogleApiAdapter().identity('fixture-token').catch((error: Error) => error);
    await vi.runAllTimersAsync();
    expect(await read).toMatchObject({ code: 'PROVIDER' });
    expect(fetch).toHaveBeenCalledTimes(3);
    googleEgress.reset(); fetch.mockClear();
    await expect(new GoogleApiAdapter().setTrashed({ accessToken: 'fixture-token', fileId: 'fixture', trashed: true })).rejects.toMatchObject({ code: 'PROVIDER' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry expired credentials or long provider cooldowns', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(new GoogleApiAdapter().identity('fixture-token')).rejects.toMatchObject({ code: 'AUTH' });
    googleEgress.reset();
    await expect(new GoogleApiAdapter().identity('fixture-token')).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
