import type { RoleCode } from '@cpms/domain';

export interface LocalAccount {
  id: string; key: string; displayName: string; loginEmail: string | null;
  accountKind: string; isActive: boolean; authzVersion: number; roles: RoleCode[];
  personnelEmployeeCode: string | null;
  profile: { organizationName: string; departmentName: string | null; jobTitle: string | null; gmailEmail: string | null } | null;
  employment: { departmentId: string; divisionId: string | null } | null;
  credential: { passwordHash: string; credentialVersion: number; mustChangePassword: boolean } | null;
}
export interface StoredLocalSession {
  id: string; tokenHash: string; csrfHash: string; mode: 'DIRECT' | 'DEMO_IMPERSONATION' | 'ADMIN_ASSIST';
  credentialVersion: number; createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null;
  original: LocalAccount; effective: LocalAccount;
}
export interface NewLocalSession {
  tokenHash: string; csrfHash: string; originalActorId: string; effectiveActorId: string;
  credentialVersion: number; mode: 'DIRECT' | 'DEMO_IMPERSONATION' | 'ADMIN_ASSIST'; expiresAt: Date;
}
export interface AccountAdministrationChange {
  targetActorId: string; expectedVersion: number; isActive: boolean; reason: string;
}
export interface DivisionLeaderProfile {
  employeeCode: string; fullName: string; email: string; gmailEmail: string | null;
  organizationName: string; departmentName: string; jobTitle: string;
  gender: 'Nam' | 'Nữ' | 'Khác'; birthDate: string; phoneText: string;
}
export abstract class IdentityRepository {
  abstract accountByEmail(email: string): Promise<LocalAccount | null>;
  abstract accountById(id: string): Promise<LocalAccount | null>;
  abstract sessionByHash(hash: string): Promise<StoredLocalSession | null>;
  abstract reserveLoginAttempt(emailHash: string, ipHash: string): Promise<boolean>;
  abstract createSession(session: NewLocalSession): Promise<StoredLocalSession>;
  abstract touchSession(id: string, seenAt: Date): Promise<void>;
  abstract revokeSession(id: string): Promise<void>;
  abstract rotateSession(id: string, replacement: NewLocalSession, action: 'DEMO_START' | 'DEMO_END' | 'ASSIST_START' | 'ASSIST_END', reason?: string): Promise<StoredLocalSession>;
  abstract changeCredential(sessionId: string, actorId: string, expectedCredentialVersion: number, passwordHash: string): Promise<void>;
  abstract resetCredential(sessionId: string, actorId: string, expectedVersion: number, passwordHash: string, reason: string, mustChangePassword: boolean): Promise<void>;
  abstract changeAccountStatus(sessionId: string, change: AccountAdministrationChange): Promise<void>;
  abstract createDivisionLeader(sessionId: string, profile: DivisionLeaderProfile, passwordHash: string, mustChangePassword: boolean, reason: string): Promise<LocalAccount>;
  abstract createCommunicationSpecialist(sessionId: string, employeeCode: string, email: string, passwordHash: string, reason: string): Promise<LocalAccount>;
  abstract createPilotAdmin(sessionId: string, email: string, displayName: string, passwordHash: string, reason: string): Promise<LocalAccount>;
  abstract updateGmail(sessionId: string, actorId: string, expectedVersion: number, gmailEmail: string | null, reason: string): Promise<void>;
  abstract listAccounts(sessionId: string): Promise<LocalAccount[]>;
  abstract configureLocalDemoCredentials(sessionId: string, credentials: { actorId: string; expectedVersion: number; passwordHash: string }[], reason: string): Promise<{ configured: number }>;
  abstract readLocalDemoDefaultPassword(): Promise<string>;
}
