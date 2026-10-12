import type {
  ActorContext,
  CampaignCommentItem,
  CampaignCommentPage,
  CampaignCommentReactionSummary,
  CampaignCommentReactionType,
  CampaignJournalPage,
} from '@cpms/domain';

export const CAMPAIGN_COLLABORATION_REPOSITORY = Symbol('CAMPAIGN_COLLABORATION_REPOSITORY');

export interface CampaignCommentIdentity {
  id: string;
  campaignId: string;
  authorActorId: string;
  parentCommentId: string | null;
  recordVersion: number;
  deletedAt: Date | null;
}

export interface CampaignCommentListQuery {
  visibleCampaignIds?: readonly string[];
  campaignId?: string;
  page: number;
  pageSize: number;
  actorId: string;
}

export interface CampaignJournalListQuery {
  visibleCampaignIds?: readonly string[];
  campaignId?: string;
  actorId?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}

export interface CampaignCollaborationRepository {
  listComments(query: CampaignCommentListQuery): Promise<CampaignCommentPage>;
  findComment(id: string): Promise<CampaignCommentIdentity | null>;
  createComment(input: {
    campaignId: string;
    authorActorId: string;
    body: string;
    parentCommentId: string | null;
    replyToCommentId: string | null;
  }, viewingActorId: string, actorContext?: ActorContext): Promise<CampaignCommentItem>;
  updateComment(id: string, body: string, expectedVersion: number, viewingActorId: string, actorContext?: ActorContext): Promise<CampaignCommentItem | null>;
  softDeleteComment(id: string, actorId: string, expectedVersion: number, viewingActorId: string, actorContext?: ActorContext, moderationReason?: string): Promise<CampaignCommentItem | null>;
  setReaction(commentId: string, actorId: string, type: CampaignCommentReactionType, actorContext?: ActorContext): Promise<CampaignCommentReactionSummary>;
  removeReaction(commentId: string, actorId: string, actorContext?: ActorContext): Promise<CampaignCommentReactionSummary>;
  listJournal(query: CampaignJournalListQuery): Promise<CampaignJournalPage>;
}
