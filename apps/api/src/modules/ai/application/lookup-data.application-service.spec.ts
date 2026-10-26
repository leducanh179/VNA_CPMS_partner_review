import type { AiWorkspaceApplicationService } from './workspace.application-service';
import type { LookupRecordApplicationService } from './lookup-record.application-service';
import { randomUUID } from 'node:crypto';
import type { ActorContext, CampaignSummary } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import { LookupDataApplicationService } from './lookup-data.application-service';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import type { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import type { MaterialApplicationService } from '../../material/application/material.application-service';
import type { MaterialSharingApplicationService } from '../../material/application/material-sharing.application-service';

const approvedId = randomUUID();
const draftId = randomUUID();
const approved = { id: approvedId, code: 'CPG-TEST-APPROVED', name: 'Chiến dịch đã duyệt', isDeleted: false,
  lifecycleState: 'DRAFT', approvalStatus: 'Đã duyệt', qcttStatus: 'Đã phê duyệt', operationalState: 'ACTIVE',
  effectiveStartDate: '2020-01-01', effectiveEndDate: '2099-12-31', startDate: '2020-01-01', endDate: '2099-12-31',
  requestingUnit: 'Phòng thử nghiệm', markets: [], descriptionRichText: null, recordVersion: 1 } as unknown as CampaignSummary;
const draft = { ...approved, id: draftId, code: 'CPG-TEST-DRAFT', name: 'Chiến dịch nháp', approvalStatus: 'Chưa trình',
  qcttStatus: undefined, effectiveStartDate: null, effectiveEndDate: null } as CampaignSummary;

function service(denied = new Set<string>()) {
  const rows = new Map([[approvedId, approved], [draftId, draft]]);
  const access = { run: async (_actor: unknown, work: () => Promise<unknown>) => work(), visibleCampaignIds: async () => [...rows.keys()],
    campaign: async (id: string) => ({ id, deleted: false }),
    check: (_permission: string, _resource: unknown, field: string) => ({ allowed: !denied.has(field) }),
    require: vi.fn() } as unknown as AccessApplicationService;
  const campaigns = { get: async (id: string) => rows.get(id) } as unknown as CampaignApplicationService;
  const lookup = new LookupDataApplicationService(access, campaigns, {} as MaterialApplicationService, {} as MaterialSharingApplicationService, {} as LookupRecordApplicationService, {} as AiWorkspaceApplicationService);
  return { lookup, access };
}

const actor = {} as ActorContext;
describe('AI campaign approval lookup', () => {
  it('uses the current workflow approval, not the legacy DRAFT field, in details and aggregates', async () => {
    const { lookup } = service();
    const result = await lookup.execute(actor, 'get_campaign', { id: approvedId });
    expect(result.content.item).toMatchObject({ campaign_approval_status: 'Đã duyệt', campaign_workflow_status: 'Đã phê duyệt',
      campaign_effective_status: 'Đang hiệu lực' });
    expect(JSON.stringify(result.content)).not.toContain('DRAFT');
    expect(result.requirements[0]?.fields).toContain('division_approval_state');
    const summary = await lookup.execute(actor, 'summarize_campaigns', { query: '', campaignId: null });
    expect(summary.content).toMatchObject({ total: 2, byApprovalStatus: { 'Đã duyệt': 1, 'Chưa trình': 1 },
      byWorkflowStatus: { 'Đã phê duyệt': 1, 'Nháp': 1 } });
    expect(JSON.stringify(summary.content)).not.toContain('DRAFT');
  });

  it('does not expose derived approval or workflow status when an approval field is denied', async () => {
    const { lookup } = service(new Set(['division_approval_state']));
    const result = await lookup.execute(actor, 'get_campaign', { id: approvedId });
    expect(result.content.item).not.toHaveProperty('campaign_approval_status');
    expect(result.content.item).not.toHaveProperty('campaign_workflow_status');
    expect(result.requirements[0]?.fields).not.toContain('division_approval_state');
  });

  it('does not treat an approval of an earlier business version as approval of the current content', async () => {
    const changed = { ...approved, qcttStatus: 'Nháp' } as CampaignSummary;
    const campaigns = { get: async () => changed } as unknown as CampaignApplicationService;
    const access = { run: async (_actor: unknown, work: () => Promise<unknown>) => work(), campaign: async () => ({ id: approvedId, deleted: false }),
      check: () => ({ allowed: true }), require: vi.fn() } as unknown as AccessApplicationService;
    const changedLookup = new LookupDataApplicationService(access, campaigns, {} as MaterialApplicationService, {} as MaterialSharingApplicationService, {} as LookupRecordApplicationService, {} as AiWorkspaceApplicationService);
    const result = await changedLookup.execute(actor, 'get_campaign', { id: approvedId });
    expect(result.content.item).toMatchObject({ campaign_approval_status: 'Bản trước đã duyệt; nội dung hiện tại chưa duyệt', campaign_workflow_status: 'Nháp' });
  });
});
