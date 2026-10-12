import {
  GOOGLE_SHEETS_OAUTH_SCOPES,
  parseGoogleSpreadsheetUrl,
  type ActorContext,
  type CampaignSpreadsheetCompareRequest,
  type CampaignSpreadsheetComparisonResult,
  type GoogleIntegrationStatus,
  type GoogleSheetImportRequest,
  type GoogleSheetPreviewResponse,
  type GoogleSheetResultTab,
  type GoogleSheetResultTabRequest,
  type GoogleSheetSourceRequest,
  type GoogleSpreadsheetMetadata,
} from '@cpms/domain';
import {
  CLOUD_SPREADSHEET_PORT,
  USER_OAUTH_PORT,
  type CloudSpreadsheetMetadata,
  type CloudSpreadsheetPort,
  type OAuthTokenSet,
  type TabularWorkbookData,
  type UserOAuthPort,
} from '@cpms/integrations';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Environment } from '../../../config/environment';
import { CampaignSpreadsheetApplicationService } from '../../campaign/application/campaign-spreadsheet.application-service';
import { GoogleProviderError } from '../infrastructure/google-api.adapter';
import { GOOGLE_INTEGRATION_REPOSITORY, type GoogleIntegrationRepository, type StoredDriveIntegrationConnection, type StoredGoogleConnection } from './google-integration.repository';

interface GoogleConfiguration {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  callbackUrl: string;
}

type StoredTokens = OAuthTokenSet;

function dateInput(value?: string) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())) throw new BadRequestException('Khoảng thời gian phải dùng định dạng YYYY-MM-DD.');
  return value;
}

