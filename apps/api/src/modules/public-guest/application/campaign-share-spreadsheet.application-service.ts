import type { ActorContext, CampaignShareSpreadsheet } from '@cpms/domain';
import { CLOUD_MANAGED_SPREADSHEET_PORT, type CloudManagedSpreadsheetPort } from '@cpms/integrations';
import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';
import { ProviderOperationAccessService } from '../../google-integration/application/provider-operation-access.service';
import { CampaignSharingApplicationService } from './campaign-sharing.application-service';
import { CampaignSharingRepository } from './campaign-sharing.repository';
import { campaignShareSpreadsheet } from './campaign-share-spreadsheet';

@Injectable()
export class CampaignShareSpreadsheetApplicationService {
  constructor(
    @Inject(CampaignSharingApplicationService) private readonly sharing: CampaignSharingApplicationService,
    @Inject(CampaignSharingRepository) private readonly repository: CampaignSharingRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
    @Inject(ProviderOperationAccessService) private readonly provider: ProviderOperationAccessService,
    @Inject(GoogleIntegrationApplicationService) private readonly google: GoogleIntegrationApplicationService,
    @Inject(CLOUD_MANAGED_SPREADSHEET_PORT) private readonly spreadsheets: CloudManagedSpreadsheetPort,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  @AccessBoundary()
  async status(id: string): Promise<CampaignShareSpreadsheet> {
    const settings = await this.sharing.settings(id);
    return this.statusFor(id, settings.version);
  }

  @AccessBoundary(2)
  async publish(id: string, expectedVersion: number, actor: ActorContext, viewerEmail?: string): Promise<CampaignShareSpreadsheet> {
    const settings = await this.sharing.settings(id);
    if (settings.version !== expectedVersion) throw new ConflictException('Quyền chia sẻ đã thay đổi. Hãy mở lại hộp Chia sẻ.');
    if (settings.mode !== 'PUBLIC' || !settings.tabs.PUBLIC.length) {
      throw new BadRequestException('Hãy lưu chế độ Public và chọn ít nhất một tab để xuất Google Sheet.');
    }
    const resource = await this.access.campaign(id);
    return this.provider.execute('campaign.export', resource, async () => {
      const projection = await this.sharing.publicView(id);
      const origin = this.config.get('WEB_ORIGIN', { infer: true });
      const exportedAt = new Date();
      const workbook = campaignShareSpreadsheet(projection, new URL(`/share/campaigns/${id}`, origin).href, exportedAt);
      const current = await this.repository.spreadsheet(id);
      const environment = this.config.get('NODE_ENV', { infer: true }) === 'production' ? 'online' : 'local';
      const key = `cpms-${environment}-public-${id}`;
      try {
        const spreadsheetId = await this.google.withDriveAccessToken(actor, async accessToken => {
          const spreadsheetId = await this.spreadsheets.replaceManagedSpreadsheet({ accessToken, key, spreadsheetId: current?.id ?? null, ...workbook });
          if (viewerEmail) await this.spreadsheets.grantSpreadsheetViewer({ accessToken, key, spreadsheetId, email: viewerEmail });
          return spreadsheetId;
        });
        await this.repository.saveSpreadsheet(id, { id: spreadsheetId, exportedAt, sharingVersion: settings.version }, actor, viewerEmail);
        return this.statusFor(id, settings.version);
      } catch (error) {
        if (error instanceof UnauthorizedException) throw new ServiceUnavailableException(error.message);
        throw error;
      }
    });
  }

  private async statusFor(id: string, version: number): Promise<CampaignShareSpreadsheet> {
    const saved = await this.repository.spreadsheet(id);
    const resource = await this.access.campaign(id);
    const drive = await this.google.driveStatus();
    const unavailableReason = !this.access.check('campaign.export', resource).allowed ? 'Tài khoản hiện tại thiếu quyền xuất chiến dịch.'
      : !drive.connected ? 'Cần kết nối Google Drive dùng chung trong Quản trị hệ thống.'
      : !this.provider.driveWritesEnabled() ? 'Quyền ghi Google Drive đang tắt trên bản CPMS này.' : null;
    return {
      enabled: unavailableReason === null,
      ...(unavailableReason ? { unavailableReason } : {}),
      url: saved ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(saved.id)}/edit` : null,
      exportedAt: saved?.exportedAt.toISOString() ?? null,
      sharingChanged: Boolean(saved && saved.sharingVersion !== version),
    };
  }
}
