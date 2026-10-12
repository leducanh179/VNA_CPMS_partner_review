import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActorContext, BookingView, QcttPlanColumn, QcttPlanItem, QcttPlanState, QcttPlanView } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QcttPlanRepository } from '../application/qctt-plan.repository';
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const wire = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
const day = (v: Date | null) => v?.toISOString().slice(0,10) ?? null;
@Injectable()
export class PrismaQcttPlanRepository extends QcttPlanRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async campaigns() {
    const rows = await this.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, qcttPlan: { select: { campaignId: true } } }, orderBy: { name: 'asc' } });
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, hasPlan: Boolean(row.qcttPlan) }));
  }
  async departments() {
    return (await this.db.employmentOrgUnit.findMany({ where: { kind: 'DEPARTMENT', isActive: true }, select: { id: true, sourceName: true }, orderBy: { sourceName: 'asc' } })).map(row => ({ id: row.id, name: row.sourceName }));
  }
  async responsibleDepartment(ownerId: string | null, actorIds: string[]) {
    const org = ownerId ? await this.db.employmentOrgUnit.findFirst({ where: { id: ownerId, isActive: true }, select: { kind: true, id: true, parentId: true } }) : null;
    if (org?.kind === 'DEPARTMENT') return org.id;
    if (org?.kind === 'DIVISION' && org.parentId) return org.parentId;
    const people = await this.db.actor.findMany({ where: { id: { in: actorIds }, isActive: true }, select: { employment: { select: { departmentId: true } } } });
    const ids = [...new Set(people.map(p => p.employment?.departmentId).filter((id): id is string => Boolean(id)))];
    return ids.length === 1 ? ids[0]! : null;
  }
  async state(campaignId: string) { return wire<QcttPlanState | null>(await this.db.qcttPlan.findUnique({ where: { campaignId } })); }
  async items(campaignId: string) {
    return (await this.db.qcttPlanItem.findMany({ where: { campaignId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })).map(i => ({ ...wire<QcttPlanItem>(i), startDate: day(i.startDate), endDate: day(i.endDate) }));
  }
  async ensure(campaignId: string, actor: ActorContext) {
    const existing = await this.db.qcttPlan.findUnique({ where: { campaignId } });
    if (existing) return;
    await this.db.qcttPlan.create({ data: { campaignId, initializedAt: new Date(), initializedByActorId: actor.id } });
    await this.audit(actor, campaignId, 'plan.create', { approvalRequired: false });
  }
  async setColumns(campaignId: string, expectedVersion: number, columns: QcttPlanColumn[], actor: ActorContext) {
    const changed = await this.db.qcttPlan.updateMany({ where: { campaignId, recordVersion: expectedVersion }, data: { columns: json(columns), recordVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new ConflictException('Bố cục kế hoạch đã thay đổi. Tải lại trước khi lưu.');
    await this.audit(actor, campaignId, 'plan.columns.update', { columns });
  }
  async save(item: QcttPlanItem, before: QcttPlanItem | null, actor: ActorContext, action: string) {
    const data = { ...item, customValues: json(item.customValues ?? {}), content: item.content ? json(item.content) : Prisma.DbNull, classification: item.classification ? json(item.classification) : Prisma.DbNull,
      startDate: item.startDate ? new Date(item.startDate) : null, endDate: item.endDate ? new Date(item.endDate) : null,
      deletedAt: item.deletedAt ? new Date(item.deletedAt) : null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) };
    if (before) {
      const result = await this.db.qcttPlanItem.updateMany({ where: { id: item.id, recordVersion: before.recordVersion }, data });
      if (result.count !== 1) throw new ConflictException('Dòng kế hoạch đã thay đổi. Tải lại trước khi lưu.');
    } else await this.db.qcttPlanItem.create({ data });
    await this.db.qcttPlanItemRevision.create({ data: { itemId: item.id, version: item.recordVersion, actorId: actor.id, action, data: json({ before, after: item }) } });
    await this.db.qcttPlan.update({ where: { campaignId: item.campaignId }, data: { recordVersion: { increment: 1 } } });
    await this.audit(actor, item.campaignId, action, { before, after: item });
  }
  async bookings(campaignId: string) {
    return (await this.db.bookingRecord.findMany({ where: { OR: [{ campaignId }, { workflow: { path: ['effective','campaignId'], equals: campaignId } }] } })).map(b => ({ ...wire<BookingView>(b), startDate: day(b.startDate)!, endDate: day(b.endDate)! }));
  }
  async legacy(campaignId: string) {
    return wire<QcttPlanView['legacyPlans']>(await this.db.campaignPlan.findMany({ where: { workflow: { campaignId } }, select: { id: true, title: true, objective: true, tasks: true }, orderBy: { number: 'desc' } }));
  }
  async history(itemId: string) {
    const rows = await this.db.qcttPlanItemRevision.findMany({ where: { itemId }, orderBy: { version: 'desc' }, take: 100 });
    const people = await this.db.actor.findMany({ where: { id: { in: [...new Set(rows.map(r => r.actorId))] } }, select: { id: true, displayName: true } });
    return rows.map(r => ({ version: r.version, action: r.action, actorName: people.find(p => p.id === r.actorId)?.displayName ?? r.actorId, createdAt: r.createdAt.toISOString(), data: r.data }));
  }
  receipt(actorId: string, key: string) { return this.db.qcttPlanCommand.findUnique({ where: { actorId_key: { actorId, key } } }); }
  async finish(actor: ActorContext, key: string, digest: string, result: unknown) { await this.db.qcttPlanCommand.create({ data: { actorId: actor.id, key, digest, result: json(result) } }); }
  async initializedCampaigns() {
    const rows = await this.db.qcttPlan.findMany({ where: { campaign: { deletedAt: null, workflow: { operationalState: 'ACTIVE' } } }, include: { campaign: { include: { workflow: { include: { currentRevision: true } } } } } });
    return rows.filter(({campaign:c})=>c.workflow?.currentRevision && ['APPROVED','NO_APPROVAL'].includes(c.workflow.currentRevision.state) && c.workflow.currentRevision.subjectRevision===c.businessRevision).map(({ campaign: c }) => ({ id: c.id, code: c.code, name: c.name, status: 'Đã khởi tạo kế hoạch', startDate: day(c.startDate), endDate: day(c.endDate) }));
  }
  private async audit(actor: ActorContext, campaignId: string, action: string, payload: unknown) {
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', entityType: 'campaign', entityId: campaignId, action, payload: json(payload) } });
  }
}
