import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext, CampaignCommentReactionType, CreateCampaignCommentCommand, UpdateCampaignCommentCommand } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CAMPAIGN_COLLABORATION_REPOSITORY, type CampaignCollaborationRepository } from './campaign-collaboration.repository';
import { CampaignCommentApplicationService } from './campaign-comment.application-service';
import { ScopedCollaborationAuthorizationService } from './scoped-collaboration-authorization.service';

@Injectable()
export class ScopedCampaignCommentApplicationService extends CampaignCommentApplicationService {
  constructor(@Inject(CAMPAIGN_COLLABORATION_REPOSITORY) private readonly collaboration: CampaignCollaborationRepository,
    @Inject(ScopedCampaignApplicationService) campaigns: ScopedCampaignApplicationService,
    @Inject(ScopedCollaborationAuthorizationService) authorization: ScopedCollaborationAuthorizationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(collaboration, campaigns, authorization); }
  @AccessBoundary(3)
  async moderate(campaignId: string, commentId: string, input: { expectedVersion: number; reason: string }, actor: ActorContext) {
    const resource = await this.access.campaign(campaignId);
    this.access.require('campaign.comment.moderate', resource);
    const identity = this.access.snapshot().identity;
    if (identity.mode !== 'DIRECT' || !identity.effectiveSuperadmin) throw new ForbiddenException('Kiểm duyệt cần phiên superadmin trực tiếp.');
    const reason = input.reason?.trim();
    if (!reason || reason.length > 1000 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BadRequestException('Cần lý do kiểm duyệt và phiên bản bình luận hợp lệ.');
    const comment = await this.collaboration.findComment(commentId);
    if (!comment || comment.campaignId !== campaignId) throw new NotFoundException('Không tìm thấy bình luận trong chiến dịch này.');
    if (comment.recordVersion !== input.expectedVersion || comment.deletedAt) throw new ConflictException('Bình luận đã thay đổi hoặc đã xóa. Hãy tải lại.');
    const result = await this.collaboration.softDeleteComment(commentId, actor.id, input.expectedVersion, actor.id, actor, reason);
    if (!result) throw new ConflictException('Bình luận đã thay đổi. Hãy tải lại.');
    return { deleted: true, id: result.id, recordVersion: result.recordVersion };
  }
  @AccessBoundary(1)
  override async list(input: { campaignId?: string; page?: number; pageSize?: number }, actor: ActorContext) {
    if (input.campaignId) await this.access.campaign(input.campaignId);
    return this.listWithinVisibility(input, actor, await this.access.visibleCampaignIds());
  }
  @AccessBoundary(2)
  override async create(campaignId: string, command: CreateCampaignCommentCommand, actor: ActorContext) {
    this.access.require('campaign.comment', await this.access.campaign(campaignId));
    return super.create(campaignId, command, actor);
  }
  @AccessBoundary(3)
  override async update(campaignId: string, commentId: string, command: UpdateCampaignCommentCommand, actor: ActorContext) {
    this.access.require('campaign.comment', await this.access.campaign(campaignId));
    return super.update(campaignId, commentId, command, actor);
  }
  @AccessBoundary(3)
  override async remove(campaignId: string, commentId: string, expectedVersion: number, actor: ActorContext) {
    this.access.require('campaign.comment', await this.access.campaign(campaignId));
    return super.remove(campaignId, commentId, expectedVersion, actor);
  }
  @AccessBoundary(3)
  override async setReaction(campaignId: string, commentId: string, type: CampaignCommentReactionType, actor: ActorContext) {
    this.access.require('campaign.comment', await this.access.campaign(campaignId));
    return super.setReaction(campaignId, commentId, type, actor);
  }
  @AccessBoundary(2)
  override async removeReaction(campaignId: string, commentId: string, actor: ActorContext) {
    this.access.require('campaign.comment', await this.access.campaign(campaignId));
    return super.removeReaction(campaignId, commentId, actor);
  }
}
