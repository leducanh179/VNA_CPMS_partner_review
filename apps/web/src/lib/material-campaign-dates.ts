import { parseMaterialCampaignRefs, type MaterialPortalBootstrap } from '@cpms/domain';

export const MATERIAL_CAMPAIGN_DATE_COLUMNS = [
  { key: 'campaign_effect_start_date', source: 'effectiveStartDate', label: 'Bắt đầu hiệu lực chương trình/xuất vé', width: '16rem', editable: false },
  { key: 'campaign_effect_end_date', source: 'effectiveEndDate', label: 'Kết thúc hiệu lực chương trình/xuất vé', width: '16rem', editable: false },
  { key: 'campaign_departure_start_date', source: 'departureStartDate', label: 'Bắt đầu hiệu lực khởi hành', width: '15rem', editable: false },
  { key: 'campaign_departure_end_date', source: 'departureEndDate', label: 'Kết thúc hiệu lực khởi hành', width: '15rem', editable: false },
] as const;
type Campaigns = MaterialPortalBootstrap['campaigns'];
export function materialCampaignDates(row: Record<string, unknown>, key: string, campaigns: Campaigns) {
  const definition = MATERIAL_CAMPAIGN_DATE_COLUMNS.find(column => column.key === key);
  if (!definition) return [];
  const refs = parseMaterialCampaignRefs(String(row.campaign_refs || row.campaign || ''));
  return refs.map(ref => {
    const campaign = ref.kind === 'SYSTEM' ? campaigns.find(item => item.campaign_id === ref.id) : undefined;
    return { id: ref.id, name: campaign?.campaign_name || ref.name, date: campaign?.[definition.source]?.slice(0, 10) || '' };
  });
}
export function materialCampaignDateProjection(row: Record<string, unknown>, campaigns: Campaigns) {
  return Object.fromEntries(MATERIAL_CAMPAIGN_DATE_COLUMNS.map(column => [column.key,
    materialCampaignDates(row, column.key, campaigns).map(value => value.date).filter(Boolean).sort().join('\n')]));
}
