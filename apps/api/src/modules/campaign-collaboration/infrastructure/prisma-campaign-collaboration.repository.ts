import type {
  ActorContext,
  CampaignAuditChange,
  CampaignChangeSource,
  CampaignCommentActor,
  CampaignCommentItem,
  CampaignCommentPage,
  CampaignCommentReactionSummary,
  CampaignCommentReactionType,
  CampaignCommentThread,
  CampaignJournalAction,
  CampaignJournalItem,
  CampaignJournalPage,
} from '@cpms/domain';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CampaignCommentReactionType as PrismaReactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CampaignCollaborationRepository,
  CampaignCommentIdentity,
  CampaignCommentListQuery,
  CampaignJournalListQuery,
} from '../application/campaign-collaboration.repository';

const authorSelect = { id: true, key: true, displayName: true } as const;
const campaignSelect = { id: true, code: true, name: true } as const;
const commentInclude = {
  author: { select: authorSelect },
  campaign: { select: campaignSelect },
  replyTo: { select: { author: { select: { displayName: true } } } },
  reactions: { select: { actorId: true, type: true } },
} as const satisfies Prisma.CampaignCommentInclude;
const rootInclude = {
  ...commentInclude,
  replies: { orderBy: { createdAt: 'asc' as const }, include: commentInclude },
} as const satisfies Prisma.CampaignCommentInclude;

type CommentRecord = Prisma.CampaignCommentGetPayload<{ include: typeof commentInclude }>;
type RootCommentRecord = Prisma.CampaignCommentGetPayload<{ include: typeof rootInclude }>;

const AUDIT_ACTIONS = [
  'campaign.created',
  'campaign.updated',
  'campaign.moved_to_trash',
  'campaign.restored',
  'campaign.approved',
  'campaign.deleted_permanently',
  'workflow.submit', 'workflow.approve_assign', 'workflow.admin_skip_assign', 'workflow.return', 'workflow.reject', 'workflow.withdraw',
  'workflow.reassign', 'workflow.request_cooperation', 'workflow.accept_cooperation', 'workflow.decline_cooperation', 'workflow.cancel_cooperation',
  'workflow.revise_policy', 'workflow.policy_changed',
] as const;

const actionMap: Record<string, { action: CampaignJournalAction; label: string; summary: string }> = {
  ...Object.fromEntries([
    ['submit','Trình duyệt'], ['approve_assign','Phê duyệt và giao việc'], ['admin_skip_assign','Superadmin can thiệp và giao việc'],
    ['return','Trả lại để sửa'], ['reject','Từ chối'], ['withdraw','Rút về nháp'], ['reassign','Thay đổi phân công'],
    ['request_cooperation','Đề nghị phối hợp'], ['accept_cooperation','Chấp nhận phối hợp'], ['decline_cooperation','Từ chối phối hợp'],
    ['cancel_cooperation','Hủy đề nghị phối hợp'], ['revise_policy','Tạo revision theo chính sách mới'], ['policy_changed','Đổi chế độ phê duyệt'],
  ].map(([code, label]) => [`workflow.${code}`, { action: 'WORKFLOW' as const, label: label!, summary: `${label}.` }])),
  'campaign.created': { action: 'CREATED', label: 'Tạo chiến dịch', summary: 'Đã tạo chiến dịch.' },
  'campaign.updated': { action: 'UPDATED', label: 'Cập nhật chiến dịch', summary: 'Đã cập nhật thông tin chiến dịch.' },
  'campaign.moved_to_trash': { action: 'MOVED_TO_TRASH', label: 'Xóa tạm', summary: 'Đã chuyển chiến dịch vào Thùng rác.' },
  'campaign.restored': { action: 'RESTORED', label: 'Phục hồi', summary: 'Đã phục hồi chiến dịch.' },
  'campaign.approved': { action: 'APPROVAL', label: 'Phê duyệt', summary: 'Đã cập nhật trạng thái phê duyệt.' },
  'campaign.deleted_permanently': { action: 'DELETED_PERMANENTLY', label: 'Xóa vĩnh viễn', summary: 'Đã xóa vĩnh viễn chiến dịch.' },
};

