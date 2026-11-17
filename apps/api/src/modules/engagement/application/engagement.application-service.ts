import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ActorContext, EngagementView, MissionMode, MissionStage } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { EngagementRepository } from './engagement.repository';

const cycle = z.object({ runNumber: z.number().int().positive() }).strict();
const startInput = z.object({ mode: z.enum(['REAL','DEMO']), restart: z.boolean().default(false) }).strict();
const draftInput = z.object({ runNumber: z.number().int().positive(), name: z.string().trim().min(1).max(200), level: z.enum(['1','2','3']) }).strict();
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.safeParse(raw); if (!value.success) throw new BadRequestException('Thông tin nhiệm vụ chưa hợp lệ.'); return value.data;
}
@Injectable()
export class EngagementApplicationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(EngagementRepository) private readonly repository: EngagementRepository) {}
  state(actor: ActorContext) { return this.access.run(actor, () => this.view(actor)); }
  settings(actor: ActorContext) { return this.access.run(actor, async () => { this.admin(); return { enabled: await this.repository.enabled() }; }); }
  configure(actor: ActorContext, raw: unknown) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), raw);
    return this.access.run(actor, async () => { this.admin(); await this.repository.configure(actor, enabled); return { enabled }; });
  }
  private admin() {
    this.access.require('system.manage');
    const identity = this.access.snapshot().identity;
    if (!identity.effectiveSuperadmin || identity.mode !== 'DIRECT' || identity.readOnlyDemo) throw new ForbiddenException('Cần superadmin để bật/tắt chế độ nhiệm vụ.');
  }
  private async active(actorId: string, runNumber: number) {
    if (!await this.repository.enabled()) throw new ConflictException('Chế độ nhiệm vụ đang tắt.');
    const progress = await this.repository.progress(actorId);
    if (!progress || progress.runNumber !== runNumber) throw new ConflictException('Lượt nhiệm vụ đã thay đổi. Hãy mở lại bảng nhiệm vụ.');
    return progress;
  }
  start(actor: ActorContext, raw: unknown) {
    const input = parse(startInput, raw);
    return this.access.run(actor, async () => {
      if (!await this.repository.enabled()) throw new ConflictException('Chế độ nhiệm vụ đang tắt.');
      if (input.mode === 'REAL') this.access.require('campaign.create');
      const previous = await this.repository.progress(actor.id);
      // Retries and a second tab resume the same run unless the user explicitly starts over.
      if (!previous || input.restart || previous.stage === 'COMPLETED') {
        await this.repository.start(actor.id, input.mode, previous);
        await this.repository.audit(actor, 'engagement.mission_started', { mode: input.mode, runNumber: (previous?.runNumber ?? 0) + 1 });
      }
      return this.view(actor);
    });
  }
  demoDraft(actor: ActorContext, raw: unknown) {
    const input = parse(draftInput, raw);
    return this.access.run(actor, async () => {
      const p = await this.active(actor.id, input.runNumber);
      if (p.mode !== 'DEMO' || p.stage === 'COMPLETED') throw new ConflictException('Lượt này không ở bước lưu bản nháp trình diễn.');
      await this.repository.update(actor.id, { stage: 'DRAFT_SAVED', campaignName: input.name });
      return this.view(actor);
    });
  }
  demoSubmit(actor: ActorContext, raw: unknown) {
    const input = parse(cycle, raw);
    return this.access.run(actor, async () => {
      const p = await this.active(actor.id, input.runNumber);
      if (p.mode !== 'DEMO' || !['DRAFT_SAVED','COMPLETED'].includes(p.stage)) throw new ConflictException('Hãy lưu bản nháp trình diễn trước khi gửi duyệt thử.');
      if (p.stage !== 'COMPLETED') await this.repository.award(actor, p);
      return this.view(actor);
    });
  }
  reconcile(actor: ActorContext) {
    return this.access.run(actor, async () => {
      const p = await this.repository.progress(actor.id);
      if (await this.repository.enabled() && p?.mode === 'REAL' && p.stage !== 'COMPLETED') {
        const evidence = await this.repository.evidence(actor.id, p.startedAt);
        if (evidence) {
          await this.repository.update(actor.id, { campaignId: evidence.id, campaignName: evidence.name, stage: 'DRAFT_SAVED' });
          if (evidence.submitted) await this.repository.award(actor, { ...p, campaignId: evidence.id, campaignName: evidence.name });
        }
      }
      return this.view(actor);
    });
  }
  acknowledge(actor: ActorContext, raw: unknown) {
    const input = parse(cycle, raw);
    return this.access.run(actor, async () => {
      const p = await this.active(actor.id, input.runNumber);
      if (p.stage !== 'COMPLETED') throw new ConflictException('Nhiệm vụ chưa hoàn thành.');
      if (!p.rewardSeenAt) await this.repository.update(actor.id, { rewardSeenAt: new Date() });
      return this.view(actor);
    });
  }
  private async view(actor: ActorContext): Promise<EngagementView> {
    const p = await this.repository.progress(actor.id);
    return { enabled: await this.repository.enabled(), canCreateCampaign: this.access.check('campaign.create').allowed,
      progress: p ? { runNumber: p.runNumber, mode: p.mode as MissionMode, stage: p.stage as MissionStage, startedAt: p.startedAt.toISOString(),
        campaignId: p.campaignId, campaignName: p.campaignName, completedAt: p.completedAt?.toISOString() ?? null,
        rewardSeenAt: p.rewardSeenAt?.toISOString() ?? null, completedCount: p.completedCount } : null,
      inventory: (await this.repository.inventory(actor.id)).map(i => ({ key: i.itemKey, earnedAt: i.earnedAt.toISOString() })) };
  }
}
