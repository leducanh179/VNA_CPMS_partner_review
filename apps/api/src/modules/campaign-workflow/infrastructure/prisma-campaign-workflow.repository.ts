import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActorContext } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CampaignWorkflowRepository, type WorkflowCommandResult, type WorkflowFacts } from '../application/campaign-workflow.repository';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const identity = (actor: ActorContext) => ({ actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT' });
const ACTIVE = () => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });

@Injectable()
export class PrismaCampaignWorkflowRepository extends CampaignWorkflowRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async configuration() {
    const state = await this.db.workflowPolicyState.findUnique({ where: { key: 'campaign' } });
    return { version: state?.recordVersion ?? 0, commDepartmentId: state?.commDepartmentId ?? null, demoInitialized: Boolean(state?.demoInitializedAt),
      policies: await this.db.approvalPolicyVersion.findMany({ orderBy: { version: 'desc' }, include: { campaign: { select: { id: true, code: true, name: true } }, createdBy: { select: { id: true, displayName: true } } } }),
      organizations: await this.db.employmentOrgUnit.findMany({ where: { isActive: true }, select: { id: true, sourceName: true, kind: true, parentId: true }, orderBy: { sourceName: 'asc' } }) };
  }
  async people() {
    const rows = await this.db.actor.findMany({ where: { accountKind: 'PERSONNEL', employment: { isNot: null } },
      select: { id: true, displayName: true, personnelEmployeeCode: true, loginEmail: true, isActive: true, personnel: { select: { jobTitle: true } }, employment: { select: { departmentId: true, divisionId: true } },
        scopedBindings: { where: ACTIVE(), select: { roleCode: true, scopeType: true, orgId: true, campaignId: true, module: true, expiresAt: true } } } });
    return rows.flatMap((row) => row.employment && row.personnelEmployeeCode ? [{ id: row.id, displayName: row.displayName, employeeCode: row.personnelEmployeeCode,
      email: row.loginEmail, isActive: row.isActive, jobTitle: row.personnel?.jobTitle ?? null, ...row.employment, roles: row.scopedBindings }] : []);
  }
  async facts(campaignId: string): Promise<WorkflowFacts | null> {
    const row = await this.db.campaign.findUnique({ where: { id: campaignId }, include: { markets: true, requestingUnits: true,
      workflow: { include: { revisions: { orderBy: { number: 'desc' }, include: { steps: { orderBy: { createdAt: 'asc' }, include: { decision: true } } } },
        assignments: { orderBy: { startsAt: 'asc' } }, changeRequests: true, cooperationRequests: { orderBy: { requestedAt: 'desc' } } } } } });
    if (!row) return null;
    const { workflow, ...subject } = row;
    return { campaign: { id: row.id, code: row.code, name: row.name, levelCode: row.levelCode, lifecycleState: row.lifecycleState,
      recordVersion: row.recordVersion, businessRevision: row.businessRevision, createdByActorId: row.createdByActorId, deletedAt: row.deletedAt, subject: JSON.parse(JSON.stringify(subject)) as Record<string, unknown> },
      workflow, revisions: workflow?.revisions ?? [], assignments: workflow?.assignments ?? [], cooperations: workflow?.cooperationRequests ?? [], changeRequests: workflow?.changeRequests ?? [] };
  }
  async inboxCampaignIds(actorId: string, orgIds: readonly string[], departmentFyiOrgId: string | null) {
    const rows = await this.db.campaignWorkflow.findMany({ where: { OR: [
      { revisions: { some: { submittedByActorId: actorId } } }, { assignments: { some: { actorId } } },
      { currentRevision: { steps: { some: { orgId: { in: [...orgIds] } } } } },
      { cooperationRequests: { some: { targetOrgId: { in: [...orgIds] }, state: 'PENDING' } } },
      ...(departmentFyiOrgId ? [{ currentRevision: { receivingDepartmentId: departmentFyiOrgId, OR: [{ route: 'DIVISION' }, { state: 'NO_APPROVAL' }] } }] : []),
    ] }, select: { campaignId: true } });
    return rows.map((row) => row.campaignId);
  }
  async initialize(actor: ActorContext, commDepartmentId: string, demo: boolean) {
    const existing = await this.db.workflowPolicyState.findUnique({ where: { key: 'campaign' } });
    if (existing) return;
    await this.db.workflowPolicyState.create({ data: { key: 'campaign', commDepartmentId, ...(demo ? { demoInitializedAt: new Date() } : {}) } });
    await this.savePolicy(actor, { campaignId: null, preset: 'STANDARD', effectiveFrom: new Date(), reason: 'Khởi tạo chính sách mặc định STANDARD.' });
    if (demo) await this.savePolicy(actor, { campaignId: null, preset: 'DIVISION_ONLY', effectiveFrom: new Date(), reason: 'Cấu hình demo local: DIVISION_ONLY; quản trị viên có thể thay đổi.' });
    // Explicit activation after this module and its persistent policy have been installed. Custom presets stay untouched.
    await this.db.permissionDefinition.updateMany({ where: { code: { in: ['campaign.submit','campaign.approve','campaign.assign','campaign.cooperate','campaign.policy.manage','campaign.access.manage'] }, implementationStatus: 'RESERVED' }, data: { implementationStatus: 'IMPLEMENTED' } });
    await this.db.accessPolicyState.update({ where: { key: 'access' }, data: { recordVersion: { increment: 1 } } });
  }
  async savePolicy(actor: ActorContext, input: Parameters<CampaignWorkflowRepository['savePolicy']>[1]) {
    const last = await this.db.approvalPolicyVersion.aggregate({ _max: { version: true } });
    const row = await this.db.approvalPolicyVersion.create({ data: { ...input, version: (last._max.version ?? 0) + 1,
      scopeKey: input.campaignId ? `CAMPAIGN:${input.campaignId}` : 'SYSTEM', enforcement: input.preset === null ? null
        : input.preset.startsWith('NO_APPROVAL') ? 'NONE' : 'HARD', createdByActorId: actor.id } });
    await this.db.workflowPolicyState.update({ where: { key: 'campaign' }, data: { recordVersion: { increment: 1 } } });
    return row;
  }
  async receipt(actorId: string, key: string) {
    const row = await this.db.campaignWorkflowCommand.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: key } } });
    return row ? { payloadHash: row.payloadHash, result: row.result as unknown as WorkflowCommandResult } : null;
  }
  async begin(input: Parameters<CampaignWorkflowRepository['begin']>[0]) {
    return (await this.db.campaignWorkflowCommand.create({ data: { campaignId: input.campaignId, ...identity(input.actor), idempotencyKey: input.idempotencyKey,
      operation: input.operation, payloadHash: input.payloadHash } })).id;
  }
  async finish(commandId: string, campaignId: string, workflowId: string) {
    const row = await this.db.campaignWorkflow.update({ where: { id: workflowId }, data: { recordVersion: { increment: 1 } } });
    const result = { commandId, campaignId, workflowVersion: row.recordVersion };
    await this.db.campaignWorkflowCommand.update({ where: { id: commandId }, data: { result } });
    await this.db.accessPolicyState.update({ where: { key: 'access' }, data: { recordVersion: { increment: 1 } } });
    return result;
  }
  async createWorkflow(campaignId: string) { return (await this.db.campaignWorkflow.create({ data: { campaignId } })).id; }
  async createRevision(input: Parameters<CampaignWorkflowRepository['createRevision']>[0]) {
    const { subject, ...fields } = input;
    const row = await this.db.campaignWorkflowRevision.create({ data: { ...fields, subjectSnapshot: json(subject) } });
    await this.db.campaignWorkflow.update({ where: { id: input.workflowId }, data: { currentRevisionId: row.id } });
    return row.id;
  }
  async setRevisionState(revisionId: string, state: string, close: boolean) {
    await this.db.campaignWorkflowRevision.update({ where: { id: revisionId }, data: { state, ...(close ? { closedAt: new Date() } : {}) } });
  }
  async closePending(revisionId: string, state: 'CANCELLED' | 'SUPERSEDED', actorId: string, commandId: string) {
    await this.db.campaignWorkflowStep.updateMany({ where: { revisionId, state: 'PENDING' }, data: { state, stepVersion: { increment: 1 }, completedAt: new Date() } });
    await this.db.campaignCooperationRequest.updateMany({ where: { revisionId, state: 'PENDING' }, data: { state, recordVersion: { increment: 1 },
      respondedByActorId: actorId, responseCommandId: commandId, responseReason: 'Revision đã đóng.', respondedAt: new Date() } });
  }
  async createSteps(input: Parameters<CampaignWorkflowRepository['createSteps']>[0]) { if (input.length) await this.db.campaignWorkflowStep.createMany({ data: input }); }
  async endAssignments(workflowId: string) {
    const ids = (await this.db.campaignWorkflowAssignment.findMany({ where: { workflowId, endsAt: null }, select: { id: true } })).map((row) => row.id);
    const now = new Date();
    await this.db.campaignParticipant.updateMany({ where: { workflowAssignmentId: { in: ids }, endsAt: null }, data: { endsAt: now, recordVersion: { increment: 1 } } });
    await this.db.campaignWorkflowAssignment.updateMany({ where: { id: { in: ids } }, data: { endsAt: now, recordVersion: { increment: 1 } } });
  }
  async reassignStep(revisionId: string, orgId: string, actorId: string | null) {
    if (actorId) await this.db.campaignWorkflowStep.updateMany({ where: { revisionId, orgId, kind: 'DIVISION_ACCEPT_AND_ASSIGN', state: 'PENDING' },
      data: { assigneeActorId: actorId, stepVersion: { increment: 1 } } });
  }
  async touchWorkflow(workflowId: string) { await this.db.campaignWorkflow.update({ where: { id: workflowId }, data: { recordVersion: { increment: 1 } } }); }
  async decide(input: Parameters<CampaignWorkflowRepository['decide']>[0]) {
    const { step, revision, commandId, actor, kind, reason } = input;
    const row = await this.db.campaignWorkflowDecision.create({ data: { stepId: step.id, commandId, subjectRevision: revision.subjectRevision,
      policyVersionId: revision.policyVersionId, stepVersion: step.stepVersion, actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, orgId: step.orgId, kind, reason } });
    await this.db.campaignWorkflowStep.update({ where: { id: step.id }, data: { state: kind === 'SKIPPED_BY_ADMIN' ? 'SKIPPED_BY_ADMIN' : ['RETURNED','REJECTED'].includes(kind) ? 'CANCELLED' : 'COMPLETED', stepVersion: { increment: 1 }, completedAt: new Date() } });
    return row.id;
  }
  async assignments(input: Parameters<CampaignWorkflowRepository['assignments']>[0]) {
    try {
    const existing = await this.db.campaignWorkflowAssignment.findMany({ where: { workflowId: input.workflowId, orgId: input.orgId, functionalRole: input.functionalRole, endsAt: null } });
    const now = new Date();
    if (existing.length) {
      await this.db.campaignParticipant.updateMany({ where: { workflowAssignmentId: { in: existing.map((row) => row.id) }, endsAt: null }, data: { endsAt: now, recordVersion: { increment: 1 } } });
      await this.db.campaignWorkflowAssignment.updateMany({ where: { id: { in: existing.map((row) => row.id) } }, data: { endsAt: now, recordVersion: { increment: 1 } } });
    }
    for (const member of input.replacements) {
      const assignment = await this.db.campaignWorkflowAssignment.create({ data: { ...member, workflowId: input.workflowId, revisionId: input.revisionId,
        assignedByActorId: input.actorId, commandId: input.commandId, ...(input.decisionId ? { decisionId: input.decisionId } : {}), startsAt: now } });
      if (member.functionalRole !== 'DEPARTMENT_LEADER') await this.db.campaignParticipant.create({ data: { campaignId: input.campaignId,
        actorId: member.functionalRole === 'CAMPAIGN_MANAGER' ? member.actorId : null, orgId: member.orgId,
        functionalRole: member.functionalRole === 'CAMPAIGN_MANAGER' ? 'CM' : 'DIVISION', responsibility: member.responsibility,
        assignedByActorId: input.actorId, startsAt: now, workflowAssignmentId: assignment.id } });
    }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('Đã có phân công hoặc người chủ trì hiệu lực trong phạm vi này. Tải lại và kiểm tra người tham gia trước khi thay đổi.');
      throw error;
    }
  }
  async requestCooperation(input: Parameters<CampaignWorkflowRepository['requestCooperation']>[0]) {
    const { actorId, ...fields } = input;
    await this.db.campaignCooperationRequest.create({ data: { ...fields, requestedByActorId: actorId } });
  }
  async respondCooperation(input: Parameters<CampaignWorkflowRepository['respondCooperation']>[0]) {
    await this.db.campaignCooperationRequest.update({ where: { id: input.id }, data: { state: input.state, recordVersion: { increment: 1 },
      respondedByActorId: input.actorId, responseCommandId: input.commandId, responseReason: input.reason, respondedAt: new Date() } });
    if (input.state === 'ACCEPTED') await this.db.campaignWorkflowRevision.update({ where: { id: input.revisionId }, data: { scopeRevision: { increment: 1 } } });
  }
  async audit(actor: ActorContext, campaignId: string | null, action: string, payload: Record<string, unknown>) {
    await this.db.auditEvent.create({ data: { ...identity(actor), entityType: campaignId ? 'campaign' : 'WorkflowPolicy', entityId: campaignId ?? 'campaign', action, payload: json({ source: 'API', ...payload }) } });
  }
}
