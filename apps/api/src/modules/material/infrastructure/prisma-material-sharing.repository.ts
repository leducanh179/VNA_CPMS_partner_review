import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ActorContext, MaterialGrant, MaterialSharing } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MaterialSharingRepository } from '../application/material-sharing.repository';
import { materialRecordSummary } from './prisma-material.repository';

@Injectable()
export class PrismaMaterialSharingRepository extends MaterialSharingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async activeOrganizationIds(ids: readonly string[]) {
    if (!ids.length) return [];
    return (await this.prisma.database.employmentOrgUnit.findMany({ where: { id: { in: [...ids] }, isActive: true }, select: { id: true } })).map(o => o.id);
  }
  async directory(query: string) {
    const [accounts, orgs] = await Promise.all([
      this.prisma.database.actor.findMany({ where: { isActive: true, accountKind: { in: ['PERSONNEL', 'PILOT_ADMIN', 'PARTNER_DEMO'] }, displayName: { contains: query, mode: 'insensitive' } }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' }, take: 50 }),
      this.prisma.database.employmentOrgUnit.findMany({ where: { isActive: true, sourceName: { contains: query, mode: 'insensitive' } }, select: { id: true, sourceName: true }, orderBy: { sourceName: 'asc' }, take: 50 }),
    ]);
    return { accounts: accounts.map(a => ({ id: a.id, name: a.displayName })), organizations: orgs.map(o => ({ id: o.id, name: o.sourceName })) };
  }
  async validTargets(campaignIds: string[], grants: MaterialGrant[]) {
    const accounts = [...new Set(grants.filter(g => g.kind === 'ACCOUNT').map(g => g.id))];
    const orgs = [...new Set(grants.filter(g => g.kind === 'ORG').map(g => g.id))];
    const [c, a, o] = await Promise.all([
      this.prisma.database.campaign.count({ where: { id: { in: campaignIds }, deletedAt: null } }),
      this.prisma.database.actor.count({ where: { id: { in: accounts }, isActive: true, accountKind: { in: ['PERSONNEL', 'PILOT_ADMIN', 'PARTNER_DEMO'] } } }),
      this.prisma.database.employmentOrgUnit.count({ where: { id: { in: orgs }, isActive: true } }),
    ]);
    return c === campaignIds.length && a === accounts.length && o === orgs.length;
  }
  async save(materialId: string, expectedVersion: number, sharing: MaterialSharing, actor: ActorContext) {
    return this.prisma.inTransaction(async db => {
      const before = await db.materialRecord.findUnique({ where: { materialId } });
      if (!before || before.isDeleted || before.recordVersion !== expectedVersion) throw new ConflictException('Tư liệu hoặc quyền chia sẻ đã thay đổi. Tải lại để đối chiếu; lựa chọn chưa lưu vẫn được giữ.');
      const saved = await db.materialRecord.update({ where: { materialId, recordVersion: expectedVersion }, data: {
        sharingMode: sharing.mode, sharingCampaignIds: sharing.campaignIds, sharingGrants: sharing.grants as unknown as Prisma.InputJsonValue,
        recordVersion: { increment: 1 }, updatedBy: actor.key,
      } });
      await db.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action: 'material.sharing_changed', entityType: 'material', entityId: materialId,
        payload: { before: materialRecordSummary(before).sharing, after: materialRecordSummary(saved).sharing } as unknown as Prisma.InputJsonValue,
      } });
      return materialRecordSummary(saved);
    });
  }
  async publicList(query: string, page: number, pageSize: number) {
    const where: Prisma.MaterialRecordWhereInput = { sharingMode: 'SHARED', isDeleted: false,
      ...(query ? { OR: [{ materialId: { contains: query, mode: 'insensitive' } }, ...['material_name', 'material_type'].map(key => ({ data: { path: [key], string_contains: query } }))] } : {}) };
    // Audience predicate is in SQL, BEFORE count and pagination.
    const [rows, total] = await Promise.all([
      this.prisma.database.materialRecord.findMany({ where, orderBy: { materialId: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.database.materialRecord.count({ where }),
    ]);
    return { records: rows.map(materialRecordSummary), total };
  }
  async publicDetail(materialId: string) {
    const row = await this.prisma.database.materialRecord.findFirst({ where: { materialId, sharingMode: 'SHARED', isDeleted: false } });
    return row ? materialRecordSummary(row) : null;
  }
}
