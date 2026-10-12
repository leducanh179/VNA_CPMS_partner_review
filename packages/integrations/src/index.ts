export interface ExternalReference {
  externalId: string;
  url: string;
}

export interface CampaignWorkspacePort {
  provisionWorkspace(campaignCode: string, campaignName: string): Promise<ExternalReference>;
}

export interface ContractSystemPort {
  getContractReference(contractCode: string): Promise<ExternalReference | null>;
}

export interface EmployeeDirectoryPort {
  findEmployee(employeeCode: string): Promise<{
    employeeCode: string;
    displayName: string;
    email: string;
  } | null>;
}

export interface TabularSheetData {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
}

export interface TabularWorkbookData {
  sheets: TabularSheetData[];
}

export interface SpreadsheetDocumentPort {
  read(input: { fileName: string; mimeType?: string; content: Uint8Array }): Promise<TabularWorkbookData>;
  write(input: TabularWorkbookData): Promise<Uint8Array>;
}

export const SPREADSHEET_DOCUMENT_PORT = Symbol('SPREADSHEET_DOCUMENT_PORT');

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  grantedScopes: string[];
}

export interface OAuthIdentity {
  subject: string;
  email: string;
  name: string | null;
}

export interface UserOAuthPort {
  authorizationUrl(input: { clientId: string; callbackUrl: string; state: string; scopes: readonly string[] }): string;
  exchangeCode(input: { clientId: string; clientSecret: string; callbackUrl: string; code: string }): Promise<OAuthTokenSet>;
  refresh(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<OAuthTokenSet>;
  identity(accessToken: string): Promise<OAuthIdentity>;
  revoke(token: string): Promise<boolean>;
}

export interface CloudSpreadsheetTab {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface CloudSpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  canEdit: boolean | null;
  tabs: CloudSpreadsheetTab[];
}

export interface CloudSpreadsheetResultTab {
  sheetId: number;
  title: string;
}

export interface CloudSpreadsheetPort {
  metadata(accessToken: string, spreadsheetId: string): Promise<CloudSpreadsheetMetadata>;
  readTab(accessToken: string, spreadsheetId: string, tabTitle: string): Promise<TabularSheetData>;
  createTab(input: {
    accessToken: string;
    spreadsheetId: string;
    title: string;
    rows: TabularSheetData['rows'];
  }): Promise<CloudSpreadsheetResultTab>;
}

export const USER_OAUTH_PORT = Symbol('USER_OAUTH_PORT');
export const CLOUD_SPREADSHEET_PORT = Symbol('CLOUD_SPREADSHEET_PORT');

export interface CloudDriveCapabilities {
  canEdit: boolean;
  canTrash: boolean;
  canUntrash: boolean;
  canMoveItemWithinDrive: boolean;
  canDownload: boolean;
  canAddChildren: boolean;
  canShare: boolean;
}

export interface CloudDriveItem {
  id: string;
  name: string;
  mimeType: string;
  driveId: string | null;
  parents: string[];
  trashed: boolean;
  size: number | null;
  modifiedTime: string | null;
  lastModifiedBy: string | null;
  trashedTime: string | null;
  trashedBy: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  capabilities: CloudDriveCapabilities;
}

export interface CloudDrivePermission {
  id: string;
  type: string;
  role: string;
  allowFileDiscovery: boolean | null;
  inherited: boolean;
}

export interface CloudDrivePage {
  items: CloudDriveItem[];
  nextPageToken: string | null;
}

export interface CloudDriveUpload {
  item: CloudDriveItem;
  mode: 'MULTIPART' | 'RESUMABLE';
}

export interface CloudDrivePort {
  getItem(accessToken: string, fileId: string): Promise<CloudDriveItem>;
  findFolders(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; nameContains?: string; exactName?: string }): Promise<CloudDriveItem[]>;
  createFolder(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string }): Promise<CloudDriveItem>;
  renameItem(input: { accessToken: string; fileId: string; name: string }): Promise<CloudDriveItem>;
  setTrashed(input: { accessToken: string; fileId: string; trashed: boolean }): Promise<CloudDriveItem>;
  moveItem(input: { accessToken: string; fileId: string; fromParentIds: string[]; toParentId: string }): Promise<CloudDriveItem>;
  listFiles(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; trashed: boolean; pageSize: number; pageToken?: string }): Promise<CloudDrivePage>;
  listPermissions(accessToken: string, fileId: string): Promise<CloudDrivePermission[]>;
  createLinkWriterPermission(accessToken: string, fileId: string): Promise<CloudDrivePermission>;
  upload(input: { accessToken: string; sharedDriveId: string; parentFolderId: string; name: string; mimeType: string; content: Uint8Array; resumableThresholdBytes: number }): Promise<CloudDriveUpload>;
}

export const CLOUD_DRIVE_PORT = Symbol('CLOUD_DRIVE_PORT');

export class DisabledCampaignWorkspaceAdapter implements CampaignWorkspacePort {
  async provisionWorkspace(): Promise<ExternalReference> {
    throw new Error('Campaign workspace integration is disabled.');
  }
}

export class DisabledContractSystemAdapter implements ContractSystemPort {
  async getContractReference(): Promise<ExternalReference | null> {
    return null;
  }
}

export class DisabledEmployeeDirectoryAdapter implements EmployeeDirectoryPort {
  async findEmployee(): Promise<null> {
    return null;
  }
}
/** Supply consumption is orthogonal to source allocation. A failing provider must reject. */
export interface InventoryConsumptionScope {
  allocationId: string; contractId: string; slotId: string | null; periodStart: string; periodEnd: string; beneficiaryUnitCode: string | null;
}
export interface InventoryConsumptionSample {
  asOf: string; mode: string; source: string;
  values: Record<string, Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', { qty: string | null; amount: string | null }>>;
}
export interface InventoryConsumptionProvider {
  read(scopes: readonly InventoryConsumptionScope[], asOf: string): Promise<InventoryConsumptionSample>;
}
export const INVENTORY_CONSUMPTION_PROVIDER = Symbol('INVENTORY_CONSUMPTION_PROVIDER');
export * from './personnel-directory';
