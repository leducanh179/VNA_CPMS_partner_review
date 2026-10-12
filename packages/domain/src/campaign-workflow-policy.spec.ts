import { describe, expect, it } from 'vitest';
import {
  canDecideCampaignTask, canPassInitialCampaignGate, canProposeBooking, canReleaseCampaign, canReleaseDivisionPart,
  canStartPlanning, createFirstPlanAndClaimLead, isBookingCoveredByApproval, resolveApprovalRoute,
  type ApprovalTaskFacts, type DivisionPartReadiness, type FirstPlannerRepository, type ReleaseContext,
} from './campaign-workflow-policy';
const context: ReleaseContext = {
  authenticated: true, accountActive: true, canReadCampaign: true, hasOperationPermission: true, operationalState: 'ACTIVE',
  workflow: { route: 'DIVISION', provenance: 'CURRENT', state: 'APPROVED', subjectRevision: 2, currentSubjectRevision: 2,
    mandatorySteps: [{ id: 'initial', subjectRevision: 2, state: 'COMPLETED' }] },
  planModuleImplemented: true, currentScopeRevision: 3, overallDecision: null,
};
const task: ApprovalTaskFacts = { id: 'task', campaignId: 'qa-a', state: 'PENDING', kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: 'division-a',
  assigneeActorId: null, pool: 'ANY_ONE', subjectRevision: 2, policyVersionId: 'policy-1', stepVersion: 1 };
const eligible = { actorId: 'leader-a', authenticated: true, accountActive: true, canRead: true, canApprove: true,
  campaignId: 'qa-a', currentSubjectRevision: 2, currentPolicyVersionId: 'policy-1', expectedStepVersion: 1, task,
  leaders: [{ actorId: 'leader-a', role: 'DIVISION_LEADER' as const, orgId: 'division-a', active: true }], adminIntervention: null };
const part: DivisionPartReadiness = { id: 'part-a', orgId: 'division-a', revision: 4, currentRevision: 4, hasActualPlanData: true,
  resourceReview: true, contentReview: true, divisionDecision: { decisionId: 'decision-a', orgId: 'division-a', revision: 4 } };

describe('Campaign workflow route/eligibility contracts (no persistence)', () => {
  it.each([
    ['STANDARD', 'CLV_01', 'DIVISION'], ['STANDARD', 'CLV_02', 'DEPARTMENT'], ['STANDARD', 'CLV_03', 'DEPARTMENT'],
    ['DEPARTMENT_REQUIRED', 'CLV_01', 'DEPARTMENT'], ['DIVISION_ONLY', 'CLV_03', 'DIVISION'], ['NO_APPROVAL', 'CLV_03', 'NONE'],
    ['DIVISION_LEVEL_1_ONLY', 'CLV_02', 'NONE'],
    ['NO_APPROVAL_LEVEL_1_ONLY', 'CLV_01', 'NONE'], ['NO_APPROVAL_LEVEL_1_ONLY', 'CLV_02', 'DEPARTMENT'],
  ] as const)('%s / %s resolves %s without changing the Campaign level', (preset, levelCode, expected) => {
    expect(resolveApprovalRoute({ preset, levelCode, commDepartmentId: 'comm', receivingDivision: { id: 'division-a', parentDepartmentId: 'comm' } }).route).toBe(expected);
  });
  it('missing or wrong receiving organization never implies approval', () => {
    expect(resolveApprovalRoute({ preset: 'DIVISION_ONLY', levelCode: 'CLV_01', commDepartmentId: 'comm', receivingDivision: null }).state).toBe('NEEDS_ROUTING');
    expect(resolveApprovalRoute({ preset: 'DIVISION_ONLY', levelCode: 'CLV_01', commDepartmentId: 'comm', receivingDivision: { id: 'wrong', parentDepartmentId: 'other' } }).reason).toBe('WRONG_RECEIVING_DEPARTMENT');
    expect(resolveApprovalRoute({ preset: 'STANDARD', levelCode: null, commDepartmentId: 'comm', receivingDivision: null }).reason).toBe('MISSING_LEVEL');
  });
  it('task permission is insufficient without correct current leader level, scope and assignment', () => {
    expect(canDecideCampaignTask(eligible).allowed).toBe(true);
    expect(canDecideCampaignTask({ ...eligible, leaders: [{ ...eligible.leaders[0]!, role: 'DEPARTMENT_LEADER' }] }).reason).toBe('WRONG_LEADER_SCOPE');
    expect(canDecideCampaignTask({ ...eligible, leaders: [{ ...eligible.leaders[0]!, orgId: 'division-b' }] }).allowed).toBe(false);
    expect(canDecideCampaignTask({ ...eligible, task: { ...task, assigneeActorId: 'other' } }).allowed).toBe(false);
    expect(canDecideCampaignTask({ ...eligible, task: { ...task, campaignId: 'qa-b' } }).reason).toBe('TASK_RESOURCE_MISMATCH');
  });
  it('stale revision/policy/step and completed tasks reject a second decision', () => {
    expect(canDecideCampaignTask({ ...eligible, currentSubjectRevision: 3 }).reason).toBe('VERSION_CONFLICT');
    expect(canDecideCampaignTask({ ...eligible, currentPolicyVersionId: 'new-policy' }).reason).toBe('VERSION_CONFLICT');
    expect(canDecideCampaignTask({ ...eligible, expectedStepVersion: 2 }).reason).toBe('VERSION_CONFLICT');
    expect(canDecideCampaignTask({ ...eligible, task: { ...task, state: 'COMPLETED' } }).reason).toBe('TASK_NOT_PENDING');
  });
  it('admin skips require explicit reason and remain distinguishable from leader approvals', () => {
    expect(canDecideCampaignTask({ ...eligible, adminIntervention: { directSuperadmin: true, reason: '' } }).allowed).toBe(false);
    expect(canDecideCampaignTask({ ...eligible, adminIntervention: { directSuperadmin: false, reason: 'Synthetic override' } }).allowed).toBe(false);
    expect(canDecideCampaignTask({ ...eligible, adminIntervention: { directSuperadmin: true, reason: 'Synthetic override' } }).decisionKind).toBe('SKIPPED_BY_ADMIN');
  });
});

