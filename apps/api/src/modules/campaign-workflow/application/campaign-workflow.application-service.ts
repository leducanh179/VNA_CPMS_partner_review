import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APPROVAL_PRESETS, canDecideCampaignTask, resolveApprovalRoute, type AccessPermission, type AccessResource, type ActorContext, type ApprovalPreset, type CampaignLevelCode } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignWorkflowRepository, type WorkflowConfiguration, type WorkflowFacts, type WorkflowPerson, type WorkflowRevision, type WorkflowStep } from './campaign-workflow.repository';
import { parseWorkflowCommand, parseWorkflowPolicy, workflowId, type WorkflowCommand } from './campaign-workflow.commands';
import { requiresCampaignApproval } from '@cpms/domain';

const current = (facts: WorkflowFacts) => facts.revisions.find((r) => r.id === facts.workflow?.currentRevisionId);
const conflict = (): never => { throw new ConflictException('Workflow đã thay đổi. Hãy tải lại phiên bản hiện hành.'); };
const blocked = (message: string): never => { throw new ForbiddenException(message); };
function functional(person: WorkflowPerson | undefined, role: string, orgId: string, campaignId: string, config: WorkflowConfiguration) {
  if (!person?.isActive || person.departmentId !== config.commDepartmentId || !config.organizations.some((o) => o.id === orgId) || !config.organizations.some((o) => o.id === config.commDepartmentId && o.kind === 'DEPARTMENT')) return false;
  if (role === 'DEPARTMENT_LEADER' ? person.departmentId !== orgId : person.divisionId !== orgId) return false;
  const roleCode = role === 'CAMPAIGN_MANAGER' ? 'COMM_CAMPAIGN_MANAGER' : role;
  return person.roles.some((binding) => binding.roleCode === roleCode && (!binding.expiresAt || binding.expiresAt.getTime() > Date.now()) &&
    (!binding.module || binding.module === 'CAMPAIGN') && (role !== 'CAMPAIGN_MANAGER'
      ? binding.scopeType === 'MODULE_ORG' && binding.orgId === orgId
      : binding.scopeType === 'SYSTEM' || binding.scopeType === 'MODULE' || (binding.scopeType === 'MODULE_ORG' && [person.departmentId, person.divisionId].includes(binding.orgId)) || (binding.scopeType === 'RECORD' && binding.campaignId === campaignId)));
}
function policyFor(config: WorkflowConfiguration, campaignId: string) {
  const active = config.policies.filter((p) => p.effectiveFrom.getTime() <= Date.now()).sort((a, b) => b.version - a.version);
  const override = active.find((p) => p.campaignId === campaignId);
  const policy = override?.preset ? override : active.find((p) => p.campaignId === null && p.preset);
  if (!policy || !(APPROVAL_PRESETS as readonly string[]).includes(policy.preset!)) throw new ConflictException('Cần khởi tạo chính sách phê duyệt.');
  return { policy, source: policy.campaignId ? 'CAMPAIGN_OVERRIDE' : 'SYSTEM_DEFAULT' };
}
function routeFor(config: WorkflowConfiguration, facts: WorkflowFacts, receivingDivisionId: string | null) {
  const { policy, source } = policyFor(config, facts.campaign.id);
  if (!requiresCampaignApproval(policy, facts.campaign.levelCode, 'DEPLOY')) return { policy, source,
    routing: { route: 'NONE' as const, state: 'ROUTED' as const, receivingOrgId: null, reason: 'POLICY_DEPLOY_EXEMPT' } };
  // The create-and-submit form does not choose a receiving division. Under STANDARD,
  // level-1 campaigns still need the same shared COMM division-leader pool as the
  // local Division-only workflow; otherwise submission silently has no task.
  const divisionPool = policy.preset === 'DIVISION_ONLY' ||
    (facts.campaign.levelCode === 'CLV_01' && ['STANDARD', 'DIVISION_LEVEL_1_ONLY'].includes(policy.preset ?? ''));
  if (divisionPool && !receivingDivisionId && config.commDepartmentId) {
    return { policy, source, routing: { route: 'DIVISION' as const, state: 'PENDING' as const, receivingOrgId: config.commDepartmentId, reason: 'COMM_DIVISION_POOL' } };
  }
  const division = config.organizations.find((org) => org.id === receivingDivisionId && org.kind === 'DIVISION');
  return { policy, source, routing: resolveApprovalRoute({ preset: policy.preset as ApprovalPreset, levelCode: facts.campaign.levelCode as CampaignLevelCode | null,
    commDepartmentId: config.commDepartmentId, receivingDivision: division?.parentId ? { id: division.id, parentDepartmentId: division.parentId } : null }) };
}

@Injectable()
export class CampaignWorkflowApplicationService {
  constructor(@Inject(CampaignWorkflowRepository) private readonly repository: CampaignWorkflowRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) {}

