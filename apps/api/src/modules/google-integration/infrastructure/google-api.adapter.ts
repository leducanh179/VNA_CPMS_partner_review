import type {
  CloudDriveItem,
  CloudManagedSpreadsheetPort,
  CloudDrivePage,
  CloudDrivePermission,
  CloudDrivePort,
  CloudDriveUpload,
  CloudSpreadsheetMetadata,
  CloudSpreadsheetPort,
  CloudSpreadsheetResultTab,
  OAuthIdentity,
  OAuthTokenSet,
  TabularSheetData,
  UserOAuthPort,
} from '@cpms/integrations';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { googleEgress, GoogleEgressLimitError, GoogleEgressResponseLimitError, googleRetryDelayMs } from './google-egress';

export type GoogleProviderErrorCode = 'AUTH' | 'FORBIDDEN' | 'NOT_FOUND' | 'VIEW_ONLY' | 'RATE_LIMIT' | 'NETWORK' | 'LIMIT' | 'PROVIDER';

export class GoogleProviderError extends Error {
  constructor(public readonly code: GoogleProviderErrorCode, message: string) { super(message); }
}

const MAX_ROWS = 1_000;
const MAX_COLUMNS = 100;
const MAX_RESPONSE_BYTES = 2_000_000;
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const CAMPAIGN_EXPORT_PROPERTY = 'cpmsCampaignExport';
const MANAGED_SHEET_FIELDS = 'id,mimeType,trashed,appProperties,capabilities(canEdit)';
type ManagedSheetFile = { id?: string; mimeType?: string; trashed?: boolean; appProperties?: Record<string, string>; capabilities?: { canEdit?: boolean } };
const pendingReads = new Map<string, Promise<unknown>>();

function providerError(status: number, method: string): GoogleProviderError {
  if (status === 401) return new GoogleProviderError('AUTH', 'Phiên Google đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.');
  if (status === 404) return new GoogleProviderError('NOT_FOUND', 'Không tìm thấy tài nguyên Google hoặc tài khoản không có quyền truy cập.');
  if (status === 403 && method === 'GET') return new GoogleProviderError('FORBIDDEN', 'Tài khoản Google không có quyền truy cập tài nguyên này.');
  if (status === 403) return new GoogleProviderError('VIEW_ONLY', 'Tài khoản Google không có quyền thay đổi tài nguyên này.');
  if (status === 429) return new GoogleProviderError('RATE_LIMIT', 'Google API đang giới hạn tần suất. Hãy thử lại sau.');
  return new GoogleProviderError('PROVIDER', 'Google API trả về lỗi. Hãy thử lại sau.');
}

async function requestJson<T>(url: string, init: RequestInit, retryReads = false): Promise<T> {
  if (!retryReads || (init.method?.toUpperCase() ?? 'GET') !== 'GET') return executeJson<T>(url, init, retryReads);
  // Coalesce only identical reads under the same provider credential; never share results across credentials.
  const key = createHash('sha256').update(JSON.stringify([url, [...new Headers(init.headers).entries()]])).digest('hex');
  const pending = pendingReads.get(key);
  if (pending) return pending as Promise<T>;
  if (pendingReads.size >= 40) throw new GoogleProviderError('RATE_LIMIT', 'Có nhiều tác vụ Google đang chờ. Hãy thử lại sau.');
  const work = executeJson<T>(url, init, retryReads).finally(() => pendingReads.delete(key));
  pendingReads.set(key, work);
  return work;
}

async function executeJson<T>(url: string, init: RequestInit, retryReads: boolean): Promise<T> {
  const attempts = retryReads ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await guardedFetch(url, init);
      if (!response.ok) {
        if (retryReads && (response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
          await waitBeforeRetry(attempt, response);
          continue;
        }
        // Report setup errors accurately without exposing Google's response or credentials.
        if (response.status === 403) {
          const details = await response.json().catch(() => null) as { error?: { details?: Array<{ reason?: string; metadata?: { service?: string } }> } } | null;
          if (details?.error?.details?.some(item => item.reason === 'SERVICE_DISABLED' && item.metadata?.service === 'sheets.googleapis.com'))
            throw new GoogleProviderError('PROVIDER', 'Google Sheets API chưa được bật trong dự án Google Cloud của CPMS. Quản trị viên cần bật API rồi đồng bộ lại.');
        }
        throw providerError(response.status, init.method?.toUpperCase() ?? 'GET');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new GoogleProviderError('LIMIT', 'Phản hồi Google Sheets vượt quá giới hạn 2 MB.');
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof GoogleProviderError) throw error;
      if (retryReads && attempt + 1 < attempts) {
        await waitBeforeRetry(attempt);
        continue;
      }
      throw new GoogleProviderError('NETWORK', 'Không thể kết nối Google API. Hãy kiểm tra mạng và thử lại.');
    }
  }
  throw new GoogleProviderError('NETWORK', 'Không thể kết nối Google API.');
}

