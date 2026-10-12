import type { AccessPermission } from './access-policy';

export interface CampaignAccessCapabilities {
  permissions: Partial<Record<AccessPermission, boolean>>;
  editableFields: string[];
  canEditAnyField: boolean;
  fieldReadMasking: false;
}

export interface CampaignApprovalPerson {
  actorId: string;
  displayName: string;
}

export const CAMPAIGN_LIFECYCLE_STATES = [
  'DRAFT',
  'SUBMITTED_TO_DEPARTMENT',
  'DEPARTMENT_ASSIGNED',
  'DIVISION_ASSIGNED',
  'CM_ACCEPTED',
  'PLANNING',
  'READY_TO_LAUNCH',
  'RUNNING',
  'PAUSE_REQUESTED',
  'PAUSED',
  'RESUME_REQUESTED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
  'ARCHIVED',
] as const;

export const CAMPAIGN_LEVEL_CODES = ['CLV_01', 'CLV_02', 'CLV_03'] as const;
export const CAMPAIGN_OBJECTIVE_CODES = [
  'BRAND_IMAGE',
  'SALES_REVENUE',
  'AWARENESS',
  'RECRUITMENT',
  'OTHER',
] as const;
export const CAMPAIGN_MARKET_SELECTION_ORIGINS = ['CUSTOM', 'REGION', 'GLOBAL', 'LEGACY'] as const;
export const CAMPAIGN_NORMALIZATION_STATUSES = ['CURRENT', 'NEEDS_NORMALIZATION'] as const;

export type CampaignLifecycleState = (typeof CAMPAIGN_LIFECYCLE_STATES)[number];
export type CampaignLevelCode = (typeof CAMPAIGN_LEVEL_CODES)[number];
export type CampaignObjectiveCode = (typeof CAMPAIGN_OBJECTIVE_CODES)[number];
export type CampaignMarketSelectionOrigin = (typeof CAMPAIGN_MARKET_SELECTION_ORIGINS)[number];
export type CampaignNormalizationStatus = (typeof CAMPAIGN_NORMALIZATION_STATUSES)[number];

export type CampaignJsonPrimitive = string | number | boolean | null;
export type CampaignJsonValue = CampaignJsonPrimitive | CampaignJsonValue[] | { [key: string]: CampaignJsonValue };
export type CampaignFieldValues = Record<string, CampaignJsonValue>;

export interface CampaignRichTextMark {
  type: 'bold' | 'italic';
}

export interface CampaignRichTextNode {
  type: 'doc' | 'paragraph' | 'bulletList' | 'orderedList' | 'listItem' | 'text' | 'table' | 'tableRow' | 'tableCell' | 'link' | 'image' | 'hardBreak';
  text?: string;
  marks?: CampaignRichTextMark[];
  attrs?: { href?: string; src?: string; alt?: string };
  content?: CampaignRichTextNode[];
}

export interface CampaignRichTextDocument {
  schemaVersion: 1;
  type: 'doc';
  content: CampaignRichTextNode[];
}

export interface CampaignAdditionalInformationItem {
  id: string;
  label: string;
  value: string;
  order: number;
}

export interface CampaignMarketSelection {
  marketCode: string;
  marketName: string;
  regionCode: string;
  selectionOrigin: CampaignMarketSelectionOrigin;
  selectionCode: string | null;
}

export interface CampaignProvinceSelection {
  provinceCode: string;
  provinceName: string;
}

export interface CampaignRequestingUnitSelection {
  id?: string;
  unitCode: string | null;
  displayName: string;
  customName: string | null;
  category: 'QUICK_SELECT' | 'FOREIGN_BRANCH' | 'CUSTOM';
  order: number;
}

export interface CampaignRequestingUnitInput {
  unitCode?: string;
  customName?: string;
}

export interface CampaignNormalizationWarning {
  code: 'MISSING_LEVEL' | 'LEGACY_MARKET' | 'LEGACY_REQUESTING_UNIT' | 'LEGACY_REQUESTER' | 'LEGACY_FIELD_VALUE';
  fieldKey: string;
  message: string;
}

export interface CampaignSummary {
  qcttStatus?: string;
  operationalState?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  pendingChangeLabel?: string;
  approvalStatus?: string;
  departmentApprovers?: CampaignApprovalPerson[];
  divisionApprovers?: CampaignApprovalPerson[];
  access?: CampaignAccessCapabilities;
  id: string;
  code: string;
  name: string;
  requestingUnit: string;
  lifecycleState: CampaignLifecycleState;
  startDate: string | null;
  endDate: string | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  levelCode: CampaignLevelCode | null;
  levelLabel: string | null;
  levelRuleDescription: string | null;
  requestingEmployeeCode: string | null;
  requestingEmployeeName: string | null;
  manualRequesterEmail: string | null;
  primaryObjectiveCode: CampaignObjectiveCode | null;
  primaryObjectiveLabel: string | null;
  primaryObjectiveOther: string | null;
  kpiText: string | null;
  descriptionRichText: CampaignRichTextDocument | null;
  additionalInformation: CampaignAdditionalInformationItem[];
  dataSchemaVersion: number;
  normalizationStatus: CampaignNormalizationStatus;
  normalizationWarnings: CampaignNormalizationWarning[];
  markets: CampaignMarketSelection[];
  provinces: CampaignProvinceSelection[];
  requestingUnits: CampaignRequestingUnitSelection[];
  fieldValues: CampaignFieldValues;
  recordVersion: number;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedByActorId: string | null;
  updatedAt: string;
}

