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

  it('marks an uploaded file and searches the same folder for its upload ID', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const uploadId = '8f8d3e1a-25f4-4f26-bc68-a6142fa13e12';
    const item = { id: 'drive-file-marked', name: 'Marked.pdf', mimeType: 'application/pdf', driveId: 'shared-drive',
      parents: ['workspace-child'], trashed: false, size: '3', appProperties: { cpmsUploadId: uploadId } };
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(String(url).includes('/upload/') ? item : { files: [item] }), { status: 200 });
    }));
    const adapter = new GoogleApiAdapter();
    const uploaded = await complete(adapter.upload({ accessToken: 'token', sharedDriveId: 'shared-drive', parentFolderId: 'workspace-child',
      name: 'Marked.pdf', mimeType: 'application/pdf', content: new Uint8Array([1, 2, 3]), resumableThresholdBytes: 10, uploadId }));
    const metadata = (requests[0]!.init!.body as FormData).get('metadata') as Blob;
    expect(JSON.parse(await metadata.text()).appProperties).toEqual({ cpmsUploadId: uploadId });
    expect(uploaded.item.uploadId).toBe(uploadId);
    const found = await complete(adapter.listFiles({ accessToken: 'token', sharedDriveId: 'shared-drive', parentFolderId: 'workspace-child',
      trashed: false, pageSize: 2, uploadId }));
    expect(found.items[0]?.uploadId).toBe(uploadId);
    expect(new URL(requests[1]!.url).searchParams.get('q')).toContain(`appProperties has { key='cpmsUploadId' and value='${uploadId}' }`);
  });
});

describe('GoogleApiAdapter Drive downloads', () => {
  it('downloads binary media and exports Google-native files without exposing the access token in the URL', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }));

    const adapter = new GoogleApiAdapter();
    const binary = await complete(adapter.downloadFile({ accessToken: 'secret-token', fileId: 'binary-file', maxBytes: 100 }));
    const exported = await complete(adapter.downloadFile({ accessToken: 'secret-token', fileId: 'google-doc', maxBytes: 100,
      exportMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));

    expect([...binary]).toEqual([1, 2, 3]);
    expect([...exported]).toEqual([1, 2, 3]);
    expect(requests[0]!.url).toContain('/binary-file?alt=media&supportsAllDrives=true');
    expect(requests[1]!.url).toContain('/google-doc/export?mimeType=');
    for (const request of requests) {
      expect(request.url).not.toContain('secret-token');
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer secret-token');
    }
  });

  it('rejects a provider response larger than the explicit download cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
    const assertion = expect(new GoogleApiAdapter().downloadFile({ accessToken: 'secret-token', fileId: 'oversized', maxBytes: 3 }))
      .rejects.toMatchObject({ code: 'LIMIT' });
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe('GoogleApiAdapter folder sharing', () => {
  it('shows inherited access and writes only the requested direct user permission', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(JSON.stringify({ permissions: [{ id: 'parent-grant-123', type: 'anyone', role: 'writer',
        permissionDetails: [{ inherited: true }] }] }), { status: 200 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'direct-grant-123', type: 'user', role: body.role,
        emailAddress: 'qa@example.test' }), { status: 200 });
    }));
    const adapter = new GoogleApiAdapter();
    expect((await complete(adapter.listPermissions('token', 'folder-123')))[0]?.inherited).toBe(true);
    const created = await complete(adapter.createPermission({ accessToken: 'token', fileId: 'folder-123',
      type: 'user', role: 'reader', emailAddress: 'qa@example.test' }));
    expect(created.emailAddress).toBe('qa@example.test');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ type: 'user', role: 'reader', emailAddress: 'qa@example.test' });
    await complete(adapter.updatePermission({ accessToken: 'token', fileId: 'folder-123', permissionId: created.id, role: 'writer' }));
    await complete(adapter.deletePermission({ accessToken: 'token', fileId: 'folder-123', permissionId: created.id }));
    expect(requests.map((request) => request.init?.method ?? 'GET')).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
    expect(requests.slice(1).every((request) => request.url.includes('supportsAllDrives=true'))).toBe(true);
  });
  it('keeps inherited and direct public roles separate and limits only the requested folder', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ permissions: [{ id: 'mixed-public', type: 'anyone',
        role: 'writer', permissionDetails: [{ inherited: true, role: 'commenter' }, { inherited: false, role: 'writer' }] }] }), { status: 200 });
      return new Response(JSON.stringify({ id: 'child-folder', name: 'Child', mimeType: 'application/vnd.google-apps.folder',
        inheritedPermissionsDisabled: true, capabilities: { canShare: true } }), { status: 200 });
    }));
    const adapter = new GoogleApiAdapter();
    const permission = (await complete(adapter.listPermissions('token', 'child-folder')))[0]!;
    expect(permission).toMatchObject({ inherited: false, inheritedRole: 'commenter', directRole: 'writer' });
    const updated = await complete(adapter.setInheritedPermissionsDisabled({ accessToken: 'token', fileId: 'child-folder', disabled: true }));
    expect(updated.inheritedPermissionsDisabled).toBe(true);
    expect(requests[1]!.url).toContain('/files/child-folder?');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ inheritedPermissionsDisabled: true });
  });
});

describe('GoogleApiAdapter Drive trash lifecycle', () => {
  it('maps shortcut metadata and sends the target resource key only in the request header', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        id: 'shortcut-id', name: 'Bản thiết kế', mimeType: 'application/vnd.google-apps.shortcut',
        driveId: 'shared-drive', parents: ['workspace-child'], trashed: false,
        shortcutDetails: { targetId: 'target-id', targetMimeType: 'application/pdf', targetResourceKey: 'resource-key' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const shortcut = await complete(new GoogleApiAdapter().getItem('secret-token', 'shortcut-id', 'resource-key'));
    expect(shortcut.shortcutDetails).toEqual({ targetId: 'target-id', targetMimeType: 'application/pdf', targetResourceKey: 'resource-key' });
    expect(requests[0]!.url).not.toContain('resource-key');
    expect(new Headers(requests[0]!.init?.headers).get('X-Goog-Drive-Resource-Keys')).toBe('shortcut-id/resource-key');
    expect(new URL(requests[0]!.url).searchParams.get('fields')).toContain('shortcutDetails(targetId,targetMimeType,targetResourceKey)');
  });

  it('retries a folder-scoped list through the account corpus when Shared Drive listing is forbidden', async () => {
    const requests: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const request = new URL(String(url));
      requests.push(request);
      if (request.searchParams.get('corpora') === 'drive') return new Response('{}', { status: 403 });
      return new Response(JSON.stringify({ files: [{
        id: 'visible-child', name: 'Visible', mimeType: 'application/vnd.google-apps.folder',
        driveId: 'shared-drive', parents: ['workspace-child'], trashed: false,
      }] }), { status: 200 });
    }));

    const page = await complete(new GoogleApiAdapter().listFiles({ accessToken: 'secret-token',
      sharedDriveId: 'shared-drive', parentFolderId: 'workspace-child', trashed: false, pageSize: 50 }));

    expect(page.items.map((item) => item.id)).toEqual(['visible-child']);
    expect(requests.map((request) => request.searchParams.get('corpora'))).toEqual(['drive', 'user']);
    expect(requests[0]!.searchParams.get('driveId')).toBe('shared-drive');
    expect(requests[1]!.searchParams.has('driveId')).toBe(false);
    for (const request of requests) expect(request.searchParams.get('q')).toBe("'workspace-child' in parents and trashed = false");
  });

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
