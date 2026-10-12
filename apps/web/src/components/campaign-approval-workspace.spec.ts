import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CampaignSummary } from '@cpms/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignApprovalWorkspace } from './campaign-approval-workspace';
import type { CampaignChangeRequest, CampaignOperationsView } from '../lib/campaign-operations';
import type { WorkflowView } from '../lib/campaign-workflow';
import type * as CampaignWorkflowModule from '../lib/campaign-workflow';

const state = vi.hoisted(() => ({ operations: null as CampaignOperationsView | null, workflow: null as WorkflowView | null, superadmin: false, error: '' }));
vi.mock('../auth-context', () => ({ useAuth: () => ({ me: { account: { id: 'leader', displayName: 'Lãnh đạo QA' }, directSuperadmin: state.superadmin } }) }));
vi.mock('../lib/use-campaign-operations', () => ({ useCampaignOperations: () => ({ view: state.operations, error: state.error, loading: false, load: vi.fn() }) }));
vi.mock('../lib/campaign-workflow', async (original) => ({
  ...await original<typeof CampaignWorkflowModule>(),
  useWorkflow: () => ({ view: state.workflow ?? approvedWorkflow, error: '', busy: false, load: vi.fn() }),
}));

const campaign: CampaignSummary = {
  id: 'campaign', code: 'CPG-QA-PAUSE', name: 'Chiến dịch QA yêu cầu tạm dừng', requestingUnit: 'Đơn vị QA',
  lifecycleState: 'DRAFT', qcttStatus: 'Đã phê duyệt', pendingChangeLabel: 'Chờ duyệt tạm dừng', operationalState: 'ACTIVE',
  startDate: null, endDate: null, effectiveStartDate: null, effectiveEndDate: null, levelCode: 'CLV_01', levelLabel: null, levelRuleDescription: null,
  requestingEmployeeCode: null, requestingEmployeeName: 'Người yêu cầu QA', manualRequesterEmail: null,
  primaryObjectiveCode: null, primaryObjectiveLabel: null, primaryObjectiveOther: null, kpiText: null, descriptionRichText: null,
  additionalInformation: [], dataSchemaVersion: 2, normalizationStatus: 'CURRENT', normalizationWarnings: [],
  markets: [], provinces: [], requestingUnits: [], fieldValues: {}, recordVersion: 3, isDeleted: false, deletedAt: null, deletedByActorId: null, updatedAt: '2026-09-09T00:00:00Z',
};
const approvedWorkflow: WorkflowView = {
  campaign: { id: campaign.id, code: campaign.code, name: campaign.name, recordVersion: 3, businessRevision: 1 },
  version: 8, provenance: 'CURRENT', revision: { id: 'revision', number: 1, subjectRevision: 1, policyVersionId: 'policy', policySource: 'SYSTEM_DEFAULT', route: 'DIVISION', state: 'APPROVED', scopeRevision: 1, receivingDepartmentId: 'department', receivingDivisionId: 'division', submittedByActorId: 'requester', reason: '', createdAt: '2026-09-09T00:00:00Z', steps: [] },
  history: [], tasks: [], assignments: [], cooperations: [], policy: null, currentPolicy: null, organizations: [], people: [], candidates: [],
  capabilities: { submit: false, assign: false, policy: false, cooperate: false, withdraw: false },
  reassignableScopes: [], cooperationSourceOrgIds: [], planning: { implemented: true, label: '' }, internalDemoNotice: '',
};
const request: CampaignChangeRequest = {
  id: 'pause-request', kind: 'PAUSE', state: 'PENDING', subjectRevision: 1, recordVersion: 1,
  payload: {}, beforeSnapshot: { operationalState: 'ACTIVE' }, reason: 'Đề nghị tạm dừng để chỉnh kế hoạch.',
  requestedByActorId: 'requester', requestedAt: '2026-09-09T08:00:00Z', decidedByActorId: null, decisionReason: null, decidedAt: null, canWithdraw: false,
};
const render = () => renderToStaticMarkup(createElement(CampaignApprovalWorkspace, { campaign, onNavigateInformation: vi.fn(), onSaved: vi.fn() }));