export interface CampaignV2Fields {
  requestingUnit?: string | null;
  lifecycleState?: CampaignLifecycleState;
  startDate?: string | null;
  endDate?: string | null;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  levelCode?: CampaignLevelCode | null;
  requestingEmployeeCode?: string | null;
  manualRequesterEmail?: string | null;
  primaryObjectiveCode?: CampaignObjectiveCode | null;
  primaryObjectiveOther?: string | null;
  kpiText?: string | null;
  descriptionRichText?: CampaignRichTextDocument | null;
  additionalInformation?: CampaignAdditionalInformationItem[];
  marketCodes?: string[];
  provinceCodes?: string[];
  marketSelectionOrigin?: CampaignMarketSelectionOrigin;
  marketSelectionCode?: string | null;
  requestingUnits?: CampaignRequestingUnitInput[];
  fieldValues?: CampaignFieldValues;
}

export interface CreateCampaignCommand extends CampaignV2Fields {
  code?: string;
  name: string;
}

export interface UpdateCampaignCommand extends CampaignV2Fields {
  name?: string;
  expectedVersion?: number;
}

export interface CampaignBatchSaveItem extends UpdateCampaignCommand {
  clientKey: string;
  id?: string;
  code?: string;
}

export interface CampaignBatchItemResult {
  clientKey: string;
  id?: string;
  ok: boolean;
  campaign?: CampaignSummary;
  message?: string;
}

export interface CampaignBatchResult {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  items: CampaignBatchItemResult[];
}

export interface CampaignDeleteResult {
  id: string;
  code: string;
  permanentlyDeleted: boolean;
}

export interface SimilarCampaignSummary {
  id: string;
  code: string;
  name: string;
  lifecycleState: CampaignLifecycleState;
  startDate: string | null;
  endDate: string | null;
  score: number;
}

export function isCampaignLevelCode(value: unknown): value is CampaignLevelCode {
  return typeof value === 'string' && (CAMPAIGN_LEVEL_CODES as readonly string[]).includes(value);
}

export function isCampaignObjectiveCode(value: unknown): value is CampaignObjectiveCode {
  return typeof value === 'string' && (CAMPAIGN_OBJECTIVE_CODES as readonly string[]).includes(value);
}

export function validateCampaignRichText(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Rich text phải là một JSON object.'];
  const document = value as Partial<CampaignRichTextDocument>;
  if (document.schemaVersion !== 1) return ['Rich text schemaVersion phải bằng 1.'];
  if (document.type !== 'doc' || !Array.isArray(document.content)) return ['Rich text root phải là doc có content dạng mảng.'];

  const errors: string[] = [];
  let nodeCount = 0;
  const allowedNodeTypes = new Set(['doc', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'text', 'table', 'tableRow', 'tableCell', 'link', 'image', 'hardBreak']);
  const allowedMarkTypes = new Set(['bold', 'italic']);
  const validateHttpsUrl = (candidate: unknown, path: string) => {
    if (typeof candidate !== 'string') {
      errors.push(`${path} phải là URL HTTPS.`);
      return;
    }
    try {
      if (new URL(candidate).protocol !== 'https:') errors.push(`${path} chỉ chấp nhận URL HTTPS.`);
    } catch {
      errors.push(`${path} không phải URL hợp lệ.`);
    }
  };
  const visit = (node: unknown, path: string) => {
    nodeCount += 1;
    if (nodeCount > 5_000) {
      errors.push('Rich text vượt quá giới hạn 5.000 node.');
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`${path} phải là object.`);
      return;
    }
    const candidate = node as CampaignRichTextNode;
    if (!allowedNodeTypes.has(candidate.type)) errors.push(`${path}.type không được hỗ trợ.`);
    if (candidate.type === 'text' && typeof candidate.text !== 'string') errors.push(`${path}.text phải là chuỗi.`);
    if (candidate.type === 'image') validateHttpsUrl(candidate.attrs?.src, `${path}.attrs.src`);
    if (candidate.type === 'link') validateHttpsUrl(candidate.attrs?.href, `${path}.attrs.href`);
    for (const [markIndex, mark] of (candidate.marks ?? []).entries()) {
      if (!allowedMarkTypes.has(mark.type)) errors.push(`${path}.marks[${markIndex}] không được hỗ trợ.`);
    }
    for (const [childIndex, child] of (candidate.content ?? []).entries()) visit(child, `${path}.content[${childIndex}]`);
  };

  for (const [index, node] of document.content.entries()) visit(node, `content[${index}]`);
  return [...new Set(errors)];
}
