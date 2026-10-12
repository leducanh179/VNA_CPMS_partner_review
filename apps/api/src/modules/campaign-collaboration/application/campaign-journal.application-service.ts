import type { ActorContext, CampaignJournalPage } from '@cpms/domain';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignCollaborationAuthorizationService } from './campaign-collaboration-authorization.service';
import {
  CAMPAIGN_COLLABORATION_REPOSITORY,
  type CampaignCollaborationRepository,
} from './campaign-collaboration.repository';

@Injectable()
export class CampaignJournalApplicationService {
  constructor(
    @Inject(CAMPAIGN_COLLABORATION_REPOSITORY) private readonly repository: CampaignCollaborationRepository,
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CampaignCollaborationAuthorizationService) private readonly authorization: CampaignCollaborationAuthorizationService,
  ) {}

  async list(input: {
    campaignId?: string;
    actorId?: string;
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }, actor: ActorContext): Promise<CampaignJournalPage> {
    return this.listWithinVisibility(input, actor);
  }
  protected async listWithinVisibility(input: { campaignId?: string; actorId?: string; action?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }, actor: ActorContext, visibleCampaignIds?: readonly string[]): Promise<CampaignJournalPage> {
    this.authorization.requireJournal(actor);
    if (input.campaignId) await this.campaigns.get(input.campaignId);
    const dateFrom = this.date(input.dateFrom, false);
    const dateTo = this.date(input.dateTo, true);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestException('Khoảng ngày nhật ký không hợp lệ.');
    return this.repository.listJournal({
      ...(visibleCampaignIds ? { visibleCampaignIds } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      page: Number.isInteger(input.page) && input.page! > 0 ? input.page! : 1,
      pageSize: Number.isInteger(input.pageSize) && input.pageSize! > 0 ? Math.min(input.pageSize!, 50) : 10,
    });
  }

  private date(value: string | undefined, endOfDay: boolean) {
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày lọc nhật ký phải theo định dạng YYYY-MM-DD.');
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(date.valueOf())) throw new BadRequestException('Ngày lọc nhật ký không hợp lệ.');
    return date;
  }
}
