import type {
  ActorContext,
  CampaignBatchResult,
  CampaignBatchSaveItem,
  CampaignLifecycleState,
  CampaignDeleteResult,
  CampaignSummary,
  CampaignSpreadsheetExportRequest,
  CampaignSpreadsheetExportResult,
  CampaignSpreadsheetFile,
  CampaignSpreadsheetImportRequest,
  CampaignSpreadsheetImportResult,
  CampaignSpreadsheetInspectResult,
  CampaignSpreadsheetPreviewRequest,
  CampaignSpreadsheetPreviewResult,
  CampaignSpreadsheetCompareRequest,
  CampaignSpreadsheetComparisonResult,
  GoogleIntegrationStatus,
  CampaignDriveFileItem,
  CampaignDriveFilePage,
  CampaignDriveFolderKey,
  CampaignDriveFileStatus,
  CampaignDriveUploadResult,
  CampaignDriveWorkspaceView,
  CampaignCommentItem,
  CampaignCommentPage,
  CampaignCommentReactionSummary,
  CampaignCommentReactionType,
  CampaignJournalPage,
  GoogleSheetImportRequest,
  GoogleSheetPreviewResponse,
  GoogleSheetResultTab,
  GoogleSheetResultTabRequest,
  GoogleSheetSourceRequest,
  GoogleSpreadsheetMetadata,
  CampaignLevelCatalogItem,
  CampaignObjectiveCatalogItem,
  ContentPillarCatalogItem,
  CreateCampaignCommand,
  MarketRegionCatalogResponse,
  MaterialBatchResult,
  MaterialBatchSaveItem,
  MaterialBulkAction,
  MaterialBulkActionItem,
  MaterialPortalBootstrap,
  MaterialCommentItem,
  MaterialJournalItem,
  MaterialSummary,
  OrganizationUnitCatalogItem,
  PersonnelDirectoryCatalogItem,
  ProvinceCatalogItem,
  SimilarCampaignSummary,
  UpdateCampaignCommand,
} from '@cpms/domain';
import { csrfHeader, currentIdentityEpoch, identityTransitionInProgress, signalSessionExpired, trackIdentityRequest, trackIdentityUpload } from './identity-network';

export interface SystemStatus {
  service: string;
  version: string;
  status: 'ok';
  database: { status: 'connected'; engine: 'postgresql'; runtime: 'DOCKER' | 'EXTERNAL' };
  auth: { mode: 'OPEN_DEMO' | 'LOCAL_SESSION'; actor: ActorContext };
  ai: { mode: 'OFF' | 'MOCK'; provider: string };
  checkedAt: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
export const CAMPAIGN_LIST_PATH = '/campaigns';
export const MATERIAL_LIST_PATH = '/materials';

interface ApiErrorPayload {
  message?: string | string[];
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (identityTransitionInProgress() && !path.startsWith('/auth/')) throw new Error('Đang thay đổi phiên CPMS.');
  const epoch = currentIdentityEpoch();
  const controller = new AbortController();
  const untrack = trackIdentityRequest(controller);
  const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
  try {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal, credentials: 'include', cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes((init?.method ?? 'GET').toUpperCase()) ? { 'x-cpms-csrf': csrfHeader() } : {}),
      ...init?.headers,
    },
  });
  if (epoch !== currentIdentityEpoch()) throw new DOMException('Phiên đã thay đổi.', 'AbortError');
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    const detail = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
    if (response.status === 401 && !path.startsWith('/auth/')) signalSessionExpired();
    throw new Error(detail || `API request failed (${response.status}).`);
  }
  const payload = await response.json() as T;
  if (epoch !== currentIdentityEpoch()) throw new DOMException('Phiên đã thay đổi.', 'AbortError');
  return payload;
  } finally { untrack(); }
}

export function getSystemStatus() {
  return requestJson<SystemStatus>('/system/status');
}

export function getCampaigns(includeTrash = false) {
  return requestJson<CampaignSummary[]>(`${CAMPAIGN_LIST_PATH}${includeTrash ? '?trash=true' : ''}`);
}

