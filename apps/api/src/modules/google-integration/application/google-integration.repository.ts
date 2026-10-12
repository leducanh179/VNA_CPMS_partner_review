import type { ActorContext } from '@cpms/domain';

export const GOOGLE_INTEGRATION_REPOSITORY = Symbol('GOOGLE_INTEGRATION_REPOSITORY');

export interface StoredGoogleConnection {
  actorId: string;
  providerAccountId: string;
  accountEmail: string;
  accountName: string | null;
  encryptedTokens: string;
  grantedScopes: string[];
  accessTokenExpiresAt: Date | null;
}

export interface StoredDriveIntegrationConnection extends Omit<StoredGoogleConnection, 'actorId'> {
  key: 'campaign-drive';
  connectedByActorId: string;
}

export interface SpreadsheetOperationRecord {
  id: string;
  actorId: string;
  idempotencyKey: string;
  kind: string;
  spreadsheetId: string;
  sourceSheetId: string | null;
  targetSheetId: string | null;
  targetSheetName: string | null;
  resultUrl: string | null;
  status: string;
}

export interface GoogleIntegrationRepository {
  getConnection(actorId: string): Promise<StoredGoogleConnection | null>;
  getDriveConnection(): Promise<StoredDriveIntegrationConnection | null>;
  saveDriveConnectionWithAudit(input: StoredDriveIntegrationConnection, actor: ActorContext): Promise<void>;
  updateDriveEncryptedTokens(encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]): Promise<void>;
  deleteDriveConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>): Promise<void>;
  saveConnectionWithAudit(input: StoredGoogleConnection, actor: ActorContext): Promise<void>;
  updateEncryptedTokens(actorId: string, encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]): Promise<void>;
  deleteConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>): Promise<void>;
  createOAuthState(stateHash: string, actorId: string, expiresAt: Date): Promise<void>;
  consumeOAuthState(stateHash: string, actorId: string, now: Date): Promise<boolean>;
  recordAudit(actor: ActorContext, action: string, entityId: string | null, metadata: Record<string, unknown>): Promise<void>;
  findOperation(actorId: string, idempotencyKey: string): Promise<SpreadsheetOperationRecord | null>;
  startOperation(input: Omit<SpreadsheetOperationRecord, 'id' | 'targetSheetId' | 'resultUrl' | 'status'>): Promise<SpreadsheetOperationRecord>;
  completeOperationWithAudit(input: {
    operationId: string;
    targetSheetId: string;
    targetSheetName: string;
    resultUrl: string;
    actor: ActorContext;
    auditAction: string;
    metadata: Record<string, unknown>;
  }): Promise<SpreadsheetOperationRecord>;
}
