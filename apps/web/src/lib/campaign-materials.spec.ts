import { describe, expect, it } from 'vitest';
import { materialsForCampaign } from './campaign-materials';
import type { MaterialSummary } from '@cpms/domain';

const record = (id: string, fields: MaterialSummary['fields'], isDeleted = false): MaterialSummary => ({ id, materialId: id, recordVersion: 1, isDeleted, updatedAt: '', fields });

describe('materialsForCampaign', () => {
  it('shows all active linked materials without an approval prerequisite, including multi-campaign records', () => {
    const both = JSON.stringify([{ kind: 'SYSTEM', id: 'c1', name: 'One' }, { kind: 'SYSTEM', id: 'c2', name: 'Two' }]);
    const temporary = JSON.stringify([{ kind: 'TEMPORARY', id: 'temp:1', name: 'One' }]);
    const materials = [
      record('both', { workflow_state: 'APPROVED', campaign_refs: both }),
      record('pending', { workflow_state: 'PENDING_APPROVAL', campaign_refs: both }),
      record('temporary', { workflow_state: 'APPROVED', campaign_refs: temporary }),
      record('deleted', { workflow_state: 'APPROVED', campaign_refs: both }, true),
      record('legacy', { approval_status: 'APPROVED', campaign_code: 'C1' }),
    ];
    expect(materialsForCampaign(materials, { id: 'c1', code: 'C1', name: 'One' }).map((material) => material.materialId)).toEqual(['both', 'pending', 'legacy']);
    expect(materialsForCampaign(materials, { id: 'c2', code: 'C2', name: 'Two' }).map((material) => material.materialId)).toEqual(['both', 'pending']);
  });
});
