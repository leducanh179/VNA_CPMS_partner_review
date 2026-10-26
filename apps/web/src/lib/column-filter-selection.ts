import type { CampaignSetColumnFilter } from './campaign-filters';

/** The master checkbox reflects the current visible scope, never a separate flag. */
export function allFilterOptionsSelected(
  optionValues: readonly string[],
  selectedValues: readonly string[],
  blankInScope: boolean,
  includeBlank: boolean,
): boolean {
  if (!optionValues.length && !blankInScope) return false;
  const selected = new Set(selectedValues);
  return optionValues.every(value => selected.has(value)) && (!blankInScope || includeBlank);
}

export function toggleAllSetFilterOptions(
  draft: CampaignSetColumnFilter,
  optionValues: readonly string[],
  blankInScope: boolean,
  additive: boolean,
): CampaignSetColumnFilter {
  if (allFilterOptionsSelected(optionValues, draft.values, blankInScope, draft.includeBlank)) {
    return { ...draft, values: [], includeBlank: false };
  }
  return {
    ...draft,
    values: additive ? [...new Set([...draft.values, ...optionValues])] : [...optionValues],
    includeBlank: blankInScope || (additive && draft.includeBlank),
  };
}
