import type { ActorContext, MaterialFields, MaterialSummary } from '@cpms/domain';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MaterialPortalReference, MaterialRecord, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  MaterialReferenceRow,
  MaterialRepository,
  PersistMaterialRecord,
} from '../application/material.repository';

function toStringRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, fieldValue]) => (
    typeof fieldValue === 'string' ? [[key, fieldValue]] : fieldValue === null ? [[key, '']] : []
  )));
}

function toSummary(record: MaterialRecord): MaterialSummary {
  const values = toStringRecord(record.data);
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])) as MaterialFields;
  fields.material_id = record.materialId;
  fields.record_version = String(record.recordVersion);
  fields.is_deleted = record.isDeleted ? 'TRUE' : 'FALSE';
  return {
    id: record.id,
    materialId: record.materialId,
    fields,
    recordVersion: record.recordVersion,
    isDeleted: record.isDeleted,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toReference(row: MaterialPortalReference): MaterialReferenceRow {
  return { type: row.type, key: row.key, data: toStringRecord(row.data) };
}

@Injectable()
export class PrismaMaterialRepository implements MaterialRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(includeDeleted: boolean): Promise<MaterialSummary[]> {
    const records = await this.prisma.database.materialRecord.findMany({
      ...(includeDeleted ? {} : { where: { isDeleted: false } }),
      orderBy: [{ updatedAt: 'desc' }, { materialId: 'asc' }],
      take: 5000,
    });
    return records.map(toSummary);
  }

  async findByMaterialIds(materialIds: readonly string[]): Promise<MaterialSummary[]> {
    if (!materialIds.length) return [];
    const records = await this.prisma.database.materialRecord.findMany({ where: { materialId: { in: [...new Set(materialIds)] } } });
    return records.map(toSummary);
  }

  async saveBatch(records: readonly PersistMaterialRecord[], actor: ActorContext, auditAction: string): Promise<MaterialSummary[]> {
    if (!records.length) return [];
    const materialIds = records.map((record) => record.materialId);
    await this.prisma.inTransaction(async (transaction) => {
      const previous = await transaction.materialRecord.findMany({ where: { materialId: { in: materialIds } }, select: { materialId: true, data: true } });
      const previousById = new Map(previous.map((row) => [row.materialId, toStringRecord(row.data)]));
      for (const record of records) {
        if (record.recordVersion === 1) {
          await transaction.materialRecord.create({ data: {
            materialId: record.materialId,
            data: record.fields as Prisma.InputJsonValue,
            recordVersion: record.recordVersion,
            isDeleted: record.isDeleted,
            createdBy: record.createdBy,
            updatedBy: record.updatedBy,
          } });
        } else {
          await transaction.materialRecord.update({
            where: { materialId: record.materialId },
            data: {
            data: record.fields as Prisma.InputJsonValue,
            recordVersion: record.recordVersion,
            isDeleted: record.isDeleted,
            updatedBy: record.updatedBy,
          },
          });
        }
      }
      await transaction.auditEvent.createMany({
        data: records.map((record) => ({
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: auditAction,
          entityType: 'material',
          entityId: record.materialId,
          payload: {
            materialId: record.materialId, recordVersion: record.recordVersion,
            changedFields: Object.keys(record.fields).filter((key) => !['updated_at', 'updated_by', 'record_version'].includes(key)
              && (previousById.get(record.materialId)?.[key] ?? null) !== (record.fields[key as keyof MaterialFields] ?? null)),
          },
        })),
      });
    });
    const saved = await this.prisma.database.materialRecord.findMany({ where: { materialId: { in: materialIds } } });
    return saved.map(toSummary);
  }

  async purge(materialId: string, expectedVersion: number, actor: ActorContext): Promise<void> {
    await this.prisma.inTransaction(async (transaction) => {
      const current = await transaction.materialRecord.findUnique({ where: { materialId }, select: { id: true, recordVersion: true } });
      if (!current) throw new NotFoundException('Không tìm thấy tư liệu.');
      if (current.recordVersion !== expectedVersion) throw new ConflictException('Tư liệu đã thay đổi. Hãy tải lại trước khi xóa.');
      if (await transaction.bookingRecord.count({ where: { materialId: current.id } })) {
        throw new ConflictException('Tư liệu đang được Đặt chỗ sử dụng; không thể xóa vĩnh viễn.');
      }
      await transaction.materialComment.updateMany({ where: { materialId }, data: { parentId: null } });
      const comments = await transaction.materialComment.deleteMany({ where: { materialId } });
      const deleted = await transaction.materialRecord.deleteMany({ where: { materialId, recordVersion: expectedVersion } });
      if (deleted.count !== 1) throw new ConflictException('Tư liệu đã thay đổi. Hãy tải lại trước khi xóa.');
      await transaction.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
        contextMode: actor.session?.mode ?? 'DIRECT', action: 'material.purged',
        entityType: 'material', entityId: materialId,
        payload: { materialId, recordVersion: expectedVersion, removedComments: comments.count },
      } });
    });
  }

  async listReferences(types: readonly string[]): Promise<MaterialReferenceRow[]> {
    const rows = await this.prisma.database.materialPortalReference.findMany({ where: { type: { in: [...types] } }, orderBy: [{ type: 'asc' }, { key: 'asc' }] });
    return rows.map(toReference);
  }
}
