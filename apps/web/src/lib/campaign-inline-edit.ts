import type {
  CampaignBatchSaveItem,
  CampaignLifecycleState,
  CampaignFieldValues,
  CampaignSummary,
  CreateCampaignCommand,
  UpdateCampaignCommand,
} from '@cpms/domain';
import { toDateInput } from './campaign-presentation';

export interface CampaignRowDraft {
  name: string;
  requestingUnit: string;
  lifecycleState: CampaignLifecycleState;
  startDate: string;
  endDate: string;
  fieldValues: CampaignFieldValues;
}

export type CampaignRowErrors = Partial<Record<keyof CampaignRowDraft, string>>;

export function emptyCampaignRow(): CampaignRowDraft {
  return {
    name: '',
    requestingUnit: '',
    lifecycleState: 'DRAFT',
    startDate: '',
    endDate: '',
    fieldValues: {},
  };
}

export function campaignToRowDraft(campaign: CampaignSummary): CampaignRowDraft {
  return {
    name: campaign.name,
    requestingUnit: campaign.requestingUnit,
    lifecycleState: campaign.lifecycleState,
    startDate: toDateInput(campaign.startDate),
    endDate: toDateInput(campaign.endDate),
    fieldValues: { ...campaign.fieldValues },
  };
}

export function validateCampaignRow(draft: CampaignRowDraft): CampaignRowErrors {
  const errors: CampaignRowErrors = {};
  if (!draft.name.trim()) errors.name = 'Tên chiến dịch là bắt buộc.';
  if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
    errors.endDate = 'Ngày kết thúc không được trước ngày bắt đầu.';
  }
  return errors;
}

export function toCreateCampaignCommand(draft: CampaignRowDraft): CreateCampaignCommand {
  return {
    name: draft.name.trim(),
    requestingUnit: draft.requestingUnit.trim() || 'Chưa xác định',
    ...(draft.startDate ? { startDate: draft.startDate } : {}),
    ...(draft.endDate ? { endDate: draft.endDate } : {}),
    fieldValues: { ...draft.fieldValues },
  };
}

export function toUpdateCampaignCommand(draft: CampaignRowDraft, expectedVersion?: number): UpdateCampaignCommand {
  return {
    name: draft.name.trim(),
    requestingUnit: draft.requestingUnit.trim() || 'Chưa xác định',
    lifecycleState: draft.lifecycleState,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    fieldValues: { ...draft.fieldValues },
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}

export function toBatchSaveItem(
  clientKey: string,
  draft: CampaignRowDraft,
  id?: string,
  expectedVersion?: number,
): CampaignBatchSaveItem {
  return {
    clientKey,
    ...(id ? { id } : {}),
    ...toUpdateCampaignCommand(draft, expectedVersion),
  };
}

export function campaignRowDraftEquals(left: CampaignRowDraft, right: CampaignRowDraft) {
  return left.name === right.name
    && left.requestingUnit === right.requestingUnit
    && left.lifecycleState === right.lifecycleState
    && left.startDate === right.startDate
    && left.endDate === right.endDate
    && JSON.stringify(left.fieldValues) === JSON.stringify(right.fieldValues);
}

export function campaignDraftFieldValue(draft: CampaignRowDraft, key: string): string {
  if (key === 'campaign_name') return draft.name;
  if (key === 'requesting_unit') return draft.requestingUnit;
  if (key === 'campaign_lifecycle_state') return draft.lifecycleState;
  if (key === 'campaign_comm_start_date') return draft.startDate;
  if (key === 'campaign_comm_end_date') return draft.endDate;
  const value = draft.fieldValues[key];
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function updateCampaignDraftField(
  draft: CampaignRowDraft,
  key: string,
  value: string,
): CampaignRowDraft {
  if (key === 'campaign_name') return { ...draft, name: value };
  if (key === 'requesting_unit') return { ...draft, requestingUnit: value };
  if (key === 'campaign_lifecycle_state') return { ...draft, lifecycleState: value as CampaignLifecycleState };
  if (key === 'campaign_comm_start_date') return { ...draft, startDate: value };
  if (key === 'campaign_comm_end_date') return { ...draft, endDate: value };
  return { ...draft, fieldValues: { ...draft.fieldValues, [key]: value || null } };
}
