import type { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { FIRST_CAMPAIGN_MISSION, PAPER_PLANE_ITEM, type ActorContext, type MissionMode } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EngagementRepository, type ProgressRecord } from '../application/engagement.repository';
@Injectable()
export class PrismaEngagementRepository extends EngagementRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async enabled() { return (await this.db.engagementSettings.findUnique({ where: { key: 'engagement' } }))?.enabled ?? false; }
  async configure(actor: ActorContext, enabled: boolean) {
    await this.db.engagementSettings.upsert({ where: { key: 'engagement' }, create: { enabled, updatedByActorId: actor.id }, update: { enabled, updatedByActorId: actor.id } });
    await this.audit(actor, 'engagement.configured', { enabled });
  }
  progress(actorId: string) { return this.db.missionProgress.findUnique({ where: { actorId_missionKey: { actorId, missionKey: FIRST_CAMPAIGN_MISSION } } }); }
  inventory(actorId: string) { return this.db.personalCollectible.findMany({ where: { actorId } }); }
  async start(actorId: string, mode: MissionMode, previous: ProgressRecord | null) {
    const fields = { mode, stage: 'ACTIVE', runNumber: (previous?.runNumber ?? 0) + 1, startedAt: new Date(), campaignId: null, campaignName: null, completedAt: null, rewardSeenAt: null };
    await this.db.missionProgress.upsert({ where: { actorId_missionKey: { actorId, missionKey: FIRST_CAMPAIGN_MISSION } }, create: { actorId, ...fields }, update: fields });
  }
  async update(actorId: string, patch: Parameters<EngagementRepository['update']>[1]) { await this.db.missionProgress.update({ where: { actorId_missionKey: { actorId, missionKey: FIRST_CAMPAIGN_MISSION } }, data: patch }); }
  async evidence(actorId: string, since: Date) {
    // Only a committed SUBMIT receipt counts. A saved draft, a preview, an old campaign,
    // somebody else's campaign or a failed HTTP command cannot award the real mission.
    const submitted = await this.db.campaignWorkflowCommand.findFirst({ where: { actorId, operation: 'SUBMIT', createdAt: { gte: since },
      result: { path: ['commandId'], not: '' }, campaign: { createdByActorId: actorId, createdAt: { gte: since }, deletedAt: null } },
      orderBy: { createdAt: 'asc' }, select: { campaign: { select: { id: true, name: true } } } });
    if (submitted) return { ...submitted.campaign, submitted: true };
    const draft = await this.db.campaign.findFirst({ where: { createdByActorId: actorId, createdAt: { gte: since }, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    return draft ? { ...draft, submitted: false } : null;
  }
  async award(actor: ActorContext, progress: ProgressRecord) {
    const changed = await this.db.missionProgress.updateMany({ where: { actorId: actor.id, missionKey: FIRST_CAMPAIGN_MISSION, runNumber: progress.runNumber, stage: { not: 'COMPLETED' } },
      data: { stage: 'COMPLETED', completedAt: new Date(), completedCount: { increment: 1 }, rewardSeenAt: null } });
    if (!changed.count) return;
    await this.db.personalCollectible.upsert({ where: { actorId_itemKey: { actorId: actor.id, itemKey: PAPER_PLANE_ITEM } }, create: { actorId: actor.id, itemKey: PAPER_PLANE_ITEM }, update: {} });
    await this.audit(actor, 'engagement.mission_completed', { mission: 'FIRST_CAMPAIGN', runNumber: progress.runNumber, mode: progress.mode, campaignId: progress.campaignId, reward: PAPER_PLANE_ITEM });
  }
  async audit(actor: ActorContext, action: string, payload: Record<string, unknown>) {
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action, entityType: 'Engagement', entityId: actor.id,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue } });
  }
}
