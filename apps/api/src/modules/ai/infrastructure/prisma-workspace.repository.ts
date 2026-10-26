import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActorContext } from '@cpms/domain';
import type { AiWorkspacePolicy } from '@cpms/ai-contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WorkspaceRepository, type ProposalRecord } from '../application/workspace.repository';
import type { LibraryEntry } from '../domain/library-index';
const json = (value: unknown) => value as Prisma.InputJsonValue;
@Injectable()
export class PrismaWorkspaceRepository extends WorkspaceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async state() { return await this.prisma.database.aiWorkspaceState.findUnique({ where: { id: 'main' } }) ??
    { version: 0, draftVersion: 0, draft: {}, published: {}, libraryVersion: 0, librarySpreadsheetId: '', librarySyncedAt: null }; }
  async versions() { return this.prisma.database.aiPolicyVersion.findMany({ select: { version: true, actorId: true, createdAt: true }, orderBy: { version: 'desc' }, take: 30 }); }
  async version(version: number) { const row = await this.prisma.database.aiPolicyVersion.findUnique({ where: { version } }); if (!row) throw new NotFoundException('Không tìm thấy phiên bản cấu hình.'); return row.policy; }
  private async audit(actor: ActorContext, action: string, entityId: string, payload: unknown) {
    await this.prisma.database.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
      contextMode: actor.session?.mode ?? 'DIRECT', action, entityType: 'AiWorkspace', entityId, payload: json(payload) } });
  }
  async saveDraft(policy: AiWorkspacePolicy, expected: number, actor: ActorContext) {
    return this.prisma.withSecurityLock(async tx => {
      const state = await this.state(); if (state.draftVersion !== expected) throw new ConflictException('Bản nháp cấu hình đã thay đổi.');
      await tx.aiWorkspaceState.upsert({ where: { id: 'main' }, create: { id: 'main', draftVersion: 1, draft: json(policy) }, update: { draft: json(policy), draftVersion: { increment: 1 } } });
      await this.audit(actor,'ai.policy.draft','main',{ draftVersion: expected + 1 });
    });
  }
  async publish(expected: number, actor: ActorContext, rollbackVersion?: number) {
    return this.prisma.withSecurityLock(async tx => {
      const state = await this.state(); if (state.draftVersion !== expected || !state.draftVersion) throw new ConflictException('Hãy lưu hoặc tải lại bản nháp cấu hình.');
      const policy = rollbackVersion ? await this.version(rollbackVersion) : state.draft;
      await tx.aiPolicyVersion.create({ data: { version: state.version + 1, policy: json(policy), actorId: actor.id } });
      await tx.aiWorkspaceState.update({ where: { id: 'main' }, data: { published: json(policy), draft: json(policy), version: { increment: 1 }, draftVersion: { increment: 1 } } });
      await this.audit(actor,'ai.policy.publish','main',{ version: state.version + 1, rollbackVersion: rollbackVersion ?? null });
    });
  }
  async library() { return (await this.prisma.database.aiLibraryEntry.findMany({ orderBy: { id: 'asc' } })).map(row => row.data as unknown as LibraryEntry); }
  async replaceLibrary(rows: LibraryEntry[], spreadsheetId: string, expectedVersion: number, actor: ActorContext) {
    return this.prisma.withSecurityLock(async tx => {
      const state = await this.state(); if (state.version !== expectedVersion) throw new ConflictException('Cấu hình nguồn đã thay đổi trong khi đồng bộ.');
      await tx.aiLibraryEntry.deleteMany();
      for (let offset = 0; offset < rows.length; offset += 300) await tx.aiLibraryEntry.createMany({ data: rows.slice(offset,offset+300).map(row => ({ id: row.id, itemId: row.itemId, rootId: row.rootId, sourceRow: row.sourceRow, data: json(row) })) });
      await tx.aiWorkspaceState.update({ where: { id: 'main' }, data: { librarySpreadsheetId: spreadsheetId, libraryVersion: { increment: 1 }, librarySyncedAt: new Date() } });
      await this.audit(actor,'ai.library.synced',spreadsheetId,{ entries: rows.length, libraryVersion: state.libraryVersion + 1 });
    });
  }
  async createProposal(input: Omit<ProposalRecord,'createdAt'>, actor: ActorContext) {
    const created = await this.prisma.database.aiAgentProposal.create({ data: { ...input, changes: json(input.changes), result: json(input.result) } });
    await this.audit(actor,'ai.proposal.prepared',input.id,{ campaignId: input.campaignId, runId: input.runId, fields: input.changes.map(c => c.field) });
    return created as unknown as ProposalRecord;
  }
  async proposal(id: string, actorId: string) {
    return await this.prisma.database.aiAgentProposal.findFirst({ where: { id, actorId, run: { state: 'COMPLETE', conversation: { deletedAt: null, actorId } } } }) as unknown as ProposalRecord | null;
  }
  async finishProposal(id: string, state: string, result: Record<string, unknown>, actor: ActorContext) {
    await this.prisma.database.aiAgentProposal.update({ where: { id }, data: { state, result: json(result) } });
    await this.audit(actor,'ai.proposal.confirmed',id,{ state, ...result });
  }
  async replaceProposal(previous: ProposalRecord, nextId: string, actor: ActorContext) {
    await this.prisma.database.aiAgentProposal.update({where:{id:previous.id},data:{state:'SUPERSEDED',result:{nextId}}});
    const run = await this.prisma.database.aiLookupRun.findUniqueOrThrow({where:{id:previous.runId}});
    await this.prisma.database.aiLookupRun.update({where:{id:run.id},data:{artifacts:{...run.artifacts as Prisma.JsonObject,proposalId:nextId}}});
    await this.audit(actor,'ai.proposal.revised',previous.id,{nextId});
  }
}
