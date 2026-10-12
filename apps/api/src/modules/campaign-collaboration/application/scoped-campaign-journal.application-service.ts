import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CAMPAIGN_COLLABORATION_REPOSITORY, type CampaignCollaborationRepository } from './campaign-collaboration.repository';
import { CampaignJournalApplicationService } from './campaign-journal.application-service';
import { ScopedCollaborationAuthorizationService } from './scoped-collaboration-authorization.service';

@Injectable()
export class ScopedCampaignJournalApplicationService extends CampaignJournalApplicationService {
  constructor(@Inject(CAMPAIGN_COLLABORATION_REPOSITORY) repository: CampaignCollaborationRepository,
    @Inject(ScopedCampaignApplicationService) campaigns: ScopedCampaignApplicationService,
    @Inject(ScopedCollaborationAuthorizationService) authorization: ScopedCollaborationAuthorizationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(repository, campaigns, authorization); }
  @AccessBoundary(1)
  override async list(input: { campaignId?: string; actorId?: string; action?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }, actor: ActorContext) {
    if (input.campaignId) this.access.require('campaign.journal.read', await this.access.campaign(input.campaignId));
    return this.listWithinVisibility(input, actor, await this.access.visibleCampaignIds(false, 'campaign.journal.read'));
  }
}
