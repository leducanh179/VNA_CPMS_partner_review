import {
  DEMO_ACTOR,
  type ActorContext,
  type CampaignSpreadsheetComparisonResult,
  type CampaignSpreadsheetPreviewResult,
} from '@cpms/domain';
import type { CloudSpreadsheetPort, OAuthTokenSet, TabularSheetData, UserOAuthPort } from '@cpms/integrations';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../../config/environment';
import type { CampaignSpreadsheetApplicationService } from '../../campaign/application/campaign-spreadsheet.application-service';
import { GoogleIntegrationApplicationService } from './google-integration.application-service';
import type { GoogleIntegrationRepository, SpreadsheetOperationRecord, StoredDriveIntegrationConnection, StoredGoogleConnection } from './google-integration.repository';

const spreadsheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;

class FakeConfig {
  values: Partial<Environment> = {
    WEB_ORIGIN: 'http://localhost:5173',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_OAUTH_ENCRYPTION_KEY: '11'.repeat(32),
    GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3000/api/integrations/google/callback',
    GOOGLE_DRIVE_INTEGRATION_EMAIL: 'integration@example.test',
  };
  get(key: keyof Environment) { return this.values[key]; }
}

class FakeOAuth implements UserOAuthPort {
  refreshCount = 0;
  revoked = false;
  authorizationScopes: readonly string[] = [];
  identityEmail = 'demo@example.com';
  grantedScopes = ['openid', 'email'];
  authorizationUrl(input: { state: string; scopes: readonly string[] }) { this.authorizationScopes = input.scopes; return `https://accounts.google.com/o/oauth2/v2/auth?state=${input.state}`; }
  async exchangeCode(): Promise<OAuthTokenSet> { return { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: new Date(0).toISOString(), grantedScopes: this.grantedScopes }; }
  async refresh(): Promise<OAuthTokenSet> { this.refreshCount += 1; return { accessToken: 'refreshed-secret', refreshToken: null, expiresAt: new Date(Date.now() + 60_000).toISOString(), grantedScopes: [] }; }
  async identity() { return { subject: 'google-subject', email: this.identityEmail, name: 'Demo Google' }; }
  async revoke() { this.revoked = true; return true; }
}

class FakeSheets implements CloudSpreadsheetPort {
  canEdit: boolean | null = true;
  created: Array<{ title: string; rows: TabularSheetData['rows'] }> = [];
  source: TabularSheetData = { name: 'Nguồn', rows: [['Mã', 'Tên'], ['campaign_code', 'campaign_name'], ['CPG-01', 'Tên nguồn']] };
  async metadata() { return { spreadsheetId, title: 'Spreadsheet test', canEdit: this.canEdit, tabs: [{ sheetId: 0, title: 'Nguồn', index: 0, rowCount: 3, columnCount: 2 }] }; }
  async readTab() { return structuredClone(this.source); }
  async createTab(input: { title: string; rows: TabularSheetData['rows'] }) {
    const existing = this.created.find((item) => item.title === input.title);
    if (!existing) this.created.push({ title: input.title, rows: structuredClone(input.rows) });
    return { sheetId: 100 + Math.max(0, this.created.findIndex((item) => item.title === input.title)), title: input.title };
  }
}

