import type { ActorContext, CampaignShareSettings, MaterialSummary, SharedCampaign } from '@cpms/domain';

export interface CampaignShareSpreadsheetRecord { id: string; exportedAt: Date; sharingVersion: number }

export abstract class CampaignSharingRepository {
  abstract spreadsheet(id: string): Promise<CampaignShareSpreadsheetRecord | null>;
  abstract saveSpreadsheet(id: string, value: CampaignShareSpreadsheetRecord, actor: ActorContext, viewerEmail?: string): Promise<void>;
  abstract subject(id: string): Promise<{ ownerId: string; settings: CampaignShareSettings } | null>;
  abstract save(id: string, before: CampaignShareSettings, after: CampaignShareSettings, actor: ActorContext): Promise<void>;
  abstract materials(id: string, code: string, name: string, publicOnly: boolean): Promise<MaterialSummary[]>;
  abstract driveUrl(id: string): Promise<string | null>;
  abstract planning(id: string): Promise<NonNullable<SharedCampaign['planning']>>;
}