async function guardedFetch(url: string, init: RequestInit, timeoutMs = 15_000, maxResponseBytes?: number): Promise<Response> {
  try { return await googleEgress.fetch(url, init, timeoutMs, maxResponseBytes); }
  catch (error) {
    if (error instanceof GoogleEgressLimitError) throw new GoogleProviderError('RATE_LIMIT', error.message);
    if (error instanceof GoogleEgressResponseLimitError) throw new GoogleProviderError('LIMIT', error.message);
    throw error;
  }
}

async function waitBeforeRetry(attempt: number, response?: Response) {
  const delay = googleRetryDelayMs(attempt, response);
  // Release unsuccessful response bodies before retrying so connections do not accumulate.
  await response?.body?.cancel();
  if (delay > 10_000) throw new GoogleProviderError('RATE_LIMIT', 'Google yêu cầu tạm nghỉ. Hãy thử lại sau.');
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function bearer(accessToken: string) { return { Authorization: `Bearer ${accessToken}` }; }

const DRIVE_ITEM_FIELDS = 'id,name,mimeType,driveId,parents,trashed,trashedTime,trashingUser(displayName),size,modifiedTime,webViewLink,webContentLink,appProperties,inheritedPermissionsDisabled,shortcutDetails(targetId,targetMimeType,targetResourceKey),lastModifyingUser(displayName),capabilities(canEdit,canTrash,canUntrash,canMoveItemWithinDrive,canDownload,canAddChildren,canShare,canDisableInheritedPermissions,canEnableInheritedPermissions)';

interface RawDriveItem {
  id?: string;
  name?: string;
  mimeType?: string;
  driveId?: string;
  parents?: string[];
  trashed?: boolean;
  trashedTime?: string;
  trashingUser?: { displayName?: string };
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string; targetResourceKey?: string };
  appProperties?: Record<string, string>;
  inheritedPermissionsDisabled?: boolean;
  lastModifyingUser?: { displayName?: string };
  capabilities?: Partial<CloudDriveItem['capabilities']>;
}

function toDriveItem(value: RawDriveItem): CloudDriveItem {
  if (!value.id || !value.name || !value.mimeType) throw new GoogleProviderError('PROVIDER', 'Google Drive không trả về đủ thông tin file.');
  const parsedSize = value.size && /^\d+$/.test(value.size) ? Number(value.size) : null;
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    driveId: value.driveId ?? null,
    parents: [...(value.parents ?? [])],
    trashed: Boolean(value.trashed),
    size: parsedSize !== null && Number.isSafeInteger(parsedSize) ? parsedSize : null,
    modifiedTime: value.modifiedTime ?? null,
    lastModifiedBy: value.lastModifyingUser?.displayName?.trim() || null,
    trashedTime: value.trashedTime ?? null,
    trashedBy: value.trashingUser?.displayName?.trim() || null,
    webViewLink: value.webViewLink ?? null,
    webContentLink: value.webContentLink ?? null,
    shortcutDetails: value.mimeType === 'application/vnd.google-apps.shortcut' && value.shortcutDetails?.targetId
      ? { targetId: value.shortcutDetails.targetId, targetMimeType: value.shortcutDetails.targetMimeType ?? null,
        targetResourceKey: value.shortcutDetails.targetResourceKey ?? null } : null,
    uploadId: value.appProperties?.cpmsUploadId ?? null,
    inheritedPermissionsDisabled: Boolean(value.inheritedPermissionsDisabled),
    capabilities: {
      canEdit: Boolean(value.capabilities?.canEdit),
      canTrash: Boolean(value.capabilities?.canTrash),
      canUntrash: Boolean(value.capabilities?.canUntrash),
      canMoveItemWithinDrive: Boolean(value.capabilities?.canMoveItemWithinDrive),
      canDownload: Boolean(value.capabilities?.canDownload),
      canAddChildren: Boolean(value.capabilities?.canAddChildren),
      canShare: Boolean(value.capabilities?.canShare),
      canDisableInheritedPermissions: Boolean(value.capabilities?.canDisableInheritedPermissions),
      canEnableInheritedPermissions: Boolean(value.capabilities?.canEnableInheritedPermissions),
    },
  };
}

