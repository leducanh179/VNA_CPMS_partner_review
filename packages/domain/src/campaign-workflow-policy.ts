import type { CampaignLevelCode } from './campaign';

export const APPROVAL_PRESETS = [
  'STANDARD', 'DEPARTMENT_REQUIRED', 'DIVISION_ONLY', 'DIVISION_LEVEL_1_ONLY',
  'NO_APPROVAL', 'NO_APPROVAL_LEVEL_1_ONLY',
] as const;
export type ApprovalPreset = typeof APPROVAL_PRESETS[number];
export type ApprovalRoute = 'DEPARTMENT' | 'DIVISION' | 'NONE';
export interface ApprovalPolicySnapshot {
  policyVersionId: string;
  preset: ApprovalPreset;
  source: 'SYSTEM_DEFAULT' | 'CAMPAIGN_OVERRIDE';
  enforcement: 'HARD' | 'NONE';
}
export interface ResolvedApprovalRoute {
  route: ApprovalRoute | null;
  state: 'ROUTED' | 'NEEDS_ROUTING';
  receivingOrgId: string | null;
  reason: 'ROUTED' | 'NO_INTERNAL_APPROVAL' | 'MISSING_LEVEL' | 'MISSING_COMM_DEPARTMENT' | 'MISSING_RECEIVING_DIVISION' | 'WRONG_RECEIVING_DEPARTMENT';
}
export function resolveApprovalRoute(input: {
  preset: ApprovalPreset; levelCode: CampaignLevelCode | null;
  commDepartmentId: string | null;
  receivingDivision: { id: string; parentDepartmentId: string } | null;
}): ResolvedApprovalRoute {
  const missing = (reason: ResolvedApprovalRoute['reason']): ResolvedApprovalRoute => ({ route: null, state: 'NEEDS_ROUTING', receivingOrgId: null, reason });
  if (input.preset === 'NO_APPROVAL' || (input.preset === 'NO_APPROVAL_LEVEL_1_ONLY' && input.levelCode === 'CLV_01')) return { route: 'NONE', state: 'ROUTED', receivingOrgId: null, reason: 'NO_INTERNAL_APPROVAL' };
  if (input.preset === 'STANDARD' && !input.levelCode) return missing('MISSING_LEVEL');
  const divisionPreset = ['DIVISION_ONLY', 'DIVISION_LEVEL_1_ONLY'].includes(input.preset);
  const levelOneOnly = input.preset === 'DIVISION_LEVEL_1_ONLY';
  if (levelOneOnly && input.levelCode !== 'CLV_01') return { route: 'NONE', state: 'ROUTED', receivingOrgId: null, reason: 'NO_INTERNAL_APPROVAL' };
  const route: ApprovalRoute = divisionPreset || (input.preset === 'STANDARD' && input.levelCode === 'CLV_01') ? 'DIVISION' : 'DEPARTMENT';
  if (!input.commDepartmentId) return missing('MISSING_COMM_DEPARTMENT');
  if (route === 'DEPARTMENT') return { route, state: 'ROUTED', receivingOrgId: input.commDepartmentId, reason: 'ROUTED' };
  if (!input.receivingDivision) return missing('MISSING_RECEIVING_DIVISION');
  if (input.receivingDivision.parentDepartmentId !== input.commDepartmentId) return missing('WRONG_RECEIVING_DEPARTMENT');
  return { route, state: 'ROUTED', receivingOrgId: input.receivingDivision.id, reason: 'ROUTED' };
}

