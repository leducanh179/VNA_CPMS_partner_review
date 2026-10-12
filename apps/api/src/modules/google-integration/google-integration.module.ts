import { Module } from '@nestjs/common';
import { CLOUD_DRIVE_PORT, CLOUD_SPREADSHEET_PORT, USER_OAUTH_PORT } from '@cpms/integrations';
import { CampaignCoreModule } from '../campaign/campaign-core.module';
import { GoogleIntegrationApplicationService } from './application/google-integration.application-service';
import { GOOGLE_INTEGRATION_REPOSITORY } from './application/google-integration.repository';
import { GoogleApiAdapter } from './infrastructure/google-api.adapter';
import { PrismaGoogleIntegrationRepository } from './infrastructure/prisma-google-integration.repository';
import { GoogleIntegrationController } from './transport/google-integration.controller';
import { ScopedGoogleIntegrationApplicationService } from './application/scoped-google-integration.application-service';
import { ProviderOperationAccessService } from './application/provider-operation-access.service';
import { guardedGooglePorts } from './infrastructure/guarded-google-ports';

const GUARDED_GOOGLE_PORTS = Symbol('GUARDED_GOOGLE_PORTS');

@Module({
  imports: [CampaignCoreModule],
  controllers: [GoogleIntegrationController],
  providers: [
    ScopedGoogleIntegrationApplicationService,
    ProviderOperationAccessService,
    { provide: GoogleIntegrationApplicationService, useExisting: ScopedGoogleIntegrationApplicationService },
    GoogleApiAdapter,
    PrismaGoogleIntegrationRepository,
    { provide: GUARDED_GOOGLE_PORTS, useFactory: guardedGooglePorts, inject: [GoogleApiAdapter, ProviderOperationAccessService] },
    { provide: USER_OAUTH_PORT, useExisting: GUARDED_GOOGLE_PORTS },
    { provide: CLOUD_SPREADSHEET_PORT, useExisting: GUARDED_GOOGLE_PORTS },
    { provide: CLOUD_DRIVE_PORT, useExisting: GUARDED_GOOGLE_PORTS },
    { provide: GOOGLE_INTEGRATION_REPOSITORY, useExisting: PrismaGoogleIntegrationRepository },
  ],
  exports: [GoogleIntegrationApplicationService, ScopedGoogleIntegrationApplicationService, ProviderOperationAccessService, CLOUD_DRIVE_PORT],
})
export class GoogleIntegrationModule {}