describe('future Plan/Booking readiness contracts — synthetic facts, not module E2E', () => {
  it('NO_APPROVAL keeps identity, permission, operational hold and business revision gates', () => {
    const noApproval = { ...context, workflow: { ...context.workflow, route: 'NONE' as const, state: 'NO_APPROVAL' as const, mandatorySteps: [] } };
    expect(canPassInitialCampaignGate(noApproval).allowed).toBe(true);
    expect(canPassInitialCampaignGate({ ...noApproval, authenticated: false }).allowed).toBe(false);
    expect(canPassInitialCampaignGate({ ...noApproval, hasOperationPermission: false }).allowed).toBe(false);
    expect(canPassInitialCampaignGate({ ...noApproval, operationalState: 'PAUSED' }).allowed).toBe(false);
    expect(canPassInitialCampaignGate({ ...noApproval, workflow: { ...noApproval.workflow, currentSubjectRevision: 3 } }).allowed).toBe(false);
  });
  it('legacy, empty mandatory steps and missing assignments never become ready', () => {
    expect(canPassInitialCampaignGate({ ...context, workflow: { ...context.workflow, provenance: 'LEGACY_UNASSESSED' } }).reason).toBe('LEGACY_UNASSESSED');
    expect(canPassInitialCampaignGate({ ...context, workflow: { ...context.workflow, mandatorySteps: [] } }).reason).toBe('MISSING_REQUIRED_STEPS');
    expect(canPassInitialCampaignGate({ ...context, workflow: { ...context.workflow, mandatorySteps: [{ id: 'missing', subjectRevision: 2, state: 'PENDING' }] } }).missing).toEqual(['missing']);
  });
  it('never declares unimplemented modules ready and retains slot/resource checks', () => {
    expect(canStartPlanning({ ...context, planModuleImplemented: false }).reason).toBe('PLAN_NOT_IMPLEMENTED');
    expect(canProposeBooking({ ...context, bookingModuleImplemented: false, hasResourceAssignment: true, inventoryValid: true }).reason).toBe('BOOKING_NOT_IMPLEMENTED');
    expect(canProposeBooking({ ...context, bookingModuleImplemented: true, hasResourceAssignment: false, inventoryValid: true }).allowed).toBe(false);
    expect(canProposeBooking({ ...context, bookingModuleImplemented: true, hasResourceAssignment: true, inventoryValid: false }).allowed).toBe(false);
  });
  it('division route releases its own ready part while another part remains blocked', () => {
    const waiting = { ...part, id: 'part-b', orgId: 'division-b', divisionDecision: null };
    expect(canReleaseDivisionPart(context, part.id, [part, waiting]).allowed).toBe(true);
    expect(canReleaseDivisionPart(context, waiting.id, [part, waiting]).allowed).toBe(false);
    expect(canReleaseCampaign(context, [part, waiting]).missing).toEqual(['part-b']);
  });
  it('department route requires all parts plus a distinct overall decision on current scope', () => {
    const department = { ...context, workflow: { ...context.workflow, route: 'DEPARTMENT' as const } };
    expect(canReleaseDivisionPart(department, part.id, [part]).reason).toBe('DEPARTMENT_OVERALL_APPROVAL_REQUIRED');
    const decided = { ...department, overallDecision: { decisionId: 'overall', subjectRevision: 2, scopeRevision: 3 } };
    expect(canReleaseCampaign(decided, [part]).allowed).toBe(true);
    expect(canReleaseCampaign({ ...decided, currentScopeRevision: 4 }, [part]).allowed).toBe(false);
    expect(canReleaseCampaign(decided, [part, { ...part, id: 'new', contentReview: false }]).allowed).toBe(false);
  });
  it('requires real plan data and does not let a division decision approve a different division', () => {
    expect(canReleaseCampaign(context, []).reason).toBe('NO_ACTUAL_PLAN_DATA');
    expect(canReleaseCampaign(context, [{ ...part, hasActualPlanData: false }]).allowed).toBe(false);
    expect(canReleaseDivisionPart(context, part.id, [{ ...part, divisionDecision: { ...part.divisionDecision!, orgId: 'other' } }]).allowed).toBe(false);
  });
  it('requires a traceable exact approval revision/resource/terms and current operational limits', () => {
    const booking = { campaignId: 'qa-a', partId: part.id, partRevision: 4, resourceId: 'resource-a', termsDigest: 'synthetic-terms', withinApprovedLimits: true, operationallyValid: true,
      coverage: { decisionId: 'decision', campaignId: 'qa-a', partId: part.id, partRevision: 4, resourceId: 'resource-a', termsDigest: 'synthetic-terms', revoked: false } };
    expect(isBookingCoveredByApproval(booking)).toBe(true);
    expect(isBookingCoveredByApproval({ ...booking, partRevision: 5 })).toBe(false);
    expect(isBookingCoveredByApproval({ ...booking, resourceId: 'shared-but-unassigned-resource' })).toBe(false);
    expect(isBookingCoveredByApproval({ ...booking, termsDigest: 'changed' })).toBe(false);
    expect(isBookingCoveredByApproval({ ...booking, withinApprovedLimits: false })).toBe(false);
  });
  it('contract test: first successful plan claims one lead under concurrent requests; failed plan claims nothing', async () => {
    // Explicit serialized in-memory repository double. PostgreSQL locking/concurrency is a separate acceptance gate.
    let lead: string | null = null;
    let queue = Promise.resolve();
    const repository: FirstPlannerRepository = {
      withCampaignTransaction: (_campaign, operation) => {
        const result = queue.then(() => operation({
          requireCurrentPlanningAccess: async () => {},
          createPlan: async (command) => { if (command.actorId === 'fails') throw new Error('PLAN_FAILED'); return { planId: `synthetic-${command.actorId}` }; },
          claimOrJoinLead: async (command) => { lead ??= command.actorId; return { leadActorId: lead, responsibility: lead === command.actorId ? 'LEAD' : 'COOP' }; },
        }));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
    };
    const results = await Promise.allSettled(['fails', 'first-success', 'second-success'].map((actorId) => createFirstPlanAndClaimLead(repository, { actorId, campaignId: 'qa-a', idempotencyKey: actorId })));
    expect(results[0]!.status).toBe('rejected');
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { responsibility: 'LEAD', leadActorId: 'first-success' } });
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: { responsibility: 'COOP', leadActorId: 'first-success' } });
  });
});
