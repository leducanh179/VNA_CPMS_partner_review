import type { ActorContext, MissionMode, MissionStage } from '@cpms/domain';
export interface ProgressRecord {
  actorId: string; runNumber: number; mode: string; stage: string; startedAt: Date;
  campaignId: string | null; campaignName: string | null; completedAt: Date | null;
  rewardSeenAt: Date | null; completedCount: number;
}
export abstract class EngagementRepository {
  abstract enabled(): Promise<boolean>;
  abstract configure(actor: ActorContext, enabled: boolean): Promise<void>;
  abstract progress(actorId: string): Promise<ProgressRecord | null>;
  abstract inventory(actorId: string): Promise<{ itemKey: string; earnedAt: Date }[]>;
  abstract start(actorId: string, mode: MissionMode, previous: ProgressRecord | null): Promise<void>;
  abstract update(actorId: string, patch: { stage?: MissionStage; campaignId?: string; campaignName?: string; rewardSeenAt?: Date }): Promise<void>;
  abstract evidence(actorId: string, since: Date): Promise<{ id: string; name: string; submitted: boolean } | null>;
  abstract award(actor: ActorContext, progress: ProgressRecord): Promise<void>;
  abstract audit(actor: ActorContext, action: string, payload: Record<string, unknown>): Promise<void>;
}
