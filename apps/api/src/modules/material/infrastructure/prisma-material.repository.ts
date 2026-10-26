import { createHash } from 'node:crypto';
import type { ActorContext, MaterialFields, MaterialSummary, MaterialGrant, MaterialSharingMode } from '@cpms/domain';
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

export function materialRecordSummary(record: MaterialRecord): MaterialSummary {
  const values = toStringRecord(record.data);
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])) as MaterialFields;
  fields.material_id = record.materialId;
  fields.record_version = String(record.recordVersion);
  fields.is_deleted = record.isDeleted ? 'TRUE' : 'FALSE';
  return {
    sharing: { mode: (record.sharingMode || 'LEGACY') as MaterialSharingMode, ownerActorId: record.ownerActorId ?? null,
      campaignIds: record.sharingCampaignIds ?? [], grants: (record.sharingGrants ?? []) as unknown as MaterialGrant[] },
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
    return records.map(materialRecordSummary);
  }

  async findByMaterialIds(materialIds: readonly string[]): Promise<MaterialSummary[]> {
    if (!materialIds.length) return [];
    const ids = materialIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    const records = await this.prisma.database.materialRecord.findMany({ where: { OR: [{ materialId: { in: [...new Set(materialIds)] } }, { id: { in: ids } }] } });
    return records.map(materialRecordSummary);
  }

  private receiptId(actor: ActorContext, key: string) {
    return createHash('sha256').update(JSON.stringify([actor.id, key])).digest('hex');
  }

  async findCreationReceipts(clientKeys: readonly string[], actor: ActorContext) {
    if (!clientKeys.length) return [];
    const keys = new Map(clientKeys.map(key => [this.receiptId(actor, key), key]));
    const receipts = await this.prisma.database.auditEvent.findMany({ where: { actorId: actor.id, entityType: 'material_create_receipt', entityId: { in: [...keys.keys()] } }, select: { entityId: true, payload: true } });
    const summaries = receipts.map(receipt => ({ clientKey: keys.get(receipt.entityId!)!, material: (receipt.payload as unknown as { material: MaterialSummary }).material }));
    const current = await this.findByMaterialIds(summaries.map(receipt => receipt.material.materialId));
    return summaries.map(receipt => ({ ...receipt, material: current.find(record => record.materialId === receipt.material.materialId) ?? receipt.material,
      unavailable: !current.some(record => record.materialId === receipt.material.materialId && !record.isDeleted) }));
  }

  async saveBatch(records: readonly PersistMaterialRecord[], actor: ActorContext, auditAction: string): Promise<Array<MaterialSummary & { creationClientKey?: string; replayed?: boolean }>> {
    if (!records.length) return [];
    return this.prisma.inTransaction(async transaction => {
      const result: Array<MaterialSummary & { creationClientKey?: string; replayed?: boolean }> = [];
      // Sort locks so overlapping bulk retries cannot deadlock. Receipts remain after a purge.
      for (const key of records.flatMap(record => record.creationClientKey ? [record.creationClientKey] : []).sort()) {
        const lock = 'material:create:' + this.receiptId(actor, key);
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
      }
      for (const record of records) {
        const receiptId = record.creationClientKey ? this.receiptId(actor, record.creationClientKey) : null;
        if (receiptId) {
          const receipt = await transaction.auditEvent.findFirst({ where: { actorId: actor.id, entityType: 'material_create_receipt', entityId: receiptId }, select: { payload: true } });
          if (receipt) {
            const material = (receipt.payload as unknown as { material: MaterialSummary }).material;
            const current = await transaction.materialRecord.findUnique({ where: { materialId: material.materialId } });
            if (!current || current.isDeleted) throw new ConflictException('Tư liệu của lần lưu trước đã bị xóa. Không tự tạo lại khi thử lưu.');
            result.push({ ...materialRecordSummary(current), creationClientKey: record.creationClientKey!, replayed: true }); continue;
          }
        }
        const previous = await transaction.materialRecord.findUnique({ where: { materialId: record.materialId } });
        const data = { data: record.fields as Prisma.InputJsonValue, recordVersion: record.recordVersion, isDeleted: record.isDeleted, updatedBy: record.updatedBy };
        const saved = record.recordVersion === 1
          ? await transaction.materialRecord.create({ data: { ...data, materialId: record.materialId, createdBy: record.createdBy,
            ownerActorId: actor.id, sharingMode: record.sharing?.mode ?? 'SHARED',
            sharingCampaignIds: record.sharing?.campaignIds ?? [], sharingGrants: (record.sharing?.grants ?? []) as unknown as Prisma.InputJsonValue } })
          : await transaction.materialRecord.update({ where: { materialId: record.materialId, recordVersion: record.recordVersion - 1 }, data });
        const material = materialRecordSummary(saved);
        const prior = previous ? toStringRecord(previous.data) : {};
        await transaction.auditEvent.createMany({ data: [{
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: auditAction, entityType: 'material', entityId: record.materialId,
          payload: { materialId: record.materialId, recordVersion: record.recordVersion,
            changedFields: Object.keys(record.fields).filter(key => !['updated_at', 'updated_by', 'record_version'].includes(key) && (prior[key] ?? null) !== (record.fields[key as keyof MaterialFields] ?? null)) },
        }, ...(receiptId ? [{
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'material.create_receipt', entityType: 'material_create_receipt', entityId: receiptId,
          payload: { material: material as unknown as Prisma.InputJsonValue },
        }] : [])] });
        result.push({ ...material, ...(record.creationClientKey ? { creationClientKey: record.creationClientKey } : {}) });
      }
      return result;
    });
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
