import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleApiAdapter } from './google-api.adapter';
import { googleEgress } from './google-egress';

beforeEach(() => { googleEgress.reset(); vi.useFakeTimers(); });
afterEach(() => { googleEgress.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function complete<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe('GoogleApiAdapter Drive uploads', () => {
  it('sends the exact Unicode filename in multipart Google Drive metadata', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const filename = 'Tài liệu QCTT – tháng 09.2026.xlsx';
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        id: 'drive-file-unicode',
        name: filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        driveId: 'shared-drive',
        parents: ['workspace-child'],
        trashed: false,
        size: '3',
        capabilities: { canEdit: true, canTrash: true, canDownload: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await complete(new GoogleApiAdapter().upload({
      accessToken: 'secret-token',
      sharedDriveId: 'shared-drive',
      parentFolderId: 'workspace-child',
      name: filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: new Uint8Array([1, 2, 3]),
      resumableThresholdBytes: 10,
    }));

    expect(result.mode).toBe('MULTIPART');
    expect(result.item.name).toBe(filename);
    const formData = requests[0]?.init?.body as FormData;
    const metadata = formData.get('metadata') as Blob;
    expect(JSON.parse(await metadata.text())).toEqual({ name: filename, parents: ['workspace-child'] });
  });

  it('uses resumable upload, authenticates chunks and retries only a transient failure', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let chunkAttempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).includes('uploadType=resumable')) {
        return new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } });
      }
      chunkAttempt += 1;
      if (chunkAttempt === 1) return new Response('temporary', { status: 500 });
      return new Response(JSON.stringify({
        id: 'drive-file-uploaded',
        name: 'QA lớn.bin',
        mimeType: 'application/octet-stream',
        driveId: 'shared-drive',
        parents: ['workspace-child'],
        trashed: false,
        size: '3',
        capabilities: { canEdit: true, canTrash: true, canDownload: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await complete(new GoogleApiAdapter().upload({
      accessToken: 'secret-token',
      sharedDriveId: 'shared-drive',
      parentFolderId: 'workspace-child',
      name: 'QA lớn.bin',
      mimeType: 'application/octet-stream',
      content: new Uint8Array([1, 2, 3]),
      resumableThresholdBytes: 1,
    }));

    expect(result.mode).toBe('RESUMABLE');
    expect(requests).toHaveLength(3);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ name: 'QA lớn.bin', parents: ['workspace-child'] });
    expect(new Headers(requests[1]?.init?.headers).get('Authorization')).toBe('Bearer secret-token');
    expect(new Headers(requests[2]?.init?.headers).get('Content-Range')).toBe('bytes 0-2/3');
  });
});

describe('GoogleApiAdapter Drive trash lifecycle', () => {
  it('lists both states and only uses reversible PATCH operations with Shared Drive support', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const baseItem = {
      id: 'drive-file-recoverable',
      name: 'Tài liệu kiểm tra phục hồi tiếng Việt.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      driveId: 'shared-drive',
      parents: ['workspace-child'],
      size: '3',
      capabilities: { canEdit: true, canTrash: true, canUntrash: true, canMoveItemWithinDrive: true, canDownload: true },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const parsed = new URL(String(url));
      const body = init?.body ? JSON.parse(String(init.body)) as { trashed?: boolean } : {};
      const isTrashedList = parsed.pathname.endsWith('/files') && parsed.searchParams.get('q')?.includes('trashed = true');
      const trashed = isTrashedList || body.trashed === true;
      const item = {
        ...baseItem,
        trashed,
        trashedTime: trashed ? '2026-09-03T00:00:00.000Z' : null,
        trashingUser: trashed ? { displayName: 'QA Google' } : undefined,
      };
      if (parsed.pathname.endsWith('/files')) return new Response(JSON.stringify({ files: [item] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const adapter = new GoogleApiAdapter();
    const active = await complete(adapter.listFiles({ accessToken: 'secret-token', sharedDriveId: 'shared-drive', parentFolderId: 'workspace-child', trashed: false, pageSize: 50 }));
    const trash = await complete(adapter.listFiles({ accessToken: 'secret-token', sharedDriveId: 'shared-drive', parentFolderId: 'workspace-child', trashed: true, pageSize: 50 }));
    await complete(adapter.setTrashed({ accessToken: 'secret-token', fileId: baseItem.id, trashed: true }));
    await complete(adapter.setTrashed({ accessToken: 'secret-token', fileId: baseItem.id, trashed: false }));
    await complete(adapter.moveItem({ accessToken: 'secret-token', fileId: baseItem.id, fromParentIds: ['wrong-parent'], toParentId: 'workspace-child' }));

    expect(active.items[0]).toMatchObject({ trashed: false, trashedTime: null, trashedBy: null });
    expect(trash.items[0]).toMatchObject({ trashed: true, trashedTime: '2026-09-03T00:00:00.000Z', trashedBy: 'QA Google' });
    expect(trash.items[0]?.capabilities).toMatchObject({ canTrash: true, canUntrash: true, canMoveItemWithinDrive: true });
    expect(new URL(requests[0]!.url).searchParams.get('q')).toContain('trashed = false');
    expect(new URL(requests[1]!.url).searchParams.get('q')).toContain('trashed = true');
    for (const request of requests) expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer secret-token');
    for (const request of requests.slice(2)) {
      expect(request.init?.method).toBe('PATCH');
      expect(new URL(request.url).searchParams.get('supportsAllDrives')).toBe('true');
    }
    expect(JSON.parse(String(requests[2]!.init?.body))).toEqual({ trashed: true });
    expect(JSON.parse(String(requests[3]!.init?.body))).toEqual({ trashed: false });
    expect(new URL(requests[4]!.url).searchParams.get('addParents')).toBe('workspace-child');
    expect(new URL(requests[4]!.url).searchParams.get('removeParents')).toBe('wrong-parent');
    expect('deleteItem' in adapter).toBe(false);
  });
});