export interface ApprovalTaskFacts {
  id: string;
  campaignId: string;
  state: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'SUPERSEDED';
  kind: 'DEPARTMENT_APPROVAL' | 'DIVISION_ACCEPT_AND_ASSIGN';
  orgId: string;
  assigneeActorId: string | null;
  pool: 'ANY_ONE';
  subjectRevision: number;
  policyVersionId: string;
  stepVersion: number;
}
export interface ScopedLeaderFact {
  actorId: string;
  role: 'DIVISION_LEADER' | 'DEPARTMENT_LEADER' | 'CORPORATE_LEADER';
  orgId: string;
  active: boolean;
}
/** Evaluate from a fresh locked snapshot at commit, never a browser capability. */
export function canDecideCampaignTask(input: {
  actorId: string; authenticated: boolean; accountActive: boolean; canRead: boolean; canApprove: boolean;
  campaignId: string; currentSubjectRevision: number; currentPolicyVersionId: string; expectedStepVersion: number;
  task: ApprovalTaskFacts; leaders: readonly ScopedLeaderFact[];
  adminIntervention: { directSuperadmin: boolean; reason: string } | null;
}) {
  const deny = (reason: string) => ({ allowed: false, reason, decisionKind: null });
  if (!input.authenticated || !input.accountActive) return deny('ACCOUNT_UNAVAILABLE');
  if (!input.canRead || !input.canApprove) return deny('PERMISSION_REQUIRED');
  if (input.task.campaignId !== input.campaignId) return deny('TASK_RESOURCE_MISMATCH');
  if (input.task.state !== 'PENDING') return deny('TASK_NOT_PENDING');
  if (input.task.subjectRevision !== input.currentSubjectRevision || input.task.policyVersionId !== input.currentPolicyVersionId || input.task.stepVersion !== input.expectedStepVersion) return deny('VERSION_CONFLICT');
  if (input.adminIntervention) {
    if (!input.adminIntervention.directSuperadmin || !input.adminIntervention.reason.trim()) return deny('ADMIN_REASON_REQUIRED');
    return { allowed: true, reason: 'EXPLICIT_ADMIN_INTERVENTION', decisionKind: 'SKIPPED_BY_ADMIN' as const };
  }
  if (input.task.assigneeActorId && input.task.assigneeActorId !== input.actorId) return deny('WRONG_ASSIGNEE');
  const role = input.task.kind === 'DEPARTMENT_APPROVAL' ? 'DEPARTMENT_LEADER' : 'DIVISION_LEADER';
  if (!input.leaders.some((leader) => leader.active && leader.actorId === input.actorId && leader.role === role && leader.orgId === input.task.orgId)) return deny('WRONG_LEADER_SCOPE');
  return { allowed: true, reason: 'ELIGIBLE_TASK', decisionKind: 'APPROVED_BY_LEADER' as const };
}

export interface InitialWorkflowGate {
  route: ApprovalRoute | null;
  provenance: 'CURRENT' | 'LEGACY_UNASSESSED';
  state: 'DRAFT' | 'PENDING' | 'RETURNED' | 'REJECTED' | 'APPROVED' | 'NO_APPROVAL' | 'CANCELLED' | 'NEEDS_ROUTING';
  subjectRevision: number;
  currentSubjectRevision: number;
  mandatorySteps: { id: string; subjectRevision: number; state: 'PENDING' | 'COMPLETED' | 'SKIPPED_BY_ADMIN' | 'CANCELLED' }[];
}
export interface FutureOperationContext {
  authenticated: boolean;
  accountActive: boolean;
  canReadCampaign: boolean;
  hasOperationPermission: boolean;
  operationalState: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'CANCELLED' | 'TRASHED';
  workflow: InitialWorkflowGate;
}
export interface ReadinessDecision { allowed: boolean; reason: string; missing: string[] }
const denied = (reason: string, missing: string[] = []): ReadinessDecision => ({ allowed: false, reason, missing });
const allowed = (): ReadinessDecision => ({ allowed: true, reason: 'GATES_SATISFIED', missing: [] });

export function canPassInitialCampaignGate(input: FutureOperationContext): ReadinessDecision {
  if (!input.authenticated || !input.accountActive) return denied('ACCOUNT_UNAVAILABLE');
  if (!input.canReadCampaign || !input.hasOperationPermission) return denied('PERMISSION_REQUIRED');
  if (input.operationalState !== 'ACTIVE') return denied('OPERATIONAL_HOLD');
  const gate = input.workflow;
  if (gate.provenance !== 'CURRENT') return denied('LEGACY_UNASSESSED');
  if (gate.subjectRevision !== gate.currentSubjectRevision) return denied('SUBJECT_REVISION_CHANGED');
  if (gate.route === 'NONE' && gate.state === 'NO_APPROVAL') return allowed();
  if (!gate.route || gate.state !== 'APPROVED') return denied('INITIAL_APPROVAL_PENDING');
  if (!gate.mandatorySteps.length) return denied('MISSING_REQUIRED_STEPS');
  const missing = gate.mandatorySteps.filter((step) => step.subjectRevision !== gate.currentSubjectRevision || !['COMPLETED', 'SKIPPED_BY_ADMIN'].includes(step.state)).map((step) => step.id);
  return missing.length ? denied('INITIAL_ASSIGNMENT_PENDING', missing) : allowed();
}

/** Future module contracts: caller must explicitly declare a real implementation. */
export function canStartPlanning(input: FutureOperationContext & { planModuleImplemented: boolean }): ReadinessDecision {
  const gate = canPassInitialCampaignGate(input);
  if (!gate.allowed) return gate;
  return input.planModuleImplemented ? allowed() : denied('PLAN_NOT_IMPLEMENTED');
}
export function canProposeBooking(input: FutureOperationContext & { bookingModuleImplemented: boolean; hasResourceAssignment: boolean; inventoryValid: boolean }): ReadinessDecision {
  const gate = canPassInitialCampaignGate(input);
  if (!gate.allowed) return gate;
  if (!input.bookingModuleImplemented) return denied('BOOKING_NOT_IMPLEMENTED');
  if (!input.hasResourceAssignment) return denied('RESOURCE_ASSIGNMENT_REQUIRED');
  return input.inventoryValid ? allowed() : denied('RESOURCE_LIMIT_OR_SLOT_INVALID');
}