export function getCampaign(id: string) {
  return requestJson<CampaignSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(id)}`);
}

export function createCampaign(command: CreateCampaignCommand) {
  return requestJson<CampaignSummary>(CAMPAIGN_LIST_PATH, {
    method: 'POST',
    body: JSON.stringify(command),
  });
}

export function updateCampaign(id: string, command: UpdateCampaignCommand) {
  return requestJson<CampaignSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(command),
  });
}

export function findSimilarCampaigns(query: string, excludeId?: string) {
  const parameters = new URLSearchParams({ query });
  if (excludeId) parameters.set('excludeId', excludeId);
  return requestJson<SimilarCampaignSummary[]>(`${CAMPAIGN_LIST_PATH}/similar?${parameters.toString()}`);
}

export function getCampaignLevels() {
  return requestJson<CampaignLevelCatalogItem[]>('/catalogs/campaign-levels');
}

export function getCampaignObjectives() {
  return requestJson<CampaignObjectiveCatalogItem[]>('/catalogs/campaign-objectives');
}

export function getMarketRegions() {
  return requestJson<MarketRegionCatalogResponse>('/catalogs/market-regions');
}

export function getProvinces() {
  return requestJson<ProvinceCatalogItem[]>('/catalogs/provinces');
}

export function getOrganizationUnits(query = '', foreignBranchesOnly = false) {
  const parameters = new URLSearchParams();
  if (query) parameters.set('query', query);
  if (foreignBranchesOnly) parameters.set('foreignBranches', 'true');
  const suffix = parameters.size ? `?${parameters.toString()}` : '';
  return requestJson<OrganizationUnitCatalogItem[]>(`/catalogs/organization-units${suffix}`);
}

export function getPersonnel(query = '') {
  const parameters = new URLSearchParams();
  if (query) parameters.set('query', query);
  const suffix = parameters.size ? `?${parameters.toString()}` : '';
  return requestJson<PersonnelDirectoryCatalogItem[]>(`/catalogs/personnel${suffix}`);
}

export function getContentPillars(year = 2026) {
  return requestJson<ContentPillarCatalogItem[]>(`/catalogs/content-pillars?year=${year}`);
}

export function batchSaveCampaigns(items: CampaignBatchSaveItem[]) {
  return requestJson<CampaignBatchResult>(`${CAMPAIGN_LIST_PATH}/batch-save`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export function bulkTransitionCampaigns(ids: string[], lifecycleState: CampaignLifecycleState) {
  return requestJson<CampaignBatchResult>(`${CAMPAIGN_LIST_PATH}/bulk-transition`, {
    method: 'POST',
    body: JSON.stringify({ ids, lifecycleState }),
  });
}

export function exportCampaignSpreadsheet(command: CampaignSpreadsheetExportRequest) {
  return requestJson<CampaignSpreadsheetExportResult>(`${CAMPAIGN_LIST_PATH}/spreadsheet/export`, {
    method: 'POST', body: JSON.stringify(command),
  });
}

export function inspectCampaignSpreadsheet(file: CampaignSpreadsheetFile) {
  return requestJson<CampaignSpreadsheetInspectResult>(`${CAMPAIGN_LIST_PATH}/spreadsheet/inspect`, {
    method: 'POST', body: JSON.stringify(file),
  });
}

export function previewCampaignSpreadsheet(command: CampaignSpreadsheetPreviewRequest) {
  return requestJson<CampaignSpreadsheetPreviewResult>(`${CAMPAIGN_LIST_PATH}/spreadsheet/preview`, {
    method: 'POST', body: JSON.stringify(command),
  });
}

export function importCampaignSpreadsheet(command: CampaignSpreadsheetImportRequest) {
  return requestJson<CampaignSpreadsheetImportResult>(`${CAMPAIGN_LIST_PATH}/spreadsheet/import`, {
    method: 'POST', body: JSON.stringify(command),
  });
}

export function getGoogleIntegrationStatus() {
  return requestJson<GoogleIntegrationStatus>('/integrations/google/status');
}

export interface SharedDriveIntegrationStatus {
  configured: boolean;
  connected: boolean;
  account: { email: string; name?: string | null } | null;
  grantedScopes: string[];
  message: string | null;
}

export function getSharedDriveIntegrationStatus() {
  return requestJson<SharedDriveIntegrationStatus>('/integrations/google/drive/status');
}

export function connectSharedDriveIntegration() {
  return requestJson<{ authorizationUrl: string }>('/integrations/google/drive/connect', { method: 'POST' });
}

export function connectGoogleIntegration(returnTo?: string) {
  const suffix = returnTo ? `?${new URLSearchParams({ returnTo }).toString()}` : '';
  return requestJson<{ authorizationUrl: string }>(`/integrations/google/connect${suffix}`, { method: 'POST' });
}

export function getCampaignDriveWorkspace(campaignId: string) {
  return requestJson<CampaignDriveWorkspaceView>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace`);
}

export function ensureCampaignDriveWorkspace(campaignId: string) {
  return requestJson<CampaignDriveWorkspaceView>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/ensure`, { method: 'POST' });
}

export interface ExistingCampaignDriveFolderPreview {
  folderId: string;
  folderUrl: string;
  currentName: string;
  expectedName: string;
  willRename: boolean;
}

export function previewExistingCampaignDriveFolder(campaignId: string, folderUrl: string) {
  return requestJson<ExistingCampaignDriveFolderPreview>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/existing-folder/preview`, {
    method: 'POST', body: JSON.stringify({ folderUrl }),
  });
}

