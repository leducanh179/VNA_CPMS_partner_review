import type { ActorContext, MaterialGrant, MaterialSharing, MaterialSummary } from '@cpms/domain';

export interface MaterialSharingDirectory {
  accounts: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
}
export abstract class MaterialSharingRepository {
  abstract activeOrganizationIds(ids: readonly string[]): Promise<string[]>;
  abstract directory(query: string): Promise<MaterialSharingDirectory>;
  abstract validTargets(campaignIds: string[], grants: MaterialGrant[]): Promise<boolean>;
  abstract save(materialId: string, expectedVersion: number, sharing: MaterialSharing, actor: ActorContext): Promise<MaterialSummary>;
  abstract publicList(query: string, page: number, pageSize: number): Promise<{ records: MaterialSummary[]; total: number }>;
  abstract publicDetail(materialId: string): Promise<MaterialSummary | null>;
}
