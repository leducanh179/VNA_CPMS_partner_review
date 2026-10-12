import { describe, expect, it } from 'vitest';
import { canAccessCampaignApprovalTab, shouldOpenCampaignApprovalTab } from './campaign-detail-access';
import type { WorkflowView } from './campaign-workflow';

const workflow = (overrides: Partial<WorkflowView> = {}): WorkflowView => ({
  campaign: { id: 'campaign', code: 'CPG-202609-TEST', name: 'Test', recordVersion: 1, businessRevision: 1 }, version: 1, provenance: 'TEST', revision: null, history: [], assignments: [], cooperations: [], policy: null, currentPolicy: null,
  organizations: [], people: [], candidates: [], tasks: [], capabilities: { submit: false, assign: false, policy: false, cooperate: false, withdraw: false }, reassignableScopes: [], cooperationSourceOrgIds: [], planning: { implemented: false, label: '' }, internalDemoNotice: '', ...overrides,
});

describe('Campaign detail tab access', () => {
  it('hides approval from requester and specialist without an eligible task', () => {
    expect(canAccessCampaignApprovalTab({ directSuperadmin: false, actorId: 'requester', workflow: workflow(), deleted: false })).toBe(false);
  });

  it('shows approval to an actor with an eligible approval task', () => {
    expect(canAccessCampaignApprovalTab({ directSuperadmin: false, actorId: 'leader', workflow: workflow({ tasks: [{ id: 'step', kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: 'org', assigneeActorId: null, mandatory: true, state: 'PENDING', stepVersion: 1, createdByActorId: 'admin', createdAt: '', completedAt: null, decision: null, eligibility: { allowed: true, reason: 'ELIGIBLE_TASK' } }] }), deleted: false })).toBe(true);
  });

  it('keeps approval available to the assigned division leader after approval', () => {
    expect(canAccessCampaignApprovalTab({ directSuperadmin: false, actorId: 'leader', workflow: workflow({ assignments: [{ id: 'assignment', actorId: 'leader', orgId: 'org', functionalRole: 'DIVISION_LEADER', responsibility: 'LEAD', assignedByActorId: 'admin', startsAt: '', endsAt: null, recordVersion: 1 }] }), deleted: false })).toBe(true);
  });

  it('never exposes approval for a trashed Campaign', () => {
    expect(canAccessCampaignApprovalTab({ directSuperadmin: true, actorId: 'admin', workflow: workflow(), deleted: true })).toBe(false);
  });

  it('opens an explicitly requested approval tab only for authorized viewers', () => {
    expect(shouldOpenCampaignApprovalTab('approval', true, false)).toBe(true);
    expect(shouldOpenCampaignApprovalTab('approval', false, true)).toBe(false);
    expect(shouldOpenCampaignApprovalTab('information', true, true)).toBe(false);
  });

  it('preserves the default approval tab after workflow access loads', () => {
    expect(shouldOpenCampaignApprovalTab(null, true, false)).toBe(false);
    expect(shouldOpenCampaignApprovalTab(null, true, true)).toBe(true);
  });
});