class FakeRepository implements GoogleIntegrationRepository {
  connection: StoredGoogleConnection | null = null;
  driveConnection: StoredDriveIntegrationConnection | null = null;
  states = new Map<string, { actorId: string; expiresAt: Date }>();
  audits: Array<{ action: string; actorId: string; metadata: Record<string, unknown> }> = [];
  operations = new Map<string, SpreadsheetOperationRecord>();
  async getConnection() { return this.connection; }
  async getDriveConnection() { return this.driveConnection; }
  async saveDriveConnectionWithAudit(input: StoredDriveIntegrationConnection, actor: ActorContext) { this.driveConnection = input; this.audits.push({ action: 'google.drive_integration_connected', actorId: actor.id, metadata: { email: input.accountEmail } }); }
  async updateDriveEncryptedTokens(encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]) { if (this.driveConnection) this.driveConnection = { ...this.driveConnection, encryptedTokens, accessTokenExpiresAt: expiresAt, grantedScopes }; }
  async deleteDriveConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>) { this.driveConnection = null; this.audits.push({ action: 'google.drive_integration_disconnected', actorId: actor.id, metadata }); }
  async saveConnectionWithAudit(input: StoredGoogleConnection, actor: ActorContext) { this.connection = input; this.audits.push({ action: 'google.connected', actorId: actor.id, metadata: { email: input.accountEmail } }); }
  async updateEncryptedTokens(_actorId: string, encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]) { if (this.connection) this.connection = { ...this.connection, encryptedTokens, accessTokenExpiresAt: expiresAt, grantedScopes }; }
  async deleteConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>) { this.connection = null; this.audits.push({ action: 'google.disconnected', actorId: actor.id, metadata }); }
  async createOAuthState(stateHash: string, actorId: string, expiresAt: Date) { this.states.set(stateHash, { actorId, expiresAt }); }
  async consumeOAuthState(stateHash: string, actorId: string, now: Date) { const state = this.states.get(stateHash); if (!state || state.actorId !== actorId || state.expiresAt <= now) return false; this.states.delete(stateHash); return true; }
  async recordAudit(actor: ActorContext, action: string, _entityId: string | null, metadata: Record<string, unknown>) { this.audits.push({ action, actorId: actor.id, metadata }); }
  async findOperation(actorId: string, idempotencyKey: string) { return this.operations.get(`${actorId}:${idempotencyKey}`) ?? null; }
  async startOperation(input: Omit<SpreadsheetOperationRecord, 'id' | 'targetSheetId' | 'resultUrl' | 'status'>) { const value: SpreadsheetOperationRecord = { id: crypto.randomUUID(), ...input, targetSheetId: null, resultUrl: null, status: 'PENDING' }; this.operations.set(`${input.actorId}:${input.idempotencyKey}`, value); return value; }
  async completeOperationWithAudit(input: { operationId: string; targetSheetId: string; targetSheetName: string; resultUrl: string; actor: ActorContext; auditAction: string; metadata: Record<string, unknown> }) {
    const operation = [...this.operations.values()].find((item) => item.id === input.operationId)!;
    const complete = { ...operation, targetSheetId: input.targetSheetId, targetSheetName: input.targetSheetName, resultUrl: input.resultUrl, status: 'COMPLETED' };
    this.operations.set(`${operation.actorId}:${operation.idempotencyKey}`, complete); this.audits.push({ action: input.auditAction, actorId: input.actor.id, metadata: input.metadata }); return complete;
  }
}

const preview: CampaignSpreadsheetPreviewResult = {
  sheetName: 'Nguồn',
  mapping: [{ columnIndex: 0, sourceHeader: 'Mã', fieldKey: 'campaign_code', recognized: true }, { columnIndex: 1, sourceHeader: 'Tên', fieldKey: 'campaign_name', recognized: true }],
  rows: [
    { rowNumber: 3, selected: true, status: 'CREATE', code: 'CPG-01', name: 'Tên nguồn', campaignId: null, expectedVersion: null, values: { campaign_code: 'CPG-01', campaign_name: 'Tên nguồn' }, diffs: [], errors: [] },
  ],
  counts: { CREATE: 1, UPDATE: 0, UNCHANGED: 0, CONFLICT: 0, INVALID: 0, SKIP: 0 },
};

