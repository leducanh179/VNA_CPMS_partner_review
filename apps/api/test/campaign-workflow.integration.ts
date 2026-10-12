import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { DEFAULT_ROLE_PRESETS } from '../src/modules/access/application/access-catalog';
import { generateLocalCredential, hashLocalPassword } from '../src/modules/identity/application/local-auth-security';
import type { CampaignWorkflowApplicationService } from '../src/modules/campaign-workflow/application/campaign-workflow.application-service';
import { campaignRequiredApprovals, type CampaignRequiredApprovals } from '@cpms/domain';

type Headers = Record<string, string>;
type Send = (route: string, headers?: Headers, method?: string, body?: unknown) => Promise<Response>;
type View = Awaited<ReturnType<CampaignWorkflowApplicationService['read']>>;
type OperationsView = { version: number; subjectRevision: number; operationalState: string; capabilities: { decide: boolean }; requests: { id: string; kind: string; state: string; recordVersion: number; canWithdraw: boolean }[] };

/** Real HTTP + PostgreSQL, independent synthetic people/orgs; the caller forbids every external HTTP origin. */
export async function exerciseCampaignWorkflow(db: PrismaService, send: Send, admin: Headers, session: (email: string) => Promise<Headers>) {
  assert(/^\/cpms_access_test_\d+_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const json = async <T>(response: Promise<Response>, expected = 200): Promise<T> => {
    const result = await response; const body = await result.json() as T;
    assert.equal(result.status, expected, JSON.stringify(body)); return body;
  };
  const org = async (name: string, parentId: string | null = null) => db.employmentOrgUnit.create({ data: { identityKey: `synthetic-workflow:${name}`, sourceName: `Synthetic Workflow ${name}`,
    kind: parentId ? 'DIVISION' : 'DEPARTMENT', parentId, sourceProvider: 'synthetic' } });
  const dept = await org('Communications'); const outside = await org('Sales');
  const division = await org('Division A', dept.id); const coopDivision = await org('Division B', dept.id);
  const person = async (name: string, departmentId: string, divisionId: string | null, role: string) => {
    const employeeCode = `SYN-WF-${name.toUpperCase()}`; const email = `workflow-${name}@example.test`;
    await db.personnelDirectoryEntry.create({ data: { employeeCode, fullName: `Synthetic Workflow ${name}`, email, organizationName: 'Synthetic workflow organization', sourceProvider: 'synthetic' } });
    const actor = await db.actor.create({ data: { key: employeeCode, displayName: `Synthetic Workflow ${name}`, accountKind: 'PERSONNEL', personnelEmployeeCode: employeeCode,
      loginEmail: email, employment: { create: { departmentId, divisionId } }, credential: { create: { passwordHash: await hashLocalPassword(generateLocalCredential()), mustChangePassword: false } } } });
    const scopeType = role.includes('LEADER') ? 'MODULE_ORG' : 'MODULE';
    const orgId = scopeType === 'MODULE_ORG' ? role === 'DEPARTMENT_LEADER' ? departmentId : divisionId : null;
    await db.scopedRoleBinding.create({ data: { actorId: actor.id, roleCode: role, scopeType, module: 'CAMPAIGN', orgId,
      scopeKey: JSON.stringify([scopeType,'CAMPAIGN',orgId,null]), relation: 'PRESET' } });
    return { ...actor, headers: await session(email) };
  };
  const requester = await person('requester', outside.id, null, 'CAMPAIGN_REQUESTER');
  const departmentLeader = await person('department', dept.id, null, 'DEPARTMENT_LEADER');
  const departmentDeputy = await person('department-deputy', dept.id, coopDivision.id, 'DEPARTMENT_LEADER');
  const leader = await person('leader', dept.id, division.id, 'DIVISION_LEADER');
  const deputy = await person('deputy', dept.id, division.id, 'DIVISION_LEADER');
  const cooperative = await person('cooperative', dept.id, coopDivision.id, 'DIVISION_LEADER');
  const manager = await person('manager', dept.id, division.id, 'COMM_CAMPAIGN_MANAGER');
  const coManager = await person('co-manager', dept.id, division.id, 'COMM_CAMPAIGN_MANAGER');
  const otherManager = await person('other-manager', dept.id, coopDivision.id, 'COMM_CAMPAIGN_MANAGER');
  const accessSave = async (changes: unknown[]) => {
    const { version } = await json<{ version: number }>(send('/access', admin));
    await json(send('/access/save', admin, 'POST', { expectedVersion: version, reason: 'Synthetic workflow fixture policy review', changes }), 201);
  };
  // Restore the preset deliberately replaced by the preceding management HTTP test.
  await accessSave([{ kind: 'ROLE_PRESET', roleCode: 'COMM_CAMPAIGN_MANAGER', permissions: DEFAULT_ROLE_PRESETS.COMM_CAMPAIGN_MANAGER! }]);
  const initial = { commDepartmentId: dept.id, demo: true };
  assert.equal((await send('/campaign-workflow/initialize', requester.headers, 'POST', initial)).status, 403);
  await json(send('/campaign-workflow/initialize', admin, 'POST', initial), 201);
  const policyCount = await db.approvalPolicyVersion.count(); const initAuditCount = await db.auditEvent.count();
  assert((await json<{ alreadyInitialized: boolean }>(send('/campaign-workflow/initialize', admin, 'POST', initial), 201)).alreadyInitialized);
  assert.equal(await db.approvalPolicyVersion.count(), policyCount); assert.equal(await db.auditEvent.count(), initAuditCount);
  assert.deepEqual((await db.approvalPolicyVersion.findMany({ orderBy: { version: 'asc' } })).map((p) => p.preset), ['STANDARD','DIVISION_ONLY']);
  const policy = async (campaignId: string | null, preset: string | null, requiredApprovals = campaignRequiredApprovals()) => {
    const { version } = await json<{ version: number }>(send('/campaign-workflow/configuration', admin));
    const body = { expectedVersion: version, campaignId, preset, requiredApprovals, effectiveFrom: new Date().toISOString(), reason: 'Synthetic reviewed policy change' };
    const before = await db.approvalPolicyVersion.count();
    await json(send('/campaign-workflow/policy/preview', admin, 'POST', body), 201); assert.equal(await db.approvalPolicyVersion.count(), before);
    return json(send('/campaign-workflow/policy/save', admin, 'POST', body), 201);
  };
  const create = async () => json<{ id: string; recordVersion: number }>(send('/campaigns', requester.headers, 'POST', { name: 'QA Workflow synthetic', levelCode: 'CLV_01', lifecycleState: 'DRAFT' }), 201);
  const view = (id: string, headers = admin) => json<View>(send(`/campaign-workflow/${id}`, headers));
  const bodyFor = (v: View, operation: string, extra: Record<string, unknown> = {}) => ({ operation, idempotencyKey: randomUUID(), expectedVersion: v.version,
    expectedSubjectRevision: v.campaign.businessRevision, reason: 'Synthetic workflow command', ...extra });
  const command = (id: string, headers: Headers, body: unknown) => send(`/campaign-workflow/${id}/commands`, headers, 'POST', body);
  const members = [{ actorId: manager.id, orgId: division.id, responsibility: 'LEAD' }, { actorId: coManager.id, orgId: division.id, responsibility: 'COOP' }];
  const one = await create(); let v = await view(one.id); assert.equal(v.provenance, 'LEGACY_UNASSESSED');
  assert.equal((await send(`/campaign-workflow/${one.id}`, leader.headers)).status, 404);
  const submit = bodyFor(v, 'SUBMIT', { receivingDivisionId: division.id });
  const beforePreview = await db.campaignWorkflow.count(); await json(send(`/campaign-workflow/${one.id}/preview`, requester.headers, 'POST', submit), 201);
  assert.equal(await db.campaignWorkflow.count(), beforePreview);
  await json(command(one.id, requester.headers, submit), 201); const retried = await json(command(one.id, requester.headers, submit), 201);
  assert(retried); assert.equal(await db.campaignWorkflowRevision.count(), 1);
  v = await view(one.id, leader.headers); assert.equal(v.revision!.route, 'DIVISION'); assert.equal(v.tasks[0]!.eligibility.allowed, true);
  assert.equal((await view(one.id, departmentLeader.headers)).tasks[0]!.eligibility.allowed, false);
  const departmentInbox = await json<{ items: { section: string; campaignId: string }[] }>(send('/campaign-workflow/inbox', departmentLeader.headers));
  assert(departmentInbox.items.some((item) => item.campaignId === one.id && item.section === 'FYI'));
  const step = v.tasks[0]!; const approval = bodyFor(v, 'APPROVE_ASSIGN', { stepId: step.id, expectedStepVersion: step.stepVersion, members });
  assert.equal((await command(one.id, departmentLeader.headers, approval)).status, 403, 'A higher title has no Division task');
  assert.equal((await send(`/campaigns/${one.id}`, requester.headers, 'PATCH', { expectedVersion: one.recordVersion, name: 'Must remain locked' })).status, 403);
  // Online initializes STANDARD (not the local demo's DIVISION_ONLY). The new-form
  // submit command has no receiving division, so it must still create a real
  // shared Ban TT leader task instead of a stranded NEEDS_ROUTING revision.
  const standardSubmission = await json<{ id: string; qcttStatus: string }>(send('/campaign-operations/create-and-submit', requester.headers, 'POST', {
    name: 'Synthetic STANDARD shared reception', levelCode: 'CLV_01', idempotencyKey: randomUUID(),
  }), 201);
  assert.equal(standardSubmission.qcttStatus, 'Chờ phê duyệt');
  const standardView = await view(standardSubmission.id, leader.headers);
  assert.equal(standardView.revision!.route, 'DIVISION');
  assert.equal(standardView.revision!.state, 'PENDING');
  assert.equal(standardView.tasks.length, 1);
  assert.equal(standardView.tasks[0]!.orgId, dept.id);
  assert(standardView.tasks[0]!.eligibility.allowed);
  assert((await view(standardSubmission.id, cooperative.headers)).tasks[0]!.eligibility.allowed);
  assert(!(await view(standardSubmission.id, departmentLeader.headers)).tasks[0]!.eligibility.allowed);
  assert((await view(standardSubmission.id, admin)).tasks[0]!.adminEligibility!.allowed);
  const standardLeaderInbox = await json<{ items: { campaignId: string; section: string }[] }>(send('/campaign-workflow/inbox', leader.headers));
  assert(standardLeaderInbox.items.some((item) => item.campaignId === standardSubmission.id && item.section === 'PENDING'));
  const standardDepartmentInbox = await json<{ items: { campaignId: string; section: string }[] }>(send('/campaign-workflow/inbox', departmentLeader.headers));
  assert(standardDepartmentInbox.items.some((item) => item.campaignId === standardSubmission.id && item.section === 'FYI'));
  await json(command(standardSubmission.id, leader.headers, bodyFor(standardView, 'APPROVE_ASSIGN', {
    stepId: standardView.tasks[0]!.id, expectedStepVersion: standardView.tasks[0]!.stepVersion, members,
  })), 201);
  assert.equal((await view(standardSubmission.id)).revision!.state, 'APPROVED');
  const noOpBefore = await db.campaign.findUniqueOrThrow({ where: { id: one.id } }); const noOpAudit = await db.auditEvent.count();
  await json(send(`/campaigns/${one.id}`, leader.headers, 'PATCH', { expectedVersion: noOpBefore.recordVersion, name: noOpBefore.name }));
  assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id: one.id } }), noOpBefore); assert.equal(await db.auditEvent.count(), noOpAudit);
  const decisionCount = await db.campaignWorkflowDecision.count(); const assignmentCount = await db.campaignWorkflowAssignment.count();
  const invalidAssignment = { ...approval, idempotencyKey: randomUUID(), members: [{ actorId: otherManager.id, orgId: division.id, responsibility: 'LEAD' }] };
  assert.equal((await command(one.id, leader.headers, invalidAssignment)).status, 403);
  assert.equal(await db.campaignWorkflowDecision.count(), decisionCount); assert.equal(await db.campaignWorkflowAssignment.count(), assignmentCount);
  // A persistence failure after decision creation must roll back the decision and command receipt too.
  const manual = await db.campaignParticipant.create({ data: { campaignId: one.id, orgId: division.id, functionalRole: 'DIVISION', responsibility: 'LEAD', assignedByActorId: requester.id } });
  const receiptsBefore = await db.campaignWorkflowCommand.count();
  const colliding = await command(one.id, leader.headers, { ...approval, idempotencyKey: randomUUID() });
  assert.equal(colliding.status, 409);
  assert.equal(await db.campaignWorkflowDecision.count(), decisionCount); assert.equal(await db.campaignWorkflowAssignment.count(), assignmentCount);
  assert.equal(await db.campaignWorkflowCommand.count(), receiptsBefore);
  assert.equal((await db.campaignParticipant.findUniqueOrThrow({ where: { id: manual.id } })).endsAt, null);
  await db.campaignParticipant.update({ where: { id: manual.id }, data: { endsAt: new Date() } });
  const race = await Promise.all([command(one.id, leader.headers, approval), command(one.id, deputy.headers, { ...approval, idempotencyKey: randomUUID() })]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201,409]);
  const winner = race[0]!.status === 201 ? leader : deputy;
  const winnerBody = race[0]!.status === 201 ? approval : null;
  if (winnerBody) await json(command(one.id, winner.headers, winnerBody), 201);
  assert.equal(await db.campaignWorkflowDecision.count(), decisionCount + 1);
  v = await view(one.id); assert.equal(v.revision!.state, 'APPROVED'); assert.equal(v.campaign.businessRevision, submit.expectedSubjectRevision);
  assert.equal(v.assignments.filter((a) => !a.endsAt && a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD').length, 1);
  assert.equal(v.assignments.filter((a) => !a.endsAt && a.functionalRole === 'CAMPAIGN_MANAGER' && a.responsibility === 'LEAD').length, 1);
  const loserInbox = await json<{ items: { id: string }[] }>(send('/campaign-workflow/inbox', (winner === leader ? deputy : leader).headers));
  assert(!loserInbox.items.some((item) => item.id === step.id));
  assert.equal((await send(`/campaigns/${one.id}`, manager.headers)).status, 200);
  await assert.rejects(db.campaignWorkflowDecision.update({ where: { stepId: step.id }, data: { reason: 'Mutate immutable history' } }));
  await assert.rejects(db.campaignWorkflowRevision.update({ where: { id: v.revision!.id }, data: { subjectRevision: 123 } }));
  await assert.rejects(db.approvalPolicyVersion.update({ where: { id: v.revision!.policyVersionId }, data: { preset: 'NO_APPROVAL' } }));
  const journal = await json<{ items: { actionLabel: string }[]; total: number }>(send(`/campaign-journal?campaignId=${one.id}`, requester.headers));
  assert.equal(journal.items.filter((item) => item.actionLabel === 'Phê duyệt và giao việc').length, 1);
  // Cross-division cooperation is paused without changing earlier decisions.
  assert.equal((await send(`/campaigns/${one.id}`, cooperative.headers)).status, 404);
  assert.equal((await command(one.id, winner.headers, bodyFor(v, 'REQUEST_COOPERATION', { sourceOrgId: division.id, targetOrgId: coopDivision.id }))).status, 403);
  assert.equal((await view(one.id)).capabilities.cooperate, false);
  assert.equal((await send(`/campaigns/${one.id}`, cooperative.headers)).status, 404);
  // Default changes never reroute an open/approved revision, and do not touch level or content.
  v = await view(one.id); const snapshotPolicy = v.revision!.policyVersionId;
  const content = await db.campaign.findUniqueOrThrow({ where: { id: one.id } });
  await policy(null, 'DEPARTMENT_REQUIRED'); assert.equal((await view(one.id)).revision!.policyVersionId, snapshotPolicy);
  await policy(one.id, 'DEPARTMENT_REQUIRED'); assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id: one.id } }), content);
  const revise = bodyFor(v, 'REVISE_POLICY', { receivingDivisionId: division.id });
  await json(send(`/campaign-workflow/${one.id}/preview`, admin, 'POST', revise), 201);
  await json(command(one.id, admin, revise), 201); v = await view(one.id); assert.equal(v.revision!.route, 'DEPARTMENT');
  assert.equal(v.history.filter((r) => r.state === 'SUPERSEDED').length, 1); assert.equal(await db.campaignWorkflowDecision.count(), decisionCount + 1);
  const deptStep = v.tasks[0]!;
  const deptApprove = bodyFor(v, 'APPROVE_ASSIGN', { stepId: deptStep.id, expectedStepVersion: deptStep.stepVersion, members: [
    { actorId: leader.id, orgId: division.id, responsibility: 'LEAD' }, { actorId: cooperative.id, orgId: coopDivision.id, responsibility: 'COOP' }] });
  const deptRace = await Promise.all([command(one.id, departmentLeader.headers, deptApprove), command(one.id, departmentDeputy.headers, { ...deptApprove, idempotencyKey: randomUUID() })]);
  assert.deepEqual(deptRace.map((r) => r.status).sort(), [201,409]);
  v = await view(one.id); assert.equal(v.revision!.state, 'PENDING'); assert.equal(v.tasks.filter((s) => s.state === 'PENDING').length, 2);
  const divisionStep = v.tasks.find((s) => s.orgId === division.id)!;
  assert.equal((await command(one.id, deputy.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: divisionStep.id, expectedStepVersion: divisionStep.stepVersion, members }))).status, 403, 'Named task does not become a pool');
  await json(command(one.id, leader.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: divisionStep.id, expectedStepVersion: divisionStep.stepVersion, members })), 201);
  v = await view(one.id); assert.equal(v.revision!.state, 'PENDING', 'The second mandatory Division blocks the initial gate');
  const mandatoryCoop = v.tasks.find((s) => s.orgId === coopDivision.id)!;
  await json(command(one.id, cooperative.headers, bodyFor(v, 'RETURN', { stepId: mandatoryCoop.id, expectedStepVersion: mandatoryCoop.stepVersion })), 201);
  v = await view(one.id); assert.equal(v.revision!.state, 'RETURNED');
  const currentRow = await db.campaign.findUniqueOrThrow({ where: { id: one.id } });
  await json(send(`/campaigns/${one.id}`, requester.headers, 'PATCH', { expectedVersion: currentRow.recordVersion, name: 'QA Workflow revised content' }));
  v = await view(one.id); assert.equal(v.campaign.businessRevision, currentRow.businessRevision + 1);
  // NO_APPROVAL is a real policy snapshot; generic edits get a fresh subject without fake tasks or Plan writes.
  await policy(one.id, 'NO_APPROVAL'); await json(command(one.id, admin, bodyFor(v, 'REVISE_POLICY')), 201);
  v = await view(one.id); assert.equal(v.revision!.state, 'NO_APPROVAL'); assert.equal(v.tasks.length, 0); assert.equal(v.planning.implemented, true);
  const noneRow = await db.campaign.findUniqueOrThrow({ where: { id: one.id } });
  await json(send(`/campaigns/${one.id}`, requester.headers, 'PATCH', { expectedVersion: noneRow.recordVersion, name: 'QA No approval edited' }));
  v = await view(one.id); assert.equal(v.revision!.subjectRevision, v.campaign.businessRevision); assert.equal(v.tasks.length, 0);
  let directOperations = await json<OperationsView>(send(`/campaign-operations/${one.id}`, requester.headers));
  const directCommand = (operation: string, more: Record<string, unknown> = {}) => ({ operation, idempotencyKey: randomUUID(), expectedVersion: directOperations.version, expectedSubjectRevision: directOperations.subjectRevision, ...more });
  await json(send(`/campaign-operations/${one.id}/commands`, requester.headers, 'POST', directCommand('REQUEST_PAUSE', { reason: '' })), 201);
  directOperations = await json<OperationsView>(send(`/campaign-operations/${one.id}`, requester.headers));
  assert.equal(directOperations.operationalState, 'PAUSED');
  assert.equal(directOperations.requests.find((request) => request.kind === 'PAUSE')?.state, 'APPROVED');
  await json(send(`/campaign-operations/${one.id}/commands`, requester.headers, 'POST', directCommand('REQUEST_RESUME', { reason: '' })), 201);
  directOperations = await json<OperationsView>(send(`/campaign-operations/${one.id}`, requester.headers));
  assert.equal(directOperations.operationalState, 'ACTIVE');
  assert.equal((await command(one.id, manager.headers, bodyFor(v, 'SUBMIT'))).status, 404, 'No assignment survives a new unapproved scope');
  assert.equal((await command(one.id, requester.headers, { ...bodyFor(v, 'SUBMIT'), actorId: departmentLeader.id })).status, 400);
  // Reassignment replaces a named task without widening it to another Leader in the same pool.
  const two = await create(); await policy(two.id, 'DEPARTMENT_REQUIRED');
  await json(command(two.id, requester.headers, bodyFor(await view(two.id), 'SUBMIT')), 201);
  v = await view(two.id); const secondDeptStep = v.tasks[0]!;
  await json(command(two.id, departmentLeader.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: secondDeptStep.id, expectedStepVersion: secondDeptStep.stepVersion,
    members: [{ actorId: leader.id, orgId: division.id, responsibility: 'LEAD' }] })), 201);
  v = await view(two.id); const oldNamed = v.tasks.find((s) => s.state === 'PENDING')!;
  const staleNamed = bodyFor(v, 'APPROVE_ASSIGN', { stepId: oldNamed.id, expectedStepVersion: oldNamed.stepVersion, members });
  await json(command(two.id, departmentLeader.headers, bodyFor(v, 'REASSIGN', { functionalRole: 'DIVISION_LEADER', orgId: division.id,
    members: [{ actorId: deputy.id, orgId: division.id, responsibility: 'LEAD' }] })), 201);
  v = await view(two.id); const named = v.tasks.find((s) => s.id === oldNamed.id)!;
  assert.equal(named.stepVersion, oldNamed.stepVersion + 1); assert.equal(named.assigneeActorId, deputy.id);
  assert.equal((await command(two.id, leader.headers, staleNamed)).status, 409);
  assert.equal((await command(two.id, leader.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: named.id, expectedStepVersion: named.stepVersion, members }))).status, 403);
  assert.equal((await command(two.id, deputy.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: step.id, expectedStepVersion: step.stepVersion, members }))).status, 409);
  const beforeInvalid = await db.campaignWorkflowDecision.count();
  await db.actor.update({ where: { id: manager.id }, data: { isActive: false } });
  assert.equal((await command(two.id, deputy.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: named.id, expectedStepVersion: named.stepVersion, members }))).status, 403);
  assert.equal(await db.campaignWorkflowDecision.count(), beforeInvalid);
  assert(!(await view(two.id)).candidates.some((candidate) => candidate.actorId === manager.id));
  await db.actor.update({ where: { id: manager.id }, data: { isActive: true } });
  const override = (actorId: string, campaignId: string, permissionCode: string, state: string) => ({ kind: 'OVERRIDE', actorId, permissionCode, state, relation: 'ALL',
    scope: { scopeType: 'RECORD', module: 'CAMPAIGN', campaignId }, validFrom: null, validUntil: null });
  // Explicit record permissions never replace the mandatory current functional role and actual org.
  await accessSave(['campaign.read','campaign.approve','campaign.assign'].map((p) => override(deputy.id, two.id, p, 'ALLOW')));
  await db.scopedRoleBinding.updateMany({ where: { actorId: deputy.id, roleCode: 'DIVISION_LEADER' }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await command(two.id, deputy.headers, bodyFor(v, 'APPROVE_ASSIGN', { stepId: named.id, expectedStepVersion: named.stepVersion, members }))).status, 403);
  await db.scopedRoleBinding.updateMany({ where: { actorId: deputy.id, roleCode: 'DIVISION_LEADER' }, data: { expiresAt: null } });
  const adminSkip = bodyFor(v, 'ADMIN_SKIP_ASSIGN', { stepId: named.id, expectedStepVersion: named.stepVersion, leaderActorId: deputy.id, members });
  assert.equal((await command(two.id, admin, { ...adminSkip, reason: '' })).status, 400);
  assert.equal((await command(two.id, requester.headers, adminSkip)).status, 403);
  await json(command(two.id, admin, adminSkip), 201);
  v = await view(two.id); assert.equal(v.tasks.find((s) => s.id === named.id)!.decision!.kind, 'SKIPPED_BY_ADMIN');
  assert(v.assignments.some((a) => !a.endsAt && a.actorId === deputy.id && a.functionalRole === 'DIVISION_LEADER'));
  // Approved content now requires a lead-reviewed change; managers cannot withdraw it to evade that gate.
  assert.equal((await command(two.id, coManager.headers, bodyFor(v, 'WITHDRAW'))).status, 403);
  assert.equal((await view(two.id)).revision!.state, 'APPROVED');
  await json(command(two.id, admin, bodyFor(v, 'REVISE_POLICY')), 201);
  v = await view(two.id); const rejectStep = v.tasks[0]!;
  await json(command(two.id, departmentLeader.headers, bodyFor(v, 'REJECT', { stepId: rejectStep.id, expectedStepVersion: rejectStep.stepVersion, reason: '' })), 201);
  assert.equal((await view(two.id)).revision!.state, 'REJECTED');

  // No new cross-division request may be created after initial approval.
  const three = await create(); await policy(three.id, 'DIVISION_ONLY');
  await json(command(three.id, requester.headers, bodyFor(await view(three.id), 'SUBMIT', { receivingDivisionId: division.id })), 201);
  v = await view(three.id); const thirdStep = v.tasks[0]!;
  const primaryApprove = bodyFor(v, 'APPROVE_ASSIGN', { stepId: thirdStep.id, expectedStepVersion: thirdStep.stepVersion, members });
  await json(command(three.id, leader.headers, primaryApprove), 201);
  assert.equal((await command(three.id, leader.headers, bodyFor(v, 'REQUEST_COOPERATION', { sourceOrgId: division.id, targetOrgId: coopDivision.id, targetActorId: cooperative.id }))).status, 403);
  v = await view(three.id); assert.equal(v.revision!.state, 'APPROVED');
  assert.equal(v.cooperations.length, 0);
  assert(v.assignments.some((a) => a.actorId === manager.id && !a.endsAt));
  await accessSave([override(leader.id, three.id, 'campaign.approve', 'DENY')]);
  assert.equal((await command(three.id, leader.headers, primaryApprove)).status, 403, 'Cached receipt must recheck revoked permission');

  // Shared COMM pool, atomic creation/submission and reviewed post-approval changes.
  await policy(null, 'DIVISION_ONLY');
  const createSubmission = { name: 'Synthetic wizard and operations', levelCode: 'CLV_01', idempotencyKey: randomUUID() };
  const poolCampaign = await json<{ id: string; name: string; recordVersion: number; qcttStatus: string }>(send('/campaign-operations/create-and-submit', requester.headers, 'POST', createSubmission), 201);
  assert.equal(poolCampaign.qcttStatus, 'Chờ phê duyệt');
  assert.equal((await json<{ id: string }>(send('/campaign-operations/create-and-submit', requester.headers, 'POST', createSubmission), 201)).id, poolCampaign.id, 'Creation retry returns the same Campaign');
  assert.equal((await send('/campaign-operations/create-and-submit', requester.headers, 'POST', { ...createSubmission, name: 'Different content' })).status, 409);
  const poolView = await view(poolCampaign.id, leader.headers);
  assert(poolView.tasks[0]!.eligibility.allowed);
  assert((await view(poolCampaign.id, cooperative.headers)).tasks[0]!.eligibility.allowed, 'Leaders of another COMM division can receive the shared pool');
  assert(!(await view(poolCampaign.id, departmentLeader.headers)).tasks[0]!.eligibility.allowed);
  assert.equal((await send(`/campaigns/${poolCampaign.id}`, manager.headers)).status, 404, 'Unassigned Campaign Manager cannot read the leadership pool');
  const outsider = await person('outside-leader', outside.id, (await org('Outside division', outside.id)).id, 'DIVISION_LEADER');
  assert.equal((await send(`/campaigns/${poolCampaign.id}`, outsider.headers)).status, 404);
  const poolApproval = bodyFor(poolView, 'APPROVE_ASSIGN', { stepId: poolView.tasks[0]!.id, expectedStepVersion: poolView.tasks[0]!.stepVersion, members });
  const beforePoolDecisions = await db.campaignWorkflowDecision.count();
  assert.equal((await command(poolCampaign.id, leader.headers, { ...poolApproval, members: [] })).status, 400);
  assert.equal((await command(poolCampaign.id, leader.headers, { ...poolApproval, members: [{ actorId: otherManager.id, orgId: coopDivision.id, responsibility: 'LEAD' }] })).status, 403);
  assert.equal(await db.campaignWorkflowDecision.count(), beforePoolDecisions);
  const poolRace = await Promise.all([command(poolCampaign.id, leader.headers, poolApproval), command(poolCampaign.id, deputy.headers, { ...poolApproval, idempotencyKey: randomUUID() })]);
  assert.deepEqual(poolRace.map((response) => response.status).sort(), [201,409]);
  const poolLead = poolRace[0]!.status === 201 ? leader : deputy;
  const poolOther = poolLead === leader ? deputy : leader;
  assert.equal((await json<{ qcttStatus: string }>(send(`/campaigns/${poolCampaign.id}`, requester.headers))).qcttStatus, 'Đã phê duyệt');
  assert.equal((await send(`/campaigns/${poolCampaign.id}`, cooperative.headers)).status, 200, 'All COMM leaders retain visibility after another division accepts');

  const operations = (headers = poolLead.headers) => json<OperationsView>(send(`/campaign-operations/${poolCampaign.id}`, headers));
  const operationBody = (state: OperationsView, operation: string, more: Record<string, unknown> = {}) => ({ operation, idempotencyKey: randomUUID(), expectedVersion: state.version, expectedSubjectRevision: state.subjectRevision, ...more });
  const operationSend = (headers: Headers, body: unknown) => send(`/campaign-operations/${poolCampaign.id}/commands`, headers, 'POST', body);
  let op = await operations();
  const planInput = operationBody(op, 'CREATE_PLAN', { plan: { title: 'Synthetic communication plan', objective: 'Test actual plan persistence and approval', tasks: [{ title: 'Prepare approved content', startDate: '2026-09-09', endDate: '2026-09-10' }] } });
  assert.equal((await operationSend(coManager.headers, planInput)).status, 403);
  await json(operationSend(manager.headers, planInput), 201);
  await json(operationSend(manager.headers, planInput), 201);
  assert.equal(await db.campaignPlan.count(), 1, 'Retry does not create a second plan');
  assert.equal((await json<{ qcttStatus: string }>(send(`/campaigns/${poolCampaign.id}`, requester.headers))).qcttStatus, 'Đã lên kế hoạch');
  op = await operations(); let review = op.requests.find((r) => r.kind === 'PLAN')!;
  const planDecision = operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: true, reason: '' });
  assert.equal((await operationSend(poolOther.headers, planDecision)).status, 403);
  await json(operationSend(poolLead.headers, planDecision), 201);
  assert.equal((await json<{ qcttStatus: string }>(send(`/campaigns/${poolCampaign.id}`, requester.headers))).qcttStatus, 'Đang triển khai');
  op = await operations();
  const withdrawablePause = await json<{ id: string }>(operationSend(requester.headers, operationBody(op, 'REQUEST_PAUSE', { reason: '' })), 201);
  op = await operations(requester.headers); review = op.requests.find((request) => request.id === withdrawablePause.id)!;
  assert.equal(review.canWithdraw, true, 'Only the requester sees its pending change as withdrawable');
  const withdrawPause = operationBody(op, 'WITHDRAW_REQUEST', { requestId: review.id, expectedRequestVersion: review.recordVersion, reason: '' });
  assert.equal((await operationSend(poolLead.headers, withdrawPause)).status, 403);
  await json(operationSend(requester.headers, withdrawPause), 201);
  await json(operationSend(requester.headers, withdrawPause), 201);
  op = await operations(requester.headers); review = op.requests.find((request) => request.id === withdrawablePause.id)!;
  assert.equal(review.state, 'SUPERSEDED'); assert.equal(review.canWithdraw, false); assert.equal(op.operationalState, 'ACTIVE');
  assert((await db.auditEvent.findFirst({ where: { entityId: poolCampaign.id, action: 'workflow.withdraw_request' } })));
  op = await operations();
  await json(operationSend(manager.headers, operationBody(op, 'CREATE_PLAN', { plan: { title: 'Pending replacement plan', objective: 'Must be superseded when the Campaign subject changes', tasks: [{ title: 'Update content', startDate: '2026-09-11', endDate: '2026-09-12' }] } })), 201);
  const leadInbox = await json<{ items: { kind: string; campaignId: string; section: string }[] }>(send('/campaign-workflow/inbox', poolLead.headers));
  assert(leadInbox.items.some((item) => item.campaignId === poolCampaign.id && item.kind === 'CHANGE_PLAN' && item.section === 'PENDING'));
  const otherInbox = await json<{ items: { kind: string; campaignId: string; section: string }[] }>(send('/campaign-workflow/inbox', poolOther.headers));
  assert(!otherInbox.items.some((item) => item.campaignId === poolCampaign.id && item.kind === 'CHANGE_PLAN' && item.section === 'PENDING'));
  const beforeEdit = await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } });
  const editProposal = { expectedVersion: beforeEdit.recordVersion, name: 'Synthetic reviewed updated name', reason: 'Changed scope', idempotencyKey: randomUUID() };
  await json(send(`/campaign-operations/${poolCampaign.id}/changes`, requester.headers, 'POST', editProposal), 201);
  await json(send(`/campaign-operations/${poolCampaign.id}/changes`, requester.headers, 'POST', editProposal), 201);
  assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } }), beforeEdit, 'Pending edit never changes effective content');
  assert.equal((await send(`/campaigns/${poolCampaign.id}`, requester.headers, 'PATCH', { expectedVersion: beforeEdit.recordVersion, name: 'Bypass review' })).status, 403);
  op = await operations(); review = op.requests.find((r) => r.kind === 'EDIT')!;
  const editDecision = operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: true, reason: 'Approved edited scope' });
  assert.equal((await operationSend(requester.headers, editDecision)).status, 403);
  await accessSave([override(requester.id, poolCampaign.id, 'campaign.update', 'DENY')]);
  assert.equal((await operationSend(poolLead.headers, editDecision)).status, 403, 'Requester permission revocation is checked again at approval');
  assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } }), beforeEdit);
  await accessSave([override(requester.id, poolCampaign.id, 'campaign.update', 'INHERIT')]);
  await json(operationSend(poolLead.headers, editDecision), 201);
  const afterEdit = await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } });
  assert.equal(afterEdit.name, editProposal.name); assert.equal(afterEdit.businessRevision, beforeEdit.businessRevision + 1);
  assert.equal((await json<{ qcttStatus: string }>(send(`/campaigns/${poolCampaign.id}`, requester.headers))).qcttStatus, 'Đã phê duyệt', 'Old approved plan cannot authorize new content');
  assert.equal(await db.campaignPlan.count(), 2, 'Old plan versions retained unchanged');
  assert(!(await operations()).requests.some((request) => request.kind === 'PLAN' && request.state === 'PENDING'), 'Old-subject pending requests are superseded with history preserved');
  await assert.rejects(db.campaignChangeRequest.update({ where: { id: review.id }, data: { reason: 'Rewrite approval history' } }));
  op = await operations(); const pauseBody = operationBody(op, 'REQUEST_PAUSE', { reason: 'Requester proposes pause' });
  assert.equal((await operationSend(requester.headers, { ...pauseBody, operation: 'PAUSE' })).status, 403);
  await json(operationSend(requester.headers, pauseBody), 201); assert.equal((await operations()).operationalState, 'ACTIVE');
  op = await operations(); review = op.requests.find((r) => r.kind === 'PAUSE' && r.state === 'PENDING')!;
  assert.equal(op.capabilities.decide, true, 'The assigned leader must receive an actionable pause request after initial approval');
  assert.equal((await operations(poolOther.headers)).capabilities.decide, false, 'Other leaders cannot decide the pause request');
  assert.equal((await operations(requester.headers)).capabilities.decide, false, 'The requester cannot approve its own pause request');
  const pauseInbox = await json<{ items: { id: string; campaignId: string; kind: string; canRespond: boolean }[] }>(send('/campaign-workflow/inbox', poolLead.headers));
  assert(pauseInbox.items.some((item) => item.id === review.id && item.campaignId === poolCampaign.id && item.kind === 'CHANGE_PAUSE' && item.canRespond), 'Inbox and detail use the same actionable request ID');
  await json(operationSend(poolLead.headers, operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: false, reason: '' })), 201);
  assert.equal((await db.campaignChangeRequest.findUniqueOrThrow({ where: { id: review.id } })).decisionReason, '');
  assert.equal((await operations()).operationalState, 'ACTIVE');
  op = await operations(); await json(operationSend(requester.headers, operationBody(op, 'REQUEST_PAUSE', { reason: 'Second pause proposal' })), 201);
  op = await operations(); review = op.requests.find((r) => r.kind === 'PAUSE' && r.state === 'PENDING')!;
  await json(operationSend(poolLead.headers, operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: true, reason: '' })), 201);
  assert.equal((await operations()).operationalState, 'PAUSED');
  assert.equal((await command(poolCampaign.id, poolLead.headers, bodyFor(await view(poolCampaign.id), 'REQUEST_COOPERATION', { sourceOrgId: division.id, targetOrgId: coopDivision.id, targetActorId: cooperative.id }))).status, 403);
  op = await operations(); await json(operationSend(requester.headers, operationBody(op, 'REQUEST_CANCEL', { reason: 'Cancel after pause' })), 201);
  op = await operations(); review = op.requests.find((r) => r.kind === 'CANCEL' && r.state === 'PENDING')!;
  await json(operationSend(poolLead.headers, operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: true, reason: '' })), 201);
  const trashedCampaign = await json<{ qcttStatus: string; isDeleted: boolean }>(send(`/campaigns/${poolCampaign.id}`, admin));
  assert.equal(trashedCampaign.qcttStatus, 'Trong Thùng rác');
  assert.equal(trashedCampaign.isDeleted, true, 'An approved delete request soft-deletes the Campaign');
  assert.equal((await command(poolCampaign.id, admin, bodyFor(await view(poolCampaign.id), 'REVISE_POLICY'))).status, 403, 'Cancelled Campaign cannot be restarted through policy revision');
  assert.equal((await operationSend(poolLead.headers, operationBody(await operations(admin), 'PAUSE', { reason: 'Invalid restart' }))).status, 404);
  // A deleted Campaign is no longer visible through ordinary read permission; an authorized Trash restore is explicit and does not fabricate a plan.
  const readStatus = async () => (await json<{ qcttStatus: string }>(send(`/campaigns/${poolCampaign.id}`, requester.headers))).qcttStatus;
  const planCountBeforeRecovery = await db.campaignPlan.count();
  assert.equal((await send(`/campaigns/${poolCampaign.id}`, requester.headers)).status, 404);
  await json(send(`/campaigns/${poolCampaign.id}/restore`, admin, 'POST'), 201);
  assert.equal(await readStatus(), 'Đã phê duyệt');
  assert.equal(await db.campaignPlan.count(), planCountBeforeRecovery, 'Recovery approval does not invent a plan');
  op = await operations();
  assert.equal((await operationSend(requester.headers, operationBody(op, 'REQUEST_RESTORE', { reason: 'Already active' }))).status, 409);
  assert.equal((await operationSend(requester.headers, operationBody(op, 'REQUEST_RESUME', { reason: 'Already active' }))).status, 409);
  await json(operationSend(poolLead.headers, operationBody(op, 'PAUSE', { reason: 'Second pause for resume testing' })), 201);
  op = await operations(); const resumeInput = operationBody(op, 'REQUEST_RESUME', { reason: 'Resume approved execution' });
  assert.equal((await operationSend(requester.headers, { ...resumeInput, operation: 'RESUME' })).status, 400);
  await json(operationSend(requester.headers, resumeInput), 201);
  assert.equal(await readStatus(), 'Đã tạm dừng');
  op = await operations(); review = op.requests.find((request) => request.kind === 'RESUME' && request.state === 'PENDING')!;
  await json(operationSend(poolLead.headers, operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: false, reason: '' })), 201);
  assert.equal(await readStatus(), 'Đã tạm dừng');
  op = await operations(); await json(operationSend(requester.headers, operationBody(op, 'REQUEST_RESUME', { reason: 'Next window ready' })), 201);
  op = await operations(); review = op.requests.find((request) => request.kind === 'RESUME' && request.state === 'PENDING')!;
  await json(operationSend(poolLead.headers, operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: true, reason: '' })), 201);
  assert.equal(await readStatus(), 'Đang triển khai');
  console.log('PASS lifecycle recovery: delete enters Trash, explicit restore preserves plans, and reviewed resume returns to execution');

  for (const kind of ['EDIT', 'PLAN', 'CANCEL'] as const) {
    op = await operations();
    if (kind === 'EDIT') {
      const effective = await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } });
      await json(send(`/campaign-operations/${poolCampaign.id}/changes`, requester.headers, 'POST', { expectedVersion: effective.recordVersion, name: 'Synthetic optional-opinion edit', reason: 'Synthetic edit proposal', idempotencyKey: randomUUID() }), 201);
    } else if (kind === 'PLAN') {
      await json(operationSend(manager.headers, operationBody(op, 'CREATE_PLAN', { plan: { title: 'Synthetic optional-opinion plan', objective: 'Verify rejection without opinion', tasks: [{ title: 'Synthetic task', startDate: '2026-09-11', endDate: '2026-09-12' }] } })), 201);
    } else await json(operationSend(requester.headers, operationBody(op, 'REQUEST_CANCEL')), 201);
    op = await operations(); review = op.requests.find((r) => r.kind === kind && r.state === 'PENDING')!;
    const effective = await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } });
    // Omitting reason entirely is also supported; blank opinions stay blank in audit/history.
    const rejection = operationBody(op, 'DECIDE', { requestId: review.id, expectedRequestVersion: review.recordVersion, approve: false });
    await json(operationSend(poolLead.headers, rejection), 201);
    await json(operationSend(poolLead.headers, rejection), 201);
    const rejected = await db.campaignChangeRequest.findUniqueOrThrow({ where: { id: review.id } });
    assert.equal(rejected.state, 'REJECTED'); assert.equal(rejected.decisionReason, '');
    assert.deepEqual(await db.campaign.findUniqueOrThrow({ where: { id: poolCampaign.id } }), effective);
    assert.equal((await operations()).operationalState, 'ACTIVE');
  }
  console.log('PASS optional rejection opinions: initial and all six change kinds; effective content unchanged and retry safe');

  const batchOne = await create(); const batchTwo = await create();
  for (const row of [batchOne,batchTwo]) await json(command(row.id, requester.headers, bodyFor(await view(row.id), 'SUBMIT')), 201);
  const batchItems = await Promise.all([batchOne,batchTwo].map(async (row) => { const state = await view(row.id, leader.headers); return { campaignId: row.id, command: bodyFor(state, 'APPROVE_ASSIGN', { stepId: state.tasks[0]!.id, expectedStepVersion: state.tasks[0]!.stepVersion, members }) }; }));
  const batchResult = await json<{ succeeded: number }>(send('/campaign-workflow/batch', leader.headers, 'POST', { items: batchItems }), 201);
  assert.equal(batchResult.succeeded, 2);
  console.log('PASS approval wizard operations: shared COMM pool, atomic assignment, persisted plan gates, immutable edit proposals, requester revocation, pause/cancel decisions and batch approval');

  // Moderation is a separate direct-admin action; it never edits another author's content.
  const comment = await json<{ id: string; recordVersion: number }>(send(`/campaigns/${three.id}/comments`, requester.headers, 'POST', { body: 'Synthetic comment preserved by moderation' }), 201);
  const beforeComment = await db.campaignComment.findUniqueOrThrow({ where: { id: comment.id } });
  const moderatePath = `/campaigns/${three.id}/comments/${comment.id}/moderation`;
  const moderate = { expectedVersion: comment.recordVersion, reason: 'Synthetic moderation reason' };
  assert.equal((await send(moderatePath, requester.headers, 'POST', moderate)).status, 403);
  assert.equal((await send(moderatePath, admin, 'POST', { ...moderate, reason: ' ' })).status, 400);
  assert.equal((await send(`/campaigns/${two.id}/comments/${comment.id}/moderation`, admin, 'POST', moderate)).status, 404);
  assert.equal((await send(moderatePath, admin, 'POST', { ...moderate, body: 'Illegal edit' })).status, 400);
  await json(send(moderatePath, admin, 'POST', moderate), 201);
  const afterComment = await db.campaignComment.findUniqueOrThrow({ where: { id: comment.id } });
  assert(afterComment.deletedAt); assert.equal(afterComment.body, beforeComment.body); assert.equal(afterComment.authorActorId, requester.id);
  const moderationAudit = await db.auditEvent.findFirstOrThrow({ where: { entityId: comment.id, action: 'campaign.comment.moderated' } });
  assert.equal((moderationAudit.payload as { reason: string }).reason, moderate.reason);
  assert.equal(moderationAudit.originalActorId, moderationAudit.actorId);
  console.log('PASS persistent workflow HTTP: scoped pools/named tasks, races/idempotence, assignment rollback, immutable decisions, paused cross-division cooperation, policy revisions and NO_APPROVAL');

  // Independent action policy: real persistence, HTTP routing, no fabricated initial decisions.
  const exempt = await create();
  const none: CampaignRequiredApprovals = { DEPLOY: false, EDIT: false, PAUSE: false, RESUME: false, CANCEL: false, PURGE: false };
  await policy(exempt.id, 'DIVISION_ONLY', none);
  const oldDecisions = await db.campaignWorkflowDecision.count();
  await json(command(exempt.id, requester.headers, bodyFor(await view(exempt.id), 'SUBMIT')), 201);
  assert.equal((await view(exempt.id)).revision!.state, 'NO_APPROVAL');
  assert.equal((await view(exempt.id)).tasks.length, 0);
  assert.equal(await db.campaignWorkflowDecision.count(), oldDecisions);
  assert.deepEqual((await view(exempt.id)).policy!.requiredApprovals, none);
  const exemptOps = (headers = requester.headers) => json<OperationsView>(send(`/campaign-operations/${exempt.id}`, headers));
  const exemptCommand = async (operation: string, extra: Record<string, unknown> = {}, headers = requester.headers) =>
    json<{ id: string }>(send(`/campaign-operations/${exempt.id}/commands`, headers, 'POST', operationBody(await exemptOps(), operation, extra)), 201);
  await exemptCommand('REQUEST_PAUSE'); assert.equal((await exemptOps()).operationalState, 'PAUSED');
  await exemptCommand('REQUEST_RESUME'); assert.equal((await exemptOps()).operationalState, 'ACTIVE');
  const editable = await db.campaign.findUniqueOrThrow({ where: { id: exempt.id } });
  await json(send(`/campaign-operations/${exempt.id}/changes`, requester.headers, 'POST', { expectedVersion: editable.recordVersion, name: 'Synthetic direct policy edit', reason: '', idempotencyKey: randomUUID() }), 201);
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: exempt.id } })).name, 'Synthetic direct policy edit');
  assert.equal((await view(exempt.id)).revision!.subjectRevision, (await view(exempt.id)).campaign.businessRevision);
  assert.equal(await db.campaignWorkflowDecision.count(), oldDecisions);

  await policy(exempt.id, 'DIVISION_ONLY', { ...none, PAUSE: true, EDIT: true, PURGE: true });
  const editLocked = await db.campaign.findUniqueOrThrow({ where: { id: exempt.id } });
  assert.equal((await send(`/campaigns/${exempt.id}`, requester.headers, 'PATCH', { expectedVersion: editLocked.recordVersion, name: 'Must not bypass checked EDIT' })).status, 403);
  const queued = await exemptCommand('REQUEST_PAUSE');
  assert.equal((await exemptOps()).operationalState, 'ACTIVE');
  const pooledInbox = await json<{ items: { id: string; canRespond: boolean }[] }>(send('/campaign-workflow/inbox', leader.headers));
  assert(pooledInbox.items.some(item => item.id === queued.id && item.canRespond), 'Deploy-exempt campaign routes checked requests to Ban TT leader pool');
  assert.equal((await exemptOps(leader.headers)).capabilities.decide, true);
  await policy(exempt.id, 'DIVISION_ONLY', none);
  assert((await exemptOps()).requests.some(r => r.id === queued.id && r.state === 'PENDING'), 'Changing policy never auto-executes an existing request');
  assert.equal((await exemptOps()).operationalState, 'ACTIVE');
  let requestState = await exemptOps(); const pendingReview = requestState.requests.find(r => r.id === queued.id)!;
  const decidePending = operationBody(requestState, 'DECIDE', { requestId: queued.id, expectedRequestVersion: pendingReview.recordVersion, approve: true, reason: '' });
  assert.equal((await send(`/campaign-operations/${exempt.id}/commands`, requester.headers, 'POST', decidePending)).status, 403);
  await json(send(`/campaign-operations/${exempt.id}/commands`, leader.headers, 'POST', decidePending), 201);
  assert.equal((await exemptOps()).operationalState, 'PAUSED');
  await exemptCommand('REQUEST_RESUME');
  const { version: policyVersion } = await json<{ version: number }>(send('/campaign-workflow/configuration', admin));
  const configBody = { campaignId: exempt.id, preset: 'DIVISION_ONLY', requiredApprovals: { ...none, PURGE: true }, expectedVersion: policyVersion, effectiveFrom: new Date().toISOString(), reason: 'QA role enforcement' };
  assert.equal((await send('/campaign-workflow/policy/save', requester.headers, 'POST', configBody)).status, 403);
  assert.equal((await send('/campaign-workflow/policy/save', admin, 'POST', { ...configBody, expectedVersion: policyVersion - 1 })).status, 409);
  await json(send('/campaign-workflow/policy/save', admin, 'POST', configBody), 201);
  await exemptCommand('REQUEST_CANCEL'); assert.equal((await exemptOps(admin)).operationalState, 'CANCELLED');
  assert((await db.campaign.findUniqueOrThrow({ where: { id: exempt.id } })).deletedAt, 'Unchecked delete moves the Campaign to Trash immediately');
  requestState = await exemptOps(admin);
  assert.equal((await send(`/campaign-operations/${exempt.id}/commands`, requester.headers, 'POST', operationBody(requestState, 'REQUEST_PURGE'))).status, 404, 'Unchecked purge does not expose the trashed record without Trash access');
  assert.equal((await send(`/campaigns/${exempt.id}`, admin, 'DELETE')).status, 403, 'Checked purge cannot bypass approval through direct endpoint');
  const purgeReview = await json<{ id: string }>(send(`/campaign-operations/${exempt.id}/commands`, admin, 'POST', operationBody(await exemptOps(admin), 'REQUEST_PURGE')), 201);
  const trashInbox = await json<{ items: { id: string; canRespond: boolean }[] }>(send('/campaign-workflow/inbox', leader.headers));
  assert(trashInbox.items.some(item => item.id === purgeReview.id && item.canRespond), 'Only explicit pending purge makes the trashed record reviewable to scoped leaders');
  const purgeState = await exemptOps(leader.headers); const purge = purgeState.requests.find(r => r.id === purgeReview.id)!;
  await json(send(`/campaign-operations/${exempt.id}/commands`, leader.headers, 'POST', operationBody(purgeState, 'DECIDE', { requestId: purge.id, expectedRequestVersion: purge.recordVersion, approve: true, reason: '' })), 201);
  assert((await db.campaign.findUniqueOrThrow({ where: { id: exempt.id } })).deletedAt, 'Review grants authorization but never silently removes data/Drive history');
  console.log('PASS per-action approval: persisted defaults/exemptions, direct edit/pause/resume/cancel, checked request pool after exempt deploy, pending-policy stability, authorization and optimistic locking');
}
