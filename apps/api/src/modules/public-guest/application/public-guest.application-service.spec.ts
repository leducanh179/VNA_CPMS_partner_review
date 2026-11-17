import { describe, expect, it } from 'vitest';
import type { CampaignSummary } from '@cpms/domain';
import { isPublicGuestRead } from '../../auth/public-material-read';
import { PublicGuestApplicationService } from './public-guest.application-service';
import type { PublicGuestRepository } from './public-guest.repository';

const campaign = {
  id: '113ad11f-9c8d-4780-b045-91050e621f51', code: 'CPG-TEST', name: 'Synthetic campaign', requestingUnit: 'Synthetic unit',
  lifecycleState: 'DRAFT', qcttStatus: 'Nháp', startDate: '2026-10-01', endDate: '2026-10-31',
  effectiveStartDate: null, effectiveEndDate: null, departureStartDate: null, departureEndDate: null,
  levelLabel: 'Synthetic level', primaryObjectiveLabel: 'Synthetic objective', primaryObjectiveOther: null,
  kpiText: null, descriptionRichText: null, additionalInformation: [], markets: [], provinces: [], requestingUnits: [],
  approvalStatus: 'Đã duyệt', departmentApprovers: [{ actorId: 'secret-actor', displayName: 'Secret person' }],
  divisionApprovers: [], fieldValues: { department_approval_state: 'Đã duyệt', division_approval_state: 'Chờ duyệt', department_approver_summary: 'Secret person' },
  updatedAt: '2026-10-27T00:00:00Z', isDeleted: false, secretInternal: 'do not expose',
} as unknown as CampaignSummary;

function source(): PublicGuestRepository {
  return {
    campaigns: async () => [campaign], campaign: async () => campaign, approval: async () => null,
    contracts: async () => [{ id: 'contract-1', code: 'C-1', name: 'Synthetic contract', number: '01', vendor: 'Synthetic vendor',
      supplyType: 'PAID', status: 'DRAFT', startDate: null, endDate: null, signedAmount: '999', unitPrice: '9', quantity: '111', source: { secret: true } }],
    bookings: async () => [{ id: 'booking-1', campaignLabel: 'Synthetic campaign', contractCode: 'C-1', contractName: 'Synthetic contract',
      slotName: 'Synthetic slot', startDate: '2026-10-01', endDate: '2026-10-31', state: 'ACTIVE', reportState: 'EMPTY',
      unit: 'tháng', quantity: '111', unitPrice: '9', amount: '999', gross: '999' }],
    materials: async () => [], plans: async () => [],
  } as PublicGuestRepository;
}

describe('public Guest boundary', () => {
  it('allows only exact anonymous GET list and Campaign information routes', () => {
    for (const route of ['/api/public/guest/campaigns','/api/public/guest/contracts','/api/public/guest/bookings','/api/public/guest/materials','/api/public/guest/plans',`/api/public/guest/campaigns/${campaign.id}`]) expect(isPublicGuestRead('GET', route)).toBe(true);
    for (const route of ['/api/public/guest/contracts/contract-1','/api/public/guest/bookings/booking-1','/api/public/guest/directory','/api/public/guest/campaigns/../contracts','/api/campaigns']) expect(isPublicGuestRead('GET', route)).toBe(false);
    expect(isPublicGuestRead('POST', '/api/public/guest/campaigns')).toBe(false);
  });
  it('masks approver identities and never spreads internal Campaign fields', async () => {
    const result = await new PublicGuestApplicationService(source()).campaigns();
    expect(result[0]?.departmentApprovers).toBe('****');
    expect(JSON.stringify(result)).not.toMatch(/Secret person|secret-actor|secretInternal|department_approver_summary/);
  });
  it('does not project quantity, unit, unit price, amount, or source on public tables', async () => {
    const service = new PublicGuestApplicationService(source());
    for (const row of [...await service.contracts(), ...await service.bookings()]) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['quantity','unit','unitPrice','amount','gross','signedAmount','source']));
      expect(JSON.stringify(row)).not.toContain('999');
    }
  });
});
