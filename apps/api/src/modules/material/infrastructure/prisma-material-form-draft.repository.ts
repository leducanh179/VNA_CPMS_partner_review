import type { ActorContext } from '@cpms/domain';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MaterialFormDraftRepository, type MaterialFormDraftData } from '../application/material-form-draft.repository';

@Injectable()
export class PrismaMaterialFormDraftRepository extends MaterialFormDraftRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  async list(ownerActorId: string) {
    return this.prisma.database.materialFormDraft.findMany({ where: { ownerActorId }, select: { id: true, materialId: true, title: true, recordVersion: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  async get(id: string, ownerActorId: string): Promise<MaterialFormDraftData | null> {
    const row = await this.prisma.database.materialFormDraft.findFirst({ where: { id, ownerActorId } });
    return row ? { ...row, formData: row.formData as Record<string, unknown> } : null;
  }

  async save(id: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext): Promise<MaterialFormDraftData> {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.materialFormDraft.findUnique({ where: { id } });
      if (current && current.ownerActorId !== actor.id) throw new NotFoundException('Không tìm thấy bản nhập dở.');
      if (current?.recordVersion !== expectedVersion && !(current === null && expectedVersion === 0))
        throw new ConflictException('Bản nhập dở đã thay đổi ở phiên khác. Hãy tải lại trước khi tiếp tục.');
      const title = typeof value.title === 'string' ? value.title.trim().slice(0, 500) : '';
      const materialId = typeof value.materialId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value.materialId) ? value.materialId : null;
      const row = current
        ? await tx.materialFormDraft.update({ where: { id, recordVersion: expectedVersion }, data: { title, materialId, formData: value as Prisma.InputJsonValue, recordVersion: { increment: 1 } } })
        : await tx.materialFormDraft.create({ data: { id, ownerActorId: actor.id, title, materialId, formData: value as Prisma.InputJsonValue } });
      await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: current ? 'material.form_draft_updated' : 'material.form_draft_created', entityType: 'material_form_draft', entityId: id, payload: { recordVersion: row.recordVersion } } });
      return { ...row, formData: row.formData as Record<string, unknown> };
    });
  }

  async remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean> {
    return this.prisma.inTransaction(async (tx) => {
      const result = await tx.materialFormDraft.deleteMany({ where: { id, ownerActorId } });
      if (result.count) await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'material.form_draft_removed', entityType: 'material_form_draft', entityId: id, payload: {} } });
      return result.count > 0;
    });
  }
}