const sourceLabels: Record<CampaignChangeSource, string> = {
  FORM: 'Biểu mẫu',
  INLINE_GRID: 'Bảng inline',
  XLSX_CSV: 'XLSX/CSV',
  GOOGLE_SHEETS: 'Google Sheets',
  IMPORTER: 'Importer',
  API: 'API',
};

function objectValue(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function sourceValue(value: Prisma.JsonValue | undefined): CampaignChangeSource {
  return typeof value === 'string' && Object.hasOwn(sourceLabels, value) ? value as CampaignChangeSource : 'API';
}

function changesValue(value: Prisma.JsonValue | undefined): CampaignAuditChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, Prisma.JsonValue>;
    if (typeof item.fieldKey !== 'string' || typeof item.label !== 'string') return [];
    const text = (entry: Prisma.JsonValue | undefined) => typeof entry === 'string' ? entry.slice(0, 500) : entry === null ? null : null;
    return [{ fieldKey: item.fieldKey, label: item.label, before: text(item.before), after: text(item.after) }];
  });
}

function actorView(actor: { id: string; key: string; displayName: string }): CampaignCommentActor {
  return actor;
}

function reactionSummary(reactions: Array<{ actorId: string; type: PrismaReactionType }>, actorId: string): CampaignCommentReactionSummary {
  return {
    likeCount: reactions.filter((reaction) => reaction.type === 'LIKE').length,
    dislikeCount: reactions.filter((reaction) => reaction.type === 'DISLIKE').length,
    actorReaction: reactions.find((reaction) => reaction.actorId === actorId)?.type ?? null,
  };
}

function commentView(comment: CommentRecord, actorId: string, demonstration?: CampaignCommentItem['demonstration']): CampaignCommentItem {
  return {
    ...(demonstration ? { demonstration } : {}),
    id: comment.id,
    campaign: comment.campaign,
    author: actorView(comment.author),
    body: comment.deletedAt ? null : comment.body,
    parentCommentId: comment.parentCommentId,
    replyToCommentId: comment.replyToCommentId,
    replyToAuthorName: comment.replyTo?.author.displayName ?? null,
    recordVersion: comment.recordVersion,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    isOwner: comment.authorActorId === actorId,
    reactions: reactionSummary(comment.reactions, actorId),
  };
}

function threadView(comment: RootCommentRecord, actorId: string, demonstrations: Map<string, NonNullable<CampaignCommentItem['demonstration']>>): CampaignCommentThread {
  return {
    ...commentView(comment, actorId, demonstrations.get(comment.id)),
    replies: comment.replies.map((reply) => commentView(reply, actorId, demonstrations.get(reply.id))),
    replyCount: comment.replies.length,
  };
}

