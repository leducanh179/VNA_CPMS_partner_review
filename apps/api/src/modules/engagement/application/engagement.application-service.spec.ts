import { describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '@cpms/domain';
import { EngagementApplicationService } from './engagement.application-service';
import type { EngagementRepository, ProgressRecord } from './engagement.repository';
import type { AccessApplicationService } from '../../access/application/access.application-service';

const actor = { id: '11111111-1111-4111-8111-111111111111', key: 'synthetic', displayName: 'Synthetic', roles: ['ADMIN'] } satisfies ActorContext;
function harness() {
  let enabled = true, allowed = true;
  let p: ProgressRecord | null = null;
  const inventory: { itemKey: string; earnedAt: Date }[] = [];
  const repo = {
    enabled: async () => enabled, configure: async (_: ActorContext, value: boolean) => { enabled = value; },
    progress: async () => p, inventory: async () => inventory,
    start: async (id: string, mode: string, previous: ProgressRecord | null) => { p = { actorId: id, mode, stage: 'ACTIVE', startedAt: new Date(),
      runNumber: (previous?.runNumber ?? 0) + 1, completedCount: previous?.completedCount ?? 0, campaignId: null, campaignName: null, completedAt: null, rewardSeenAt: null }; },
    update: async (_: string, patch: object) => { Object.assign(p!, patch); },
    evidence: vi.fn(async (): Promise<{ id: string; name: string; submitted: boolean } | null> => null),
    award: vi.fn(async () => { if (p?.stage === 'COMPLETED') return; p!.stage = 'COMPLETED'; p!.completedCount++; p!.completedAt = new Date(); if (!inventory.length) inventory.push({ itemKey: 'PAPER_PLANE', earnedAt: new Date() }); }),
    audit: vi.fn(async () => undefined),
  };
  const access = { run: async (_: ActorContext, operation: () => Promise<unknown>) => operation(), check: () => ({ allowed }),
    require: () => { if (!allowed) throw new Error('denied'); }, snapshot: () => ({ identity: { effectiveSuperadmin: allowed, mode: 'DIRECT' } }) } as unknown as AccessApplicationService;
  const service = new EngagementApplicationService(access, repo as unknown as EngagementRepository);
  return { service, repo, disable: () => { enabled = false; }, deny: () => { allowed = false; } };
}
describe('first Campaign mission', () => {
  it('awards only after a saved demo draft, and repeats keep one collectible', async () => {
    const h = harness(); await h.service.start(actor, { mode: 'DEMO' });
    await expect(h.service.demoSubmit(actor, { runNumber: 1 })).rejects.toThrow();
    await h.service.demoDraft(actor, { runNumber: 1, name: 'Synthetic practice', level: '1' });
    await h.service.demoSubmit(actor, { runNumber: 1 }); await h.service.demoSubmit(actor, { runNumber: 1 });
    expect((await h.service.state(actor)).progress?.completedCount).toBe(1); expect(h.repo.award).toHaveBeenCalledTimes(1);
    await h.service.start(actor, { mode: 'DEMO', restart: true });
    await expect(h.service.demoSubmit(actor, { runNumber: 1 })).rejects.toThrow('Lượt nhiệm vụ');
    await h.service.demoDraft(actor, { runNumber: 2, name: 'Synthetic practice 2', level: '2' }); await h.service.demoSubmit(actor, { runNumber: 2 });
    expect((await h.service.state(actor)).inventory).toHaveLength(1); expect((await h.service.state(actor)).progress?.completedCount).toBe(2);
  });
  it('a real mission requires server evidence of a successful submission', async () => {
    const h = harness(); await h.service.start(actor, { mode: 'REAL' });
    await h.service.reconcile(actor); expect(h.repo.award).not.toHaveBeenCalled();
    h.repo.evidence.mockResolvedValue({ id: 'synthetic-campaign', name: 'Synthetic campaign', submitted: false });
    expect((await h.service.reconcile(actor)).progress?.stage).toBe('DRAFT_SAVED'); expect(h.repo.award).not.toHaveBeenCalled();
    h.repo.evidence.mockResolvedValue({ id: 'synthetic-campaign', name: 'Synthetic campaign', submitted: true });
    await h.service.reconcile(actor); await h.service.reconcile(actor); expect(h.repo.award).toHaveBeenCalledTimes(1);
    await expect(h.service.demoSubmit(actor, { runNumber: 1 })).rejects.toThrow();
  });
  it('readonly accounts may practice without receiving Campaign creation or admin rights', async () => {
    const h = harness(); h.deny(); await h.service.start(actor, { mode: 'DEMO' });
    await expect(h.service.start(actor, { mode: 'REAL', restart: true })).rejects.toThrow('denied');
    await expect(h.service.configure(actor, { enabled: true })).rejects.toThrow('denied');
    expect(() => h.service.start(actor, { mode: 'DEMO', actorId: 'another' })).toThrow('chưa hợp lệ');
  });
  it('disabling pauses progress without deleting inventory, and retries resume an active run', async () => {
    const h = harness(); await h.service.start(actor, { mode: 'DEMO' }); await h.service.start(actor, { mode: 'DEMO' });
    expect((await h.service.state(actor)).progress?.runNumber).toBe(1); h.disable();
    await expect(h.service.demoDraft(actor, { runNumber: 1, name: 'Synthetic', level: '1' })).rejects.toThrow('đang tắt');
    expect((await h.service.state(actor)).enabled).toBe(false);
  });
});
