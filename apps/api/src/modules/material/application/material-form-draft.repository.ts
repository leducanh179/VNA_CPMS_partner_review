import type { ActorContext } from '@cpms/domain';

export interface MaterialFormDraftData {
  id: string;
  materialId: string | null;
  title: string;
  formData: Record<string, unknown>;
  recordVersion: number;
  updatedAt: Date;
}

export abstract class MaterialFormDraftRepository {
  abstract list(ownerActorId: string): Promise<Omit<MaterialFormDraftData, 'formData'>[]>;
  abstract get(id: string, ownerActorId: string): Promise<MaterialFormDraftData | null>;
  abstract save(id: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext): Promise<MaterialFormDraftData>;
  abstract remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean>;
}
