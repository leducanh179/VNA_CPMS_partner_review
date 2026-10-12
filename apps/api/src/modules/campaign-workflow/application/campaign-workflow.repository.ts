import type { ActorContext, ApprovalPreset, CampaignRequiredApprovals } from '@cpms/domain';

export interface WorkflowOrganization { id: string; sourceName: string; kind: string; parentId: string | null }
export interface WorkflowPerson {
  id: string; displayName: string; employeeCode: string; email: string | null; departmentId: string; divisionId: string | null; isActive: boolean; jobTitle: string | null;
  roles: { roleCode: string; scopeType: string; orgId: string | null; campaignId: string | null; module: string | null; expiresAt: Date | null }[];
}
export interface WorkflowPolicy {
  requiredApprovals?: unknown;
  id: string; version: number; scopeKey: string; campaignId: string | null; preset: string | null; enforcement: string | null;
  effectiveFrom: Date; createdByActorId: string; reason: string;
  campaign?: { id: string; code: string; name: string } | null;
  createdBy?: { id: string; displayName: string };
}
export interface WorkflowConfiguration { version: number; commDepartmentId: string | null; demoInitialized: boolean; policies: WorkflowPolicy[]; organizations: WorkflowOrganization[] }
export interface WorkflowStep {
  id: string; revisionId: string; kind: string; orgId: string; assigneeActorId: string | null; pool: string; mandatory: boolean;
  state: string; stepVersion: number; createdByActorId: string; createdAt: Date; completedAt: Date | null;
  decision: { id: string; kind: string; actorId: string; orgId: string; subjectRevision: number; policyVersionId: string; stepVersion: number; reason: string; decidedAt: Date } | null;
}
export interface WorkflowRevision {
  id: string; workflowId: string; number: number; subjectRevision: number; policyVersionId: string; policySource: string; route: string | null;
  state: string; scopeRevision: number; receivingDepartmentId: string | null; receivingDivisionId: string | null;
  submittedByActorId: string; reason: string; createdAt: Date; closedAt: Date | null; steps: WorkflowStep[];
}
export interface WorkflowAssignment {
  id: string; revisionId: string; actorId: string; orgId: string; functionalRole: string; responsibility: string;
  assignedByActorId: string; startsAt: Date; endsAt: Date | null; recordVersion: number;
}
export interface WorkflowCooperation {
  id: string; revisionId: string; sourceOrgId: string; targetOrgId: string; targetActorId: string | null;
  requestedByActorId: string; state: string; recordVersion: number; reason: string; responseReason: string | null;
  requestedAt: Date; respondedAt: Date | null;
}
export interface WorkflowFacts {
  campaign: { id: string; code: string; name: string; levelCode: string | null; lifecycleState: string; recordVersion: number; businessRevision: number; createdByActorId: string; deletedAt: Date | null; subject: Record<string, unknown> };
  workflow: { id: string; recordVersion: number; currentRevisionId: string | null; operationalState: string } | null;
  revisions: WorkflowRevision[]; assignments: WorkflowAssignment[]; cooperations: WorkflowCooperation[];
  changeRequests: { id: string; kind: string; state: string; requestedAt: Date; requestedByActorId: string; reason: string; recordVersion: number; beforeSnapshot: unknown; subjectRevision: number; campaignRecordVersion: number; decidedByActorId: string | null }[];
}
export interface NewWorkflowRevision {
  workflowId: string; number: number; subjectRevision: number; subject: Record<string, unknown>; policyVersionId: string;
  policySource: string; route: string | null; state: string; receivingDepartmentId: string | null;
  receivingDivisionId: string | null; submittedByActorId: string; reason: string;
}
export interface NewWorkflowStep { revisionId: string; kind: string; orgId: string; assigneeActorId: string | null; mandatory: boolean; createdByActorId: string }
export interface NewWorkflowAssignment { actorId: string; orgId: string; functionalRole: string; responsibility: string }
export interface WorkflowCommandIdentity { campaignId: string; actor: ActorContext; idempotencyKey: string; operation: string; payloadHash: string }
export interface WorkflowCommandResult { commandId: string; campaignId: string; workflowVersion: number }

/** All methods execute inside AccessApplicationService's shared security transaction. */
export abstract class CampaignWorkflowRepository {
  abstract configuration(): Promise<WorkflowConfiguration>;
  abstract people(): Promise<WorkflowPerson[]>;
  abstract facts(campaignId: string): Promise<WorkflowFacts | null>;
  abstract inboxCampaignIds(actorId: string, orgIds: readonly string[], departmentFyiOrgId: string | null): Promise<string[]>;
  abstract initialize(actor: ActorContext, commDepartmentId: string, demo: boolean): Promise<void>;
  abstract savePolicy(actor: ActorContext, input: { campaignId: string | null; preset: ApprovalPreset | null; requiredApprovals?: CampaignRequiredApprovals; effectiveFrom: Date; reason: string }): Promise<WorkflowPolicy>;
  abstract receipt(actorId: string, key: string): Promise<{ payloadHash: string; result: WorkflowCommandResult } | null>;
  abstract begin(input: WorkflowCommandIdentity): Promise<string>;
  abstract finish(commandId: string, campaignId: string, workflowId: string): Promise<WorkflowCommandResult>;
  abstract createWorkflow(campaignId: string): Promise<string>;
  abstract createRevision(input: NewWorkflowRevision): Promise<string>;
  abstract setRevisionState(revisionId: string, state: string, close: boolean): Promise<void>;
  abstract closePending(revisionId: string, state: 'CANCELLED' | 'SUPERSEDED', actorId: string, commandId: string): Promise<void>;
  abstract createSteps(input: NewWorkflowStep[]): Promise<void>;
  abstract endAssignments(workflowId: string): Promise<void>;
  abstract reassignStep(revisionId: string, orgId: string, actorId: string | null): Promise<void>;
  abstract touchWorkflow(workflowId: string): Promise<void>;
  abstract decide(input: { step: WorkflowStep; revision: WorkflowRevision; commandId: string; actor: ActorContext; kind: string; reason: string }): Promise<string>;
  abstract assignments(input: { campaignId: string; workflowId: string; revisionId: string; orgId: string; functionalRole: string; replacements: NewWorkflowAssignment[]; commandId: string; decisionId?: string; actorId: string }): Promise<void>;
  abstract requestCooperation(input: { workflowId: string; revisionId: string; sourceOrgId: string; targetOrgId: string; targetActorId: string | null; actorId: string; commandId: string; reason: string }): Promise<void>;
  abstract respondCooperation(input: { id: string; revisionId: string; actorId: string; commandId: string; state: string; reason: string }): Promise<void>;
  abstract audit(actor: ActorContext, campaignId: string | null, action: string, payload: Record<string, unknown>): Promise<void>;
}
