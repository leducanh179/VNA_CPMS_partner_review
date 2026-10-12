import type { ActorContext, CampaignSpreadsheetCompareRequest, GoogleSheetImportRequest, GoogleSheetResultTabRequest, GoogleSheetSourceRequest } from '@cpms/domain';
import { CLOUD_SPREADSHEET_PORT, USER_OAUTH_PORT, type CloudSpreadsheetPort, type UserOAuthPort } from '@cpms/integrations';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignSpreadsheetApplicationService } from '../../campaign/application/scoped-campaign-spreadsheet.application-service';
import { GoogleIntegrationApplicationService } from './google-integration.application-service';
import { GOOGLE_INTEGRATION_REPOSITORY, type GoogleIntegrationRepository } from './google-integration.repository';
import { ProviderOperationAccessService } from './provider-operation-access.service';

@Injectable()
export class ScopedGoogleIntegrationApplicationService extends GoogleIntegrationApplicationService {
  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(USER_OAUTH_PORT) oauth: UserOAuthPort, @Inject(CLOUD_SPREADSHEET_PORT) sheets: CloudSpreadsheetPort,
    @Inject(GOOGLE_INTEGRATION_REPOSITORY) private readonly integrationRepository: GoogleIntegrationRepository,
    @Inject(ScopedCampaignSpreadsheetApplicationService) private readonly scopedSpreadsheets: ScopedCampaignSpreadsheetApplicationService,
    @Inject(ProviderOperationAccessService) private readonly providerAccess: ProviderOperationAccessService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(config, oauth, sheets, integrationRepository, scopedSpreadsheets); }
  @AccessBoundary(0)
  override async status(actor: ActorContext) {
    const status = await super.status(actor);
    return { ...status, providerWritesEnabled: this.providerAccess.writesEnabled(),
      canConnectGoogle: this.providerAccess.writesEnabled() && this.access.check('google.connect').allowed,
      canDisconnectGoogle: this.providerAccess.writesEnabled() && this.access.check('google.revoke').allowed,
      canReadSheets: this.access.check('campaign.sheets.read').allowed,
      canWriteSheets: this.providerAccess.writesEnabled() && this.access.check('campaign.sheets.write').allowed,
      connectionState: status.connected ? 'CONNECTED' : 'BLOCKED_BY_RECONNECT',
      message: status.connected ? status.message : 'Tài khoản hiện hành chưa kết nối Google. Cần kết nối riêng để sử dụng Google Sheets/Drive.' };
  }
  @AccessBoundary(0)
  override async beginConnection(actor: ActorContext, returnTo?: string) {
    return this.providerAccess.execute('google.connect', undefined, () => super.beginConnection(actor, returnTo));
  }
  @AccessBoundary(0)
  override async beginDriveConnection(actor: ActorContext) {
    this.requireDriveAdministrator();
    return this.providerAccess.execute('system.manage', undefined, () => super.beginDriveConnection(actor));
  }
  @AccessBoundary(0)
  override async completeConnection(actor: ActorContext, code: string | undefined, state: string | undefined, oauthError?: string) {
    let purpose: unknown;
    try { purpose = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf8')).purpose; } catch { /* Validated by base service. */ }
    if (purpose === 'CAMPAIGN_DRIVE') this.requireDriveAdministrator();
    return this.providerAccess.execute(purpose === 'CAMPAIGN_DRIVE' ? 'system.manage' : 'google.connect', undefined, () => super.completeConnection(actor, code, state, oauthError));
  }
  override async driveStatus() { return super.driveStatus(); }
  @AccessBoundary(0)
  override async disconnectDriveConnection(actor: ActorContext) {
    this.requireDriveAdministrator();
    return this.providerAccess.execute('system.manage', undefined, () => super.disconnectDriveConnection(actor));
  }
  @AccessBoundary(0)
  override async disconnect(actor: ActorContext) {
    return this.providerAccess.execute('google.revoke', undefined, () => super.disconnect(actor));
  }
  @AccessBoundary(0)
  override async inspect(actor: ActorContext, spreadsheetUrl: string) {
    return this.providerAccess.execute('campaign.sheets.read', undefined, () => super.inspect(actor, spreadsheetUrl));
  }
  @AccessBoundary(0)
  override async preview(actor: ActorContext, request: GoogleSheetSourceRequest) {
    return this.providerAccess.execute('campaign.sheets.read', undefined, () => super.preview(actor, request));
  }
  override async import(actor: ActorContext, request: GoogleSheetImportRequest) {
    return this.access.withRequestActor(actor, async () => {
      const source = await this.access.run(actor, () => this.providerAccess.execute('campaign.sheets.read', undefined,
        () => this.loadSource(actor, request.spreadsheetUrl, request.sheetName)));
      // Source fetch and each imported row use their own transaction; a rejected row cannot erase accepted rows.
      const result = await this.scopedSpreadsheets.importWorkbook(source.workbook, request, actor, 'GOOGLE_SHEETS');
      await this.access.run(actor, async () => {
        this.access.require('campaign.sheets.read');
        await this.integrationRepository.recordAudit(actor, 'google.sheet_imported', source.metadata.spreadsheetId,
          { sheetName: request.sheetName, processed: result.processed, succeeded: result.succeeded, failed: result.failed });
      });
      return result;
    });
  }
  @AccessBoundary(0)
  override async compare(actor: ActorContext, request: CampaignSpreadsheetCompareRequest) {
    return this.providerAccess.execute('campaign.sheets.read', undefined, () => super.compare(actor, request));
  }
  @AccessBoundary(0)
  override async createDiffTab(actor: ActorContext, request: GoogleSheetResultTabRequest) {
    return this.providerAccess.execute('campaign.sheets.write', undefined, async () => {
      const comparison = await this.compare(actor, request);
      for (const id of new Set(comparison.rows.flatMap((row) => row.campaignId ? [row.campaignId] : []))) this.access.require('campaign.export', await this.access.campaign(id));
      const rows = [['Trạng thái','Mã chiến dịch','Tên chiến dịch','Dòng nguồn','Field key','Nhãn trường','Google Sheets','CPMS','Ghi chú'],
        ...comparison.rows.flatMap((row) => row.fields.map((field) => [row.status,row.code,row.name,row.sourceRowNumber,field.fieldKey,field.label,field.sheetValue,field.cpmsValue,field.note ?? row.errors.join(' ')]))];
      return this.createResultTab(actor, request, comparison.spreadsheet, 'DIFF', rows);
    });
  }
  @AccessBoundary(0)
  override async createSyncTab(actor: ActorContext, request: GoogleSheetResultTabRequest) {
    return this.providerAccess.execute('campaign.sheets.write', undefined, () => super.createSyncTab(actor, request));
  }
  @AccessBoundary(0)
  override async withAccessToken<T>(actor: ActorContext, operation: (accessToken: string) => Promise<T>): Promise<T> {
    this.providerAccess.assert();
    return super.withAccessToken(actor, operation);
  }
  override async withDriveAccessToken<T>(actor: ActorContext, operation: (accessToken: string) => Promise<T>): Promise<T> {
    this.providerAccess.assert(['campaign.create', 'campaign.delete', 'campaign.restore', 'campaign.approve', 'campaign.drive.read', 'campaign.drive.ensure', 'campaign.drive.upload',
      'campaign.drive.rename', 'campaign.drive.trash', 'campaign.drive.restore', 'campaign.purge']);
    return super.withDriveAccessToken(actor, operation);
  }

  private requireDriveAdministrator() {
    const identity = this.access.snapshot().identity;
    this.access.require('system.manage');
    if (identity.mode !== 'DIRECT' || !identity.effectiveSuperadmin)
      throw new ForbiddenException('Chỉ quản trị viên trực tiếp được quản lý kết nối Google Drive dùng chung.');
  }
}
