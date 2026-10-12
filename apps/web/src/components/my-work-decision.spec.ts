import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InboxDecisionButtons } from './my-work-decision';
import { OperationEditor } from './campaign-operations-workspace';
import { inboxDecisionKind, type InboxItem } from '../lib/my-work';
import type { CampaignChangeRequest, CampaignOperationsView } from '../lib/campaign-operations';

const item: InboxItem = { id: 'request-qa', campaignId: 'campaign-qa', campaign: { code: 'CPG-QA', name: 'Synthetic Campaign' },
  section: 'PENDING', kind: 'DIVISION_ACCEPT_AND_ASSIGN', state: 'PENDING', canRespond: true, orgId: 'division-qa',
  createdAt: '2026-09-09T00:00:00Z', assignedByActorId: 'requester-qa', assigneeActorId: 'leader-qa', pool: null,
  reason: '', workflowVersion: 2, subjectRevision: 1, taskVersion: 1 };
const buttons = (value: InboxItem, disabled = false) => renderToStaticMarkup(createElement(InboxDecisionButtons, { item: value, disabled, onSelect: vi.fn() }));
const request: CampaignChangeRequest = { id: item.id, kind: 'PAUSE', state: 'PENDING', subjectRevision: 1, recordVersion: 1,
  payload: {}, beforeSnapshot: {}, reason: '', requestedByActorId: 'requester-qa', requestedAt: item.createdAt,
  decidedByActorId: null, decisionReason: null, decidedAt: null, canWithdraw: false };
const view: CampaignOperationsView = { campaignId: item.campaignId, version: 2, subjectRevision: 1, operationalState: 'ACTIVE',
  leadActorId: 'leader-qa', requests: [request], plans: [], proposalAccess: null,
  capabilities: { decide: true, requestChange: false, plan: false, resume: false, restore: false } };

describe('My Work direct decisions', () => {
  it.each(['DIVISION_ACCEPT_AND_ASSIGN', 'DEPARTMENT_APPROVAL', 'CHANGE_EDIT', 'CHANGE_PAUSE', 'CHANGE_CANCEL', 'CHANGE_PLAN', 'CHANGE_RESUME', 'CHANGE_RESTORE', 'CHANGE_PURGE'])('exposes both decisions for eligible %s', kind => {
    const html = buttons({ ...item, kind });
    expect(html).toContain('Phê duyệt</button>'); expect(html).toContain('Từ chối</button>');
    expect(html).toContain('bg-emerald-700'); expect(html).toContain('bg-rose-700');
    expect(html).toContain('href="/campaigns/campaign-qa?tab=approval"'); expect(html).toContain('XEM CHI TIẾT…');
  });
  it.each([{ canRespond: false }, { state: 'REJECTED' }, { state: 'APPROVED' }, { section: 'FYI' as const }, { section: 'FOLLOWING' as const }, { campaign: null }, { kind: 'UNKNOWN' }])('does not expose decision controls for %j', patch => {
    expect(inboxDecisionKind({ ...item, ...patch })).toBeNull(); expect(buttons({ ...item, ...patch })).toBe('');
  });
  it('locks both controls while another decision is open', () => {
    expect(buttons(item, true).match(/disabled=""/g)).toHaveLength(2);
  });
});

describe('Optional change-request rejection opinion', () => {
  it.each(['EDIT', 'PAUSE', 'CANCEL', 'PLAN', 'RESUME', 'RESTORE'] as const)('can confirm %s rejection without entering a reason', kind => {
    const html = renderToStaticMarkup(createElement(OperationEditor, { view, operation: 'DECIDE', request: { ...request, kind }, decision: 'reject', onSaved: vi.fn(), onBusyChange: vi.fn() }));
    expect(html).toContain('Ý kiến xử lý (không bắt buộc)'); expect(html).toContain('OK · Từ chối yêu cầu');
    expect(html).not.toContain('disabled=""'); expect(html).not.toContain('required=');
  });
  it('keeps stale requests disabled despite optional opinions', () => {
    const html = renderToStaticMarkup(createElement(OperationEditor, { view, operation: 'DECIDE', request: { ...request, subjectRevision: 0 }, decision: 'reject', onSaved: vi.fn(), onBusyChange: vi.fn() }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
