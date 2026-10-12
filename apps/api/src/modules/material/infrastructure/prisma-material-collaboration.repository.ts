import type { ActorContext, MaterialCommentItem, MaterialJournalItem } from '@cpms/domain';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MaterialComment, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { MaterialCollaborationRepository } from '../application/material-collaboration.repository';

function toComment(row: MaterialComment & { author: { displayName: string } }): MaterialCommentItem {
  return {
    id: row.id, materialId: row.materialId, authorActorId: row.authorActorId,
    authorName: row.author.displayName, body: row.deletedAt ? '' : row.body, parentId: row.parentId,
    recordVersion: row.recordVersion, createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() || null, deletedAt: row.deletedAt?.toISOString() || null,
  };
}

@Injectable()
export class PrismaMaterialCollaborationRepository implements MaterialCollaborationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async materialExists(materialId: string) {
    return Boolean(await this.prisma.database.materialRecord.findFirst({ where: { materialId, isDeleted: false }, select: { id: true } }));
  }

  async listComments(materialId: string) {
    const rows = await this.prisma.database.materialComment.findMany({ where: { materialId }, include: { author: { select: { displayName: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 });
    return rows.map(toComment);
  }

  async listJournal(materialId: string): Promise<MaterialJournalItem[]> {
    const rows = await this.prisma.database.auditEvent.findMany({ where: { entityType: 'material', entityId: materialId }, include: { actor: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((row) => ({
      id: row.id, action: row.action, actorName: row.actor.displayName, createdAt: row.createdAt.toISOString(),
      payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {},
    }));
  }

  async createComment(materialId: string, body: string, parentId: string | null, actor: ActorContext) {
    return this.prisma.inTransaction(async (tx) => {
      if (parentId) {
        const parent = await tx.materialComment.findUnique({ where: { id: parentId } });
        if (!parent || parent.materialId !== materialId || parent.deletedAt) throw new BadRequestException('Bình luận được trả lời không tồn tại.');
      }
      const row = await tx.materialComment.create({ data: { materialId, body, parentId, authorActorId: actor.id }, include: { author: { select: { displayName: true } } } });
      await tx.auditEvent.create({ data: this.audit(actor, materialId, 'material.comment_created', { commentId: row.id }) });
      return toComment(row);
    });
  }

  async updateComment(materialId: string, id: string, body: string, expectedVersion: number, actor: ActorContext, canManage: boolean) {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.materialComment.findUnique({ where: { id } });
      this.assertWritable(current, materialId, expectedVersion, actor, canManage);
      const updated = await tx.materialComment.update({ where: { id }, data: { body, editedAt: new Date(), recordVersion: { increment: 1 } }, include: { author: { select: { displayName: true } } } });
      await tx.auditEvent.create({ data: this.audit(actor, materialId, 'material.comment_updated', { commentId: id, recordVersion: updated.recordVersion }) });
      return toComment(updated);
    });
  }

  async deleteComment(materialId: string, id: string, expectedVersion: number, actor: ActorContext, canManage: boolean) {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.materialComment.findUnique({ where: { id } });
      this.assertWritable(current, materialId, expectedVersion, actor, canManage);
      const updated = await tx.materialComment.update({ where: { id }, data: { deletedAt: new Date(), recordVersion: { increment: 1 } }, include: { author: { select: { displayName: true } } } });
      await tx.auditEvent.create({ data: this.audit(actor, materialId, 'material.comment_deleted', { commentId: id, recordVersion: updated.recordVersion }) });
      return toComment(updated);
    });
  }

  private assertWritable(current: MaterialComment | null, materialId: string, version: number, actor: ActorContext, canManage: boolean): asserts current is MaterialComment {
    if (!current || current.materialId !== materialId || current.deletedAt) throw new NotFoundException('Không tìm thấy bình luận.');
    if (current.authorActorId !== actor.id && !canManage) throw new ForbiddenException('Chỉ tác giả hoặc quản trị viên có thể sửa bình luận.');
    if (current.recordVersion !== version) throw new ConflictException('Bình luận đã thay đổi. Hãy tải lại.');
  }

  private audit(actor: ActorContext, materialId: string, action: string, payload: Prisma.InputJsonValue) {
    return {
      actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
      contextMode: actor.session?.mode ?? 'DIRECT', action,
      entityType: 'material', entityId: materialId, payload,
    };
  }
}
