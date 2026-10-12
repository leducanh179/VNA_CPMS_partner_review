export const CAMPAIGN_DRIVE_FOLDER_KEYS = ['BASE_DOCUMENTS', 'MEDIA_ASSETS', 'OTHER_DOCUMENTS'] as const;
export type CampaignDriveFolderKey = (typeof CAMPAIGN_DRIVE_FOLDER_KEYS)[number];

export const CAMPAIGN_DRIVE_FILE_STATUSES = ['ACTIVE', 'TRASHED'] as const;
export type CampaignDriveFileStatus = (typeof CAMPAIGN_DRIVE_FILE_STATUSES)[number];

export const CAMPAIGN_DRIVE_ACCESS_MODES = ['CPMS_VISIBILITY_ONLY', 'DRIVE_ACL_SYNC'] as const;
export type CampaignDriveAccessMode = (typeof CAMPAIGN_DRIVE_ACCESS_MODES)[number];

export const CAMPAIGN_DRIVE_SHARING_MODES = ['PARENT_INHERITED', 'LINK_WRITER', 'DRIVE_ACL'] as const;
export type CampaignDriveSharingMode = (typeof CAMPAIGN_DRIVE_SHARING_MODES)[number];

export const CAMPAIGN_DRIVE_SYNC_STATUSES = [
  'NOT_CREATED', 'CREATING', 'READY', 'NEEDS_SYNC', 'CONFLICT',
  'PERMISSION_SETUP_REQUIRED', 'OUT_OF_SYNC', 'ERROR',
] as const;
export type CampaignDriveSyncStatus = (typeof CAMPAIGN_DRIVE_SYNC_STATUSES)[number];

export const CAMPAIGN_DRIVE_LIFECYCLE_STATUSES = [
  'ACTIVE', 'TRASHED', 'TRASH_FAILED', 'RESTORE_FAILED', 'MISSING',
] as const;
export type CampaignDriveLifecycleStatus = (typeof CAMPAIGN_DRIVE_LIFECYCLE_STATUSES)[number];

export interface CampaignDriveFolderView {
  key: CampaignDriveFolderKey;
  label: string;
  available: boolean;
}

export interface CampaignDriveWorkspaceView {
  capabilities?: Partial<Record<'read' | 'ensure' | 'upload' | 'rename' | 'trash' | 'restore', boolean>>;
  providerWritesEnabled?: boolean;
  canConnectGoogle?: boolean;
  canViewDriveWorkspace: boolean;
  canManageDriveWorkspace: boolean;
  configured: boolean;
  googleConnected: boolean;
  googleAccountEmail: string | null;
  needsReconsent: boolean;
  syncStatus: CampaignDriveSyncStatus;
  lifecycleStatus: CampaignDriveLifecycleStatus;
  accessMode: CampaignDriveAccessMode;
  sharingMode: CampaignDriveSharingMode;
  campaignFolderName: string | null;
  expectedFolderName: string;
  campaignFolderLink: string | null;
  nameMismatch: boolean;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  folders: CampaignDriveFolderView[];
}

export interface CampaignDriveFileItem {
  id: string;
  name: string;
  folderKind: CampaignDriveFolderKey;
  folderLabel: string;
  status: CampaignDriveFileStatus;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  lastModifiedBy: string | null;
  trashedAt: string | null;
  trashedBy: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  canEdit: boolean;
  canTrash: boolean;
  canUntrash: boolean;
  canDownload: boolean;
}

export interface CampaignDriveFilePage {
  items: CampaignDriveFileItem[];
  nextPageToken: string | null;
}

export interface CampaignDriveUploadResult {
  file: CampaignDriveFileItem;
  uploadMode: 'MULTIPART' | 'RESUMABLE';
}

export interface CampaignDriveRenameFileCommand {
  name: string;
}
