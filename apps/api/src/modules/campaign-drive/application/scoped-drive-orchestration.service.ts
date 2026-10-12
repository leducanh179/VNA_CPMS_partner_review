import type { ActorContext, CampaignChangeSource, CreateCampaignCommand, UpdateCampaignCommand } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CampaignOperationsApplicationService } from '../../campaign/application/campaign-operations.application-service';
import { CampaignDriveOrchestrationService } from './campaign-drive-orchestration.service';
import { ScopedCampaignDriveApplicationService } from './scoped-campaign-drive.application-service';
import { CAMPAIGN_DRIVE_REPOSITORY, type CampaignDriveRepository } from './campaign-drive.repository';

@Injectable()
export class ScopedDriveOrchestrationService extends CampaignDriveOrchestrationService {
  constructor(@Inject(ScopedCampaignApplicationService) private readonly scopedCampaigns: ScopedCampaignApplicationService,
    @Inject(ScopedCampaignDriveApplicationService) private readonly scopedDrive: ScopedCampaignDriveApplicationService,
    @Inject(CampaignOperationsApplicationService) private readonly operations: CampaignOperationsApplicationService,
    @Inject(CAMPAIGN_DRIVE_REPOSITORY) private readonly driveRepository: CampaignDriveRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(scopedCampaigns, scopedDrive); }
  @AccessBoundary(0)
  async createAndSubmit(actor: ActorContext, command: CreateCampaignCommand, key: string) {
    const campaign = await this.operations.createAndSubmit(actor, command, key);
    if (this.scopedDrive.providerAccess.driveWritesEnabled()) await this.scopedDrive.ensureCreatedCampaign(campaign.id, actor);
    return this.scopedCampaigns.get(campaign.id);
  }
  @AccessBoundary(2)
  async command(actor: ActorContext, id: string, input: unknown) {
    const result = await this.operations.command(actor, id, input);
    if (!this.scopedDrive.providerAccess.driveWritesEnabled()) return result;
    const workspace = await this.driveRepository.get(id);
    if (!workspace?.campaignFolderId) return result;
    const campaign = await this.scopedCampaigns.get(id);
    if (campaign.isDeleted && workspace.lifecycleStatus !== 'TRASHED') await this.scopedDrive.trashCampaignFolder(campaign, actor);
    if (!campaign.isDeleted && workspace.lifecycleStatus === 'TRASHED') await this.scopedDrive.restoreCampaignFolder(campaign, actor);
    return result;
  }
  @AccessBoundary(1)
  override async create(command: CreateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'FORM') {
    const campaign = await this.scopedCampaigns.create(command, actor, source);
    if (this.scopedDrive.providerAccess.driveWritesEnabled()) await this.scopedDrive.ensureCreatedCampaign(campaign.id, actor);
    return this.scopedCampaigns.get(campaign.id);
  }
  @AccessBoundary(2)
  override async update(id: string, command: UpdateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'FORM') {
    const campaign = await this.scopedCampaigns.update(id, command, actor, source);
    await this.scopedDrive.markNameMismatch(campaign, actor);
    return this.scopedCampaigns.get(id);
  }
  @AccessBoundary(1)
  override async moveToTrash(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    const resource = await this.access.campaign(id); this.access.require('campaign.delete', resource);
    await this.scopedCampaigns.requireLifecycleApproval(id, 'CANCEL');
    const synchronize = this.scopedDrive.providerAccess.driveWritesEnabled() && this.access.check('campaign.delete', resource).allowed;
    if (synchronize) await this.scopedDrive.trashCampaignFolder(await this.scopedCampaigns.get(id), actor);
    const result = await this.scopedCampaigns.moveToTrash(id, actor, source);
    return { ...result, ...(!synchronize ? { driveSynchronization: { status: 'DEFERRED', message: 'Campaign đã vào Thùng rác CPMS. Chưa thay đổi thư mục Google.' } } : {}) };
  }
  @AccessBoundary(1)
  override async restore(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    const campaign = await this.scopedCampaigns.restore(id, actor, source);
    const resource = await this.access.campaign(id);
    const synchronize = this.scopedDrive.providerAccess.driveWritesEnabled() && this.access.check('campaign.restore', resource).allowed;
    if (synchronize) await this.scopedDrive.restoreCampaignFolder(campaign, actor);
    return { ...campaign, ...(!synchronize ? { driveSynchronization: { status: 'DEFERRED', message: 'Campaign đã phục hồi trong CPMS. Chưa thay đổi thư mục Google.' } } : {}) };
  }
  @AccessBoundary(1)
  override async deletePermanently(id: string, actor: ActorContext, source: CampaignChangeSource = 'INLINE_GRID') {
    await this.scopedCampaigns.requireLifecycleApproval(id, 'PURGE');
    const campaign = await this.scopedCampaigns.get(id);
    await this.scopedDrive.ensureFolderTrashedBeforePermanentDelete(campaign, actor);
    return this.scopedCampaigns.deletePermanently(id, actor, source);
  }
}
