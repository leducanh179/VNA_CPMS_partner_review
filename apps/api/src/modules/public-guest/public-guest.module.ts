import { Module } from '@nestjs/common';
import { PrismaCampaignRepository } from '../campaign/infrastructure/prisma-campaign.repository';
import { PrismaCampaignWorkflowRepository } from '../campaign-workflow/infrastructure/prisma-campaign-workflow.repository';
import { PublicGuestApplicationService } from './application/public-guest.application-service';
import { PublicGuestRepository } from './application/public-guest.repository';
import { PrismaPublicGuestRepository } from './infrastructure/prisma-public-guest.repository';
import { PublicGuestController } from './transport/public-guest.controller';

import { GoogleIntegrationModule } from '../google-integration/google-integration.module';
import { CampaignShareSpreadsheetApplicationService } from './application/campaign-share-spreadsheet.application-service';
import { MaterialModule } from '../material/material.module';
import { CampaignSharingApplicationService } from './application/campaign-sharing.application-service';
import { CampaignSharingRepository } from './application/campaign-sharing.repository';
import { PrismaCampaignSharingRepository } from './infrastructure/prisma-campaign-sharing.repository';
import { CampaignSharingController } from './transport/campaign-sharing.controller';

@Module({ imports: [MaterialModule, GoogleIntegrationModule], controllers: [PublicGuestController, CampaignSharingController],
  providers: [PrismaCampaignRepository, PrismaCampaignWorkflowRepository, PublicGuestApplicationService, CampaignSharingApplicationService, CampaignShareSpreadsheetApplicationService,
  { provide: CampaignSharingRepository, useClass: PrismaCampaignSharingRepository },
  { provide: PublicGuestRepository, useClass: PrismaPublicGuestRepository }] })
export class PublicGuestModule {}
