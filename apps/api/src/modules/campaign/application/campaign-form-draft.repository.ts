import type { ActorContext } from '@cpms/domain';

export interface CampaignFormDraftData {
  id: string;
  title: string;
  levelCode: string | null;
  formData: Record<string, unknown>;
  recordVersion: number;
  updatedAt: Date;
}

export abstract class CampaignFormDraftRepository {
  abstract list(ownerActorId: string): Promise<Omit<CampaignFormDraftData, 'formData'>[]>;
  abstract get(id: string, ownerActorId: string): Promise<CampaignFormDraftData | null>;
  abstract save(id: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext): Promise<CampaignFormDraftData>;
  abstract remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean>;
}
