export interface MaterialGridPreferenceKeys {
  columns: string;
  pinned: string;
  widths: string;
}

/** Keep the existing Portal keys so current user layouts are not reset. */
export function materialGridPreferenceKeys(scope?: { actorId: string; campaignId: string }): MaterialGridPreferenceKeys {
  if (!scope) return {
    columns: 'cpms-material-visible-columns-v3',
    pinned: 'cpms-material-pinned-columns-v2',
    widths: 'cpms-material-column-widths-v1',
  };

  const prefix = `cpms-material-campaign-layout-v1:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.campaignId)}`;
  return {
    columns: `${prefix}:columns`,
    pinned: `${prefix}:pinned`,
    widths: `${prefix}:widths`,
  };
}
