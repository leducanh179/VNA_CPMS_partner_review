import type {
  ActorContext,
  CampaignAuditChange,
  CampaignChangeSource,
  CampaignAdditionalInformationItem,
  CampaignFieldValues,
  CampaignLevelCode,
  CampaignLifecycleState,
  CampaignMarketSelectionOrigin,
  CampaignNormalizationStatus,
  CampaignObjectiveCode,
  CampaignRichTextDocument,
  CampaignSummary,
} from '@cpms/domain';

export const CAMPAIGN_REPOSITORY = Symbol('CAMPAIGN_REPOSITORY');

export interface PersistCampaignMarket {
  marketCode: string;
  selectionOrigin: CampaignMarketSelectionOrigin;
  selectionCode: string | null;
}

export interface PersistCampaignRequestingUnit {
  unitCode: string | null;
  customName: string | null;
  displayOrder: number;
}

export interface CampaignFields {
  name: string;
  requestingUnit: string | null;
  lifecycleState: CampaignLifecycleState;
  startDate: Date | null;
  endDate: Date | null;
  effectiveStartDate: Date | null;
  effectiveEndDate: Date | null;
  levelCode: CampaignLevelCode | null;
  requestingEmployeeCode: string | null;
  manualRequesterEmail: string | null;
  primaryObjectiveCode: CampaignObjectiveCode | null;
  primaryObjectiveOther: string | null;
  kpiText: string | null;
  descriptionRichText: CampaignRichTextDocument | null;
  additionalInformation: CampaignAdditionalInformationItem[];
  dataSchemaVersion: number;
  normalizationStatus: CampaignNormalizationStatus;
  fieldValues: CampaignFieldValues;
  markets?: PersistCampaignMarket[];
  provinces?: string[];
  requestingUnits?: PersistCampaignRequestingUnit[];
  expectedVersion?: number;
  auditSource?: CampaignChangeSource;
  auditChanges?: CampaignAuditChange[];
}

export interface PersistCampaignInput extends CampaignFields {
  code: string;
}

export class CampaignVersionConflictError extends Error {}
export class CampaignCodeConflictError extends Error {}

export interface CampaignRepository {
  list(trash: boolean, visibleIds?: readonly string[]): Promise<CampaignSummary[]>;
  findById(id: string): Promise<CampaignSummary | null>;
  findByCode(code: string): Promise<CampaignSummary | null>;
  findSimilarCandidates(query: string, excludeId?: string, visibleIds?: readonly string[]): Promise<CampaignSummary[]>;
  createWithAudit(input: PersistCampaignInput, actor: ActorContext): Promise<CampaignSummary>;
  regenerateCodeWithAudit(id: string, oldCode: string, nextCode: string, expectedVersion: number, actor: ActorContext): Promise<CampaignSummary>;
  updateWithAudit(id: string, input: CampaignFields, actor: ActorContext): Promise<CampaignSummary>;
  moveToTrashWithAudit(id: string, actor: ActorContext, source?: CampaignChangeSource): Promise<CampaignSummary>;
  restoreWithAudit(id: string, actor: ActorContext, source?: CampaignChangeSource): Promise<CampaignSummary>;
  deletePermanentlyWithAudit(id: string, actor: ActorContext, source?: CampaignChangeSource): Promise<{ id: string; code: string }>;
}
