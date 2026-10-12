import { Module } from '@nestjs/common';
import { GridDraftModule } from './modules/grid-draft/grid-draft.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { QcttCatalogModule } from './modules/qctt-catalog/qctt-catalog.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { BookingModule } from './modules/booking/booking.module';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CampaignModule } from './modules/campaign/campaign.module';
import { CampaignCollaborationModule } from './modules/campaign-collaboration/campaign-collaboration.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { MaterialModule } from './modules/material/material.module';
import { SystemModule } from './modules/system/system.module';
import { AccessModule } from './modules/access/access.module';
import { CampaignWorkflowModule } from './modules/campaign-workflow/campaign-workflow.module';

@Module({
  imports: [
    GridDraftModule,
    DirectoryModule,
    QcttCatalogModule,
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    AccessModule,
    CampaignWorkflowModule,
    AuthModule,
    SystemModule,
    CatalogModule,
    CampaignModule,
    CampaignCollaborationModule,
    MaterialModule,
    ContractsModule,
    BookingModule,
  ],
})
export class AppModule {}
