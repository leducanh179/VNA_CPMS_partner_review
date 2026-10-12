import {
  DEMO_ACTOR,
  type ActorContext,
  type CampaignCommentItem,
  type CampaignCommentPage,
  type CampaignCommentReactionSummary,
  type CampaignJournalPage,
  type CampaignSummary,
} from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import type { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignCollaborationAuthorizationService } from './campaign-collaboration-authorization.service';
import type {
  CampaignCollaborationRepository,
  CampaignCommentIdentity,
  CampaignCommentListQuery,
  CampaignJournalListQuery,
} from './campaign-collaboration.repository';
import { CampaignCommentApplicationService } from './campaign-comment.application-service';

const CAMPAIGN_ID = '10000000-0000-4000-8000-000000000010';
const OTHER_CAMPAIGN_ID = '10000000-0000-4000-8000-000000000011';
const COMMENT_ID = '10000000-0000-4000-8000-000000000020';
const REPLY_ID = '10000000-0000-4000-8000-000000000021';

const campaign = { id: CAMPAIGN_ID, code: 'CPG-202609-QA01', name: 'QA bình luận', isDeleted: false } as CampaignSummary;

class FakeRepository implements CampaignCollaborationRepository {
  comments = new Map<string, CampaignCommentIdentity>([[COMMENT_ID, {
    id: COMMENT_ID, campaignId: CAMPAIGN_ID, authorActorId: DEMO_ACTOR.id,
    parentCommentId: null, recordVersion: 1, deletedAt: null,
  }], [REPLY_ID, {
    id: REPLY_ID, campaignId: CAMPAIGN_ID, authorActorId: DEMO_ACTOR.id,
    parentCommentId: COMMENT_ID, recordVersion: 1, deletedAt: null,
  }]]);
  created: { body: string; parentCommentId: string | null; replyToCommentId: string | null } | null = null;

  async listComments(query: CampaignCommentListQuery): Promise<CampaignCommentPage> {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 };
  }
  async findComment(id: string) { return this.comments.get(id) ?? null; }
  async createComment(input: { campaignId: string; authorActorId: string; body: string; parentCommentId: string | null; replyToCommentId: string | null }, viewingActorId: string) {
    this.created = input;
    return this.item('10000000-0000-4000-8000-000000000099', input.body, viewingActorId, input.parentCommentId, input.replyToCommentId);
  }
  async updateComment(id: string, body: string, expectedVersion: number, viewingActorId: string) {
    const current = this.comments.get(id);
    if (!current || current.recordVersion !== expectedVersion) return null;
    current.recordVersion += 1;
    return this.item(id, body, viewingActorId, current.parentCommentId, null, current.recordVersion);
  }
  async softDeleteComment(id: string, actorId: string, expectedVersion: number, viewingActorId: string) {
    const current = this.comments.get(id);
    if (!current || current.recordVersion !== expectedVersion) return null;
    current.recordVersion += 1; current.deletedAt = new Date();
    return this.item(id, '', viewingActorId, current.parentCommentId, null, current.recordVersion, current.deletedAt.toISOString());
  }
  async setReaction(): Promise<CampaignCommentReactionSummary> { return { likeCount: 1, dislikeCount: 0, actorReaction: 'LIKE' }; }
  async removeReaction(): Promise<CampaignCommentReactionSummary> { return { likeCount: 0, dislikeCount: 0, actorReaction: null }; }
  async listJournal(_query: CampaignJournalListQuery): Promise<CampaignJournalPage> { return { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1, actors: [] }; }

  private item(id: string, body: string, viewingActorId: string, parentCommentId: string | null, replyToCommentId: string | null, recordVersion = 1, deletedAt: string | null = null): CampaignCommentItem {
    return {
      id, campaign: { id: campaign.id, code: campaign.code, name: campaign.name },
      author: { id: DEMO_ACTOR.id, key: DEMO_ACTOR.key, displayName: DEMO_ACTOR.displayName },
      body: deletedAt ? null : body, parentCommentId, replyToCommentId, replyToAuthorName: null,
      recordVersion, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      editedAt: null, deletedAt, isOwner: viewingActorId === DEMO_ACTOR.id,
      reactions: { likeCount: 0, dislikeCount: 0, actorReaction: null },
    };
  }
}