beforeEach(() => {
  state.error = '';
  state.workflow = null;
  state.superadmin = false;
  state.operations = { campaignId: campaign.id, version: 8, subjectRevision: 1, operationalState: 'ACTIVE', leadActorId: 'leader', requests: [request], plans: [], capabilities: { decide: true, requestChange: false, plan: false, resume: false, restore: false }, proposalAccess: null };
});

describe('Campaign approval tab after initial approval', () => {
  it('renders pause decision buttons even when all initial approval tasks are completed', () => {
    const html = render();
    expect(html).toContain('Yêu cầu mới đang chờ phê duyệt');
    expect(html).toContain('Tạm dừng chiến dịch');
    expect(html).toContain('Phê duyệt yêu cầu</button>');
    expect(html).toContain('Từ chối yêu cầu</button>');
    expect(html.indexOf('Phê duyệt yêu cầu</button>')).toBeLessThan(html.indexOf('Lịch sử yêu cầu và phê duyệt'));
    expect(html).toContain('Đã phê duyệt · Chờ duyệt tạm dừng');
    expect(html).not.toContain('Giao nhiệm vụ phụ trách chính');
  });

  it.each(['EDIT', 'CANCEL', 'RESUME', 'RESTORE', 'PLAN'] as const)('also exposes the pending %s queue on the approval tab', (kind) => {
    state.operations!.requests = [{ ...request, kind }];
    expect(render()).toContain('Phê duyệt yêu cầu</button>');
  });

  it('does not expose decisions to an actor whose server capability denies review', () => {
    state.operations!.capabilities.decide = false;
    const html = render();
    expect(html).toContain('Đang chờ Lãnh đạo Phòng chủ trì xử lý');
    expect(html).not.toContain('Phê duyệt yêu cầu</button>');
    expect(html).not.toContain('Từ chối yêu cầu</button>');
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'])('keeps %s requests in history without actionable buttons', (status) => {
    state.operations!.requests = [{ ...request, state: status }];
    const html = render();
    expect(html).not.toContain('Yêu cầu đang chờ phê duyệt');
    expect(html).not.toContain('Phê duyệt yêu cầu</button>');
    expect(html).toContain('Lịch sử yêu cầu và phê duyệt');
  });

  it('shows a recoverable loading error rather than silently hiding the request queue', () => {
    state.operations = null; state.error = 'Kết nối bị gián đoạn';
    const html = render();
    expect(html).toContain('Không tải được yêu cầu phê duyệt');
    expect(html).toContain('Tải lại yêu cầu');
  });

  it('offers a separate audited superadmin decision when the actor is not the scoped leader', () => {
    state.superadmin = true;
    const task = {
      id: 'pending-step', kind: 'DIVISION_ACCEPT_AND_ASSIGN', orgId: 'division', assignmentOrgId: 'division', assigneeActorId: null,
      mandatory: true, state: 'PENDING', stepVersion: 1, createdByActorId: 'requester', createdAt: '2026-09-09T00:00:00Z', completedAt: null,
      decision: null, eligibility: { allowed: false, reason: 'WRONG_LEADER_SCOPE' }, adminEligibility: { allowed: true, reason: 'EXPLICIT_ADMIN_INTERVENTION' },
    };
    state.workflow = { ...approvedWorkflow, tasks: [task], revision: { ...approvedWorkflow.revision!, state: 'PENDING', steps: [task] } };
    const html = render();
    expect(html).toContain('Quyết định của superadmin');
    expect(html).toContain('Phê duyệt</span></button>');
    expect(html).toContain('Từ chối</span></button>');
    expect(html).not.toContain('Quyết định của Lãnh đạo Phòng');
  });
});