export function adoptExistingCampaignDriveFolder(campaignId: string, preview: ExistingCampaignDriveFolderPreview) {
  return requestJson<CampaignDriveWorkspaceView>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/existing-folder/adopt`, {
    method: 'POST', body: JSON.stringify({ folderUrl: preview.folderUrl, expectedCurrentName: preview.currentName, confirmRename: true }),
  });
}

export function syncCampaignDriveWorkspaceName(campaignId: string) {
  return requestJson<CampaignDriveWorkspaceView>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/sync-name`, { method: 'POST' });
}

export function listCampaignDriveFiles(campaignId: string, folderKind: CampaignDriveFolderKey, status: CampaignDriveFileStatus, pageToken?: string) {
  const parameters = new URLSearchParams({ folderKind, status });
  if (pageToken) parameters.set('pageToken', pageToken);
  return requestJson<CampaignDriveFilePage>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/files?${parameters.toString()}`);
}

export function renameCampaignDriveFile(campaignId: string, fileId: string, name: string) {
  return requestJson<CampaignDriveFileItem>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/files/${encodeURIComponent(fileId)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function trashCampaignDriveFile(campaignId: string, fileId: string) {
  return requestJson<CampaignDriveFileItem>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/files/${encodeURIComponent(fileId)}/trash`, { method: 'POST' });
}

export function restoreCampaignDriveFile(campaignId: string, fileId: string) {
  return requestJson<CampaignDriveFileItem>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/files/${encodeURIComponent(fileId)}/restore`, { method: 'POST' });
}

export function uploadCampaignDriveFile(
  campaignId: string,
  folderKey: CampaignDriveFolderKey,
  file: File,
  onProgress: (percent: number) => void,
) {
  if (identityTransitionInProgress()) throw new Error('Đang thay đổi phiên CPMS.');
  const epoch = currentIdentityEpoch();
  const request = new XMLHttpRequest();
  const untrack = trackIdentityUpload(request);
  request.addEventListener('loadend', untrack);
  const promise = new Promise<CampaignDriveUploadResult>((resolve, reject) => {
    request.open('POST', `${API_BASE_URL}${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/drive-workspace/uploads`);
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('x-cpms-csrf', csrfHeader());
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      if (epoch !== currentIdentityEpoch()) { reject(new DOMException('Phiên đã thay đổi.', 'AbortError')); return; }
      if (request.status === 401) signalSessionExpired();
      const payload = (() => { try { return JSON.parse(request.responseText) as ApiErrorPayload & CampaignDriveUploadResult; } catch { return null; } })();
      if (request.status >= 200 && request.status < 300 && payload) resolve(payload as CampaignDriveUploadResult);
      else {
        const detail = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
        reject(new Error(detail || `API request failed (${request.status}).`));
      }
    });
    request.addEventListener('error', () => reject(new Error('Mất kết nối khi tải file lên Google Drive.')));
    request.addEventListener('abort', () => reject(new DOMException('Đã hủy tải file.', 'AbortError')));
    const body = new FormData();
    body.append('folderKey', folderKey);
    body.append('file', file, file.name);
    request.send(body);
  });
  return { promise, cancel: () => request.abort() };
}

export function disconnectGoogleIntegration() {
  return requestJson<{ disconnected: boolean; revoked: boolean }>('/integrations/google/disconnect', { method: 'POST' });
}

export function inspectGoogleSpreadsheet(spreadsheetUrl: string) {
  return requestJson<GoogleSpreadsheetMetadata>('/integrations/google/spreadsheets/inspect', { method: 'POST', body: JSON.stringify({ spreadsheetUrl }) });
}

export function previewGoogleSpreadsheet(command: GoogleSheetSourceRequest) {
  return requestJson<GoogleSheetPreviewResponse>('/integrations/google/spreadsheets/preview', { method: 'POST', body: JSON.stringify(command) });
}

export function importGoogleSpreadsheet(command: GoogleSheetImportRequest) {
  return requestJson<CampaignSpreadsheetImportResult>('/integrations/google/spreadsheets/import', { method: 'POST', body: JSON.stringify(command) });
}

export function compareGoogleSpreadsheet(command: CampaignSpreadsheetCompareRequest) {
  return requestJson<CampaignSpreadsheetComparisonResult>('/integrations/google/spreadsheets/compare', { method: 'POST', body: JSON.stringify(command) });
}

export function createGoogleDiffTab(command: GoogleSheetResultTabRequest) {
  return requestJson<GoogleSheetResultTab>('/integrations/google/spreadsheets/tabs/diff', { method: 'POST', body: JSON.stringify(command) });
}

export function createGoogleSyncTab(command: GoogleSheetResultTabRequest) {
  return requestJson<GoogleSheetResultTab>('/integrations/google/spreadsheets/tabs/sync', { method: 'POST', body: JSON.stringify(command) });
}

export function moveCampaignToTrash(id: string) {
  return requestJson<CampaignSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(id)}/trash`, { method: 'POST' });
}

