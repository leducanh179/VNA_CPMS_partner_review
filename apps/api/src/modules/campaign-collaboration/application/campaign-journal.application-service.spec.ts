import { DEMO_ACTOR, type ActorContext, type CampaignJournalPage } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import type { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { CampaignCollaborationAuthorizationService } from './campaign-collaboration-authorization.service';
import type {
  CampaignCollaborationRepository,
  CampaignCommentListQuery,
  CampaignJournalListQuery,
} from './campaign-collaboration.repository';
import { CampaignJournalApplicationService } from './campaign-journal.application-service';

const CAMPAIGN_ID = '10000000-0000-4000-8000-000000000010';

class FakeRepository implements Partial<CampaignCollaborationRepository> {
  query: CampaignJournalListQuery | null = null;

  async listComments(query: CampaignCommentListQuery) {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 };
  }

  async listJournal(query: CampaignJournalListQuery): Promise<CampaignJournalPage> {
    this.query = query;
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1, actors: [] };
  }
}

const serviceFor = (repository: FakeRepository, viewed: string[] = []) => new CampaignJournalApplicationService(
  repository as CampaignCollaborationRepository,
  { get: async (id: string) => { viewed.push(id); return {} as never; } } as CampaignApplicationService,
  new CampaignCollaborationAuthorizationService(),
);

describe('CampaignJournalApplicationService', () => {
  it('defaults to ten items and validates the selected Campaign through the Campaign service', async () => {
    const repository = new FakeRepository();
    const viewed: string[] = [];
    await serviceFor(repository, viewed).list({ campaignId: CAMPAIGN_ID }, DEMO_ACTOR);
    expect(viewed).toEqual([CAMPAIGN_ID]);
    expect(repository.query).toMatchObject({ campaignId: CAMPAIGN_ID, page: 1, pageSize: 10 });
  });

  it('maps actor, action and inclusive UTC date filters without exposing raw audit payloads', async () => {
    const repository = new FakeRepository();
    await serviceFor(repository).list({
      actorId: DEMO_ACTOR.id,
      action: 'UPDATED',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-03',
      page: 2,
      pageSize: 25,
    }, DEMO_ACTOR);
    expect(repository.query).toEqual({
      actorId: DEMO_ACTOR.id,
      action: 'UPDATED',
      dateFrom: new Date('2026-09-01T00:00:00.000Z'),
      dateTo: new Date('2026-09-03T23:59:59.999Z'),
      page: 2,
      pageSize: 25,
    });
  });

  it('rejects reversed date ranges and users without journal permission', async () => {
    const service = serviceFor(new FakeRepository());
    await expect(service.list({ dateFrom: '2026-09-03', dateTo: '2026-09-01' }, DEMO_ACTOR)).rejects.toThrow('Khoảng ngày');
    const guest: ActorContext = { ...DEMO_ACTOR, roles: ['GUEST'] };
    await expect(service.list({}, guest)).rejects.toThrow('không có quyền xem nhật ký');
  });
});
