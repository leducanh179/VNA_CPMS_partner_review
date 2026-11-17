import { EngagementModule } from '../engagement/engagement.module';
import { Global, Module } from '@nestjs/common';
import { CampaignWorkflowApplicationService } from './application/campaign-workflow.application-service';
import { CampaignWorkflowRepository } from './application/campaign-workflow.repository';
import { PrismaCampaignWorkflowRepository } from './infrastructure/prisma-campaign-workflow.repository';
import { CampaignWorkflowController } from './transport/campaign-workflow.controller';

@Global()
@Module({ imports: [EngagementModule], controllers: [CampaignWorkflowController], providers: [CampaignWorkflowApplicationService,
  { provide: CampaignWorkflowRepository, useClass: PrismaCampaignWorkflowRepository }], exports: [CampaignWorkflowApplicationService] })
export class CampaignWorkflowModule {}
