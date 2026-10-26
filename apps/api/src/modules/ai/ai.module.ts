import { Module } from '@nestjs/common';
import { CampaignCoreModule } from '../campaign/campaign-core.module';
import { MaterialModule } from '../material/material.module';
import { LookupApplicationService } from './application/lookup.application-service';
import { LookupDataApplicationService } from './application/lookup-data.application-service';
import { LookupRepository } from './application/lookup.repository';
import { PrismaLookupRepository } from './infrastructure/prisma-lookup.repository';
import { LookupController } from './transport/lookup.controller';
import { LookupProviderFactory } from './application/lookup-provider.factory';
import { ConfiguredLookupProviderFactory } from './infrastructure/configured-lookup-provider.factory';
import { ContractsModule } from '../contracts/contracts.module';
import { BookingModule } from '../booking/booking.module';
import { LookupRecordApplicationService } from './application/lookup-record.application-service';
import { GoogleIntegrationModule } from '../google-integration/google-integration.module';
import { AiWorkspaceApplicationService } from './application/workspace.application-service';
import { WorkspaceRepository } from './application/workspace.repository';
import { PrismaWorkspaceRepository } from './infrastructure/prisma-workspace.repository';
import { AiWorkspaceController } from './transport/workspace.controller';

@Module({ imports: [CampaignCoreModule, MaterialModule, ContractsModule, BookingModule, GoogleIntegrationModule], controllers: [LookupController, AiWorkspaceController],
  providers: [LookupApplicationService, LookupDataApplicationService, LookupRecordApplicationService, AiWorkspaceApplicationService,
    { provide: WorkspaceRepository, useClass: PrismaWorkspaceRepository },
    { provide: LookupProviderFactory, useClass: ConfiguredLookupProviderFactory },
    { provide: LookupRepository, useClass: PrismaLookupRepository }],
  exports: [LookupApplicationService] })
export class AiModule {}
