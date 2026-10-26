import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { LookupRepository, type LookupRun } from '../application/lookup.repository';
import { LOOKUP_LIMIT_VND, LOOKUP_PRICE_VERSION } from '../domain/lookup-policy';

@Injectable()
export class PrismaLookupRepository extends LookupRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>) { super(); }
  async accountId(email: string) {
    const row = await this.prisma.database.actor.findFirst({ where: { loginEmail: email, isActive: true }, select: { id: true } });
    return row?.id ?? null;
  }
  async totals(period: string) {
    const result = await this.prisma.database.aiLookupRun.aggregate({ where: { period }, _sum: { chargedVnd: true, reservedVnd: true } });
    const prior = this.config.get('AI_PRIOR_SPEND_PERIOD', { infer: true }) === period ? this.config.get('AI_PRIOR_SPEND_VND', { infer: true }) : 0;
    return { chargedVnd: (result._sum.chargedVnd ?? 0) + prior, reservedVnd: result._sum.reservedVnd ?? 0 };
  }
  async get(id: string, actorId: string) {
    return await this.prisma.database.aiLookupRun.findFirst({ where: { id, actorId } }) as unknown as LookupRun | null;
  }
  async recent(actorId: string) {
    return await this.prisma.database.aiLookupRun.findMany({ where: { actorId }, orderBy: { createdAt: 'desc' }, take: 10 }) as unknown as LookupRun[];
  }
  async conversation(id: string, actorId: string) {
    return this.prisma.database.aiConversation.findFirst({ where: { id, actorId, deletedAt: null } });
  }
  async conversations(actorId: string, cursor?: string) {
    if (cursor && !await this.conversation(cursor, actorId)) throw new NotFoundException('Không tìm thấy hội thoại.');
    const rows = await this.prisma.database.aiConversation.findMany({ where: { actorId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
  }
  async turns(id: string, actorId: string, before?: string) {
    if (!await this.conversation(id, actorId)) throw new NotFoundException('Không tìm thấy hội thoại.');
    if (before && !await this.prisma.database.aiLookupRun.findFirst({ where: { id: before, actorId, conversationId: id } }))
      throw new NotFoundException('Không tìm thấy tin nhắn.');
    const rows = await this.prisma.database.aiLookupRun.findMany({ where: { actorId, conversationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, ...(before ? { cursor: { id: before }, skip: 1 } : {}) });
    return { items: rows.slice(0, 20) as unknown as LookupRun[], nextCursor: rows.length > 20 ? rows[19]!.id : null };
  }
  async rename(id: string, actorId: string, title: string, version: number) {
    return this.prisma.withSecurityLock(async tx => {
      const row = await this.conversation(id, actorId);
      if (!row) throw new NotFoundException('Không tìm thấy hội thoại.');
      if (row.version !== version) throw new ConflictException('Tên hội thoại đã thay đổi. Hãy tải lại danh sách.');
      return tx.aiConversation.update({ where: { id }, data: { title, version: { increment: 1 } } });
    });
  }
  async deleteConversation(id: string, actorId: string) {
    await this.prisma.withSecurityLock(async tx => {
      if (!await this.conversation(id, actorId)) throw new NotFoundException('Không tìm thấy hội thoại.');
      await tx.aiConversation.update({ where: { id }, data: { title: '', deletedAt: new Date(), version: { increment: 1 } } });
      // Ledger survives deletion; conversational content and evidence do not.
      await tx.aiAgentProposal.deleteMany({ where: { actorId, run: { conversationId: id } } });
      await tx.aiLookupRun.updateMany({ where: { conversationId: id, actorId }, data: { question: '', answer: '', sources: [], evidence: [], artifacts: {} } });
    });
  }
  async reserve(input: Parameters<LookupRepository['reserve']>[0]) {
    return this.prisma.withSecurityLock(async tx => {
      if (input.conversationId && !await this.conversation(input.conversationId, input.actorId)) throw new NotFoundException('Không tìm thấy hội thoại.');
      const existing = await tx.aiLookupRun.findUnique({ where: { id: input.id } });
      if (existing) throw new ConflictException('Yêu cầu này đã được nhận. Hãy tải lại lịch sử, không gửi lại cùng mã yêu cầu.');
      // Crash/timeout cannot turn possibly charged usage into free budget, including across month boundaries.
      const stale = await tx.aiLookupRun.findMany({ where: { state: 'RUNNING', createdAt: { lt: new Date(Date.now() - 300_000) } } });
      for (const row of stale) await tx.aiLookupRun.update({ where: { id: row.id }, data: { state: 'UNCERTAIN', chargedVnd: row.reservedVnd, reservedVnd: 0 } });
      if (await tx.aiLookupRun.count({ where: { state: 'RUNNING' } })) throw new ConflictException('Đang có một lượt AI xử lý. Vui lòng chờ hoàn tất.');
      const totals = await this.totals(input.period);
      if (totals.chargedVnd + totals.reservedVnd + input.reserveVnd > LOOKUP_LIMIT_VND) throw new HttpException('Ngân sách còn lại không đủ dự trù lượt hỏi này.', 429);
      const conversation = input.conversationId
        ? await tx.aiConversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } })
        : await tx.aiConversation.create({ data: { id: randomUUID(), actorId: input.actorId, title: input.question.replace(/\s+/g, ' ').slice(0, 100) } });
      return await tx.aiLookupRun.create({ data: {
        id: input.id, actorId: input.actorId, period: input.period, question: input.question, mode: input.mode,
        conversationId: conversation.id, state: 'RUNNING', reservedVnd: input.reserveVnd, priceVersion: LOOKUP_PRICE_VERSION,
      } }) as unknown as LookupRun;
    });
  }
  async finish(id: string, result: Parameters<LookupRepository['finish']>[1]) {
    await this.prisma.withSecurityLock(async tx => {
      const row = await tx.aiLookupRun.findUniqueOrThrow({ where: { id } });
      if (row.state !== 'RUNNING') return;
      const deleted = row.conversationId && !await this.conversation(row.conversationId, row.actorId);
      await tx.aiLookupRun.update({ where: { id }, data: {
        state: deleted && result.state === 'COMPLETE' ? 'FAILED' : result.state, answer: deleted ? '' : result.answer, chargedVnd: result.chargedVnd, reservedVnd: 0,
        sources: (deleted ? [] : result.sources) as unknown as Prisma.InputJsonValue,
        evidence: (deleted ? [] : result.evidence) as unknown as Prisma.InputJsonValue,
        usage: result.usage as unknown as Prisma.InputJsonValue,
        artifacts: (deleted ? {} : result.artifacts ?? {}) as Prisma.InputJsonValue,
      } });
    });
  }
}
