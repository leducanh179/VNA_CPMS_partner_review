import type { AccessRule, ActorContext } from '@cpms/domain';
import type { ManagedAccessCommand } from './access-administration';

export interface AccessAdministrationView {
  version: number;
  definitions: unknown[]; roles: unknown[]; bindings: unknown[]; overrides: unknown[];
  accounts: unknown[]; organizations: unknown[]; history: unknown[];
  pendingContacts: { email: string; sourceSheet: string; sourceRow: number }[];
}
export interface AccessChangePreview { kind: string; key: string; actorId: string | null; before: unknown; after: unknown }
export abstract class AccessAdministrationRepository {
  abstract read(filters: { actorId?: string; campaignId?: string }): Promise<AccessAdministrationView>;
  abstract preview(command: ManagedAccessCommand): Promise<AccessChangePreview[]>;
  abstract projectRules(command: ManagedAccessCommand): Promise<{ actorId: string; before: AccessRule[]; after: AccessRule[] }[]>;
  abstract save(command: ManagedAccessCommand, actor: ActorContext): Promise<{ version: number; changes: AccessChangePreview[] }>;
}
