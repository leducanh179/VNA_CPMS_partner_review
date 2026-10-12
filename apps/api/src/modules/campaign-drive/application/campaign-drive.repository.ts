import type {
  ActorContext,
  CampaignDriveAccessMode,
  CampaignDriveLifecycleStatus,
  CampaignDriveSharingMode,
  CampaignDriveSyncStatus,
} from '@cpms/domain';

export interface CampaignDriveWorkspaceRecord {
  campaignId: string;
  sharedDriveId: string;
  parentFolderId: string;
  campaignFolderId: string | null;
  campaignFolderLink: string | null;
  lastKnownFolderName: string | null;
  baseDocumentsFolderId: string | null;
  mediaAssetsFolderId: string | null;
  otherDocumentsFolderId: string | null;
  templateVersion: number;
  accessMode: CampaignDriveAccessMode;
  sharingMode: CampaignDriveSharingMode;
  permissionPolicyVersion?: number;
  syncStatus: CampaignDriveSyncStatus;
  lifecycleStatus: CampaignDriveLifecycleStatus;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  googlePermissionId: string | null;
  desiredRole: string | null;
  permissionSyncStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignDriveRepository {
  get(campaignId: string): Promise<CampaignDriveWorkspaceRecord | null>;
  findByFolderId(folderId: string): Promise<CampaignDriveWorkspaceRecord | null>;
  save(record: Omit<CampaignDriveWorkspaceRecord, 'createdAt' | 'updatedAt'>): Promise<CampaignDriveWorkspaceRecord>;
  recordAudit(actor: ActorContext, campaignId: string, action: string, payload: Record<string, unknown>): Promise<void>;
}

export const CAMPAIGN_DRIVE_REPOSITORY = Symbol('CAMPAIGN_DRIVE_REPOSITORY');
