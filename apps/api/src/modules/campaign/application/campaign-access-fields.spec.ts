import { describe, expect, it } from 'vitest';
import type { CampaignSummary } from '@cpms/domain';
import { inspectCampaignFieldChanges } from '@cpms/domain';
import { prepareCampaignAccessUpdate } from './campaign-access-fields';

const current = { code: 'QA-FIELDS', name: 'Synthetic Campaign', lifecycleState: 'DRAFT', levelCode: 'CLV_01', startDate: '2026-09-01', endDate: null,
  effectiveStartDate: null, effectiveEndDate: null, primaryObjectiveCode: 'RECRUITMENT', primaryObjectiveLabel: 'Synthetic recruitment', kpiText: 'Original KPI',
  requestingUnits: [], markets: [], provinces: [], additionalInformation: [], descriptionRichText: null,
  fieldValues: { campaign_name: 'Synthetic Campaign', campaign_objective: 'Synthetic recruitment', mystery: 'preserve  spaces' } } as unknown as CampaignSummary;
const objectives = [{ code: 'RECRUITMENT', label: 'Synthetic recruitment' }, { code: 'AWARENESS', label: 'Synthetic awareness' }];

describe('Campaign typed/legacy adapter authorization diff', () => {
  it('turns legacy-only name/date/KPI edits into typed values and canonical permission fields', () => {
    const result = prepareCampaignAccessUpdate(current, { expectedVersion: 1, fieldValues: { campaign_name: ' New name ', campaign_comm_start_date: '2026-09-02', kpi_primary: 'New KPI' } }, objectives);
    expect(result.command).toMatchObject({ name: 'New name', startDate: '2026-09-02', kpiText: 'New KPI' });
    expect(inspectCampaignFieldChanges(result.before, result.patch).fields.map((field) => field.fieldKey).sort()).toEqual(['campaign_comm_start_date','campaign_name','kpi_primary']);
  });
  it('preserves an unchanged legacy read label while correctly detecting a changed typed objective', () => {
    const result = prepareCampaignAccessUpdate(current, { expectedVersion: 1, primaryObjectiveCode: 'AWARENESS', fieldValues: { campaign_objective: 'Synthetic recruitment', mystery: 'preserve  spaces' } }, objectives);
    const changes = inspectCampaignFieldChanges(result.before, result.patch);
    expect(changes.errors).toEqual([]); expect(changes.fields.map((field) => field.fieldKey)).toEqual(['campaign_objective']);
    expect(result.command.fieldValues?.mystery).toBe('preserve  spaces');
  });
  it('canonicalizes a changed legacy objective through the exact catalog label', () => {
    const result = prepareCampaignAccessUpdate(current, { expectedVersion: 1, fieldValues: { campaign_objective: 'Synthetic awareness' } }, objectives);
    expect(result.command.primaryObjectiveCode).toBe('AWARENESS');
  });
  it('rejects conflicting changed aliases, invalid dates and invalid legacy field types', () => {
    expect(() => prepareCampaignAccessUpdate(current, { expectedVersion: 1, name: 'One', fieldValues: { campaign_name: 'Two' } }, objectives)).toThrow();
    expect(() => prepareCampaignAccessUpdate(current, { expectedVersion: 1, fieldValues: { campaign_comm_start_date: '2026-02-30' } }, objectives)).toThrow();
    expect(() => prepareCampaignAccessUpdate(current, { expectedVersion: 1, fieldValues: { campaign_name: { role: 'ADMIN' } } }, objectives)).toThrow();
  });
});