@Injectable()
export class PrismaCampaignCollaborationRepository implements CampaignCollaborationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listComments(query: CampaignCommentListQuery): Promise<CampaignCommentPage> {
    const where: Prisma.CampaignCommentWhereInput = {
      parentCommentId: null,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.visibleCampaignIds ? { AND: [{ campaignId: { in: [...query.visibleCampaignIds] } }] } : {}),
      OR: [{ deletedAt: null }, { replies: { some: {} } }],
    };
    const [total, comments] = await this.prisma.batchTransaction([
      this.prisma.database.campaignComment.count({ where }),
      this.prisma.database.campaignComment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: rootInclude,
      }),
    ]);
    const demonstrations = await this.commentDemonstrations(comments.flatMap((comment) => [comment.id, ...comment.replies.map((reply) => reply.id)]));
    return {
      items: comments.map((comment) => threadView(comment, query.actorId, demonstrations)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findComment(id: string): Promise<CampaignCommentIdentity | null> {
    return this.prisma.database.campaignComment.findUnique({
      where: { id },
      select: { id: true, campaignId: true, authorActorId: true, parentCommentId: true, recordVersion: true, deletedAt: true },
    });
  }

  async createComment(input: {
    campaignId: string;
    authorActorId: string;
    body: string;
    parentCommentId: string | null;
    replyToCommentId: string | null;
  }, viewingActorId: string, actorContext?: ActorContext): Promise<CampaignCommentItem> {
    return this.prisma.inTransaction(async () => {
      const comment = await this.prisma.database.campaignComment.create({ data: input, include: commentInclude });
      await this.auditComment('campaign.comment.created', comment.id, input.authorActorId, actorContext);
      return commentView(comment, viewingActorId, (await this.commentDemonstrations([comment.id])).get(comment.id));
    });
  }

  async updateComment(id: string, body: string, expectedVersion: number, viewingActorId: string, actorContext?: ActorContext): Promise<CampaignCommentItem | null> {
    return this.prisma.inTransaction(async () => {
    const result = await this.prisma.database.campaignComment.updateMany({
      where: { id, recordVersion: expectedVersion, deletedAt: null },
      data: { body, editedAt: new Date(), recordVersion: { increment: 1 } },
    });
    if (result.count) await this.auditComment('campaign.comment.updated', id, viewingActorId, actorContext);
    return result.count ? this.commentById(id, viewingActorId) : null;
    });
  }

  async softDeleteComment(id: string, actorId: string, expectedVersion: number, viewingActorId: string, actorContext?: ActorContext, moderationReason?: string): Promise<CampaignCommentItem | null> {
    return this.prisma.inTransaction(async () => {
    const result = await this.prisma.database.campaignComment.updateMany({
      where: { id, recordVersion: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedByActorId: actorId, recordVersion: { increment: 1 } },
    });
    if (result.count) await this.auditComment(moderationReason ? 'campaign.comment.moderated' : 'campaign.comment.deleted', id, actorId, actorContext,
      moderationReason ? { reason: moderationReason, before: { deleted: false, recordVersion: expectedVersion }, after: { deleted: true, recordVersion: expectedVersion + 1 } } : undefined);
    return result.count ? this.commentById(id, viewingActorId) : null;
    });
  }

  async setReaction(commentId: string, actorId: string, type: CampaignCommentReactionType, actorContext?: ActorContext): Promise<CampaignCommentReactionSummary> {
    return this.prisma.inTransaction(async () => {
    await this.prisma.database.campaignCommentReaction.upsert({
      where: { commentId_actorId: { commentId, actorId } },
      update: { type },
      create: { commentId, actorId, type },
    });
    await this.auditComment('campaign.comment.reaction_set', commentId, actorId, actorContext);
    return this.reactions(commentId, actorId);
    });
  }

  async removeReaction(commentId: string, actorId: string, actorContext?: ActorContext): Promise<CampaignCommentReactionSummary> {
    return this.prisma.inTransaction(async () => {
    await this.prisma.database.campaignCommentReaction.deleteMany({ where: { commentId, actorId } });
    await this.auditComment('campaign.comment.reaction_removed', commentId, actorId, actorContext);
    return this.reactions(commentId, actorId);
    });
  }

  private async auditComment(action: string, commentId: string, actorId: string, context?: ActorContext, details?: Prisma.InputJsonObject) {
    if (context && context.id !== actorId) throw new ForbiddenException('Người thực hiện bình luận không khớp phiên.');
    const comment = await this.prisma.database.campaignComment.findUniqueOrThrow({ where: { id: commentId }, select: { campaignId: true } });
    await this.prisma.database.auditEvent.create({ data: { actorId, originalActorId: context?.session?.originalActorId ?? actorId, contextMode: context?.session?.mode ?? 'DIRECT',
      entityType: 'CampaignComment', entityId: commentId, action, payload: { campaignId: comment.campaignId, ...details } } });
  }

  async listJournal(query: CampaignJournalListQuery): Promise<CampaignJournalPage> {
    const campaigns = await this.prisma.database.campaign.findMany({ where: { ...(query.visibleCampaignIds ? { id: { in: [...query.visibleCampaignIds] } } : {}) }, select: campaignSelect });
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const viewableIds = campaigns.filter((campaign) => !query.campaignId || campaign.id === query.campaignId).map((campaign) => campaign.id);
    const where: Prisma.AuditEventWhereInput = {
      entityType: 'campaign',
      entityId: { in: viewableIds },
      action: query.action && (AUDIT_ACTIONS as readonly string[]).includes(query.action)
        ? query.action
        : { in: [...AUDIT_ACTIONS] },
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.dateFrom || query.dateTo ? { createdAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } } : {}),
    };
    const facetWhere: Prisma.AuditEventWhereInput = { entityType: 'campaign', entityId: { in: viewableIds }, action: { in: [...AUDIT_ACTIONS] } };
    const [total, events, actorEvents] = await this.prisma.batchTransaction([
      this.prisma.database.auditEvent.count({ where }),
      this.prisma.database.auditEvent.findMany({
        where,
        include: { actor: { select: authorSelect }, originalActor: { select: authorSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.database.auditEvent.findMany({ where: facetWhere, distinct: ['actorId'], include: { actor: { select: authorSelect } }, orderBy: { actorId: 'asc' } }),
    ]);
    const items = events.flatMap((event): CampaignJournalItem[] => {
      const campaign = event.entityId ? campaignById.get(event.entityId) : undefined;
      const action = actionMap[event.action];
      if (!campaign || !action) return [];
      const payload = objectValue(event.payload);
      const changes = changesValue(payload.changes);
      const source = sourceValue(payload.source);
      return [{
        id: event.id,
        campaign,
        actor: actorView(event.actor),
        action: action.action,
        actionLabel: action.label,
        source,
        sourceLabel: ['DEMO_IMPERSONATION', 'ADMIN_ASSIST'].includes(event.contextMode ?? '') ? `${sourceLabels[source]} · Thao tác thay mặt bởi ${event.originalActor?.displayName ?? 'superadmin'}` : sourceLabels[source],
        summary: changes.length ? `${action.summary} ${changes.length} trường thay đổi.` : action.summary,
        changes,
        createdAt: event.createdAt.toISOString(),
      }];
    });
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      actors: actorEvents.map((event) => actorView(event.actor)),
    };
  }

  private async commentById(id: string, actorId: string) {
    const comment = await this.prisma.database.campaignComment.findUnique({ where: { id }, include: commentInclude });
    return comment ? commentView(comment, actorId, (await this.commentDemonstrations([id])).get(id)) : null;
  }

  private async commentDemonstrations(ids: string[]) {
    const contexts = new Map<string, NonNullable<CampaignCommentItem['demonstration']>>();
    if (!ids.length) return contexts;
    const events = await this.prisma.database.auditEvent.findMany({ where: { entityType: 'CampaignComment', entityId: { in: ids }, contextMode: { in: ['DEMO_IMPERSONATION', 'ADMIN_ASSIST'] },
      action: { in: ['campaign.comment.created','campaign.comment.updated','campaign.comment.deleted'] } },
      select: { entityId: true, originalActor: { select: authorSelect } }, orderBy: { createdAt: 'desc' } });
    for (const event of events) if (event.entityId && !contexts.has(event.entityId)) contexts.set(event.entityId, { originalActor: event.originalActor });
    return contexts;
  }

  private async reactions(commentId: string, actorId: string) {
    const reactions = await this.prisma.database.campaignCommentReaction.findMany({ where: { commentId }, select: { actorId: true, type: true } });
    return reactionSummary(reactions, actorId);
  }
}