function fakeSpreadsheetEngine() {
  const comparison: Omit<CampaignSpreadsheetComparisonResult, 'spreadsheet'> = {
    rows: [{ code: 'CPG-01', name: 'Tên nguồn', sourceRowNumber: 3, campaignId: 'campaign-id', status: 'DIFFERENT', errors: [], fields: [{ fieldKey: 'campaign_name', label: 'Tên chiến dịch', sheetValue: 'Tên nguồn', cpmsValue: 'Tên CPMS', status: 'DIFFERENT', note: null }] }],
    counts: { SAME: 0, DIFFERENT: 1, ONLY_IN_SHEET: 0, ONLY_IN_CPMS: 0, INVALID: 0 },
    selectedFieldKeys: ['campaign_code', 'campaign_name'],
  };
  return {
    previewWorkbook: async () => structuredClone(preview),
    importWorkbook: async (_workbook: unknown, _request: unknown, actor: typeof DEMO_ACTOR) => ({ preview: structuredClone(preview), processed: 1, succeeded: 1, failed: 0, items: [{ clientKey: 'spreadsheet-3', ok: true, id: actor.id }] }),
    compareWorkbook: async () => structuredClone(comparison),
    exportWorkbook: async () => ({ workbook: { sheets: [{ name: 'Campaigns', rows: [['Mã', 'Tên'], ['campaign_code', 'campaign_name'], ['CPG-01', 'Tên CPMS']] }] }, rowCount: 1, fieldKeys: ['campaign_code', 'campaign_name'] }),
  } as unknown as CampaignSpreadsheetApplicationService;
}

function services() {
  const config = new FakeConfig(); const oauth = new FakeOAuth(); const sheets = new FakeSheets(); const repository = new FakeRepository();
  const service = new GoogleIntegrationApplicationService(config as never, oauth, sheets, repository, fakeSpreadsheetEngine());
  return { config, oauth, sheets, repository, service };
}

async function connect(service: GoogleIntegrationApplicationService) {
  const begin = await service.beginConnection(DEMO_ACTOR);
  const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
  await service.completeConnection(DEMO_ACTOR, 'code', state);
}

const compareRequest = {
  spreadsheetUrl, sheetName: 'Nguồn', selectedRows: [3], selectedFieldKeys: ['campaign_code', 'campaign_name'] as const,
  timeBasis: 'COMMUNICATION' as const, includeOnlyOneSide: true,
};