export interface DivisionPartReadiness {
  id: string; orgId: string; revision: number; currentRevision: number;
  hasActualPlanData: boolean; resourceReview: boolean; contentReview: boolean;
  divisionDecision: { decisionId: string; orgId: string; revision: number } | null;
}
export interface ReleaseContext extends FutureOperationContext {
  planModuleImplemented: boolean;
  currentScopeRevision: number;
  overallDecision: { decisionId: string; subjectRevision: number; scopeRevision: number } | null;
}
function divisionPartReady(part: DivisionPartReadiness, route: ApprovalRoute | null): ReadinessDecision {
  if (!part.hasActualPlanData) return denied('NO_ACTUAL_PLAN_DATA');
  if (part.revision !== part.currentRevision) return denied('PART_REVISION_CHANGED');
  if (!part.resourceReview || !part.contentReview) return denied('RESOURCE_AND_CONTENT_REVIEWS_REQUIRED');
  if (route === 'NONE') return allowed();
  const decision = part.divisionDecision;
  if (!decision || decision.orgId !== part.orgId || decision.revision !== part.currentRevision) return denied('DIVISION_APPROVAL_REQUIRED');
  return allowed();
}
function departmentReleaseReady(input: ReleaseContext): boolean {
  return Boolean(input.overallDecision && input.overallDecision.subjectRevision === input.workflow.currentSubjectRevision && input.overallDecision.scopeRevision === input.currentScopeRevision);
}
export function canReleaseDivisionPart(input: ReleaseContext, partId: string, currentParts: readonly DivisionPartReadiness[]): ReadinessDecision {
  const gate = canStartPlanning(input);
  if (!gate.allowed) return gate;
  const part = currentParts.find((entry) => entry.id === partId);
  if (!part) return denied('PART_NOT_IN_CURRENT_SCOPE');
  const readiness = divisionPartReady(part, input.workflow.route);
  if (!readiness.allowed) return readiness;
  if (input.workflow.route === 'DEPARTMENT') return canReleaseCampaign(input, currentParts);
  return allowed();
}
export function canReleaseCampaign(input: ReleaseContext, currentParts: readonly DivisionPartReadiness[]): ReadinessDecision {
  const gate = canStartPlanning(input);
  if (!gate.allowed) return gate;
  if (!currentParts.length) return denied('NO_ACTUAL_PLAN_DATA');
  const missing = currentParts.filter((part) => !divisionPartReady(part, input.workflow.route).allowed).map((part) => part.id);
  if (missing.length) return denied('DIVISION_PARTS_NOT_READY', missing);
  if (input.workflow.route === 'DEPARTMENT' && !departmentReleaseReady(input)) return denied('DEPARTMENT_OVERALL_APPROVAL_REQUIRED');
  return allowed();
}

export function isBookingCoveredByApproval(input: {
  campaignId: string; partId: string; partRevision: number; resourceId: string; termsDigest: string;
  withinApprovedLimits: boolean; operationallyValid: boolean;
  coverage: { decisionId: string; campaignId: string; partId: string; partRevision: number; resourceId: string; termsDigest: string; revoked: boolean } | null;
}): boolean {
  const coverage = input.coverage;
  return Boolean(coverage && coverage.decisionId && !coverage.revoked && input.withinApprovedLimits && input.operationallyValid &&
    coverage.campaignId === input.campaignId && coverage.partId === input.partId && coverage.partRevision === input.partRevision &&
    coverage.resourceId === input.resourceId && coverage.termsDigest === input.termsDigest);
}

/** Implement together with the real Plan repository. No fake Plan endpoint exists in this delivery. */
export interface FirstPlannerTransaction {
  requireCurrentPlanningAccess(actorId: string, campaignId: string): Promise<void>;
  createPlan(command: { actorId: string; campaignId: string; idempotencyKey: string }): Promise<{ planId: string }>;
  claimOrJoinLead(command: { actorId: string; campaignId: string; planId: string }): Promise<{ leadActorId: string; responsibility: 'LEAD' | 'COOP' }>;
}
export interface FirstPlannerRepository {
  /** Serializes by Campaign; rollback includes the plan, unique active lead and audit. */
  withCampaignTransaction<T>(campaignId: string, command: (transaction: FirstPlannerTransaction) => Promise<T>): Promise<T>;
}
export async function createFirstPlanAndClaimLead(repository: FirstPlannerRepository, command: { actorId: string; campaignId: string; idempotencyKey: string }) {
  return repository.withCampaignTransaction(command.campaignId, async (transaction) => {
    await transaction.requireCurrentPlanningAccess(command.actorId, command.campaignId);
    const plan = await transaction.createPlan(command);
    const assignment = await transaction.claimOrJoinLead({ ...command, planId: plan.planId });
    return { ...plan, ...assignment };
  });
}