function driveQueryLiteral(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

@Injectable()
export class GoogleApiAdapter implements UserOAuthPort, CloudSpreadsheetPort, CloudDrivePort, CloudManagedSpreadsheetPort {
  authorizationUrl(input: { clientId: string; callbackUrl: string; state: string; scopes: readonly string[] }) {
    const parameters = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.callbackUrl,
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: input.state,
      scope: input.scopes.join(' '),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`;
  }

  async exchangeCode(input: { clientId: string; clientSecret: string; callbackUrl: string; code: string }): Promise<OAuthTokenSet> {
    return this.tokenRequest(new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.callbackUrl,
    }));
  }

  async refresh(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<OAuthTokenSet> {
    return this.tokenRequest(new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
    }));
  }

  async identity(accessToken: string): Promise<OAuthIdentity> {
    const value = await requestJson<{ sub?: string; email?: string; name?: string }>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { method: 'GET', headers: bearer(accessToken) },
      true,
    );
    if (!value.sub || !value.email) throw new GoogleProviderError('PROVIDER', 'Google không trả về đủ thông tin tài khoản.');
    return { subject: value.sub, email: value.email, name: value.name?.trim() || null };
  }

  async revoke(token: string) {
    try {
      const response = await guardedFetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      }, 8_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async metadata(accessToken: string, spreadsheetId: string): Promise<CloudSpreadsheetMetadata> {
    const fields = 'spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))';
    const value = await requestJson<{
      spreadsheetId: string;
      properties?: { title?: string };
      sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
    }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=${encodeURIComponent(fields)}`, {
      method: 'GET', headers: bearer(accessToken),
    }, true);
    let canEdit: boolean | null = null;
    try {
      const drive = await requestJson<{ capabilities?: { canEdit?: boolean } }>(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?supportsAllDrives=true&fields=capabilities(canEdit)`,
        { method: 'GET', headers: bearer(accessToken) },
        true,
      );
      canEdit = typeof drive.capabilities?.canEdit === 'boolean' ? drive.capabilities.canEdit : null;
    } catch (error) {
      if (error instanceof GoogleProviderError && error.code === 'AUTH') throw error;
    }
    return {
      spreadsheetId: value.spreadsheetId,
      title: value.properties?.title?.trim() || 'Google Spreadsheet',
      canEdit,
      tabs: (value.sheets ?? []).flatMap((sheet) => {
        const properties = sheet.properties;
        return typeof properties?.sheetId === 'number' && properties.title
          ? [{ sheetId: properties.sheetId, title: properties.title, index: properties.index ?? 0, rowCount: properties.gridProperties?.rowCount ?? 0, columnCount: properties.gridProperties?.columnCount ?? 0 }]
          : [];
      }).sort((left, right) => left.index - right.index),
    };
  }

  async readTab(accessToken: string, spreadsheetId: string, tabTitle: string, options?: { purpose: 'AI_LIBRARY' }): Promise<TabularSheetData> {
    const metadata = await this.metadata(accessToken, spreadsheetId);
    const tab = metadata.tabs.find((candidate) => candidate.title === tabTitle);
    if (!tab) throw new GoogleProviderError('NOT_FOUND', 'Không tìm thấy tab nguồn đã chọn.');
    if (tab.rowCount > 50_000 || tab.columnCount > 200) throw new GoogleProviderError('LIMIT', 'Tab nguồn vượt giới hạn an toàn 50.000 dòng hoặc 200 cột.');
    if (options?.purpose === 'AI_LIBRARY') {
      // Read the entire allocated range, including blank gaps, with a bounded look-ahead.
      // A later nonempty row must never be silently dropped from the replacement index.
      if (tabTitle !== 'DriveIndex' || tab.rowCount > 10_002 || tab.columnCount !== 27)
        throw new GoogleProviderError('LIMIT', 'DriveIndex chỉ hỗ trợ tối đa 10.000 dòng dữ liệu và đúng 27 cột.');
      const rows: TabularSheetData['rows'] = [];
      let bytes = 0;
      for (let start = 1; start <= tab.rowCount; start += 500) {
        const end = Math.min(start + 499, tab.rowCount);
        const range = `'DriveIndex'!A${start}:AA${end}`;
        const page = await requestJson<{ values?: unknown[][] }>(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
          { method: 'GET', headers: bearer(accessToken) }, true,
        );
        const values = page.values ?? [];
        bytes += Buffer.byteLength(JSON.stringify(values), 'utf8');
        if (values.length > end - start + 1 || values.some(row => !Array.isArray(row) || row.length > 27) || bytes > 16_000_000)
          throw new GoogleProviderError('LIMIT', 'DriveIndex vượt giới hạn đồng bộ an toàn; chỉ mục cũ được giữ nguyên.');
        for (let offset = 0; offset <= end - start; offset++) {
          rows.push((values[offset] ?? []).map(cell => typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' || cell === null ? cell : String(cell)));
        }
      }
      while (rows.length && rows.at(-1)!.every(cell => !String(cell ?? '').trim())) rows.pop();
      if (rows.length > 10_001) throw new GoogleProviderError('LIMIT', 'DriveIndex vượt 10.000 dòng dữ liệu; chỉ mục cũ được giữ nguyên.');
      return { name: tabTitle, rows };
    }
    const quoted = `'${tabTitle.replaceAll("'", "''")}'!A1:CV${MAX_ROWS + 3}`;
    const value = await requestJson<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quoted)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      { method: 'GET', headers: bearer(accessToken) },
      true,
    );
    const rawRows = value.values ?? [];
    if (rawRows.length > MAX_ROWS + 2 || rawRows.some((row) => row.length > MAX_COLUMNS)) {
      throw new GoogleProviderError('LIMIT', `Tab nguồn chỉ được tối đa ${MAX_ROWS} dòng dữ liệu và ${MAX_COLUMNS} cột.`);
    }
    const rows = rawRows.map((row) => row.map((cell) => (
      typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' || cell === null ? cell : String(cell)
    )));
    return { name: tabTitle, rows };
  }

  async createTab(input: { accessToken: string; spreadsheetId: string; title: string; rows: TabularSheetData['rows'] }): Promise<CloudSpreadsheetResultTab> {
    const metadata = await this.metadata(input.accessToken, input.spreadsheetId);
    if (metadata.canEdit === false) throw new GoogleProviderError('VIEW_ONLY', 'Tài khoản chỉ có quyền xem; cần quyền Editor để tạo tab kết quả.');
    let target = metadata.tabs.find((tab) => tab.title === input.title);
    if (!target) {
      const columnCount = Math.max(10, ...input.rows.map((row) => row.length));
      const response = await requestJson<{ replies?: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }> }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: input.title, gridProperties: { rowCount: Math.max(100, input.rows.length + 10), columnCount, frozenRowCount: 2 } } } }] }),
        },
      );
      const properties = response.replies?.[0]?.addSheet?.properties;
      if (typeof properties?.sheetId !== 'number') throw new GoogleProviderError('PROVIDER', 'Google không xác nhận tab kết quả vừa tạo.');
      target = { sheetId: properties.sheetId, title: properties.title ?? input.title, index: metadata.tabs.length, rowCount: input.rows.length, columnCount };
    }
    const range = `'${target.title.replaceAll("'", "''")}'!A1`;
    await requestJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: [{ range, majorDimension: 'ROWS', values: input.rows }] }),
      },
    );
    return { sheetId: target.sheetId, title: target.title };
  }

  async replaceManagedSpreadsheet(input: Parameters<CloudManagedSpreadsheetPort['replaceManagedSpreadsheet']>[0]): Promise<string> {
    const mimeType = GOOGLE_SHEET_MIME;
    const keyName = CAMPAIGN_EXPORT_PROPERTY;
    const fields = MANAGED_SHEET_FIELDS;
    const headers = { ...bearer(input.accessToken), 'Content-Type': 'application/json' };
    const drive = 'https://www.googleapis.com/drive/v3/files';
    if (!input.sheets.length || input.sheets.some(sheet => sheet.rows.some(row => row.some(cell => String(cell ?? '').length > 50_000)))) {
      throw new GoogleProviderError('LIMIT', 'Cần ít nhất một tab và mỗi ô Google Sheet chỉ được tối đa 50.000 ký tự.');
    }
    const packed = input.sheets.map(sheet => ({
      name: sheet.name,
      columnCount: Math.max(2, ...sheet.rows.map(row => row.length)),
      rows: sheet.rows.map(row => ({ values: row.map(cell => ({ userEnteredValue: { stringValue: String(cell ?? '') } })) })),
    }));
    if (Buffer.byteLength(JSON.stringify(packed)) > MAX_RESPONSE_BYTES) {
      throw new GoogleProviderError('LIMIT', 'Nội dung xuất Google Sheet vượt quá 2 MB.');
    }

    let file: ManagedSheetFile;
    if (input.spreadsheetId) {
      file = await this.managedSpreadsheet(input.accessToken, input.spreadsheetId);
    } else {
      // Recover the file after an interrupted creation or an uncommitted database write.
      const parameters = new URLSearchParams({
        q: `trashed = false and mimeType = '${mimeType}' and appProperties has { key='${keyName}' and value=${driveQueryLiteral(input.key)} }`,
        spaces: 'drive', corpora: 'user', fields: `nextPageToken,files(${fields})`, pageSize: '2',
      });
      const found = await requestJson<{ files?: ManagedSheetFile[]; nextPageToken?: string }>(`${drive}?${parameters}`, { method: 'GET', headers }, true);
      if (found.nextPageToken || (found.files?.length ?? 0) > 1) {
        throw new GoogleProviderError('PROVIDER', 'Tìm thấy nhiều bản xuất của chiến dịch. Quản trị viên cần kiểm tra trên Drive.');
      }
      file = found.files?.[0] ?? await requestJson<ManagedSheetFile>(`${drive}?fields=${encodeURIComponent(fields)}`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: input.title, mimeType, appProperties: { [keyName]: input.key } }),
      });
    }
    const spreadsheetId = this.requireManagedSpreadsheet(file, input.key);
    const metadata = await this.metadata(input.accessToken, spreadsheetId);
    const sheetIds = new Set(metadata.tabs.map(tab => tab.sheetId));
    let nextId = 1;
    const retainedIds = new Set<number>();
    const requests: object[] = [];
    for (const sheet of packed) {
      const existing = metadata.tabs.find(tab => tab.title === sheet.name);
      while (sheetIds.has(nextId)) nextId += 1;
      const sheetId = existing?.sheetId ?? nextId++;
      retainedIds.add(sheetId);
      const gridProperties = { rowCount: Math.max(2, sheet.rows.length), columnCount: sheet.columnCount, frozenRowCount: 1, frozenColumnCount: 0 };
      if (existing) {
        requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties },
          fields: 'gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } });
      } else {
        requests.push({ addSheet: { properties: { sheetId, title: sheet.name, gridProperties } } });
      }
      // A bounded range clears leftover cells when the new projection has fewer values.
      requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0,
        endRowIndex: gridProperties.rowCount, endColumnIndex: gridProperties.columnCount }, rows: sheet.rows, fields: 'userEnteredValue' } });
    }
    for (const tab of metadata.tabs) if (!retainedIds.has(tab.sheetId)) requests.push({ deleteSheet: { sheetId: tab.sheetId } });
    requests.push({ updateSpreadsheetProperties: { properties: { title: input.title }, fields: 'title' } });
    await requestJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST', headers, body: JSON.stringify({ requests }),
    });
    return spreadsheetId;
  }

  async grantSpreadsheetViewer(input: Parameters<CloudManagedSpreadsheetPort['grantSpreadsheetViewer']>[0]) {
    const file = await this.managedSpreadsheet(input.accessToken, input.spreadsheetId);
    const id = this.requireManagedSpreadsheet(file, input.key);
    const existing = await this.listPermissions(input.accessToken, id);
    if (existing.some(item => item.type === 'user' && item.emailAddress?.toLowerCase() === input.email.toLowerCase())) return;
    await this.createPermission({ accessToken: input.accessToken, fileId: id, type: 'user', role: 'reader', emailAddress: input.email });
  }

  private managedSpreadsheet(token: string, spreadsheetId: string) {
    return requestJson<ManagedSheetFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?supportsAllDrives=true&fields=${encodeURIComponent(MANAGED_SHEET_FIELDS)}`,
      { method: 'GET', headers: bearer(token) }, true);
  }

  private requireManagedSpreadsheet(file: ManagedSheetFile, key: string) {
    if (!file.id || file.trashed || file.mimeType !== GOOGLE_SHEET_MIME
      || file.appProperties?.[CAMPAIGN_EXPORT_PROPERTY] !== key || file.capabilities?.canEdit !== true) {
      throw new GoogleProviderError('VIEW_ONLY', 'Bản xuất Google Sheet đã bị xóa hoặc tài khoản dùng chung không còn quyền sửa.');
    }
    return file.id;
  }

  async getItem(accessToken: string, fileId: string, resourceKey?: string): Promise<CloudDriveItem> {
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      { method: 'GET', headers: { ...bearer(accessToken), ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {}) } },
      true,
    );
    return toDriveItem(value);
  }

  async findFolders(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; nameContains?: string; exactName?: string }): Promise<CloudDriveItem[]> {
    const parts = [
      `${driveQueryLiteral(input.parentFolderId)} in parents`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      'trashed = false',
    ];
    if (input.exactName) parts.push(`name = ${driveQueryLiteral(input.exactName)}`);
    else if (input.nameContains) parts.push(`name contains ${driveQueryLiteral(input.nameContains)}`);
    const parameters = new URLSearchParams({
      q: parts.join(' and '),
      corpora: 'drive',
      driveId: input.sharedDriveId,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      pageSize: '100',
      fields: `files(${DRIVE_ITEM_FIELDS})`,
    });
    const value = await requestJson<{ files?: RawDriveItem[] }>(
      `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
      { method: 'GET', headers: bearer(input.accessToken) },
      true,
    );
    return (value.files ?? []).map(toDriveItem);
  }

  async createFolder(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string }): Promise<CloudDriveItem> {
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      {
        method: 'POST',
        headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.name, mimeType: 'application/vnd.google-apps.folder', parents: [input.parentFolderId] }),
      },
    );
    const item = toDriveItem(value);
    if (item.driveId && item.driveId !== input.sharedDriveId) throw new GoogleProviderError('PROVIDER', 'Google tạo folder ngoài Shared Drive đã cấu hình.');
    return item;
  }

  async renameItem(input: { accessToken: string; fileId: string; name: string }): Promise<CloudDriveItem> {
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      { method: 'PATCH', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name }) },
    );
    return toDriveItem(value);
  }

  async setTrashed(input: { accessToken: string; fileId: string; trashed: boolean }): Promise<CloudDriveItem> {
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      { method: 'PATCH', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: input.trashed }) },
    );
    return toDriveItem(value);
  }

  async moveItem(input: { accessToken: string; fileId: string; fromParentIds: string[]; toParentId: string }): Promise<CloudDriveItem> {
    const parameters = new URLSearchParams({
      supportsAllDrives: 'true',
      addParents: input.toParentId,
      fields: DRIVE_ITEM_FIELDS,
    });
    const removableParents = input.fromParentIds.filter((parentId) => parentId !== input.toParentId);
    if (removableParents.length) parameters.set('removeParents', removableParents.join(','));
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?${parameters.toString()}`,
      { method: 'PATCH', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' }, body: '{}' },
    );
    return toDriveItem(value);
  }

  async listFiles(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; trashed: boolean; pageSize: number; pageToken?: string; orderBy?: string; uploadId?: string }): Promise<CloudDrivePage> {
    const parameters = new URLSearchParams({
      q: `${driveQueryLiteral(input.parentFolderId)} in parents and trashed = ${input.trashed ? 'true' : 'false'}${input.uploadId ? ` and appProperties has { key='cpmsUploadId' and value=${driveQueryLiteral(input.uploadId)} }` : ''}`,
      corpora: 'drive',
      driveId: input.sharedDriveId,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      pageSize: String(input.pageSize),
      orderBy: input.orderBy ?? 'folder,name_natural',
      fields: `nextPageToken,files(${DRIVE_ITEM_FIELDS})`,
    });
    if (input.pageToken) parameters.set('pageToken', input.pageToken);
    const readPage = () => requestJson<{ nextPageToken?: string; files?: RawDriveItem[] }>(
      `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
      { method: 'GET', headers: bearer(input.accessToken) },
      true,
    );
    let value: { nextPageToken?: string; files?: RawDriveItem[] };
    try {
      value = await readPage();
    } catch (error) {
      if (!(error instanceof GoogleProviderError) || error.code !== 'FORBIDDEN') throw error;
      // A link-shared folder can be readable without membership in the entire Shared Drive.
      // Keep the parent predicate, but search only files visible to this account.
      parameters.set('corpora', 'user');
      parameters.delete('driveId');
      value = await readPage();
    }
    return { items: (value.files ?? []).map(toDriveItem), nextPageToken: value.nextPageToken ?? null };
  }

  async downloadFile(input: { accessToken: string; fileId: string; maxBytes: number; exportMimeType?: string }): Promise<Uint8Array> {
    const url = input.exportMimeType
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/export?mimeType=${encodeURIComponent(input.exportMimeType)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media&supportsAllDrives=true`;
    const response = await guardedFetch(url, { method: 'GET', headers: bearer(input.accessToken) }, 60_000, input.maxBytes);
    if (!response.ok) throw providerError(response.status, 'GET');
    return new Uint8Array(await response.arrayBuffer());
  }

  async listPermissions(accessToken: string, fileId: string): Promise<CloudDrivePermission[]> {
    type RawPermission = { id?: string; type?: string; role?: string; emailAddress?: string; displayName?: string;
      allowFileDiscovery?: boolean; permissionDetails?: Array<{ inherited?: boolean; role?: string }> };
    const all: RawPermission[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const parameters = new URLSearchParams({ supportsAllDrives: 'true', pageSize: '100',
        fields: 'nextPageToken,permissions(id,type,role,emailAddress,displayName,allowFileDiscovery,permissionDetails(inherited,role))' });
      if (pageToken) parameters.set('pageToken', pageToken);
      const value = await requestJson<{ permissions?: RawPermission[]; nextPageToken?: string }>(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${parameters}`,
        { method: 'GET', headers: bearer(accessToken) }, true);
      all.push(...(value.permissions ?? []));
      pageToken = value.nextPageToken;
      if (!pageToken) break;
      if (page === 9) throw new GoogleProviderError('LIMIT', 'Danh sách chia sẻ quá dài; hãy quản lý quyền trên Google Drive.');
    }
    return all.flatMap((permission) => permission.id && permission.type && permission.role ? [{
      id: permission.id,
      type: permission.type,
      role: permission.role,
      emailAddress: permission.emailAddress ?? null,
      displayName: permission.displayName ?? null,
      allowFileDiscovery: typeof permission.allowFileDiscovery === 'boolean' ? permission.allowFileDiscovery : null,
      inherited: Boolean(permission.permissionDetails?.length && permission.permissionDetails.every((detail) => detail.inherited)),
      inheritedRole: permission.permissionDetails?.find((detail) => detail.inherited)?.role ??
        (permission.permissionDetails?.some((detail) => detail.inherited) ? permission.role : null),
      directRole: permission.permissionDetails?.length
        ? permission.permissionDetails.find((detail) => !detail.inherited)?.role ??
          (permission.permissionDetails.some((detail) => !detail.inherited) ? permission.role : null)
        : permission.role,
    }] : []);
  }

  async createLinkWriterPermission(accessToken: string, fileId: string): Promise<CloudDrivePermission> {
    const value = await requestJson<{ id?: string; type?: string; role?: string; allowFileDiscovery?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id,type,role,allowFileDiscovery`,
      {
        method: 'POST',
        headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'anyone', role: 'writer', allowFileDiscovery: false }),
      },
    );
    if (!value.id || !value.type || !value.role) throw new GoogleProviderError('PROVIDER', 'Google không xác nhận quyền link-writer vừa tạo.');
    return { id: value.id, type: value.type, role: value.role, emailAddress: null, displayName: null, allowFileDiscovery: value.allowFileDiscovery ?? null, inherited: false };
  }

  async createPermission(input: { accessToken: string; fileId: string; type: 'user' | 'anyone'; role: 'reader' | 'commenter' | 'writer'; emailAddress?: string }): Promise<CloudDrivePermission> {
    const value = await requestJson<{ id?: string; type?: string; role?: string; emailAddress?: string; displayName?: string; allowFileDiscovery?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id,type,role,emailAddress,displayName,allowFileDiscovery`,
      { method: 'POST', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: input.type, role: input.role, ...(input.type === 'user' ? { emailAddress: input.emailAddress } : { allowFileDiscovery: false }) }) },
    );
    if (!value.id || !value.type || !value.role) throw new GoogleProviderError('PROVIDER', 'Google chưa xác nhận quyền vừa tạo.');
    return { id: value.id, type: value.type, role: value.role, emailAddress: value.emailAddress ?? null,
      displayName: value.displayName ?? null, allowFileDiscovery: value.allowFileDiscovery ?? null, inherited: false };
  }

  async updatePermission(input: { accessToken: string; fileId: string; permissionId: string; role: 'reader' | 'commenter' | 'writer' }): Promise<CloudDrivePermission> {
    const value = await requestJson<{ id?: string; type?: string; role?: string; emailAddress?: string; displayName?: string; allowFileDiscovery?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions/${encodeURIComponent(input.permissionId)}?supportsAllDrives=true&fields=id,type,role,emailAddress,displayName,allowFileDiscovery`,
      { method: 'PATCH', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ role: input.role }) },
    );
    if (!value.id || !value.type || !value.role) throw new GoogleProviderError('PROVIDER', 'Google chưa xác nhận quyền vừa cập nhật.');
    return { id: value.id, type: value.type, role: value.role, emailAddress: value.emailAddress ?? null,
      displayName: value.displayName ?? null, allowFileDiscovery: value.allowFileDiscovery ?? null, inherited: false };
  }

  async deletePermission(input: { accessToken: string; fileId: string; permissionId: string }): Promise<void> {
    const response = await guardedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions/${encodeURIComponent(input.permissionId)}?supportsAllDrives=true`,
      { method: 'DELETE', headers: bearer(input.accessToken) });
    if (!response.ok) throw providerError(response.status, 'DELETE');
  }

  async setInheritedPermissionsDisabled(input: { accessToken: string; fileId: string; disabled: boolean }): Promise<CloudDriveItem> {
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      { method: 'PATCH', headers: { ...bearer(input.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ inheritedPermissionsDisabled: input.disabled }) },
    );
    return toDriveItem(value);
  }

  async upload(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string; mimeType: string; content: Uint8Array; resumableThresholdBytes: number; uploadId?: string }): Promise<CloudDriveUpload> {
    return input.content.byteLength >= input.resumableThresholdBytes ? this.resumableUpload(input) : this.multipartUpload(input);
  }

  private async multipartUpload(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string; mimeType: string; content: Uint8Array; uploadId?: string }): Promise<CloudDriveUpload> {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: input.name, parents: [input.parentFolderId],
      ...(input.uploadId ? { appProperties: { cpmsUploadId: input.uploadId } } : {}) })], { type: 'application/json; charset=UTF-8' }));
    form.append('file', new Blob([Buffer.from(input.content)], { type: input.mimeType }), input.name);
    const value = await requestJson<RawDriveItem>(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      { method: 'POST', headers: bearer(input.accessToken), body: form },
    );
    const item = toDriveItem(value);
    if (item.driveId && item.driveId !== input.sharedDriveId) throw new GoogleProviderError('PROVIDER', 'Google upload file ngoài Shared Drive đã cấu hình.');
    return { item, mode: 'MULTIPART' };
  }

  private async resumableUpload(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string; mimeType: string; content: Uint8Array; uploadId?: string }): Promise<CloudDriveUpload> {
    const start = await guardedFetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(DRIVE_ITEM_FIELDS)}`,
      {
        method: 'POST',
        headers: {
          ...bearer(input.accessToken),
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': input.mimeType,
          'X-Upload-Content-Length': String(input.content.byteLength),
        },
        body: JSON.stringify({ name: input.name, parents: [input.parentFolderId],
          ...(input.uploadId ? { appProperties: { cpmsUploadId: input.uploadId } } : {}) }),
      },
    );
    if (!start.ok) throw providerError(start.status, 'POST');
    const location = start.headers.get('location');
    if (!location?.startsWith('https://')) throw new GoogleProviderError('PROVIDER', 'Google không trả về resumable upload URL hợp lệ.');
    const chunkSize = 5 * 1024 * 1024;
    for (let offset = 0; offset < input.content.byteLength; offset += chunkSize) {
      const endExclusive = Math.min(input.content.byteLength, offset + chunkSize);
      const chunk = input.content.slice(offset, endExclusive);
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await guardedFetch(location, {
          method: 'PUT',
          headers: {
            ...bearer(input.accessToken),
            'Content-Type': input.mimeType,
            'Content-Length': String(chunk.byteLength),
            'Content-Range': `bytes ${offset}-${endExclusive - 1}/${input.content.byteLength}`,
          },
          body: chunk,
        }, 60_000);
        if (response.status === 308 || response.ok) break;
        if (!(response.status === 429 || response.status >= 500) || attempt === 2) throw providerError(response.status, 'PUT');
        await waitBeforeRetry(attempt, response);
      }
      if (!response) throw new GoogleProviderError('NETWORK', 'Không thể upload file lên Google Drive.');
      if (response.ok) {
        const item = toDriveItem(await response.json() as RawDriveItem);
        if (item.driveId && item.driveId !== input.sharedDriveId) throw new GoogleProviderError('PROVIDER', 'Google upload file ngoài Shared Drive đã cấu hình.');
        return { item, mode: 'RESUMABLE' };
      }
    }
    throw new GoogleProviderError('PROVIDER', 'Google không xác nhận resumable upload đã hoàn tất.');
  }

  private async tokenRequest(body: URLSearchParams): Promise<OAuthTokenSet> {
    const value = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      'https://oauth2.googleapis.com/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    );
    if (!value.access_token) throw new GoogleProviderError('AUTH', 'Google không cấp access token. Hãy kết nối lại.');
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token ?? null,
      expiresAt: typeof value.expires_in === 'number' ? new Date(Date.now() + value.expires_in * 1_000).toISOString() : null,
      grantedScopes: value.scope?.split(' ').filter(Boolean) ?? [],
    };
  }
}