describe('GoogleIntegrationApplicationService', () => {
  it('connects only the configured shared Drive identity and keeps its token separate from personal Google access', async () => {
    const { service, oauth, repository } = services();
    oauth.grantedScopes = ['openid', 'email', 'https://www.googleapis.com/auth/drive'];
    const rejected = await service.beginDriveConnection(DEMO_ACTOR);
    const rejectedState = new URL(rejected.authorizationUrl).searchParams.get('state')!;
    await expect(service.completeConnection(DEMO_ACTOR, 'code', rejectedState)).rejects.toThrow('tài khoản Google Drive dùng chung');
    oauth.identityEmail = 'integration@example.test';
    const begin = await service.beginDriveConnection(DEMO_ACTOR);
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
    expect(oauth.authorizationScopes).toContain('https://www.googleapis.com/auth/drive');
    await expect(service.completeConnection(DEMO_ACTOR, 'code', state)).resolves.toMatchObject({ returnTo: '/admin/system?section=DRIVE' });
    expect(repository.driveConnection?.encryptedTokens).not.toContain('access-secret');
    expect(repository.connection).toBeNull();
    expect(await service.driveStatus()).toMatchObject({ connected: true, account: { email: 'integration@example.test' } });
    await expect(service.withDriveAccessToken(DEMO_ACTOR, async (token) => token)).resolves.toBe('refreshed-secret');
    expect(repository.driveConnection?.encryptedTokens).not.toContain('refreshed-secret');
  });
  it('requests only the approved full Drive scope and returns to the originating Campaign after consent', async () => {
    const { service, oauth } = services();
    const returnTo = '/campaigns/10000000-0000-4000-8000-000000000001';
    const begin = await service.beginConnection(DEMO_ACTOR, returnTo);
    expect(oauth.authorizationScopes).toContain('https://www.googleapis.com/auth/drive');
    expect(oauth.authorizationScopes).not.toContain('https://www.googleapis.com/auth/drive.file');
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
    await expect(service.completeConnection(DEMO_ACTOR, 'code', state)).resolves.toMatchObject({ returnTo });
  });

  it('validates one-time OAuth state, encrypts tokens and never exposes them in status', async () => {
    const { service, repository } = services();
    await expect(service.completeConnection(DEMO_ACTOR, 'code', 'invalid')).rejects.toThrow('OAuth state');
    await connect(service);
    expect(repository.connection?.encryptedTokens).not.toContain('access-secret');
    const status = await service.status(DEMO_ACTOR);
    expect(status.account?.email).toBe('demo@example.com');
    expect(JSON.stringify(status)).not.toMatch(/access-secret|refresh-secret|encryptedTokens/);
  });

  it('refreshes an expired token, reads tabs and reuses IV-A preview/import with actor audit', async () => {
    const { service, oauth, repository } = services(); await connect(service);
    const metadata = await service.inspect(DEMO_ACTOR, spreadsheetUrl);
    expect(metadata.tabs[0]?.title).toBe('Nguồn'); expect(oauth.refreshCount).toBe(1);
    const source = await service.preview(DEMO_ACTOR, { spreadsheetUrl, sheetName: 'Nguồn' });
    expect(source.preview.counts.CREATE).toBe(1);
    await service.import(DEMO_ACTOR, { spreadsheetUrl, sheetName: 'Nguồn', selectedRows: [3], selectedFieldKeys: ['campaign_code', 'campaign_name'], decisions: [{ rowNumber: 3, action: 'CREATE', selectedFieldKeys: ['campaign_code', 'campaign_name'] }] });
    expect(repository.audits.some((event) => event.action === 'google.sheet_imported' && event.actorId === DEMO_ACTOR.id)).toBe(true);
  });

  it('rejects unsafe URLs, creates diff/sync tabs idempotently and never changes the source tab', async () => {
    const { service, sheets, repository } = services(); await connect(service);
    await expect(service.inspect(DEMO_ACTOR, `https://evil.example/${spreadsheetId}`)).rejects.toThrow('URL Google Sheets không hợp lệ');
    const sourceBefore = structuredClone(sheets.source);
    const diffRequest = { ...compareRequest, selectedFieldKeys: [...compareRequest.selectedFieldKeys], idempotencyKey: '00000000-0000-4000-8000-000000000111' };
    const first = await service.createDiffTab(DEMO_ACTOR, diffRequest);
    const second = await service.createDiffTab(DEMO_ACTOR, diffRequest);
    expect(second).toMatchObject({ sheetId: first.sheetId, reused: true });
    expect(sheets.created.filter((tab) => tab.title.startsWith('CPMS_DIFF_'))).toHaveLength(1);
    await service.createSyncTab(DEMO_ACTOR, { ...diffRequest, idempotencyKey: '00000000-0000-4000-8000-000000000222' });
    expect(sheets.created.some((tab) => tab.title.startsWith('CPMS_SYNC_') && tab.rows[1]?.[0] === 'campaign_code')).toBe(true);
    expect(sheets.source).toEqual(sourceBefore);
    expect(repository.audits.some((event) => event.action === 'google.diff_tab_created')).toBe(true);
  });

  it('allows preview for a view-only file but blocks creating result tabs', async () => {
    const { service, sheets } = services(); await connect(service); sheets.canEdit = false;
    await expect(service.preview(DEMO_ACTOR, { spreadsheetUrl, sheetName: 'Nguồn' })).resolves.toBeTruthy();
    await expect(service.createDiffTab(DEMO_ACTOR, { ...compareRequest, selectedFieldKeys: [...compareRequest.selectedFieldKeys], idempotencyKey: '00000000-0000-4000-8000-000000000333' })).rejects.toThrow('quyền Editor');
    expect(sheets.created).toHaveLength(0);
  });

  it('revokes the provider token and removes the encrypted connection', async () => {
    const { service, oauth, repository } = services(); await connect(service);
    await service.disconnect(DEMO_ACTOR);
    expect(oauth.revoked).toBe(true); expect(repository.connection).toBeNull();
  });
});
