export interface InboxItem {
  id: string; section: 'PENDING' | 'FOLLOWING' | 'ASSIGNED' | 'FYI'; campaignId: string;
  campaign: { code: string; name: string } | null;
  kind: string; orgId: string | null; state: string; createdAt: string; assignedByActorId: string;
  assigneeActorId: string | null; pool: string | null; reason: string; workflowVersion: number;
  subjectRevision: number; taskVersion: number | null; canRespond: boolean; adminIntervention?: boolean;
}

export type InboxDecision = 'approve' | 'reject';

export function inboxDecisionKind(item: InboxItem): 'workflow' | 'change' | null {
  if (item.section !== 'PENDING' || item.state !== 'PENDING' || !item.canRespond || !item.campaign) return null;
  if (['DIVISION_ACCEPT_AND_ASSIGN', 'DEPARTMENT_APPROVAL'].includes(item.kind)) return 'workflow';
  if (['CHANGE_EDIT', 'CHANGE_PAUSE', 'CHANGE_CANCEL', 'CHANGE_RESUME', 'CHANGE_RESTORE', 'CHANGE_PLAN', 'CHANGE_PURGE'].includes(item.kind)) return 'change';
  return null;
}
