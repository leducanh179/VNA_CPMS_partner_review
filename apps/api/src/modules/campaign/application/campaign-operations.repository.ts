import type { ActorContext } from '@cpms/domain';

export interface CampaignChange {
  id: string; workflowId: string; kind: string; state: string; subjectRevision: number; campaignRecordVersion: number;
  payload: unknown; beforeSnapshot: unknown; reason: string; requestedByActorId: string; idempotencyKey: string; payloadHash: string;
  recordVersion: number; requestedAt: Date; decidedByActorId: string | null; decisionReason: string | null; decidedAt: Date | null;
}
export interface CampaignPlanRecord {
  id: string; workflowId: string; number: number; subjectRevision: number; title: string; objective: string; tasks: unknown;
  createdByActorId: string; createdAt: Date;
}
export abstract class CampaignOperationsRepository {
  abstract hasQcttPlan(campaignId: string): Promise<boolean>;
  abstract read(campaignId: string): Promise<{ workflowId: string; operationalState: string; requests: CampaignChange[]; plans: CampaignPlanRecord[] } | null>;
  abstract receipt(actorId: string, key: string): Promise<CampaignChange | null>;
  abstract createRequest(input: Omit<CampaignChange, 'id' | 'state' | 'recordVersion' | 'requestedAt' | 'decidedAt' | 'decidedByActorId' | 'decisionReason'>): Promise<CampaignChange>;
  abstract decide(requestId: string, actorId: string, approved: boolean, reason: string): Promise<void>;
  abstract withdraw(requestId: string, actorId: string, reason: string): Promise<void>;
  abstract supersedePending(workflowId: string, exceptId: string, actorId: string, reason: string): Promise<string[]>;
  abstract createPlan(input: Omit<CampaignPlanRecord, 'id' | 'createdAt'>): Promise<CampaignPlanRecord>;
  abstract setOperationalState(workflowId: string, state: string): Promise<void>;
  abstract touch(workflowId: string): Promise<void>;
  abstract actorActive(actorId: string): Promise<boolean>;
  abstract audit(actor: ActorContext, campaignId: string, action: string, payload: Record<string, unknown>): Promise<void>;
}
