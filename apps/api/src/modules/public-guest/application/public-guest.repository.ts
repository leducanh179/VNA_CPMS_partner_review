import type { CampaignSummary } from '@cpms/domain';
import type { WorkflowFacts } from '../../campaign-workflow/application/campaign-workflow.repository';

export interface GuestContractRow {
  id: string; code: string; name: string; number: string | null; vendor: string | null;
  supplyType: string; status: string; startDate: string | null; endDate: string | null;
}
export interface GuestBookingRow {
  id: string; campaignLabel: string; contractCode: string; contractName: string; slotName: string;
  startDate: string; endDate: string; state: string; reportState: string;
}
export interface GuestMaterialRow {
  id: string; materialId: string; title: string; group: string; type: string;
  campaign: string; status: string; updatedAt: string;
}
export interface GuestPlanRow { id: string; code: string; name: string; hasPlan: boolean }

/** Read-only source boundary. Public DTOs are constructed separately by the Application Service. */
export abstract class PublicGuestRepository {
  abstract campaigns(): Promise<CampaignSummary[]>;
  abstract campaign(id: string): Promise<CampaignSummary | null>;
  abstract approval(id: string): Promise<WorkflowFacts | null>;
  abstract contracts(): Promise<GuestContractRow[]>;
  abstract bookings(): Promise<GuestBookingRow[]>;
  abstract materials(): Promise<GuestMaterialRow[]>;
  abstract plans(): Promise<GuestPlanRow[]>;
}
