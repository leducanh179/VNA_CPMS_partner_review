import type { ActorContext, CampaignChangeSource, CreateCampaignCommand, UpdateCampaignCommand } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignDriveApplicationService } from './campaign-drive.application-service';

@Injectable()
export class CampaignDriveOrchestrationService {
  constructor(
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CampaignDriveApplicationService) private readonly drive: CampaignDriveApplicationService,
  ) {}

  async create(command: CreateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'FORM') {
    const campaign = await this.campaigns.create(command, actor, source);
    await this.drive.ensure(campaign.id, actor);
    return this.campaigns.get(campaign.id);
  }

  async update(id: string, command: UpdateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'FORM') {
    const campaign = await this.campaigns.update(id, command, actor, source);
    await this.drive.markNameMismatch(campaign, actor);
    return this.campaigns.get(id);
  }

  async moveToTrash(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    const campaign = await this.campaigns.moveToTrash(id, actor, source);
    await this.drive.trashCampaignFolder(campaign, actor);
    return campaign;
  }

  async restore(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    const campaign = await this.campaigns.restore(id, actor, source);
    await this.drive.restoreCampaignFolder(campaign, actor);
    return campaign;
  }

  async deletePermanently(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    const campaign = await this.campaigns.get(id);
    await this.drive.ensureFolderTrashedBeforePermanentDelete(campaign, actor);
    return this.campaigns.deletePermanently(id, actor, source);
  }
}