export function restoreCampaign(id: string) {
  return requestJson<CampaignSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export function deleteCampaignPermanently(id: string) {
  return requestJson<CampaignDeleteResult>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getCampaignComments(input: { campaignId?: string; page?: number; pageSize?: number }) {
  const parameters = new URLSearchParams();
  if (input.campaignId) parameters.set('campaignId', input.campaignId);
  parameters.set('page', String(input.page ?? 1));
  parameters.set('pageSize', String(input.pageSize ?? 10));
  return requestJson<CampaignCommentPage>(`/campaign-comments?${parameters.toString()}`);
}

export function createCampaignComment(campaignId: string, body: string, replyToCommentId?: string) {
  return requestJson<CampaignCommentItem>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, ...(replyToCommentId ? { replyToCommentId } : {}) }),
  });
}

export function updateCampaignComment(campaignId: string, commentId: string, body: string, expectedVersion: number) {
  return requestJson<CampaignCommentItem>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH', body: JSON.stringify({ body, expectedVersion }),
  });
}

export function deleteCampaignComment(campaignId: string, commentId: string, expectedVersion: number) {
  const parameters = new URLSearchParams({ expectedVersion: String(expectedVersion) });
  return requestJson<{ deleted: boolean; id: string; recordVersion?: number }>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/comments/${encodeURIComponent(commentId)}?${parameters.toString()}`, { method: 'DELETE' });
}

export function setCampaignCommentReaction(campaignId: string, commentId: string, type: CampaignCommentReactionType) {
  return requestJson<CampaignCommentReactionSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/comments/${encodeURIComponent(commentId)}/reaction`, {
    method: 'PUT', body: JSON.stringify({ type }),
  });
}

export function removeCampaignCommentReaction(campaignId: string, commentId: string) {
  return requestJson<CampaignCommentReactionSummary>(`${CAMPAIGN_LIST_PATH}/${encodeURIComponent(campaignId)}/comments/${encodeURIComponent(commentId)}/reaction`, { method: 'DELETE' });
}

export function getCampaignJournal(input: { campaignId?: string; actorId?: string; action?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') parameters.set(key, String(value));
  if (!parameters.has('page')) parameters.set('page', '1');
  if (!parameters.has('pageSize')) parameters.set('pageSize', '10');
  return requestJson<CampaignJournalPage>(`/campaign-journal?${parameters.toString()}`);
}

export function getMaterials(includeTrash = false) {
  return requestJson<MaterialSummary[]>(`${MATERIAL_LIST_PATH}${includeTrash ? '?trash=true' : ''}`);
}

export function getMaterialBootstrap() {
  return requestJson<MaterialPortalBootstrap>(`${MATERIAL_LIST_PATH}/bootstrap`);
}

export function getMaterialComments(materialId: string) {
  return requestJson<MaterialCommentItem[]>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}/comments`);
}

export function getMaterialJournal(materialId: string) {
  return requestJson<MaterialJournalItem[]>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}/journal`);
}

export function createMaterialComment(materialId: string, body: string, parentId?: string) {
  return requestJson<MaterialCommentItem>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}/comments`, { method: 'POST', body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) }) });
}

export function updateMaterialComment(materialId: string, commentId: string, body: string, expectedVersion: number) {
  return requestJson<MaterialCommentItem>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: JSON.stringify({ body, expectedVersion }) });
}

export function deleteMaterialComment(materialId: string, commentId: string, expectedVersion: number) {
  return requestJson<MaterialCommentItem>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}/comments/${encodeURIComponent(commentId)}?expectedVersion=${expectedVersion}`, { method: 'DELETE' });
}

export function batchSaveMaterials(items: MaterialBatchSaveItem[]) {
  return requestJson<MaterialBatchResult>(`${MATERIAL_LIST_PATH}/batch-save`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export function bulkMaterialAction(items: MaterialBulkActionItem[], action: MaterialBulkAction, reason?: string) {
  return requestJson<MaterialBatchResult>(`${MATERIAL_LIST_PATH}/bulk-action`, {
    method: 'POST',
    body: JSON.stringify({ items, action, ...(reason ? { reason } : {}) }),
  });
}

export function purgeMaterial(materialId: string, expectedVersion: number) {
  return requestJson<{ materialId: string; deleted: true }>(`${MATERIAL_LIST_PATH}/${encodeURIComponent(materialId)}?expectedVersion=${expectedVersion}`, { method: 'DELETE' });
}

export type { CampaignLifecycleState };
