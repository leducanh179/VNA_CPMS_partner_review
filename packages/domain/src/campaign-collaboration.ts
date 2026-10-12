export const CAMPAIGN_COMMENT_REACTION_TYPES = ['LIKE', 'DISLIKE'] as const;
export type CampaignCommentReactionType = (typeof CAMPAIGN_COMMENT_REACTION_TYPES)[number];

export const CAMPAIGN_CHANGE_SOURCES = ['FORM', 'INLINE_GRID', 'XLSX_CSV', 'GOOGLE_SHEETS', 'IMPORTER', 'API'] as const;
export type CampaignChangeSource = (typeof CAMPAIGN_CHANGE_SOURCES)[number];

export interface CampaignReference {
  id: string;
  code: string;
  name: string;
}

export interface CampaignCommentActor {
  id: string;
  key: string;
  displayName: string;
}

export interface CampaignCommentReactionSummary {
  likeCount: number;
  dislikeCount: number;
  actorReaction: CampaignCommentReactionType | null;
}

export interface CampaignCommentItem {
  demonstration?: { originalActor: CampaignCommentActor | null };
  id: string;
  campaign: CampaignReference;
  author: CampaignCommentActor;
  body: string | null;
  parentCommentId: string | null;
  replyToCommentId: string | null;
  replyToAuthorName: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  isOwner: boolean;
  reactions: CampaignCommentReactionSummary;
}

export interface CampaignCommentThread extends CampaignCommentItem {
  replies: CampaignCommentItem[];
  replyCount: number;
}

export interface CampaignCommentPage {
  items: CampaignCommentThread[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreateCampaignCommentCommand {
  body: string;
  replyToCommentId?: string;
}

export interface UpdateCampaignCommentCommand {
  body: string;
  expectedVersion: number;
}

export interface CampaignAuditChange {
  fieldKey: string;
  label: string;
  before: string | null;
  after: string | null;
}

export type CampaignJournalAction = 'CREATED' | 'UPDATED' | 'MOVED_TO_TRASH' | 'RESTORED' | 'APPROVAL' | 'DELETED_PERMANENTLY' | 'WORKFLOW';

export interface CampaignJournalItem {
  id: string;
  campaign: CampaignReference;
  actor: CampaignCommentActor;
  action: CampaignJournalAction;
  actionLabel: string;
  source: CampaignChangeSource;
  sourceLabel: string;
  summary: string;
  changes: CampaignAuditChange[];
  createdAt: string;
}

export type CampaignJournalFilterActor = CampaignCommentActor;

export interface CampaignJournalPage {
  items: CampaignJournalItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  actors: CampaignJournalFilterActor[];
}
