import type {
  ActorContext,
  CampaignCommentPage,
  CampaignCommentReactionSummary,
  CampaignCommentReactionType,
  CreateCampaignCommentCommand,
  UpdateCampaignCommentCommand,
} from '@cpms/domain';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignCollaborationAuthorizationService } from './campaign-collaboration-authorization.service';
import {
  CAMPAIGN_COLLABORATION_REPOSITORY,
  type CampaignCollaborationRepository,
} from './campaign-collaboration.repository';

const MAX_COMMENT_LENGTH = 5_000;

@Injectable()
export class CampaignCommentApplicationService {
  constructor(
    @Inject(CAMPAIGN_COLLABORATION_REPOSITORY) private readonly repository: CampaignCollaborationRepository,
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(CampaignCollaborationAuthorizationService) private readonly authorization: CampaignCollaborationAuthorizationService,
  ) {}

  async list(input: { campaignId?: string; page?: number; pageSize?: number }, actor: ActorContext): Promise<CampaignCommentPage> {
    return this.listWithinVisibility(input, actor);
  }
  protected async listWithinVisibility(input: { campaignId?: string; page?: number; pageSize?: number }, actor: ActorContext, visibleCampaignIds?: readonly string[]): Promise<CampaignCommentPage> {
    this.authorization.requireView(actor);
    if (input.campaignId) await this.campaigns.get(input.campaignId);
    return this.repository.listComments({
      ...(visibleCampaignIds ? { visibleCampaignIds } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      page: this.page(input.page),
      pageSize: this.pageSize(input.pageSize),
      actorId: actor.id,
    });
  }

  async create(campaignId: string, command: CreateCampaignCommentCommand, actor: ActorContext) {
    this.authorization.requireComment(actor);
    this.authorization.requireView(actor);
    const campaign = await this.campaigns.get(campaignId);
    if (campaign.isDeleted) throw new ConflictException('Không thể bình luận khi chiến dịch đang ở trong Thùng rác.');
    const body = this.body(command.body);
    let parentCommentId: string | null = null;
    let replyToCommentId: string | null = null;
    if (command.replyToCommentId) {
      const target = await this.requireCommentInCampaign(command.replyToCommentId, campaignId);
      if (target.deletedAt) throw new ConflictException('Không thể trả lời một bình luận đã xóa.');
      parentCommentId = target.parentCommentId ?? target.id;
      replyToCommentId = target.id;
      const root = target.parentCommentId ? await this.requireCommentInCampaign(target.parentCommentId, campaignId) : target;
      if (root.deletedAt) throw new ConflictException('Không thể trả lời một luồng bình luận đã xóa.');
    }
    return this.repository.createComment({ campaignId, authorActorId: actor.id, body, parentCommentId, replyToCommentId }, actor.id, actor);
  }

  async update(campaignId: string, commentId: string, command: UpdateCampaignCommentCommand, actor: ActorContext) {
    this.authorization.requireComment(actor);
    this.authorization.requireView(actor);
    await this.campaigns.get(campaignId);
    const comment = await this.requireCommentInCampaign(commentId, campaignId);
    this.authorization.requireOwner(actor, comment.authorActorId);
    if (comment.deletedAt) throw new ConflictException('Bình luận đã bị xóa.');
    if (command.expectedVersion !== comment.recordVersion) throw this.versionConflict();
    const updated = await this.repository.updateComment(commentId, this.body(command.body), command.expectedVersion, actor.id, actor);
    if (!updated) throw this.versionConflict();
    return updated;
  }

  async remove(campaignId: string, commentId: string, expectedVersion: number, actor: ActorContext) {
    this.authorization.requireComment(actor);
    this.authorization.requireView(actor);
    await this.campaigns.get(campaignId);
    const comment = await this.requireCommentInCampaign(commentId, campaignId);
    this.authorization.requireOwner(actor, comment.authorActorId);
    if (comment.deletedAt) return { deleted: true, id: comment.id };
    if (expectedVersion !== comment.recordVersion) throw this.versionConflict();
    const deleted = await this.repository.softDeleteComment(commentId, actor.id, expectedVersion, actor.id, actor);
    if (!deleted) throw this.versionConflict();
    return { deleted: true, id: deleted.id, recordVersion: deleted.recordVersion };
  }

  async setReaction(campaignId: string, commentId: string, type: CampaignCommentReactionType, actor: ActorContext): Promise<CampaignCommentReactionSummary> {
    this.authorization.requireComment(actor);
    this.authorization.requireView(actor);
    await this.campaigns.get(campaignId);
    const comment = await this.requireCommentInCampaign(commentId, campaignId);
    if (comment.deletedAt) throw new ConflictException('Không thể bày tỏ cảm xúc với bình luận đã xóa.');
    return this.repository.setReaction(commentId, actor.id, type, actor);
  }

  async removeReaction(campaignId: string, commentId: string, actor: ActorContext): Promise<CampaignCommentReactionSummary> {
    this.authorization.requireComment(actor);
    this.authorization.requireView(actor);
    await this.campaigns.get(campaignId);
    const comment = await this.requireCommentInCampaign(commentId, campaignId);
    if (comment.deletedAt) throw new ConflictException('Không thể thay đổi cảm xúc của bình luận đã xóa.');
    return this.repository.removeReaction(commentId, actor.id, actor);
  }

  private async requireCommentInCampaign(commentId: string, campaignId: string) {
    const comment = await this.repository.findComment(commentId);
    if (!comment || comment.campaignId !== campaignId) throw new NotFoundException('Không tìm thấy bình luận trong chiến dịch này.');
    return comment;
  }

  private body(value: string) {
    const body = value.trim();
    if (!body) throw new BadRequestException('Nội dung bình luận không được để trống.');
    if (body.length > MAX_COMMENT_LENGTH) throw new BadRequestException('Bình luận không được vượt quá 5.000 ký tự.');
    return body;
  }

  private page(value?: number) { return Number.isInteger(value) && value! > 0 ? value! : 1; }
  private pageSize(value?: number) { return Number.isInteger(value) && value! > 0 ? Math.min(value!, 50) : 10; }
  private versionConflict() { return new ConflictException('Bình luận đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.'); }
}
