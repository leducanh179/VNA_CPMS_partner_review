import type { AccessIdentity, AccessPermission, AccessResource, AccessRule, ActorContext } from '@cpms/domain';

export interface AccessSnapshot {
  actor: ActorContext;
  identity: AccessIdentity;
  rules: AccessRule[];
  implemented: ReadonlySet<string>;
  now: number;
  policyVersion: number;
  requiredAtCommit: { permission: AccessPermission; resource?: AccessResource; fieldKey?: string }[];
}

/** Port owns the transaction fence; all command repositories use its transaction context. */
export abstract class AccessRepository {
  moduleMetadata(): Promise<AccessResource[]> { return Promise.resolve([]); }
  abstract execute<T>(actor: ActorContext, operation: (snapshot: AccessSnapshot) => Promise<T>): Promise<T>;
  abstract campaignMetadata(input: { id?: string; code?: string; trash?: boolean }): Promise<AccessResource[]>;
  abstract initializeCatalog(actor: ActorContext): Promise<{ initializedRoles: number; definitions: number }>;
  abstract describeAccount(actorId: string): Promise<{ identity: AccessIdentity; rules: AccessRule[] } | null>;
}

export type { CampaignAccessCapabilities } from '@cpms/domain';
