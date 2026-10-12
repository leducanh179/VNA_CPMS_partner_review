import { Module } from '@nestjs/common';
import { CampaignCoreModule } from '../campaign/campaign-core.module';
import { CampaignCollaborationAuthorizationService } from './application/campaign-collaboration-authorization.service';
import { CAMPAIGN_COLLABORATION_REPOSITORY } from './application/campaign-collaboration.repository';
import { CampaignCommentApplicationService } from './application/campaign-comment.application-service';
import { CampaignJournalApplicationService } from './application/campaign-journal.application-service';
import { PrismaCampaignCollaborationRepository } from './infrastructure/prisma-campaign-collaboration.repository';
import { CampaignCommentMutationController, CampaignCommentQueryController } from './transport/campaign-comment.controller';
import { CampaignJournalController } from './transport/campaign-journal.controller';
import { ScopedCampaignCommentApplicationService } from './application/scoped-campaign-comment.application-service';
import { ScopedCampaignJournalApplicationService } from './application/scoped-campaign-journal.application-service';
import { ScopedCollaborationAuthorizationService } from './application/scoped-collaboration-authorization.service';

@Module({
  imports: [CampaignCoreModule],
  controllers: [CampaignCommentQueryController, CampaignCommentMutationController, CampaignJournalController],
  providers: [
    ScopedCollaborationAuthorizationService,
    ScopedCampaignCommentApplicationService,
    ScopedCampaignJournalApplicationService,
    { provide: CampaignCollaborationAuthorizationService, useExisting: ScopedCollaborationAuthorizationService },
    { provide: CampaignCommentApplicationService, useExisting: ScopedCampaignCommentApplicationService },
    { provide: CampaignJournalApplicationService, useExisting: ScopedCampaignJournalApplicationService },
    PrismaCampaignCollaborationRepository,
    { provide: CAMPAIGN_COLLABORATION_REPOSITORY, useExisting: PrismaCampaignCollaborationRepository },
  ],
})
export class CampaignCollaborationModule {}