@Injectable()
export class GoogleIntegrationApplicationService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(USER_OAUTH_PORT) private readonly oauth: UserOAuthPort,
    @Inject(CLOUD_SPREADSHEET_PORT) private readonly sheets: CloudSpreadsheetPort,
    @Inject(GOOGLE_INTEGRATION_REPOSITORY) private readonly repository: GoogleIntegrationRepository,
    @Inject(CampaignSpreadsheetApplicationService) private readonly spreadsheets: CampaignSpreadsheetApplicationService,
  ) {}

  async status(actor: ActorContext): Promise<GoogleIntegrationStatus> {
    const configured = this.configuration();
    if (!configured) return { configured: false, connected: false, callbackUrl: this.config.get('GOOGLE_OAUTH_CALLBACK_URL', { infer: true }) ?? 'http://localhost:3000/api/integrations/google/callback', account: null, grantedScopes: [], message: 'Google chưa được cấu hình.' };
    const connection = await this.repository.getConnection(actor.id);
    return {
      configured: true,
      connected: Boolean(connection),
      callbackUrl: configured.callbackUrl,
      account: connection ? { subject: connection.providerAccountId, email: connection.accountEmail, name: connection.accountName } : null,
      grantedScopes: connection ? [...connection.grantedScopes] : [],
      message: connection ? null : 'Chưa kết nối tài khoản Google.',
    };
  }

  async driveStatus() {
    const configured = this.configuration();
    const expectedEmail = this.config.get('GOOGLE_DRIVE_INTEGRATION_EMAIL', { infer: true })?.toLowerCase();
    if (!configured || !expectedEmail) return { configured: false, connected: false, account: null, grantedScopes: [],
      message: 'Chưa cấu hình kết nối Google Drive dùng chung.' };
    const connection = await this.repository.getDriveConnection();
    const connected = Boolean(connection && connection.accountEmail.toLowerCase() === expectedEmail &&
      connection.grantedScopes.includes('https://www.googleapis.com/auth/drive'));
    return { configured: true, connected, account: connected && connection ? { email: connection.accountEmail, name: connection.accountName } : null,
      grantedScopes: connected && connection ? [...connection.grantedScopes] : [],
      message: connected ? null : 'Tài khoản Google Drive dùng chung chưa kết nối hoặc cần cấp lại quyền.' };
  }

  async beginDriveConnection(actor: ActorContext) {
    const configured = this.requireConfiguration();
    if (!this.config.get('GOOGLE_DRIVE_INTEGRATION_EMAIL', { infer: true })) throw new ServiceUnavailableException('Chưa cấu hình email tài khoản Google Drive dùng chung.');
    const state = Buffer.from(JSON.stringify({ nonce: randomBytes(32).toString('base64url'), purpose: 'CAMPAIGN_DRIVE',
      sessionBinding: actor.session ? createHash('sha256').update(actor.session.id).digest('hex') : null })).toString('base64url');
    await this.repository.createOAuthState(createHash('sha256').update(state).digest('hex'), actor.id, new Date(Date.now() + 10 * 60_000));
    return { authorizationUrl: this.oauth.authorizationUrl({ clientId: configured.clientId, callbackUrl: configured.callbackUrl, state,
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive'] }) };
  }

  async beginConnection(actor: ActorContext, returnTo?: string) {
    const configured = this.requireConfiguration();
    const state = Buffer.from(JSON.stringify({
      nonce: randomBytes(32).toString('base64url'),
      sessionBinding: actor.session ? createHash('sha256').update(actor.session.id).digest('hex') : null,
      returnTo: this.safeReturnPath(returnTo),
    })).toString('base64url');
    const stateHash = createHash('sha256').update(state).digest('hex');
    await this.repository.createOAuthState(stateHash, actor.id, new Date(Date.now() + 10 * 60_000));
    return { authorizationUrl: this.oauth.authorizationUrl({ clientId: configured.clientId, callbackUrl: configured.callbackUrl, state, scopes: GOOGLE_SHEETS_OAUTH_SCOPES }) };
  }

  async completeConnection(actor: ActorContext, code: string | undefined, state: string | undefined, oauthError?: string) {
    const configured = this.requireConfiguration();
    let purpose: unknown;
    try { purpose = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf8')).purpose; } catch { /* The one-time state validation below rejects malformed input. */ }
    if (purpose !== undefined && purpose !== 'CAMPAIGN_DRIVE') throw new BadRequestException('Mục đích kết nối Google không hợp lệ.');
    if (actor.session) {
      let sessionBinding: unknown;
      try { sessionBinding = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf8')).sessionBinding; } catch { /* Invalid states are rejected below. */ }
      if (sessionBinding !== createHash('sha256').update(actor.session.id).digest('hex')) throw new BadRequestException('OAuth state không thuộc phiên đăng nhập hiện hành.');
    }
    if (!state || !await this.repository.consumeOAuthState(createHash('sha256').update(state).digest('hex'), actor.id, new Date())) {
      throw new BadRequestException('OAuth state không hợp lệ hoặc đã hết hạn. Hãy kết nối lại từ CPMS.');
    }
    if (oauthError) throw new BadRequestException(oauthError === 'access_denied' ? 'Người dùng đã từ chối cấp quyền Google.' : 'Google OAuth không hoàn tất.');
    if (!code) throw new BadRequestException('Google OAuth không trả về authorization code.');
    const exchanged = await this.oauth.exchangeCode({ clientId: configured.clientId, clientSecret: configured.clientSecret, callbackUrl: configured.callbackUrl, code });
    const identity = await this.oauth.identity(exchanged.accessToken);
    if (purpose === 'CAMPAIGN_DRIVE') {
      const expectedEmail = this.config.get('GOOGLE_DRIVE_INTEGRATION_EMAIL', { infer: true })?.toLowerCase();
      if (!expectedEmail || identity.email.toLowerCase() !== expectedEmail) throw new ForbiddenException('Chỉ tài khoản Google Drive dùng chung đã cấu hình mới được kết nối.');
      const existingDrive = await this.repository.getDriveConnection();
      const driveTokens: StoredTokens = { ...exchanged,
        refreshToken: exchanged.refreshToken ?? (existingDrive?.providerAccountId === identity.subject
          ? this.decryptTokens(existingDrive.encryptedTokens, configured.encryptionKey).refreshToken : null),
        grantedScopes: exchanged.grantedScopes };
      if (!driveTokens.refreshToken || !driveTokens.grantedScopes.includes('https://www.googleapis.com/auth/drive'))
        throw new BadRequestException('Google chưa cấp đủ quyền Drive và refresh token. Hãy kết nối lại.');
      await this.repository.saveDriveConnectionWithAudit({ key: 'campaign-drive', connectedByActorId: actor.id,
        providerAccountId: identity.subject, accountEmail: identity.email, accountName: identity.name,
        encryptedTokens: this.encryptTokens(driveTokens, configured.encryptionKey), grantedScopes: driveTokens.grantedScopes,
        accessTokenExpiresAt: driveTokens.expiresAt ? new Date(driveTokens.expiresAt) : null }, actor);
      return { account: identity, returnTo: '/admin/system?section=DRIVE' };
    }
    const existing = await this.repository.getConnection(actor.id);
    const tokens: StoredTokens = {
      ...exchanged,
      refreshToken: exchanged.refreshToken ?? (existing?.providerAccountId === identity.subject ? this.decryptTokens(existing.encryptedTokens, configured.encryptionKey).refreshToken : null),
      grantedScopes: exchanged.grantedScopes.length ? exchanged.grantedScopes : [...GOOGLE_SHEETS_OAUTH_SCOPES],
    };
    if (!tokens.refreshToken) throw new BadRequestException('Google không cấp refresh token. Hãy ngắt quyền ứng dụng trong tài khoản Google rồi kết nối lại.');
    await this.repository.saveConnectionWithAudit({
      actorId: actor.id,
      providerAccountId: identity.subject,
      accountEmail: identity.email,
      accountName: identity.name,
      encryptedTokens: this.encryptTokens(tokens, configured.encryptionKey),
      grantedScopes: tokens.grantedScopes,
      accessTokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    }, actor);
    return { account: identity, returnTo: this.returnPathFromState(state) };
  }

  async disconnect(actor: ActorContext) {
    const configured = this.configuration();
    const connection = await this.repository.getConnection(actor.id);
    let revoked = false;
    if (configured && connection) {
      const tokens = this.decryptTokens(connection.encryptedTokens, configured.encryptionKey);
      revoked = await this.oauth.revoke(tokens.refreshToken ?? tokens.accessToken);
    }
    await this.repository.deleteConnectionWithAudit(actor, { accountEmail: connection?.accountEmail ?? null, revoked });
    return { disconnected: true, revoked };
  }

  async disconnectDriveConnection(actor: ActorContext) {
    const connection = await this.repository.getDriveConnection();
    const configured = this.configuration();
    let revoked = false;
    if (connection && configured) {
      const tokens = this.decryptTokens(connection.encryptedTokens, configured.encryptionKey);
      revoked = await this.oauth.revoke(tokens.accessToken).then(() => true).catch(() => false);
    }
    await this.repository.deleteDriveConnectionWithAudit(actor, { accountEmail: connection?.accountEmail ?? null, revoked });
    return { disconnected: true, revoked };
  }

  async inspect(actor: ActorContext, spreadsheetUrl: string) {
    const reference = this.requireReference(spreadsheetUrl);
    const metadata = await this.withAccessToken(actor, (accessToken) => this.sheets.metadata(accessToken, reference.spreadsheetId));
    return this.toMetadata(metadata, reference.canonicalUrl);
  }

  async preview(actor: ActorContext, request: GoogleSheetSourceRequest): Promise<GoogleSheetPreviewResponse> {
    const source = await this.loadSource(actor, request.spreadsheetUrl, request.sheetName);
    const preview = await this.spreadsheets.previewWorkbook(source.workbook, request);
    return { spreadsheet: source.metadata, preview, sampleRows: source.workbook.sheets[0]?.rows.slice(0, 12) ?? [] };
  }

  async import(actor: ActorContext, request: GoogleSheetImportRequest) {
    const source = await this.loadSource(actor, request.spreadsheetUrl, request.sheetName);
    const result = await this.spreadsheets.importWorkbook(source.workbook, request, actor, 'GOOGLE_SHEETS');
    await this.repository.recordAudit(actor, 'google.sheet_imported', source.metadata.spreadsheetId, {
      spreadsheetId: source.metadata.spreadsheetId,
      sheetName: request.sheetName,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    });
    return result;
  }

  async compare(actor: ActorContext, request: CampaignSpreadsheetCompareRequest): Promise<CampaignSpreadsheetComparisonResult> {
    this.validateDateRange(request);
    const source = await this.loadSource(actor, request.spreadsheetUrl, request.sheetName);
    const comparison = await this.spreadsheets.compareWorkbook(source.workbook, request);
    return { spreadsheet: source.metadata, ...comparison };
  }

  async createDiffTab(actor: ActorContext, request: GoogleSheetResultTabRequest): Promise<GoogleSheetResultTab> {
    const comparison = await this.compare(actor, request);
    const rows = [
      ['Trạng thái', 'Mã chiến dịch', 'Tên chiến dịch', 'Dòng nguồn', 'Field key', 'Nhãn trường', 'Google Sheets', 'CPMS', 'Ghi chú'],
      ...comparison.rows.flatMap((row) => row.fields.map((field) => [row.status, row.code, row.name, row.sourceRowNumber, field.fieldKey, field.label, field.sheetValue, field.cpmsValue, field.note ?? row.errors.join(' ')])),
    ];
    return this.createResultTab(actor, request, comparison.spreadsheet, 'DIFF', rows);
  }

  async createSyncTab(actor: ActorContext, request: GoogleSheetResultTabRequest): Promise<GoogleSheetResultTab> {
    const comparison = await this.compare(actor, request);
    const campaignIds = [...new Set(comparison.rows.flatMap((row) => row.campaignId ? [row.campaignId] : []))];
    if (!campaignIds.length) throw new BadRequestException('Không có chiến dịch CPMS trong phạm vi đã chọn để tạo tab đồng bộ.');
    const exported = await this.spreadsheets.exportWorkbook({
      mode: 'DATA', recordScope: 'SELECTED', campaignIds, fieldScope: 'CUSTOM', fieldKeys: comparison.selectedFieldKeys, includeLegacyReadOnly: false,
    });
    const rows = exported.workbook.sheets.find((sheet) => sheet.name === 'Campaigns')?.rows ?? [];
    return this.createResultTab(actor, request, comparison.spreadsheet, 'SYNC', rows);
  }

  protected async createResultTab(
    actor: ActorContext,
    request: GoogleSheetResultTabRequest,
    metadata: GoogleSpreadsheetMetadata,
    kind: 'DIFF' | 'SYNC',
    rows: Array<Array<string | number | boolean | null>>,
  ): Promise<GoogleSheetResultTab> {
    if (metadata.canEdit === false) throw new BadRequestException('Tài khoản chỉ có quyền xem; cần quyền Editor để tạo tab kết quả.');
    const existing = await this.repository.findOperation(actor.id, request.idempotencyKey);
    if (existing && (existing.kind !== kind || existing.spreadsheetId !== metadata.spreadsheetId)) throw new BadRequestException('Idempotency key đã được dùng cho thao tác khác.');
    if (existing?.status === 'COMPLETED' && existing.targetSheetId && existing.targetSheetName && existing.resultUrl) {
      return { spreadsheetId: existing.spreadsheetId, sheetId: Number(existing.targetSheetId), sheetName: existing.targetSheetName, url: existing.resultUrl, reused: true };
    }
    const sourceTab = metadata.tabs.find((tab) => tab.title === request.sheetName);
    if (!sourceTab) throw new BadRequestException('Không tìm thấy tab nguồn đã chọn.');
    const targetName = existing?.targetSheetName ?? this.resultTabName(kind, metadata, request.idempotencyKey);
    const operation = existing ?? await this.repository.startOperation({
      actorId: actor.id,
      idempotencyKey: request.idempotencyKey,
      kind,
      spreadsheetId: metadata.spreadsheetId,
      sourceSheetId: String(sourceTab.sheetId),
      targetSheetName: targetName,
    });
    const created = await this.withAccessToken(actor, (accessToken) => this.sheets.createTab({ accessToken, spreadsheetId: metadata.spreadsheetId, title: targetName, rows }));
    const url = `https://docs.google.com/spreadsheets/d/${metadata.spreadsheetId}/edit#gid=${created.sheetId}`;
    await this.repository.completeOperationWithAudit({
      operationId: operation.id,
      targetSheetId: String(created.sheetId),
      targetSheetName: created.title,
      resultUrl: url,
      actor,
      auditAction: kind === 'DIFF' ? 'google.diff_tab_created' : 'google.sync_tab_created',
      metadata: { spreadsheetId: metadata.spreadsheetId, sourceSheetId: sourceTab.sheetId, targetSheetId: created.sheetId, targetSheetName: created.title, rowCount: rows.length, idempotencyKey: request.idempotencyKey },
    });
    return { spreadsheetId: metadata.spreadsheetId, sheetId: created.sheetId, sheetName: created.title, url, reused: Boolean(existing) };
  }

  protected async loadSource(actor: ActorContext, spreadsheetUrl: string, sheetName: string) {
    const reference = this.requireReference(spreadsheetUrl);
    if (!sheetName.trim()) throw new BadRequestException('Hãy chọn tab nguồn.');
    return this.withAccessToken(actor, async (accessToken) => {
      const remoteMetadata = await this.sheets.metadata(accessToken, reference.spreadsheetId);
      const sheet = await this.sheets.readTab(accessToken, reference.spreadsheetId, sheetName);
      const workbook: TabularWorkbookData = { sheets: [sheet] };
      return { metadata: this.toMetadata(remoteMetadata, reference.canonicalUrl), workbook };
    });
  }

  private requireReference(value: string) {
    const reference = parseGoogleSpreadsheetUrl(value);
    if (!reference) throw new BadRequestException('URL Google Sheets không hợp lệ. Chỉ chấp nhận https://docs.google.com/spreadsheets/d/...');
    return reference;
  }

  private toMetadata(metadata: CloudSpreadsheetMetadata, canonicalUrl: string): GoogleSpreadsheetMetadata {
    return { ...metadata, canonicalUrl, tabs: metadata.tabs.map((tab) => ({ ...tab })) };
  }

  private validateDateRange(request: Pick<CampaignSpreadsheetCompareRequest, 'dateFrom' | 'dateTo'>) {
    const from = dateInput(request.dateFrom);
    const to = dateInput(request.dateTo);
    if (from && to && from > to) throw new BadRequestException('Ngày bắt đầu đối chiếu không được sau ngày kết thúc.');
  }

  private resultTabName(kind: 'DIFF' | 'SYNC', metadata: GoogleSpreadsheetMetadata, idempotencyKey: string) {
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(/[-: ]/g, '');
    const base = `CPMS_${kind}_${stamp}`;
    if (!metadata.tabs.some((tab) => tab.title === base)) return base;
    return `${base}_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 6)}`;
  }

  async withAccessToken<T>(actor: ActorContext, operation: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      const configured = this.requireConfiguration();
      const connection = await this.repository.getConnection(actor.id);
      if (!connection) throw new UnauthorizedException('Chưa kết nối tài khoản Google.');
      let tokens = this.decryptTokens(connection.encryptedTokens, configured.encryptionKey);
      if (tokens.expiresAt && new Date(tokens.expiresAt).valueOf() <= Date.now() + 30_000) tokens = await this.refreshTokens(connection, tokens, configured);
      try {
        return await operation(tokens.accessToken);
      } catch (error) {
        if (!(error instanceof GoogleProviderError) || error.code !== 'AUTH' || !tokens.refreshToken) throw error;
        tokens = await this.refreshTokens(connection, tokens, configured);
        return operation(tokens.accessToken);
      }
    } catch (error) {
      if (!(error instanceof GoogleProviderError)) throw error;
      if (error.code === 'AUTH') throw new UnauthorizedException(error.message);
      if (error.code === 'FORBIDDEN') throw new ForbiddenException(error.message);
      if (error.code === 'NOT_FOUND') throw new NotFoundException(error.message);
      if (error.code === 'VIEW_ONLY') throw new ForbiddenException(error.message);
      if (error.code === 'LIMIT') throw new BadRequestException(error.message);
      if (error.code === 'RATE_LIMIT') throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      throw new ServiceUnavailableException(error.message);
    }
  }

  async withDriveAccessToken<T>(_actor: ActorContext, operation: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      const configured = this.requireConfiguration();
      const expectedEmail = this.config.get('GOOGLE_DRIVE_INTEGRATION_EMAIL', { infer: true })?.toLowerCase();
      const connection = await this.repository.getDriveConnection();
      if (!expectedEmail || !connection || connection.accountEmail.toLowerCase() !== expectedEmail ||
        !connection.grantedScopes.includes('https://www.googleapis.com/auth/drive'))
        throw new UnauthorizedException('Tài khoản Google Drive dùng chung chưa kết nối đúng quyền.');
      let tokens = this.decryptTokens(connection.encryptedTokens, configured.encryptionKey);
      if (tokens.expiresAt && new Date(tokens.expiresAt).valueOf() <= Date.now() + 30_000)
        tokens = await this.refreshDriveTokens(connection, tokens, configured);
      try { return await operation(tokens.accessToken); }
      catch (error) {
        if (!(error instanceof GoogleProviderError) || error.code !== 'AUTH' || !tokens.refreshToken) throw error;
        tokens = await this.refreshDriveTokens(connection, tokens, configured);
        return operation(tokens.accessToken);
      }
    } catch (error) {
      if (!(error instanceof GoogleProviderError)) throw error;
      if (error.code === 'AUTH') throw new UnauthorizedException(error.message);
      if (error.code === 'FORBIDDEN' || error.code === 'VIEW_ONLY') throw new ForbiddenException(error.message);
      if (error.code === 'NOT_FOUND') throw new NotFoundException(error.message);
      if (error.code === 'LIMIT') throw new BadRequestException(error.message);
      if (error.code === 'RATE_LIMIT') throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      throw new ServiceUnavailableException(error.message);
    }
  }

  private async refreshDriveTokens(connection: StoredDriveIntegrationConnection, current: StoredTokens, configured: GoogleConfiguration) {
    if (!current.refreshToken) throw new UnauthorizedException('Kết nối Google Drive dùng chung cần được cấp lại quyền.');
    const refreshed = await this.oauth.refresh({ clientId: configured.clientId, clientSecret: configured.clientSecret, refreshToken: current.refreshToken });
    const tokens: StoredTokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? current.refreshToken,
      grantedScopes: refreshed.grantedScopes.length ? refreshed.grantedScopes : current.grantedScopes };
    await this.repository.updateDriveEncryptedTokens(this.encryptTokens(tokens, configured.encryptionKey),
      tokens.expiresAt ? new Date(tokens.expiresAt) : null, tokens.grantedScopes);
    return tokens;
  }

  private async refreshTokens(connection: StoredGoogleConnection, current: StoredTokens, configured: GoogleConfiguration) {
    if (!current.refreshToken) throw new UnauthorizedException('Phiên Google không còn refresh token. Hãy kết nối lại.');
    const refreshed = await this.oauth.refresh({ clientId: configured.clientId, clientSecret: configured.clientSecret, refreshToken: current.refreshToken });
    const tokens: StoredTokens = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? current.refreshToken,
      grantedScopes: refreshed.grantedScopes.length ? refreshed.grantedScopes : current.grantedScopes,
    };
    await this.repository.updateEncryptedTokens(connection.actorId, this.encryptTokens(tokens, configured.encryptionKey), tokens.expiresAt ? new Date(tokens.expiresAt) : null, tokens.grantedScopes);
    return tokens;
  }

  private configuration(): GoogleConfiguration | null {
    const clientId = this.config.get('GOOGLE_OAUTH_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GOOGLE_OAUTH_CLIENT_SECRET', { infer: true });
    const keyText = this.config.get('GOOGLE_OAUTH_ENCRYPTION_KEY', { infer: true });
    const callbackUrl = this.config.get('GOOGLE_OAUTH_CALLBACK_URL', { infer: true });
    if (!clientId || !clientSecret || !keyText || !callbackUrl) return null;
    const encryptionKey = /^[a-fA-F0-9]{64}$/.test(keyText) ? Buffer.from(keyText, 'hex') : Buffer.from(keyText, 'base64');
    return encryptionKey.length === 32 ? { clientId, clientSecret, encryptionKey, callbackUrl } : null;
  }

  private requireConfiguration() {
    const configured = this.configuration();
    if (!configured) throw new ServiceUnavailableException('Google chưa được cấu hình. Hãy thiết lập biến môi trường OAuth phía server.');
    return configured;
  }

  private safeReturnPath(value?: string) {
    if (!value) return '/campaigns';
    const candidate = value.trim();
    const hasUnsafeCharacter = [...candidate].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || character === '\\';
    });
    if (candidate.length > 500 || !candidate.startsWith('/campaigns') || candidate.startsWith('//') || hasUnsafeCharacter) return '/campaigns';
    try {
      const parsed = new URL(candidate, 'http://cpms.local');
      return parsed.origin === 'http://cpms.local' && parsed.pathname.startsWith('/campaigns')
        ? `${parsed.pathname}${parsed.search}`
        : '/campaigns';
    } catch {
      return '/campaigns';
    }
  }

  private returnPathFromState(state: string) {
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { returnTo?: unknown };
      return this.safeReturnPath(typeof parsed.returnTo === 'string' ? parsed.returnTo : undefined);
    } catch {
      return '/campaigns';
    }
  }

  private encryptTokens(tokens: StoredTokens, key: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  private decryptTokens(value: string, key: Buffer): StoredTokens {
    const [version, ivText, tagText, encryptedText] = value.split('.');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new UnauthorizedException('Dữ liệu kết nối Google không hợp lệ. Hãy kết nối lại.');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')) as StoredTokens;
    } catch {
      throw new UnauthorizedException('Không thể giải mã kết nối Google. Hãy kết nối lại.');
    }
  }
}
