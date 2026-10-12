import { Module } from '@nestjs/common';
import { CampaignCoreModule } from '../campaign/campaign-core.module';
import { GoogleIntegrationModule } from '../google-integration/google-integration.module';
import { CampaignDriveApplicationService } from './application/campaign-drive.application-service';
import { CampaignDriveAuthorizationService } from './application/campaign-drive-authorization.service';
import { CampaignDriveOrchestrationService } from './application/campaign-drive-orchestration.service';
import { CAMPAIGN_DRIVE_REPOSITORY } from './application/campaign-drive.repository';
import { PrismaCampaignDriveRepository } from './infrastructure/prisma-campaign-drive.repository';
import { CampaignDriveController } from './transport/campaign-drive.controller';
import { ScopedCampaignDriveApplicationService } from './application/scoped-campaign-drive.application-service';
import { ScopedDriveAuthorizationService } from './application/scoped-drive-authorization.service';
import { ScopedDriveOrchestrationService } from './application/scoped-drive-orchestration.service';
import { CampaignDriveGoogleAccessService } from './application/campaign-drive-google-access.service';

@Module({
  imports: [CampaignCoreModule, GoogleIntegrationModule],
  controllers: [CampaignDriveController],
  providers: [
    ScopedCampaignDriveApplicationService,
    ScopedDriveAuthorizationService,
    ScopedDriveOrchestrationService,
    CampaignDriveGoogleAccessService,
    { provide: CampaignDriveApplicationService, useExisting: ScopedCampaignDriveApplicationService },
    { provide: CampaignDriveAuthorizationService, useExisting: ScopedDriveAuthorizationService },
    { provide: CampaignDriveOrchestrationService, useExisting: ScopedDriveOrchestrationService },
    PrismaCampaignDriveRepository,
    { provide: CAMPAIGN_DRIVE_REPOSITORY, useExisting: PrismaCampaignDriveRepository },
  ],
  exports: [CampaignDriveApplicationService, CampaignDriveOrchestrationService, ScopedDriveOrchestrationService],
})
export class CampaignDriveModule {}
