import { describe, expect, it } from 'vitest';
import { parseWorkflowCommand, parseWorkflowPolicy } from './campaign-workflow.commands';
import { campaignRequiredApprovals } from '@cpms/domain';

const base = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  expectedVersion: 1,
  expectedSubjectRevision: 1,
  stepId: '00000000-0000-4000-8000-000000000002',
  expectedStepVersion: 1,
};

describe('Campaign workflow command validation', () => {
  it('validates a complete typed approval map and defaults old callers safely', () => {
    const policy = { expectedVersion: 1, campaignId: null, preset: 'DIVISION_ONLY', effectiveFrom: '2026-09-09T00:00:00Z', reason: 'QA' };
    expect(parseWorkflowPolicy(policy).requiredApprovals).toEqual(campaignRequiredApprovals());
    const requiredApprovals = { ...campaignRequiredApprovals(), PAUSE: false };
    expect(parseWorkflowPolicy({ ...policy, requiredApprovals }).requiredApprovals).toEqual(requiredApprovals);
    expect(() => parseWorkflowPolicy({ ...policy, requiredApprovals: { PAUSE: false } })).toThrow();
    expect(() => parseWorkflowPolicy({ ...policy, requiredApprovals: { ...requiredApprovals, PAUSE: 'false' } })).toThrow();
    expect(() => parseWorkflowPolicy({ ...policy, requiredApprovals: { ...requiredApprovals, UNKNOWN: false } })).toThrow();
  });
  it('accepts a rejection without an optional opinion', () => {
    expect(parseWorkflowCommand({ ...base, operation: 'REJECT' })).toMatchObject({ operation: 'REJECT', reason: '' });
    expect(parseWorkflowCommand({ ...base, operation: 'ADMIN_REJECT' })).toMatchObject({ operation: 'ADMIN_REJECT', reason: '' });
  });

  it('requires an accountable reason and assignment for superadmin approval', () => {
    const leaderActorId = '00000000-0000-4000-8000-000000000003';
    const member = { actorId: '00000000-0000-4000-8000-000000000004', orgId: '00000000-0000-4000-8000-000000000005', responsibility: 'LEAD' };
    expect(() => parseWorkflowCommand({ ...base, operation: 'ADMIN_SKIP_ASSIGN', leaderActorId, members: [member] })).toThrow('Cần lý do cho thay đổi workflow.');
    expect(parseWorkflowCommand({ ...base, operation: 'ADMIN_SKIP_ASSIGN', leaderActorId, members: [member], reason: 'Phê duyệt ca kiểm thử theo yêu cầu.' })).toMatchObject({ operation: 'ADMIN_SKIP_ASSIGN', leaderActorId, members: [member] });
  });

  it('continues to require a reason when returning a Campaign for revision', () => {
    expect(() => parseWorkflowCommand({ ...base, operation: 'RETURN' })).toThrow('Cần lý do cho thay đổi workflow.');
  });

  it('accepts declining cooperation without an opinion', () => {
    const { stepId, expectedStepVersion, ...command } = base;
    expect(parseWorkflowCommand({ ...command, operation: 'DECLINE_COOPERATION', requestId: stepId, expectedRequestVersion: expectedStepVersion })).toMatchObject({ reason: '' });
  });
});
