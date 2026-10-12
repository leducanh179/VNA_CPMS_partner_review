import type { ActorContext } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  GoogleIntegrationRepository,
  SpreadsheetOperationRecord,
  StoredGoogleConnection,
  StoredDriveIntegrationConnection,
} from '../application/google-integration.repository';

@Injectable()
export class PrismaGoogleIntegrationRepository implements GoogleIntegrationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getConnection(actorId: string): Promise<StoredGoogleConnection | null> {
    const value = await this.prisma.database.googleOAuthConnection.findUnique({ where: { actorId } });
    return value ? { ...value, grantedScopes: [...value.grantedScopes] } : null;
  }

  async getDriveConnection(): Promise<StoredDriveIntegrationConnection | null> {
    const value = await this.prisma.database.googleDriveIntegrationConnection.findUnique({ where: { key: 'campaign-drive' } });
    return value ? { ...value, key: 'campaign-drive', grantedScopes: [...value.grantedScopes] } : null;
  }

  async saveDriveConnectionWithAudit(input: StoredDriveIntegrationConnection, actor: ActorContext) {
    await this.prisma.batchTransaction([
      this.prisma.database.googleDriveIntegrationConnection.upsert({
        where: { key: input.key }, create: input,
        update: { providerAccountId: input.providerAccountId, accountEmail: input.accountEmail,
          accountName: input.accountName, encryptedTokens: input.encryptedTokens, grantedScopes: input.grantedScopes,
          accessTokenExpiresAt: input.accessTokenExpiresAt, connectedByActorId: input.connectedByActorId },
      }),
      this.prisma.database.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action: 'google.drive_integration_connected', entityType: 'google_drive_integration', entityId: input.key,
        payload: { accountEmail: input.accountEmail, grantedScopes: input.grantedScopes },
      } }),
    ]);
  }

  async updateDriveEncryptedTokens(encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]) {
    await this.prisma.database.googleDriveIntegrationConnection.update({ where: { key: 'campaign-drive' },
      data: { encryptedTokens, accessTokenExpiresAt: expiresAt, grantedScopes } });
  }

  async deleteDriveConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>) {
    await this.prisma.batchTransaction([
      this.prisma.database.googleDriveIntegrationConnection.deleteMany({ where: { key: 'campaign-drive' } }),
      this.prisma.database.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action: 'google.drive_integration_disconnected', entityType: 'google_drive_integration', entityId: 'campaign-drive',
        payload: metadata as Prisma.InputJsonValue,
      } }),
    ]);
  }

  async saveConnectionWithAudit(input: StoredGoogleConnection, actor: ActorContext) {
    await this.prisma.batchTransaction([
      this.prisma.database.googleOAuthConnection.upsert({
        where: { actorId: input.actorId },
        create: input,
        update: {
          providerAccountId: input.providerAccountId,
          accountEmail: input.accountEmail,
          accountName: input.accountName,
          encryptedTokens: input.encryptedTokens,
          grantedScopes: input.grantedScopes,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
        },
      }),
      this.prisma.database.auditEvent.create({
        data: {
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'google.connected',
          entityType: 'google_connection',
          entityId: actor.id,
          payload: { accountEmail: input.accountEmail, grantedScopes: input.grantedScopes },
        },
      }),
    ]);
  }

  async updateEncryptedTokens(actorId: string, encryptedTokens: string, expiresAt: Date | null, grantedScopes: string[]) {
    await this.prisma.database.googleOAuthConnection.update({
      where: { actorId },
      data: { encryptedTokens, accessTokenExpiresAt: expiresAt, grantedScopes },
    });
  }

  async deleteConnectionWithAudit(actor: ActorContext, metadata: Record<string, unknown>) {
    await this.prisma.batchTransaction([
      this.prisma.database.googleOAuthConnection.deleteMany({ where: { actorId: actor.id } }),
      this.prisma.database.auditEvent.create({
        data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'google.disconnected', entityType: 'google_connection', entityId: actor.id, payload: metadata as Prisma.InputJsonValue },
      }),
    ]);
  }

  async createOAuthState(stateHash: string, actorId: string, expiresAt: Date) {
    await this.prisma.batchTransaction([
      this.prisma.database.googleOAuthState.deleteMany({ where: { actorId, expiresAt: { lt: new Date() } } }),
      this.prisma.database.googleOAuthState.create({ data: { stateHash, actorId, expiresAt } }),
    ]);
  }

  async consumeOAuthState(stateHash: string, actorId: string, now: Date) {
    // One-time capability consumption intentionally commits independently: a provider exchange failure
    // must never roll its consumed state back into circulation. The scoped service checks actor/session first.
    const deleted = await this.prisma.googleOAuthState.deleteMany({ where: { stateHash, actorId, expiresAt: { gt: now } } });
    return deleted.count === 1;
  }

  async recordAudit(actor: ActorContext, action: string, entityId: string | null, metadata: Record<string, unknown>) {
    await this.prisma.database.auditEvent.create({
      data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action, entityType: 'google_spreadsheet', entityId, payload: metadata as Prisma.InputJsonValue },
    });
  }

  async findOperation(actorId: string, idempotencyKey: string): Promise<SpreadsheetOperationRecord | null> {
    return this.prisma.database.spreadsheetExchangeOperation.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey } } });
  }

  async startOperation(input: Omit<SpreadsheetOperationRecord, 'id' | 'targetSheetId' | 'resultUrl' | 'status'>) {
    try {
      return await this.prisma.database.spreadsheetExchangeOperation.create({
        data: { id: randomUUID(), ...input, targetSheetId: null, resultUrl: null, status: 'PENDING', metadata: {} },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.database.spreadsheetExchangeOperation.findUniqueOrThrow({ where: { actorId_idempotencyKey: { actorId: input.actorId, idempotencyKey: input.idempotencyKey } } });
      }
      throw error;
    }
  }

  async completeOperationWithAudit(input: { operationId: string; targetSheetId: string; targetSheetName: string; resultUrl: string; actor: ActorContext; auditAction: string; metadata: Record<string, unknown> }) {
    const [operation] = await this.prisma.batchTransaction([
      this.prisma.database.spreadsheetExchangeOperation.update({
        where: { id: input.operationId },
        data: { targetSheetId: input.targetSheetId, targetSheetName: input.targetSheetName, resultUrl: input.resultUrl, status: 'COMPLETED', metadata: input.metadata as Prisma.InputJsonValue },
      }),
      this.prisma.database.auditEvent.create({
        data: { actorId: input.actor.id, originalActorId: input.actor.session?.originalActorId ?? input.actor.id, contextMode: input.actor.session?.mode ?? 'DIRECT', action: input.auditAction, entityType: 'google_spreadsheet', entityId: input.operationId, payload: input.metadata as Prisma.InputJsonValue },
      }),
    ]);
    return operation;
  }
}
