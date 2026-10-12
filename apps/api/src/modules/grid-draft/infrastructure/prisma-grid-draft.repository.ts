import type { ActorContext } from '@cpms/domain';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GridDraftRepository } from '../application/grid-draft.repository';

@Injectable()
export class PrismaGridDraftRepository extends GridDraftRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async get(scope: string, ownerActorId: string) {
    const row = await this.prisma.database.gridDraft.findUnique({ where: { ownerActorId_scope: { ownerActorId, scope } } });
    return row ? { value: row.value as Record<string, unknown>, recordVersion: row.recordVersion } : null;
  }
  async save(scope: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext) {
    return this.prisma.inTransaction(async tx => {
      const where = { ownerActorId: actor.id, scope };
      const current = await tx.gridDraft.findUnique({ where: { ownerActorId_scope: where } });
      if ((current?.recordVersion ?? 0) !== expectedVersion) throw new ConflictException('Bản nhập dở đã thay đổi ở cửa sổ khác. Hãy tải lại trước khi tiếp tục.');
      const row = current
        ? await tx.gridDraft.update({ where: { id: current.id, recordVersion: expectedVersion }, data: { value: value as Prisma.InputJsonValue, recordVersion: { increment: 1 } } })
        : await tx.gridDraft.create({ data: { ...where, value: value as Prisma.InputJsonValue } });
      await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
        contextMode: actor.session?.mode ?? 'DIRECT', action: 'grid.draft_saved', entityType: 'grid_draft', entityId: row.id,
        payload: { scope, recordVersion: row.recordVersion } } });
      return { value: row.value as Record<string, unknown>, recordVersion: row.recordVersion };
    });
  }
}
