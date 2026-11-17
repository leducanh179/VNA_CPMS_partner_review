import type { CampaignSummary } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { PublicGuestRepository } from './public-guest.repository';

/** Every public response is an explicit projection. Never spread a stored record to the wire. */
export function guestCampaign(row: CampaignSummary) {
  return {
    id: row.id, code: row.code, name: row.name, requestingUnit: row.requestingUnit,
    lifecycleState: row.lifecycleState, qcttStatus: row.qcttStatus ?? null,
    startDate: row.startDate, endDate: row.endDate,
    effectiveStartDate: row.effectiveStartDate, effectiveEndDate: row.effectiveEndDate,
    departureStartDate: row.departureStartDate ?? null, departureEndDate: row.departureEndDate ?? null,
    levelLabel: row.levelLabel, primaryObjectiveLabel: row.primaryObjectiveLabel,
    primaryObjectiveOther: row.primaryObjectiveOther, kpiText: row.kpiText,
    descriptionRichText: row.descriptionRichText, additionalInformation: row.additionalInformation,
    markets: row.markets.map(value => ({ marketName: value.marketName, regionCode: value.regionCode })),
    provinces: row.provinces.map(value => ({ provinceName: value.provinceName })),
    requestingUnits: row.requestingUnits.map(value => ({ displayName: value.displayName })),
    approvalStatus: row.approvalStatus ?? 'Chưa trình',
    departmentApproval: row.fieldValues.department_approval_state ?? 'Chưa trình',
    divisionApproval: row.fieldValues.division_approval_state ?? 'Chưa trình',
    departmentApprovers: row.departmentApprovers?.length ? '****' : '—',
    divisionApprovers: row.divisionApprovers?.length ? '****' : '—',
    updatedAt: row.updatedAt,
  };
}
@Injectable()
export class PublicGuestApplicationService {
  constructor(@Inject(PublicGuestRepository) private readonly source: PublicGuestRepository) {}
  async campaigns() { return (await this.source.campaigns()).map(guestCampaign); }
  async contracts() { return (await this.source.contracts()).map(row => ({ id: row.id, code: row.code, name: row.name,
    number: row.number, vendor: row.vendor, supplyType: row.supplyType, status: row.status,
    startDate: row.startDate, endDate: row.endDate })); }
  async bookings() { return (await this.source.bookings()).map(row => ({ id: row.id, campaignLabel: row.campaignLabel,
    contractCode: row.contractCode, contractName: row.contractName, slotName: row.slotName,
    startDate: row.startDate, endDate: row.endDate, state: row.state, reportState: row.reportState })); }
  async materials() { return (await this.source.materials()).map(row => ({ id: row.id, materialId: row.materialId,
    title: row.title, group: row.group, type: row.type, campaign: row.campaign, status: row.status, updatedAt: row.updatedAt })); }
  async plans() { return (await this.source.plans()).map(row => ({ id: row.id, code: row.code, name: row.name, hasPlan: row.hasPlan })); }
}