const serviceFor = (repository: FakeRepository, actorCampaign = campaign) => new CampaignCommentApplicationService(
  repository,
  { get: async (id: string) => id === CAMPAIGN_ID ? actorCampaign : id === OTHER_CAMPAIGN_ID ? { ...campaign, id } : Promise.reject(new Error('missing')) } as CampaignApplicationService,
  new CampaignCollaborationAuthorizationService(),
);

describe('CampaignCommentApplicationService', () => {
  it('trims plain-text comments and defaults list paging to ten roots', async () => {
    const repository = new FakeRepository();
    const service = serviceFor(repository);
    await service.create(CAMPAIGN_ID, { body: '  Nội dung tiếng Việt\nhttps://example.com  ' }, DEMO_ACTOR);
    expect(repository.created?.body).toBe('Nội dung tiếng Việt\nhttps://example.com');
    await expect(service.list({}, DEMO_ACTOR)).resolves.toMatchObject({ page: 1, pageSize: 10 });
  });

  it('rejects empty and over-limit content', async () => {
    const service = serviceFor(new FakeRepository());
    await expect(service.create(CAMPAIGN_ID, { body: '   ' }, DEMO_ACTOR)).rejects.toThrow('không được để trống');
    await expect(service.create(CAMPAIGN_ID, { body: 'a'.repeat(5_001) }, DEMO_ACTOR)).rejects.toThrow('5.000');
  });

  it('stores a reply to a reply directly under the root while retaining replyTo', async () => {
    const repository = new FakeRepository();
    const service = serviceFor(repository);
    await service.create(CAMPAIGN_ID, { body: 'Phản hồi cấp một', replyToCommentId: REPLY_ID }, DEMO_ACTOR);
    expect(repository.created).toMatchObject({ parentCommentId: COMMENT_ID, replyToCommentId: REPLY_ID });
  });

  it('enforces exact Campaign membership and author-only edit/delete', async () => {
    const repository = new FakeRepository();
    const service = serviceFor(repository);
    await expect(service.update(OTHER_CAMPAIGN_ID, COMMENT_ID, { body: 'Sai Campaign', expectedVersion: 1 }, DEMO_ACTOR)).rejects.toThrow('Không tìm thấy');
    const other: ActorContext = { ...DEMO_ACTOR, id: '10000000-0000-4000-8000-000000000030' };
    await expect(service.update(CAMPAIGN_ID, COMMENT_ID, { body: 'Không phải tác giả', expectedVersion: 1 }, other)).rejects.toThrow('Chỉ tác giả');
    await expect(service.remove(CAMPAIGN_ID, COMMENT_ID, 1, other)).rejects.toThrow('Chỉ tác giả');
  });

  it('uses optimistic locking and soft delete', async () => {
    const service = serviceFor(new FakeRepository());
    await expect(service.update(CAMPAIGN_ID, COMMENT_ID, { body: 'Xung đột', expectedVersion: 2 }, DEMO_ACTOR)).rejects.toThrow('đã được cập nhật');
    await expect(service.remove(CAMPAIGN_ID, COMMENT_ID, 1, DEMO_ACTOR)).resolves.toMatchObject({ deleted: true, recordVersion: 2 });
  });

  it('rejects reactions on deleted comments and rejects comments for Campaigns in trash', async () => {
    const repository = new FakeRepository();
    repository.comments.get(COMMENT_ID)!.deletedAt = new Date();
    const service = serviceFor(repository);
    await expect(service.setReaction(CAMPAIGN_ID, COMMENT_ID, 'LIKE', DEMO_ACTOR)).rejects.toThrow('đã xóa');
    const trashService = serviceFor(new FakeRepository(), { ...campaign, isDeleted: true } as CampaignSummary);
    await expect(trashService.create(CAMPAIGN_ID, { body: 'Không được tạo' }, DEMO_ACTOR)).rejects.toThrow('Thùng rác');
  });

  it('requires a dedicated comment permission', async () => {
    const viewer: ActorContext = { ...DEMO_ACTOR, roles: ['VIEWER'] };
    await expect(serviceFor(new FakeRepository()).create(CAMPAIGN_ID, { body: 'Không đủ quyền' }, viewer)).rejects.toThrow('không có quyền bình luận');
  });
});
