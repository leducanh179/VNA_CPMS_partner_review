import { parseMaterialCampaignRefs, type MaterialSummary } from '@cpms/domain';

export function materialsForCampaign(materials: readonly MaterialSummary[], campaign: { id: string; code: string; name: string }): MaterialSummary[] {
  return materials.filter((material) => {
    if (material.isDeleted) return false;
    const references = parseMaterialCampaignRefs(material.fields.campaign_refs);
    if (references.length) return references.some((reference) => reference.kind === 'SYSTEM' && reference.id === campaign.id);
    // Older Material Portal records used only the campaign code/name fields.
    return material.fields.campaign_code === campaign.code || material.fields.campaign_name === campaign.name;
  });
}
