import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PrismaCampaignRepository } from '../../campaign/infrastructure/prisma-campaign.repository';
import { PrismaCampaignWorkflowRepository } from '../../campaign-workflow/infrastructure/prisma-campaign-workflow.repository';
import { PublicGuestRepository, type GuestBookingRow, type GuestContractRow, type GuestMaterialRow, type GuestPlanRow } from '../application/public-guest.repository';

const publicCampaign = { deletedAt: null, sharing: { is: { mode: 'PUBLIC' } } } satisfies Prisma.CampaignWhereInput;
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;
const field = (value: unknown, key: string) => value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string'
  ? String((value as Record<string, unknown>)[key]).slice(0, 500) : '';

@Injectable()
export class PrismaPublicGuestRepository extends PublicGuestRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrismaCampaignRepository) private readonly campaignsSource: PrismaCampaignRepository,
    @Inject(PrismaCampaignWorkflowRepository) private readonly approvalSource: PrismaCampaignWorkflowRepository) { super(); }
  private get db() { return this.prisma.database; }

  async campaigns() {
    const rows = await this.db.campaign.findMany({
      where: { ...publicCampaign, sharing: { is: { mode: 'PUBLIC', publicTabs: { has: 'information' } } } },
      select: { id: true, sharing: { select: { publicTabs: true } } },
    });
    if (!rows.length) return [];
    const approvalIds = new Set(rows.filter(row => row.sharing?.publicTabs.includes('approval')).map(row => row.id));
    const campaigns = await this.campaignsSource.list(false, rows.map(row => row.id));
    return campaigns.map(row => approvalIds.has(row.id) ? row : {
      ...row, approvalStatus: '—', departmentApprovers: [], divisionApprovers: [],
      fieldValues: { ...row.fieldValues, department_approval_state: '—', division_approval_state: '—' },
    });
  }
  campaign(id: string) { return this.campaignsSource.findById(id); }
  approval(id: string) { return this.approvalSource.facts(id); }

  async contracts(): Promise<GuestContractRow[]> {
    const rows = await this.db.supplyContract.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 1000,
      select: { id: true, code: true, name: true, number: true, vendor: true, supplyType: true, status: true, startDate: true, endDate: true } });
    return rows.map(row => ({ ...row, startDate: day(row.startDate), endDate: day(row.endDate) }));
  }

  async bookings(): Promise<GuestBookingRow[]> {
    const rows = await this.db.bookingRecord.findMany({ where: { deletedAt: null, contract: { deletedAt: null }, OR: [
      { campaignId: null }, { campaign: { is: { ...publicCampaign, sharing: { is: { mode: 'PUBLIC', publicTabs: { has: 'planning' } } } } } },
    ] }, orderBy: { updatedAt: 'desc' }, take: 2000,
      select: { id: true, campaignId: true, campaignLabel: true, startDate: true, endDate: true, state: true, reportState: true,
        contract: { select: { code: true, name: true } }, slot: { select: { name: true } } } });
    return rows.map(row => ({ id: row.id, campaignLabel: row.campaignId ? row.campaignLabel : '—', contractCode: row.contract.code,
      contractName: row.contract.name, slotName: row.slot.name, startDate: day(row.startDate)!, endDate: day(row.endDate)!, state: row.state, reportState: row.reportState }));
  }

  async materials(): Promise<GuestMaterialRow[]> {
    const rows = await this.db.materialRecord.findMany({ where: { isDeleted: false, sharingMode: 'SHARED' }, orderBy: { updatedAt: 'desc' }, take: 2000,
      select: { id: true, materialId: true, data: true, updatedAt: true } });
    return rows.map(row => ({ id: row.id, materialId: row.materialId, title: field(row.data, 'material_name'),
      group: field(row.data, 'material_group'), type: field(row.data, 'material_type'), campaign: '—',
      status: field(row.data, 'status'), updatedAt: row.updatedAt.toISOString() }));
  }

  async plans(): Promise<GuestPlanRow[]> {
    const rows = await this.db.campaign.findMany({ where: { ...publicCampaign, sharing: { is: { mode: 'PUBLIC', publicTabs: { has: 'planning' } } } }, orderBy: { name: 'asc' }, take: 500,
      select: { id: true, code: true, name: true, qcttPlan: { select: { campaignId: true } } } });
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, hasPlan: Boolean(row.qcttPlan) }));
  }
}
