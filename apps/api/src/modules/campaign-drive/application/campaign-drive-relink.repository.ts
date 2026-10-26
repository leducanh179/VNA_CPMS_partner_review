import type { ActorContext } from '@cpms/domain';

export type CampaignDriveRelinkStatus = 'PENDING' | 'APPLYING' | 'FAILED' | 'APPLIED' | 'REJECTED' | 'WITHDRAWN';

export interface CampaignDriveRelinkRecord {
  id: string;
  campaignId: string;
  sourceFolderId: string;
  sourceFolderLink: string;
  sourceFolderName: string;
  targetFolderId: string;
  targetFolderLink: string;
  targetFolderName: string;
  expectedFolderName: string;
  reason: string;
  status: CampaignDriveRelinkStatus;
  requestedByActorId: string;
  requestedAt: Date;
  decidedByActorId: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  lastError: string | null;
  recordVersion: number;
}

export interface CreateCampaignDriveRelink {
  campaignId: string;
  sourceFolderId: string;
  sourceFolderLink: string;
  sourceFolderName: string;
  targetFolderId: string;
  targetFolderLink: string;
  targetFolderName: string;
  expectedFolderName: string;
  reason: string;
  requestedByActorId: string;
}

export abstract class CampaignDriveRelinkRepository {
  abstract listPending(campaignIds: string[]): Promise<CampaignDriveRelinkRecord[]>;
  abstract list(campaignId: string): Promise<CampaignDriveRelinkRecord[]>;
  abstract get(id: string): Promise<CampaignDriveRelinkRecord | null>;
  abstract create(input: CreateCampaignDriveRelink): Promise<CampaignDriveRelinkRecord>;
  abstract transition(id: string, from: CampaignDriveRelinkStatus, expectedVersion: number, to: CampaignDriveRelinkStatus,
    update: { decidedByActorId?: string; decisionReason?: string; decidedAt?: Date; lastError?: string | null }): Promise<boolean>;
  abstract finish(request: CampaignDriveRelinkRecord, actor: ActorContext): Promise<boolean>;
  abstract findOtherCampaignHistory(folderId: string, campaignId: string): Promise<boolean>;
}