  configuration(actor: ActorContext) { return this.access.run(actor, async () => { this.access.require('access.manage'); return this.repository.configuration(); }); }
  initialize(actor: ActorContext, departmentId: string, demo: boolean) {
    return this.access.run(actor, async () => {
      this.access.require('access.manage'); workflowId(departmentId);
      if (demo && (process.env.NODE_ENV === 'production' || process.env.LOCAL_DEMO_CREDENTIALS !== 'true')) blocked('Cấu hình demo chỉ được bật trong runtime local đã khai báo.');
      const config = await this.repository.configuration();
      if (!config.organizations.some((org) => org.id === departmentId && org.kind === 'DEPARTMENT')) throw new BadRequestException('Ban tiếp nhận không hợp lệ.');
      if (config.version) {
        if (config.commDepartmentId !== departmentId) conflict();
        return { alreadyInitialized: true, version: config.version };
      }
      await this.repository.initialize(actor, departmentId, demo);
      await this.repository.audit(actor, null, 'workflow.policy_initialized', { commDepartmentId: departmentId, demo, preservesExistingCampaigns: true });
      return { alreadyInitialized: false, version: (await this.repository.configuration()).version };
    });
  }
  policy(actor: ActorContext, raw: unknown, save: boolean) {
    return this.access.run(actor, async () => {
      this.access.require('access.manage'); const input = parseWorkflowPolicy(raw);
      if (input.campaignId) this.access.require('campaign.policy.manage', await this.access.campaign(input.campaignId));
      const config = await this.repository.configuration(); if (!config.version || config.version !== input.expectedVersion) conflict();
      const facts = input.campaignId ? await this.repository.facts(input.campaignId) : null;
      const preview = { before: input.campaignId ? policyFor(config, input.campaignId).policy : config.policies.find((p) => p.scopeKey === 'SYSTEM'), after: input,
        affectsNewWorkflowsOnly: true, existingRevisionUnchanged: facts ? current(facts)?.id ?? null : null,
        warning: 'Không sửa nội dung, cấp Campaign hoặc quyết định cũ. Workflow đang mở chỉ đổi khi dùng Tạo revision theo chính sách mới.' };
      if (!save) return preview;
      const created = await this.repository.savePolicy(actor, { campaignId: input.campaignId, preset: input.preset, requiredApprovals: input.requiredApprovals, reason: input.reason, effectiveFrom: new Date(input.effectiveFrom) });
      await this.repository.audit(actor, input.campaignId, 'workflow.policy_changed', { policyVersionId: created.id, preset: created.preset, reason: input.reason,
        beforePolicyVersionId: preview.before?.id ?? null, requiredApprovals: input.requiredApprovals, affectsNewWorkflowsOnly: true });
      return { version: (await this.repository.configuration()).version, policy: created };
    });
  }
  private async facts(id: string) { const facts = await this.repository.facts(workflowId(id)); if (!facts) throw new NotFoundException('Không tìm thấy workflow.'); return facts; }
  async requiresApproval(campaignId: string, action: string) {
    const config = await this.repository.configuration(); const facts = await this.facts(campaignId);
    return requiresCampaignApproval(config.version ? policyFor(config, campaignId).policy : null, facts.campaign.levelCode, action);
  }
  async requireLifecycleApproval(campaignId: string, action: 'CANCEL' | 'PURGE') {
    const facts = await this.facts(campaignId); const revision = current(facts);
    // Unsubmitted drafts retain the existing trash/purge rules; no completed workflow is invented.
    if (!revision || !await this.requiresApproval(campaignId, action)) return;
    const approved = facts.changeRequests.some(r => r.kind === action && r.state === 'APPROVED' && r.decidedByActorId !== r.requestedByActorId && r.subjectRevision === facts.campaign.businessRevision && (action !== 'PURGE' || r.campaignRecordVersion === facts.campaign.recordVersion));
    if (!approved) blocked(action === 'PURGE' ? 'Cần gửi và được Lãnh đạo Phòng phê duyệt yêu cầu Xóa vĩnh viễn trước.' : 'Cần gửi và được Lãnh đạo Phòng phê duyệt yêu cầu Xóa trước.');
  }
  async createAndSubmitOnce(actor: ActorContext, key: string, payload: unknown, create: () => Promise<{ id: string }>) {
    workflowId(key); this.access.require('campaign.create');
    const payloadHash = createHash('sha256').update(JSON.stringify({ operation: 'CREATE_AND_SUBMIT', payload, originalActorId: actor.session?.originalActorId ?? actor.id })).digest('hex');
    const cached = await this.repository.receipt(actor.id, key);
    if (cached) {
      if (cached.payloadHash !== payloadHash) conflict();
      this.access.require('campaign.submit', await this.access.campaign(cached.result.campaignId));
      return cached.result.campaignId;
    }
    const campaign = await create();
    await this.command(actor, campaign.id, { operation: 'SUBMIT', idempotencyKey: crypto.randomUUID(), expectedVersion: 0,
      expectedSubjectRevision: (await this.facts(campaign.id)).campaign.businessRevision, receivingDivisionId: null });
    const facts = await this.facts(campaign.id);
    const commandId = await this.repository.begin({ actor, campaignId: campaign.id, idempotencyKey: key, operation: 'CREATE_AND_SUBMIT', payloadHash });
    await this.repository.finish(commandId, campaign.id, facts.workflow!.id);
    return campaign.id;
  }
  async requireLeadDivisionLeader(actor: ActorContext, campaignId: string) {
    const resource = await this.access.campaign(campaignId); this.access.require('campaign.approve', resource);
    const facts = await this.facts(campaignId); const revision = current(facts);
    if (!revision || !['APPROVED','NO_APPROVAL'].includes(revision.state)) blocked('Chiến dịch chưa hoàn tất phê duyệt.');
    const lead = facts.assignments.find((a) => !a.endsAt && a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD' && a.actorId === actor.id);
    if (this.directSuperadmin()) {
      this.access.require('access.manage');
      return { orgId: facts.assignments.find((a) => !a.endsAt && a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD')?.orgId ?? '' };
    }
    // A deploy-exempt campaign has no invented assignment. Its first change review uses the Ban TT leader pool.
    if (!lead && revision!.state === 'NO_APPROVAL' && !facts.assignments.some(a => !a.endsAt && a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD') && facts.changeRequests.some(r => r.state === 'PENDING')) {
      const config = await this.repository.configuration(); const people = await this.repository.people(); const person = people.find(p => p.id === actor.id);
      this.leaderCheck(actor.id, 'DIVISION_LEADER', person?.divisionId ?? '', campaignId, people, config);
      return { orgId: person!.divisionId! };
    }
    if (!lead) blocked('Chỉ Lãnh đạo Phòng chủ trì được quyết định yêu cầu này.');
    this.leaderCheck(actor.id, 'DIVISION_LEADER', lead!.orgId, campaignId, await this.repository.people(), await this.repository.configuration());
    return lead!;
  }
  async requireLeadCampaignManager(actor: ActorContext, campaignId: string) {
    const resource = await this.access.campaign(campaignId); this.access.require('campaign.update', resource);
    const facts = await this.facts(campaignId); const revision = current(facts);
    if (revision?.state !== 'APPROVED' || revision.subjectRevision !== facts.campaign.businessRevision) blocked('Chiến dịch chưa hoàn tất phê duyệt cho nội dung hiện hành.');
    const leadDivision = facts.assignments.find((a) => !a.endsAt && a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD');
    const member = facts.assignments.find((a) => !a.endsAt && a.actorId === actor.id && a.functionalRole === 'CAMPAIGN_MANAGER' && a.responsibility === 'LEAD' && a.orgId === leadDivision?.orgId);
    if (!member) blocked('Chỉ Campaign Manager chủ trì được trình kế hoạch.');
    this.leaderCheck(actor.id, 'CAMPAIGN_MANAGER', member!.orgId, campaignId, await this.repository.people(), await this.repository.configuration());
  }
  async recordApprovedChange(actor: ActorContext, campaignId: string, reason: string, requesterId: string) {
    const lead = await this.requireLeadDivisionLeader(actor, campaignId);
    const facts = await this.facts(campaignId); const revision = current(facts)!;
    if (revision.state === 'NO_APPROVAL') { await this.afterContentChanged(campaignId); return; }
    const commandId = await this.repository.begin({ campaignId, actor, idempotencyKey: crypto.randomUUID(), operation: 'APPROVE_CHANGE', payloadHash: createHash('sha256').update(JSON.stringify({ campaignId, subject: facts.campaign.businessRevision, reason })).digest('hex') });
    await this.repository.closePending(revision.id, 'SUPERSEDED', actor.id, commandId);
    await this.repository.setRevisionState(revision.id, 'SUPERSEDED', true);
    const id = await this.repository.createRevision({ workflowId: facts.workflow!.id, number: facts.revisions[0]!.number + 1,
      subjectRevision: facts.campaign.businessRevision, subject: facts.campaign.subject, policyVersionId: revision.policyVersionId,
      policySource: revision.policySource, route: revision.route, state: 'PENDING', receivingDepartmentId: revision.receivingDepartmentId,
      receivingDivisionId: revision.receivingDivisionId, submittedByActorId: requesterId, reason });
    await this.repository.createSteps([{ revisionId: id, kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: lead.orgId, assigneeActorId: actor.id, mandatory: true, createdByActorId: requesterId }]);
    const next = current(await this.facts(campaignId))!;
    await this.repository.decide({ step: next.steps[0]!, revision: next, commandId, actor, kind: 'APPROVED_BY_LEADER', reason });
    await this.repository.setRevisionState(id, 'APPROVED', false);
    await this.repository.finish(commandId, campaignId, facts.workflow!.id);
  }
  async planningAccess(actor: ActorContext, campaignId: string) {
    const resource = await this.access.campaign(campaignId);
    const facts = await this.facts(campaignId), revision = current(facts);
    const config = await this.repository.configuration(), people = await this.repository.people();
    const now = Date.now();
    const assignments = facts.assignments.filter(a => a.startsAt.getTime() <= now && (!a.endsAt || a.endsAt.getTime() > now));
    const members = assignments.filter(a => a.actorId === actor.id && a.functionalRole === 'CAMPAIGN_MANAGER' && functional(people.find(p => p.id === actor.id), 'CAMPAIGN_MANAGER', a.orgId, campaignId, config));
    const lead = assignments.find(a => a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD');
    const ready = !facts.campaign.deletedAt && facts.workflow?.operationalState === 'ACTIVE' && Boolean(revision && ['APPROVED','NO_APPROVAL'].includes(revision.state) && revision.subjectRevision === facts.campaign.businessRevision);
    const edit = ready && members.length > 0 && this.access.check('campaign.update', resource).allowed;
    return { resource, edit, ready, initialize: edit && members.some(m => m.responsibility === 'LEAD' && m.orgId === lead?.orgId),
      defaultDepartmentId: members[0]?.orgId ?? null,
      departments: config.organizations.filter(o => o.kind === 'DIVISION' && o.parentId === config.commDepartmentId).map(o => ({ id: o.id, name: o.sourceName })) };
  }
  async closeCancelledWork(actor: ActorContext, campaignId: string, reason: string) {
    await this.requireLeadDivisionLeader(actor, campaignId);
    const facts = await this.facts(campaignId); const revision = current(facts)!;
    const commandId = await this.repository.begin({ campaignId, actor, idempotencyKey: crypto.randomUUID(), operation: 'CANCEL_CAMPAIGN', payloadHash: createHash('sha256').update(JSON.stringify({ campaignId, reason })).digest('hex') });
    await this.repository.closePending(revision.id, 'CANCELLED', actor.id, commandId);
    await this.repository.finish(commandId, campaignId, facts.workflow!.id);
  }
  private leaderCheck(personId: string, role: string, orgId: string, id: string, people: WorkflowPerson[], config: WorkflowConfiguration) {
    if (!functional(people.find((p) => p.id === personId), role, orgId, id, config)) blocked('Người được chọn không còn role và đơn vị phù hợp.');
    this.access.requireAtCommit(async () => {
      if (!functional((await this.repository.people()).find((p) => p.id === personId), role, orgId, id, await this.repository.configuration())) blocked('Vai trò hoặc đơn vị người xử lý đã thay đổi trước khi hoàn tất.');
    });
  }
  private directSuperadmin() {
    const identity = this.access.snapshot().identity;
    return identity.mode === 'DIRECT' && identity.effectiveSuperadmin;
  }
  private taskEligibility(actor: ActorContext, step: WorkflowStep, revision: WorkflowRevision, facts: WorkflowFacts, resource: AccessResource, people: WorkflowPerson[], config: WorkflowConfiguration, admin = false, adminReason = 'Superadmin quyết định không kèm ý kiến.') {
    if (facts.workflow?.operationalState === 'CANCELLED') return { allowed: false, reason: 'CAMPAIGN_CANCELLED' };
    const role = step.kind === 'DEPARTMENT_APPROVAL' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER';
    const person = people.find((p) => p.id === actor.id);
    const pool = revision.route === 'DIVISION' && !revision.receivingDivisionId && step.orgId === config.commDepartmentId;
    const decisionOrgId = pool ? person?.divisionId ?? '' : step.orgId;
    const identity = this.access.snapshot().identity;
    return canDecideCampaignTask({ actorId: actor.id, authenticated: identity.sessionValid, accountActive: identity.effectiveActive && identity.originalActive,
      canRead: this.access.check('campaign.read', resource).allowed, canApprove: this.access.check('campaign.approve', resource).allowed,
      campaignId: facts.campaign.id, currentSubjectRevision: facts.campaign.businessRevision, currentPolicyVersionId: revision.policyVersionId, expectedStepVersion: step.stepVersion,
      task: { ...step, orgId: decisionOrgId, campaignId: facts.campaign.id, subjectRevision: revision.subjectRevision, policyVersionId: revision.policyVersionId,
        state: step.state === 'PENDING' ? 'PENDING' : 'COMPLETED', kind: step.kind as 'DEPARTMENT_APPROVAL' | 'DIVISION_ACCEPT_AND_ASSIGN', pool: 'ANY_ONE' },
      leaders: functional(person, role, decisionOrgId, facts.campaign.id, config) ? [{ actorId: actor.id, role, orgId: decisionOrgId, active: true }] : [],
      adminIntervention: admin ? { directSuperadmin: identity.mode === 'DIRECT' && identity.effectiveSuperadmin, reason: adminReason.trim() || 'Superadmin quyết định không kèm ý kiến.' } : null });
  }
  read(actor: ActorContext, campaignId: string) {
    return this.access.run(actor, async () => {
      const resource = await this.access.campaign(workflowId(campaignId)); const facts = await this.facts(campaignId);
      const config = await this.repository.configuration(); const people = await this.repository.people(); const revision = current(facts);
      const effectivePolicy = config.version ? policyFor(config, campaignId) : null;
      const canManage = this.access.check('access.manage').allowed;
      const closed = facts.workflow?.operationalState === 'CANCELLED';
      const canAssign = !closed && this.access.check('campaign.assign', resource).allowed;
      const activeAssignments = facts.assignments.filter((a) => !a.endsAt);
      const me = people.find((p) => p.id === actor.id);
      const reassignableScopes = canAssign && revision && ['PENDING','APPROVED','NEEDS_ASSIGNEE'].includes(revision.state) ? activeAssignments
        .filter((a) => a.functionalRole === 'DIVISION_LEADER' || a.functionalRole === 'CAMPAIGN_MANAGER')
        .filter((a) => canManage || activeAssignments.some((own) => own.actorId === actor.id && own.functionalRole === (a.functionalRole === 'DIVISION_LEADER' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER') &&
          own.orgId === (a.functionalRole === 'DIVISION_LEADER' ? config.commDepartmentId : a.orgId) && functional(me, own.functionalRole, own.orgId, campaignId, config)))
        .filter((a, i, all) => all.findIndex((b) => b.orgId === a.orgId && b.functionalRole === a.functionalRole) === i).map(({ orgId, functionalRole }) => ({ orgId, functionalRole })) : [];
      // Cross-division cooperation is paused for this pilot. Historical requests
      // and assignments remain readable; no new invitation is offered.
      const cooperationSourceOrgIds: string[] = [];
      const personIds = new Set([actor.id, ...facts.assignments.flatMap((p) => [p.actorId, p.assignedByActorId]), ...facts.revisions.flatMap((r) => [r.submittedByActorId, ...r.steps.flatMap((s) => [s.assigneeActorId, s.createdByActorId, s.decision?.actorId].filter((id): id is string => Boolean(id)))])]);
      const eligible = people.filter((person) => ['DEPARTMENT_LEADER','DIVISION_LEADER','CAMPAIGN_MANAGER'].some((role) => functional(person, role, role === 'DEPARTMENT_LEADER' ? person.departmentId : person.divisionId ?? '', campaignId, config)));
      return { campaign: { id: campaignId, code: facts.campaign.code, name: facts.campaign.name, recordVersion: facts.campaign.recordVersion, businessRevision: facts.campaign.businessRevision },
        version: facts.workflow?.recordVersion ?? 0, provenance: revision ? 'CURRENT' : 'LEGACY_UNASSESSED', revision: revision ?? null,
        history: facts.revisions, assignments: facts.assignments, cooperations: facts.cooperations,
        policy: effectivePolicy ? { ...effectivePolicy.policy, source: effectivePolicy.source } : null,
        currentPolicy: revision ? config.policies.find((p) => p.id === revision.policyVersionId) : null,
        organizations: config.organizations.filter((org) => org.id === config.commDepartmentId || org.parentId === config.commDepartmentId),
        people: people.filter((p) => personIds.has(p.id) || ((canAssign || canManage) && eligible.includes(p))).map(({ id, displayName, employeeCode, email, departmentId, divisionId, isActive, jobTitle }) => ({ id, displayName, employeeCode, email, departmentId, divisionId, isActive, jobTitle })),
        candidates: (canAssign || canManage) ? eligible.map((p) => ({ actorId: p.id, divisionId: p.divisionId,
          roles: ['DEPARTMENT_LEADER','DIVISION_LEADER','CAMPAIGN_MANAGER'].filter((role) => functional(p, role, role === 'DEPARTMENT_LEADER' ? p.departmentId : p.divisionId ?? '', campaignId, config)) })) : [],
        tasks: revision?.steps.map((step) => ({ ...step, assignmentOrgId: revision.route === 'DIVISION' && !revision.receivingDivisionId && step.orgId === config.commDepartmentId ? me?.divisionId ?? null : step.orgId,
          eligibility: this.taskEligibility(actor, step, revision, facts, resource, people, config),
          adminEligibility: this.directSuperadmin() ? this.taskEligibility(actor, step, revision, facts, resource, people, config, true) : null })) ?? [],
        capabilities: { submit: !closed && this.access.check('campaign.submit', resource).allowed, assign: canAssign, policy: canManage && !closed,
          reviewChanges: revision?.state === 'NO_APPROVAL' && facts.changeRequests.some(r => r.state === 'PENDING') && !activeAssignments.some(a => a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD') && (this.directSuperadmin() || functional(me, 'DIVISION_LEADER', me?.divisionId ?? '', campaignId, config)) && this.access.check('campaign.approve', resource).allowed,
          cooperate: false, withdraw: !closed && this.access.check('campaign.submit', resource).allowed },
        reassignableScopes, cooperationSourceOrgIds,
        planning: { implemented: true, label: 'Kế hoạch chiến dịch' }, internalDemoNotice: 'Quy trình mô phỏng nội bộ; không thay thế chữ ký hoặc thẩm quyền phê duyệt chính thức.' };
    });
  }

  /** Draft edits retain the old decision history; current pending/approved subjects are immutable. */
  async requireEditable(campaignId: string, changed: boolean) {
    if (!changed) return;
    const revision = current(await this.facts(campaignId));
    if (revision?.state === 'NO_APPROVAL' && await this.requiresApproval(campaignId, 'EDIT')) blocked('Thao tác Sửa đổi cần được trình Lãnh đạo Phòng theo chính sách hiện hành.');
    if (revision && ['PENDING','APPROVED','NEEDS_ASSIGNEE'].includes(revision.state)) blocked(revision.state === 'APPROVED' ? 'Nội dung đã phê duyệt. Hãy gửi đề nghị sửa đổi để Lãnh đạo Phòng chủ trì xem xét.' : 'Nội dung đang chờ duyệt. Hãy rút về nháp trước khi sửa và gửi lại.');
  }
  async afterContentChanged(campaignId: string) {
    this.access.snapshot();
    const facts = await this.facts(campaignId); const revision = current(facts);
    if (!revision || !['NO_APPROVAL','APPROVED'].includes(revision.state) || revision.subjectRevision === facts.campaign.businessRevision) return;
    if (revision.state === 'APPROVED' && await this.requiresApproval(campaignId, 'EDIT')) blocked('Nội dung mới chưa được phê duyệt.');
    await this.repository.setRevisionState(revision.id, 'SUPERSEDED', true);
    await this.repository.createRevision({ workflowId: facts.workflow!.id, number: facts.revisions[0]!.number + 1, subjectRevision: facts.campaign.businessRevision,
      subject: facts.campaign.subject, policyVersionId: revision.policyVersionId, policySource: revision.policySource, route: 'NONE', state: 'NO_APPROVAL',
      receivingDepartmentId: revision.receivingDepartmentId, receivingDivisionId: revision.receivingDivisionId,
      submittedByActorId: this.access.snapshot().actor.id, reason: 'Cập nhật nội dung trong chế độ không cần phê duyệt nội bộ.' });
    await this.repository.touchWorkflow(facts.workflow!.id);
  }

  inbox(actor: ActorContext) {
    return this.access.run(actor, async () => {
      const config = await this.repository.configuration(); const people = await this.repository.people();
      const person = people.find((p) => p.id === actor.id); const identity = this.access.snapshot().identity;
      const departmentFyi = functional(person, 'DEPARTMENT_LEADER', config.commDepartmentId ?? '', '', config) || functional(person, 'DIVISION_LEADER', person?.divisionId ?? '', '', config) ? config.commDepartmentId : null;
      const ids = this.directSuperadmin()
        ? [...new Set([...(await this.repository.inboxCampaignIds(actor.id, identity.orgIds, departmentFyi)), ...await this.access.visibleCampaignIds(), ...await this.access.visibleCampaignIds(true)])]
        : await this.repository.inboxCampaignIds(actor.id, identity.orgIds, departmentFyi);
      const visible = new Set([...await this.access.visibleCampaignIds(), ...await this.access.visibleCampaignIds(true)]);
      const items: { id: string; section: 'PENDING' | 'FOLLOWING' | 'ASSIGNED' | 'FYI'; campaignId: string; campaign: { code: string; name: string } | null;
        kind: string; orgId: string | null; state: string; createdAt: Date; assignedByActorId: string; assigneeActorId: string | null; pool: string | null;
        reason: string; workflowVersion: number; subjectRevision: number; taskVersion: number | null; canRespond: boolean; adminIntervention?: boolean }[] = [];
      for (const id of ids) {
        const facts = await this.facts(id); const revision = current(facts);
        if (!revision || (facts.campaign.deletedAt && !facts.changeRequests.some(r => ['RESTORE','PURGE'].includes(r.kind) && r.state === 'PENDING'))) continue;
        const canRead = visible.has(id);
        const base = { campaignId: id, campaign: canRead ? { code: facts.campaign.code, name: facts.campaign.name } : null,
          workflowVersion: facts.workflow!.recordVersion, subjectRevision: facts.campaign.businessRevision };
        if (canRead) {
          const resource = await this.access.campaign(id);
          const lead = facts.assignments.find((assignment) => !assignment.endsAt && assignment.functionalRole === 'DIVISION_LEADER' && assignment.responsibility === 'LEAD');
          const reviewerOrg = lead?.actorId === actor.id ? lead.orgId : !lead && revision.state === 'NO_APPROVAL' ? person?.divisionId : null;
          const canDecideChange = Boolean(['APPROVED','NO_APPROVAL'].includes(revision.state) && this.access.check('campaign.approve', resource).allowed &&
            (this.directSuperadmin() || reviewerOrg && functional(person, 'DIVISION_LEADER', reviewerOrg, id, config)));
          for (const request of facts.changeRequests.filter((request) => request.state === 'PENDING')) {
            if (facts.campaign.deletedAt && !['RESTORE','PURGE'].includes(request.kind)) continue;
            if (facts.workflow?.operationalState === 'CANCELLED' && !['RESTORE','PURGE'].includes(request.kind)) continue;
            if (!canDecideChange && request.requestedByActorId !== actor.id) continue;
            items.push({ ...base, id: request.id, section: canDecideChange ? 'PENDING' : 'FOLLOWING', kind: `CHANGE_${request.kind}`, orgId: lead?.orgId ?? null,
              state: request.state, createdAt: request.requestedAt, assignedByActorId: request.requestedByActorId, assigneeActorId: lead?.actorId ?? null,
              pool: null, reason: request.reason, taskVersion: request.recordVersion, canRespond: canDecideChange });
          }
          for (const step of revision.steps) if (this.taskEligibility(actor, step, revision, facts, resource, people, config).allowed || this.directSuperadmin() && this.taskEligibility(actor, step, revision, facts, resource, people, config, true).allowed) items.push({ ...base,
            id: step.id, section: 'PENDING', kind: step.kind, orgId: step.orgId, state: step.state, createdAt: step.createdAt,
            assignedByActorId: step.createdByActorId, assigneeActorId: step.assigneeActorId, pool: step.pool, reason: '', taskVersion: step.stepVersion, canRespond: true,
            adminIntervention: !this.taskEligibility(actor, step, revision, facts, resource, people, config).allowed });
          if (facts.revisions.some((r) => r.submittedByActorId === actor.id)) items.push({ ...base, id: `following:${id}`, section: 'FOLLOWING', kind: 'SUBMITTED', orgId: revision.receivingDivisionId ?? revision.receivingDepartmentId,
            state: revision.state, createdAt: revision.createdAt, assignedByActorId: revision.submittedByActorId, assigneeActorId: null, pool: null,
            reason: revision.steps.find((s) => ['RETURNED','REJECTED'].includes(s.decision?.kind ?? ''))?.decision?.reason ?? revision.reason, taskVersion: null, canRespond: false });
          for (const assignment of facts.assignments.filter((a) => !a.endsAt && a.actorId === actor.id)) items.push({ ...base, id: assignment.id, section: 'ASSIGNED', kind: assignment.functionalRole,
            orgId: assignment.orgId, state: assignment.responsibility, createdAt: assignment.startsAt, assignedByActorId: assignment.assignedByActorId,
            assigneeActorId: actor.id, pool: null, reason: '', taskVersion: assignment.recordVersion, canRespond: false });
          if (revision.route === 'DIVISION' && departmentFyi && !items.some((item) => item.campaignId === id && item.section === 'PENDING')) items.push({ ...base, id: `fyi:${id}`, section: 'FYI', kind: 'DIVISION_ROUTE_FYI',
            orgId: config.commDepartmentId, state: revision.state, createdAt: revision.createdAt, assignedByActorId: revision.submittedByActorId, assigneeActorId: null,
            pool: null, reason: '', taskVersion: null, canRespond: false });
        }
        for (const request of facts.cooperations.filter((r) => r.state === 'PENDING' && r.revisionId === revision.id && (!r.targetActorId || r.targetActorId === actor.id))) {
          if (!functional(person, 'DIVISION_LEADER', request.targetOrgId, id, config)) continue;
          const invitation: AccessResource = { type: 'CAMPAIGN', id, exists: true, deleted: false, state: facts.campaign.lifecycleState,
            createdByActorId: facts.campaign.createdByActorId, orgIds: [request.targetOrgId], assignedActorIds: [] };
          if (!this.access.check('campaign.cooperate', invitation).allowed) continue;
          items.push({ ...base, id: request.id, section: 'PENDING', kind: 'COOPERATION_INVITATION', orgId: request.targetOrgId, state: request.state,
            createdAt: request.requestedAt, assignedByActorId: request.requestedByActorId, assigneeActorId: request.targetActorId, pool: request.targetActorId ? null : 'ANY_ONE',
            reason: request.reason, taskVersion: request.recordVersion, canRespond: true });
        }
      }
      const actorIds = new Set(items.flatMap((item) => [item.assignedByActorId, item.assigneeActorId].filter((id): id is string => Boolean(id))));
      const orgIds = new Set(items.map((item) => item.orgId));
      return { items: items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()), policyVersion: this.access.snapshot().policyVersion,
        people: people.filter((p) => actorIds.has(p.id)).map(({ id, displayName }) => ({ id, displayName })), organizations: config.organizations.filter((o) => orgIds.has(o.id)) };
    });
  }

  command(actor: ActorContext, campaignId: string, raw: unknown, preview = false) {
    return this.access.run(actor, async () => {
      workflowId(campaignId); const input = parseWorkflowCommand(raw);
      const config = await this.repository.configuration(); const people = await this.repository.people();
      const reply = input.operation === 'ACCEPT_COOPERATION' || input.operation === 'DECLINE_COOPERATION';
      // An invitation authorizes only its response envelope. It never authorizes GET Campaign or general metadata.
      const facts = reply ? await this.facts(campaignId) : (await this.access.campaign(campaignId), await this.facts(campaignId));
      const revision = current(facts);
      const request = 'requestId' in input ? facts.cooperations.find((r) => r.id === input.requestId) : undefined;
      let resource: AccessResource;
      if (reply) {
        if (!request || (request.targetActorId && request.targetActorId !== actor.id)) throw new NotFoundException('Không tìm thấy đề nghị trong phạm vi tiếp nhận.');
        this.leaderCheck(actor.id, 'DIVISION_LEADER', request.targetOrgId, campaignId, people, config);
        resource = { type: 'CAMPAIGN', id: campaignId, exists: true, deleted: Boolean(facts.campaign.deletedAt), state: facts.campaign.lifecycleState,
          createdByActorId: facts.campaign.createdByActorId, orgIds: [request.targetOrgId], assignedActorIds: [] };
      } else resource = await this.access.campaign(campaignId);
      const permission: AccessPermission = ['SUBMIT','WITHDRAW'].includes(input.operation) ? 'campaign.submit'
        : input.operation === 'REVISE_POLICY' ? 'campaign.policy.manage' : input.operation === 'REASSIGN' ? 'campaign.assign'
        : input.operation.includes('COOPERATION') ? 'campaign.cooperate' : 'campaign.approve';
      this.access.require(permission, resource);
      if (input.operation === 'ADMIN_SKIP_ASSIGN' || input.operation === 'ADMIN_REJECT') this.access.require('access.manage');
      if (facts.campaign.deletedAt) blocked('Không xử lý workflow của Campaign trong Thùng rác.');
      const payloadHash = createHash('sha256').update(JSON.stringify({ campaignId, ...input, originalActorId: actor.session?.originalActorId ?? actor.id, mode: actor.session?.mode ?? 'DIRECT' })).digest('hex');
      const cached = await this.repository.receipt(actor.id, input.idempotencyKey);
      if (cached) { if (cached.payloadHash !== payloadHash) conflict(); return cached.result; }
      if (facts.workflow?.operationalState === 'CANCELLED') blocked('Chiến dịch đã hủy bỏ.');
      if ((facts.workflow?.recordVersion ?? 0) !== input.expectedVersion || facts.campaign.businessRevision !== input.expectedSubjectRevision) conflict();
      if (input.operation === 'SUBMIT' && revision && !['DRAFT','RETURNED','REJECTED','NEEDS_ROUTING','NEEDS_ASSIGNEE','CANCELLED'].includes(revision.state)) conflict();
      if (preview) {
        if (!['SUBMIT','REVISE_POLICY'].includes(input.operation)) {
          if (!revision || !facts.workflow) conflict();
          await this.applyExisting(actor, input, facts, revision!, resource, config, people, '', true);
        }
        const proposed = 'receivingDivisionId' in input ? routeFor(config, facts, input.receivingDivisionId) : null;
        return { operation: input.operation, currentRevisionId: revision?.id ?? null, subjectRevision: facts.campaign.businessRevision,
          supersedesPendingTaskIds: ['REVISE_POLICY','WITHDRAW'].includes(input.operation) ? revision?.steps.filter((s) => s.state === 'PENDING').map((s) => s.id) ?? [] : [],
          proposedPolicy: proposed?.policy ?? null, proposedRouting: proposed?.routing ?? null, input, persists: false };
      }
      const commandId = await this.repository.begin({ campaignId, actor, idempotencyKey: input.idempotencyKey, operation: input.operation, payloadHash });
      const workflow = facts.workflow?.id ?? await this.repository.createWorkflow(campaignId);
      if (input.operation === 'SUBMIT' || input.operation === 'REVISE_POLICY') {
        if (input.operation === 'SUBMIT' && revision && !['DRAFT','RETURNED','REJECTED','NEEDS_ROUTING','NEEDS_ASSIGNEE','CANCELLED'].includes(revision.state)) conflict();
        const resolved = routeFor(config, facts, input.receivingDivisionId);
        if (revision) { await this.repository.closePending(revision.id, 'SUPERSEDED', actor.id, commandId); await this.repository.setRevisionState(revision.id, 'SUPERSEDED', true); }
        await this.repository.endAssignments(workflow);
        const role = resolved.routing.route === 'DEPARTMENT' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER';
        const hasLeader = people.some((person) => functional(person, role,
          resolved.routing.reason === 'COMM_DIVISION_POOL' ? person.divisionId ?? '' : resolved.routing.receivingOrgId ?? '', campaignId, config));
        const state = resolved.routing.state === 'NEEDS_ROUTING' ? 'NEEDS_ROUTING' : resolved.routing.route === 'NONE' ? 'NO_APPROVAL' : hasLeader ? 'PENDING' : 'NEEDS_ASSIGNEE';
        const id = await this.repository.createRevision({ workflowId: workflow, number: (facts.revisions[0]?.number ?? 0) + 1, subjectRevision: facts.campaign.businessRevision,
          subject: facts.campaign.subject, policyVersionId: resolved.policy.id, policySource: resolved.source, route: resolved.routing.route, state,
          receivingDepartmentId: config.commDepartmentId, receivingDivisionId: input.receivingDivisionId, submittedByActorId: actor.id, reason: input.reason });
        if (resolved.routing.receivingOrgId) await this.repository.createSteps([{ revisionId: id, kind: role === 'DEPARTMENT_LEADER' ? 'DEPARTMENT_APPROVAL' : 'DIVISION_ACCEPT_AND_ASSIGN',
          orgId: resolved.routing.receivingOrgId, assigneeActorId: null, mandatory: true, createdByActorId: actor.id }]);
      } else {
        if (!revision || !facts.workflow) conflict();
        await this.applyExisting(actor, input, facts, revision!, resource, config, people, commandId);
      }
      const afterFacts = await this.facts(campaignId); const afterRevision = current(afterFacts);
      await this.repository.audit(actor, campaignId, `workflow.${input.operation.toLowerCase()}`, { commandId, operation: input.operation, reason: input.reason,
        subjectRevision: facts.campaign.businessRevision, beforeRevisionId: revision?.id ?? null, beforeVersion: input.expectedVersion,
        before: { revisionId: revision?.id ?? null, state: revision?.state ?? 'LEGACY_UNASSESSED', activeAssignmentIds: facts.assignments.filter((a) => !a.endsAt).map((a) => a.id) },
        after: { revisionId: afterRevision?.id ?? null, state: afterRevision?.state, activeAssignmentIds: afterFacts.assignments.filter((a) => !a.endsAt).map((a) => a.id) },
        ...(actor.session?.mode === 'DEMO_IMPERSONATION' ? { demo: true } : actor.session?.mode === 'ADMIN_ASSIST' ? { adminAssist: true } : {}) });
      return this.repository.finish(commandId, campaignId, workflow);
    });
  }

  async batch(actor: ActorContext, raw: unknown) {
    const input = raw as { items?: { campaignId: string; command: unknown }[] } | null;
    if (!input || Object.keys(input).some((key) => key !== 'items') || !Array.isArray(input.items) || !input.items.length || input.items.length > 50 ||
      input.items.some((item) => !item || typeof item !== 'object' || Object.keys(item).some((key) => !['campaignId','command'].includes(key))) ||
      new Set(input.items.map((item) => item.campaignId)).size !== input.items.length) throw new BadRequestException('Chọn từ 1 đến 50 chiến dịch, mỗi chiến dịch một thao tác.');
    const items = [];
    for (const item of input.items) {
      try { const result = await this.command(actor, item.campaignId, item.command); items.push({ campaignId: item.campaignId, ok: true, result }); }
      catch (error) { items.push({ campaignId: item.campaignId, ok: false, message: error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException ? error.message : 'Không thể xử lý chiến dịch trong phạm vi hiện hành.' }); }
    }
    return { items, succeeded: items.filter((item) => item.ok).length, total: items.length };
  }

  private async applyExisting(actor: ActorContext, input: WorkflowCommand, facts: WorkflowFacts, revision: WorkflowRevision, resource: AccessResource,
    config: WorkflowConfiguration, people: WorkflowPerson[], commandId: string, dryRun = false) {
    const campaignId = facts.campaign.id; const workflowId = facts.workflow!.id;
    if (input.operation === 'WITHDRAW') {
      if (revision.state === 'APPROVED') blocked('Chiến dịch đã phê duyệt cần gửi đề nghị sửa đổi cho Lãnh đạo Phòng chủ trì.');
      if (dryRun) return;
      await this.repository.closePending(revision.id, 'CANCELLED', actor.id, commandId);
      await this.repository.setRevisionState(revision.id, 'SUPERSEDED', true);
      await this.repository.createRevision({ workflowId, number: facts.revisions[0]!.number + 1, subjectRevision: facts.campaign.businessRevision, subject: facts.campaign.subject,
        policyVersionId: revision.policyVersionId, policySource: revision.policySource, route: revision.route, state: 'DRAFT',
        receivingDepartmentId: revision.receivingDepartmentId, receivingDivisionId: revision.receivingDivisionId, submittedByActorId: actor.id, reason: input.reason });
      return;
    }
    if ('stepId' in input) {
      const step = revision.steps.find((s) => s.id === input.stepId);
      if (!step || step.stepVersion !== input.expectedStepVersion || revision.subjectRevision !== facts.campaign.businessRevision) conflict();
      const admin = input.operation === 'ADMIN_SKIP_ASSIGN' || input.operation === 'ADMIN_REJECT';
      const eligibility = this.taskEligibility(actor, step!, revision, facts, resource, people, config, admin, input.reason);
      if (!eligibility.allowed) blocked(`Không được xử lý bước này: ${eligibility.reason}.`);
      const role = step!.kind === 'DEPARTMENT_APPROVAL' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER';
      const leadActorId = input.operation === 'ADMIN_SKIP_ASSIGN' ? input.leaderActorId : actor.id;
      const decisionOrgId = revision.route === 'DIVISION' && !revision.receivingDivisionId && step!.orgId === config.commDepartmentId
        ? people.find((p) => p.id === leadActorId)?.divisionId ?? '' : step!.orgId;
      if (!admin) this.leaderCheck(actor.id, role, decisionOrgId, campaignId, people, config);
      const members = 'members' in input ? input.members : [];
      const childRole = role === 'DEPARTMENT_LEADER' ? 'DIVISION_LEADER' : 'CAMPAIGN_MANAGER';
      if ('members' in input) {
        this.access.require('campaign.assign', resource);
        this.leaderCheck(leadActorId, role, decisionOrgId, campaignId, people, config);
        this.validateMembers(members, childRole, role === 'DIVISION_LEADER' ? decisionOrgId : null, campaignId, people, config);
      }
      if (dryRun) return;
      const decisionId = await this.repository.decide({ step: step!, revision, commandId, actor, kind: input.operation === 'RETURN' ? 'RETURNED' : ['REJECT','ADMIN_REJECT'].includes(input.operation) ? 'REJECTED' : admin ? 'SKIPPED_BY_ADMIN' : 'APPROVED_BY_LEADER', reason: input.reason });
      if (input.operation === 'RETURN' || input.operation === 'REJECT' || input.operation === 'ADMIN_REJECT') {
        if (!step!.mandatory) {
          // Optional cooperation is not authority to veto another division's completed primary gate.
          // End only this workflow-owned optional part; the immutable decision remains in history.
          for (const functionalRole of ['CAMPAIGN_MANAGER','DIVISION_LEADER']) await this.repository.assignments({ campaignId, workflowId, revisionId: revision.id,
            orgId: step!.orgId, functionalRole, replacements: [], commandId, decisionId, actorId: actor.id });
          return;
        }
        await this.repository.closePending(revision.id, 'CANCELLED', actor.id, commandId);
        await this.repository.setRevisionState(revision.id, input.operation === 'RETURN' ? 'RETURNED' : 'REJECTED', true); return;
      }
      if (!('members' in input)) conflict();
      this.access.require('campaign.assign', resource);
      const prior = facts.assignments.find((a) => a.endsAt === null && a.functionalRole === role && a.orgId === decisionOrgId);
      await this.repository.assignments({ campaignId, workflowId, revisionId: revision.id, orgId: decisionOrgId, functionalRole: role,
        replacements: [{ actorId: leadActorId, orgId: decisionOrgId, functionalRole: role, responsibility: prior?.responsibility ?? (step!.mandatory ? 'LEAD' : 'COOP') }], commandId, decisionId, actorId: actor.id });
      for (const orgId of new Set(members.map((m) => m.orgId))) {
        await this.repository.assignments({ campaignId, workflowId, revisionId: revision.id, orgId, functionalRole: childRole,
          replacements: members.filter((m) => m.orgId === orgId).map((m) => ({ ...m, functionalRole: childRole })), commandId, decisionId, actorId: actor.id });
      }
      if (role === 'DEPARTMENT_LEADER') await this.repository.createSteps(members.map((m) => ({ revisionId: revision.id, kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: m.orgId, assigneeActorId: m.actorId, mandatory: true, createdByActorId: actor.id })));
      const refreshed = current((await this.facts(campaignId)))!;
      const all = refreshed.steps.filter((s) => s.mandatory).every((s) => ['COMPLETED','SKIPPED_BY_ADMIN'].includes(s.state));
      await this.repository.setRevisionState(revision.id, all ? 'APPROVED' : 'PENDING', false); return;
    }
    if (input.operation === 'REASSIGN') {
      const active = facts.assignments.filter((a) => a.endsAt === null);
      if (!['PENDING','APPROVED','NEEDS_ASSIGNEE'].includes(revision.state)) conflict();
      const admin = this.access.check('access.manage').allowed;
      const role = input.functionalRole === 'DIVISION_LEADER' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER';
      const orgId = role === 'DEPARTMENT_LEADER' ? config.commDepartmentId! : input.orgId;
      if (!admin) {
        this.leaderCheck(actor.id, role, orgId, campaignId, people, config);
        if (!active.some((a) => a.actorId === actor.id && a.functionalRole === role && a.orgId === orgId)) blocked('Chưa được giao trách nhiệm điều phối phạm vi này.');
      }
      const previous = active.filter((a) => a.functionalRole === input.functionalRole && a.orgId === input.orgId);
      if (!previous.length) blocked('Thêm phòng mới cần revision hoặc đề nghị phối hợp.');
      this.validateMembers(input.members, input.functionalRole, input.orgId, campaignId, people, config, input.functionalRole === 'DIVISION_LEADER' ? previous[0]!.responsibility : undefined);
      if (dryRun) return;
      await this.repository.assignments({ campaignId, workflowId, revisionId: revision.id, orgId: input.orgId, functionalRole: input.functionalRole,
        replacements: input.members.map((m) => ({ ...m, functionalRole: input.functionalRole })), commandId, actorId: actor.id });
      // A pending named task is reassigned explicitly, with its own version increment; its old assignment is ended.
      await this.repository.reassignStep(revision.id, input.orgId, input.functionalRole === 'DIVISION_LEADER' ? input.members[0]!.actorId : null);
      return;
    }
    if (input.operation === 'REQUEST_COOPERATION') {
      blocked('Phối hợp ngang phòng đang tạm dừng trong giai đoạn này.');
    }
    if ('requestId' in input) {
      if (input.operation === 'ACCEPT_COOPERATION') blocked('Phối hợp ngang phòng đang tạm dừng trong giai đoạn này.');
      const request = facts.cooperations.find((r) => r.id === input.requestId);
      if (!request || request.state !== 'PENDING' || request.revisionId !== revision.id || request.recordVersion !== input.expectedRequestVersion || revision.subjectRevision !== facts.campaign.businessRevision) conflict();
      if (input.operation === 'CANCEL_COOPERATION' && request!.requestedByActorId !== actor.id && !this.access.check('access.manage').allowed) blocked('Chỉ người gửi hoặc superadmin được hủy đề nghị.');
      if (dryRun) return;
      const accepted = input.operation === 'ACCEPT_COOPERATION';
      await this.repository.respondCooperation({ id: request!.id, revisionId: revision.id, actorId: actor.id, commandId, state: accepted ? 'ACCEPTED' : input.operation === 'DECLINE_COOPERATION' ? 'DECLINED' : 'CANCELLED', reason: input.reason });
      if (accepted) {
        await this.repository.assignments({ campaignId, workflowId, revisionId: revision.id, orgId: request!.targetOrgId, functionalRole: 'DIVISION_LEADER',
          replacements: [{ actorId: actor.id, orgId: request!.targetOrgId, functionalRole: 'DIVISION_LEADER', responsibility: 'COOP' }], commandId, actorId: actor.id });
        await this.repository.createSteps([{ revisionId: revision.id, kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: request!.targetOrgId, assigneeActorId: actor.id, mandatory: false, createdByActorId: actor.id }]);
      }
      return;
    }
    throw new BadRequestException('Command không áp dụng cho revision hiện hành.');
  }

  private validateMembers(members: { actorId: string; orgId: string; responsibility: string }[], role: string, orgId: string | null, campaignId: string, people: WorkflowPerson[], config: WorkflowConfiguration, fixedResponsibility?: string) {
    if (role === 'DIVISION_LEADER' && new Set(members.map((m) => m.orgId)).size !== members.length) throw new BadRequestException('Mỗi phòng chỉ chọn một Leader tiếp nhận.');
    if (fixedResponsibility ? members.length !== 1 || members[0]!.responsibility !== fixedResponsibility : members.filter((m) => m.responsibility === 'LEAD').length !== 1) throw new BadRequestException('Cần đúng một người chủ trì trong phạm vi phân công.');
    for (const member of members) {
      if (orgId && member.orgId !== orgId) blocked('Không được phân công sang phạm vi phòng khác.');
      this.leaderCheck(member.actorId, role, member.orgId, campaignId, people, config);
    }
  }
}
