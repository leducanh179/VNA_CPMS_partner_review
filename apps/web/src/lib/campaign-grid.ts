import {
  CAMPAIGN_FIELD_BY_KEY,
  type CampaignFieldDefinition,
  type CampaignSummary,
} from '@cpms/domain';
import { campaignGridDisplayValue } from './campaign-filters';

export type CampaignSortDirection = 'asc' | 'desc';
export type CampaignPageSize = 10 | 20 | 50;

export const CAMPAIGN_PAGE_SIZES: readonly CampaignPageSize[] = [10, 20, 50];

export function campaignPageSize(value: string | null | undefined): CampaignPageSize {
  const parsed = Number(value);
  return CAMPAIGN_PAGE_SIZES.includes(parsed as CampaignPageSize) ? parsed as CampaignPageSize : 10;
}

export function campaignFieldValue(campaign: CampaignSummary, key: string): string {
  return campaignGridDisplayValue(campaign, key);
}

function numericValue(value: string) {
  const normalized = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function compareCampaigns(
  left: CampaignSummary,
  right: CampaignSummary,
  key: string,
  direction: CampaignSortDirection,
) {
  const definition = CAMPAIGN_FIELD_BY_KEY[key];
  const leftValue = campaignFieldValue(left, key);
  const rightValue = campaignFieldValue(right, key);
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  let comparison: number;

  if (definition?.kind === 'number') comparison = numericValue(leftValue) - numericValue(rightValue);
  else if (definition?.kind === 'date' || definition?.kind === 'dateTime') {
    comparison = (Date.parse(leftValue) || 0) - (Date.parse(rightValue) || 0);
  } else comparison = leftValue.localeCompare(rightValue, 'vi', { numeric: true, sensitivity: 'base' });

  return direction === 'asc' ? comparison : -comparison;
}

export function nextSortDirection(currentKey: string, currentDirection: CampaignSortDirection, nextKey: string) {
  if (currentKey !== nextKey) return 'asc' as const;
  return currentDirection === 'asc' ? 'desc' as const : 'asc' as const;
}

export function sortDirectionLabel(definition: CampaignFieldDefinition, direction: CampaignSortDirection) {
  if (definition.kind === 'number') return direction === 'asc' ? 'Nhỏ tới lớn' : 'Lớn tới nhỏ';
  if (definition.kind === 'date' || definition.kind === 'dateTime') return direction === 'asc' ? 'Cũ tới mới' : 'Mới tới cũ';
  return direction === 'asc' ? 'A tới Z' : 'Z tới A';
}
