import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CampaignOperationsRepository } from '../application/campaign-operations.repository';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class PrismaCampaignOperationsRepository extends CampaignOperationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async hasQcttPlan(campaignId: string) { return Boolean(await this.db.qcttPlan.findUnique({ where: { campaignId }, select: { campaignId: true } })); }
  async read(campaignId: string) {
    const workflow = await this.db.campaignWorkflow.findUnique({ where: { campaignId }, include: { changeRequests: { orderBy: { requestedAt: 'desc' } }, plans: { orderBy: { number: 'desc' } } } });
    return workflow ? { workflowId: workflow.id, operationalState: workflow.operationalState, requests: workflow.changeRequests, plans: workflow.plans } : null;
  }
  receipt(actorId: string, key: string) { return this.db.campaignChangeRequest.findUnique({ where: { requestedByActorId_idempotencyKey: { requestedByActorId: actorId, idempotencyKey: key } } }); }
  createRequest(input: Parameters<CampaignOperationsRepository['createRequest']>[0]) { return this.db.campaignChangeRequest.create({ data: { ...input, payload: json(input.payload), beforeSnapshot: json(input.beforeSnapshot) } }); }
  async decide(requestId: string, actorId: string, approved: boolean, reason: string) { await this.db.campaignChangeRequest.update({ where: { id: requestId }, data: { state: approved ? 'APPROVED' : 'REJECTED', recordVersion: { increment: 1 }, decidedByActorId: actorId, decisionReason: reason, decidedAt: new Date() } }); }
  async withdraw(requestId: string, actorId: string, reason: string) { await this.db.campaignChangeRequest.update({ where: { id: requestId }, data: { state: 'SUPERSEDED', recordVersion: { increment: 1 }, decidedByActorId: actorId, decisionReason: reason, decidedAt: new Date() } }); }
  async supersedePending(workflowId: string, exceptId: string, actorId: string, reason: string) {
    const where = { workflowId, state: 'PENDING', id: { not: exceptId } };
    const requests = await this.db.campaignChangeRequest.findMany({ where, select: { id: true } });
    await this.db.campaignChangeRequest.updateMany({ where, data: { state: 'SUPERSEDED', recordVersion: { increment: 1 }, decidedByActorId: actorId, decisionReason: reason, decidedAt: new Date() } });
    return requests.map((request) => request.id);
  }
  createPlan(input: Parameters<CampaignOperationsRepository['createPlan']>[0]) { return this.db.campaignPlan.create({ data: { ...input, tasks: json(input.tasks) } }); }
  async setOperationalState(workflowId: string, state: string) { await this.db.campaignWorkflow.update({ where: { id: workflowId }, data: { operationalState: state } }); }
  async touch(workflowId: string) {
    await this.db.campaignWorkflow.update({ where: { id: workflowId }, data: { recordVersion: { increment: 1 } } });
    await this.db.accessPolicyState.update({ where: { key: 'access' }, data: { recordVersion: { increment: 1 } } });
  }
  async actorActive(actorId: string) { return Boolean(await this.db.actor.findFirst({ where: { id: actorId, isActive: true, accountKind: { in: ['PERSONNEL', 'PILOT_ADMIN'] } }, select: { id: true } })); }
  async audit(actor: ActorContext, campaignId: string, action: string, payload: Record<string, unknown>) {
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', entityType: 'campaign', entityId: campaignId, action, payload: json({ source: 'API', ...payload }) } });
  }
}
