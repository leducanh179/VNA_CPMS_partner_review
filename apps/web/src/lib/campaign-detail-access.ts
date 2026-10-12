import type { WorkflowView } from './campaign-workflow';

export function canAccessCampaignApprovalTab(input: { directSuperadmin: boolean; actorId: string; workflow: WorkflowView | null; deleted: boolean }) {
  if (input.deleted) return false;
  if (input.directSuperadmin) return true;
  if (input.workflow?.tasks.some((task) => task.eligibility?.allowed)) return true;
  if (input.workflow?.capabilities.reviewChanges) return true;
  return Boolean(input.workflow?.assignments.some((assignment) => !assignment.endsAt && assignment.actorId === input.actorId && ['DEPARTMENT_LEADER', 'DIVISION_LEADER'].includes(assignment.functionalRole)));
}

export function shouldOpenCampaignApprovalTab(requestedTab: string | null, canSeeApproval: boolean, workflowReady: boolean) {
  return canSeeApproval && (requestedTab === 'approval' || (requestedTab === null && workflowReady));
}
