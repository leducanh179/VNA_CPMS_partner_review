import type {
  CampaignSpreadsheetFieldKey,
  CampaignSpreadsheetImportDecision,
  CampaignSpreadsheetMapping,
  CampaignSpreadsheetPreviewResult,
  CampaignSpreadsheetValue,
} from './campaign-spreadsheet';

export const GOOGLE_SHEETS_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
] as const;

export interface GoogleSpreadsheetReference {
  spreadsheetId: string;
  gid: number | null;
  canonicalUrl: string;
}

export function parseGoogleSpreadsheetUrl(value: string): GoogleSpreadsheetReference | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
    const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(url.pathname);
    if (!match?.[1]) return null;
    const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gidText = url.searchParams.get('gid') ?? hashParameters.get('gid');
    const gid = gidText && /^\d+$/.test(gidText) ? Number(gidText) : null;
    if (gid !== null && !Number.isSafeInteger(gid)) return null;
    return {
      spreadsheetId: match[1],
      gid,
      canonicalUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/edit${gid === null ? '' : `#gid=${gid}`}`,
    };
  } catch {
    return null;
  }
}

export interface GoogleConnectionAccount {
  subject: string;
  email: string;
  name: string | null;
}

export interface GoogleIntegrationStatus {
  providerWritesEnabled?: boolean;
  canConnectGoogle?: boolean;
  canDisconnectGoogle?: boolean;
  canReadSheets?: boolean;
  canWriteSheets?: boolean;
  configured: boolean;
  connected: boolean;
  callbackUrl: string | null;
  account: GoogleConnectionAccount | null;
  grantedScopes: string[];
  message: string | null;
}

export interface GoogleSpreadsheetTab {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface GoogleSpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  canonicalUrl: string;
  canEdit: boolean | null;
  tabs: GoogleSpreadsheetTab[];
}

export interface GoogleSheetSourceRequest {
  spreadsheetUrl: string;
  sheetName: string;
  mapping?: CampaignSpreadsheetMapping[];
  selectedRows?: number[];
  selectedFieldKeys?: CampaignSpreadsheetFieldKey[];
}

export interface GoogleSheetPreviewResponse {
  spreadsheet: GoogleSpreadsheetMetadata;
  preview: CampaignSpreadsheetPreviewResult;
  sampleRows: Array<Array<string | number | boolean | null>>;
}

export interface GoogleSheetImportRequest extends GoogleSheetSourceRequest {
  decisions: CampaignSpreadsheetImportDecision[];
}

export type CampaignSpreadsheetComparisonStatus = 'SAME' | 'DIFFERENT' | 'ONLY_IN_SHEET' | 'ONLY_IN_CPMS' | 'INVALID';

export interface CampaignSpreadsheetComparisonField {
  fieldKey: CampaignSpreadsheetFieldKey;
  label: string;
  sheetValue: CampaignSpreadsheetValue;
  cpmsValue: CampaignSpreadsheetValue;
  status: CampaignSpreadsheetComparisonStatus;
  note: string | null;
}

export interface CampaignSpreadsheetComparisonRow {
  code: string | null;
  name: string | null;
  sourceRowNumber: number | null;
  campaignId: string | null;
  status: CampaignSpreadsheetComparisonStatus;
  fields: CampaignSpreadsheetComparisonField[];
  errors: string[];
}

export interface CampaignSpreadsheetCompareRequest extends GoogleSheetSourceRequest {
  timeBasis: 'COMMUNICATION' | 'UPDATED_AT';
  dateFrom?: string;
  dateTo?: string;
  includeOnlyOneSide: boolean;
}

export interface CampaignSpreadsheetComparisonResult {
  spreadsheet: GoogleSpreadsheetMetadata;
  rows: CampaignSpreadsheetComparisonRow[];
  counts: Record<CampaignSpreadsheetComparisonStatus, number>;
  selectedFieldKeys: CampaignSpreadsheetFieldKey[];
}

export interface GoogleSheetResultTabRequest extends CampaignSpreadsheetCompareRequest {
  idempotencyKey: string;
}

export interface GoogleSheetResultTab {
  spreadsheetId: string;
  sheetId: number;
  sheetName: string;
  url: string;
  reused: boolean;
}
