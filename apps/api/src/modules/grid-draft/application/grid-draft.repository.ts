import type { ActorContext } from '@cpms/domain';

export interface GridDraftData { value: Record<string, unknown>; recordVersion: number }
export abstract class GridDraftRepository {
  abstract get(scope: string, actorId: string): Promise<GridDraftData | null>;
  abstract save(scope: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext): Promise<GridDraftData>;
}
