import { describe, expect, it } from 'vitest';
import { CampaignWorkflowApplicationService, canCooperateInDivision } from './campaign-workflow.application-service';
import type { CampaignWorkflowRepository, WorkflowConfiguration, WorkflowPerson } from './campaign-workflow.repository';
import type { AccessApplicationService } from '../../access/application/access.application-service';

const departmentId = 'department';
const divisionId = 'division';
const otherDivisionId = 'other-division';
const campaignId = 'campaign';
const config: WorkflowConfiguration = {
  version: 1, commDepartmentId: departmentId, demoInitialized: false, policies: [],
  organizations: [
    { id: departmentId, sourceName: 'Ban TT', kind: 'DEPARTMENT', parentId: null },
    { id: divisionId, sourceName: 'Phòng Thương hiệu', kind: 'DIVISION', parentId: departmentId },
    { id: otherDivisionId, sourceName: 'Phòng khác', kind: 'DIVISION', parentId: departmentId },
  ],
};
const personnel = (id: string, division = divisionId, isActive = true, manager = false): WorkflowPerson => ({
  id, displayName: id, employeeCode: id, email: `${id}@example.test`, departmentId, divisionId: division, isActive, jobTitle: null,
  roles: manager ? [{ roleCode: 'COMM_CAMPAIGN_MANAGER', scopeType: 'SYSTEM', orgId: null, campaignId: null, module: null, expiresAt: null }] : [],
});

describe('Campaign workflow cooperation assignment', () => {
  it('accepts active personnel in the responsible division without Campaign Manager role, while keeping the lead role requirement', () => {
    const people = [personnel('lead', divisionId, true, true), personnel('cooperator')];
    const commitChecks: (() => Promise<void>)[] = [];
    const repository = { people: async () => people, configuration: async () => config } as CampaignWorkflowRepository;
    const access = { requireAtCommit: (check: () => Promise<void>) => { commitChecks.push(check); } } as AccessApplicationService;
    const service = new CampaignWorkflowApplicationService(repository, access);
    const validate = (service as unknown as { validateMembers: (members: { actorId: string; orgId: string; responsibility: string }[], role: string, orgId: string, campaignId: string, people: WorkflowPerson[], config: WorkflowConfiguration) => void }).validateMembers.bind(service);
    const members = [{ actorId: 'lead', orgId: divisionId, responsibility: 'LEAD' }, { actorId: 'cooperator', orgId: divisionId, responsibility: 'COOP' }];
    expect(() => validate(members, 'CAMPAIGN_MANAGER', divisionId, campaignId, people, config)).not.toThrow();
    expect(commitChecks).toHaveLength(2);
    expect(() => validate([{ actorId: 'cooperator', orgId: divisionId, responsibility: 'LEAD' }], 'CAMPAIGN_MANAGER', divisionId, campaignId, people, config)).toThrow();
  });

  it('rejects inactive personnel and personnel outside the responsible division', () => {
    expect(canCooperateInDivision(personnel('same'), divisionId, config)).toBe(true);
    expect(canCooperateInDivision(personnel('other', otherDivisionId), divisionId, config)).toBe(false);
    expect(canCooperateInDivision(personnel('inactive', divisionId, false), divisionId, config)).toBe(false);
    expect(canCooperateInDivision(personnel('same'), otherDivisionId, config)).toBe(false);
  });
});
