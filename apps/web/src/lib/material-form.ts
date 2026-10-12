import {
  inferMaterialGroup,
  parseMaterialCampaignRefs,
  parseMaterialSupplementaryLinks,
  type CampaignRichTextDocument,
  type CampaignRichTextNode,
  type MaterialCampaignReference,
  type MaterialFields,
  type MaterialPortalBootstrap,
  type MaterialSupplementaryLink,
} from '@cpms/domain';
import { EMPTY_CAMPAIGN_RICH_TEXT } from './campaign-rich-text';

export function plainRichText(value: string | null | undefined): CampaignRichTextDocument {
  return value ? { schemaVersion: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } : EMPTY_CAMPAIGN_RICH_TEXT;
}

export function materialRichText(value: string | null | undefined, legacy: string | null | undefined): CampaignRichTextDocument {
  if (value) {
    try {
      const parsed = JSON.parse(value) as CampaignRichTextDocument;
      if (parsed?.type === 'doc' && Array.isArray(parsed.content)) return parsed;
    } catch { /* Show the preserved legacy text if a stored payload is malformed. */ }
  }
  return plainRichText(legacy);
}

export function richTextPlainValue(document: CampaignRichTextDocument): string {
  const collect = (node: CampaignRichTextNode): string => node.type === 'text' ? node.text ?? ''
    : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(collect).join(node.type === 'paragraph' || node.type === 'listItem' ? ' ' : '');
  return document.content.map(collect).join(' ').trim();
}

export function materialTitleSuggestion(type: string | null | undefined, typeOther: string | null | undefined, references: MaterialCampaignReference[]): string {
  const typeName = (type === 'Khác' ? typeOther : type)?.trim() || '';
  const campaigns = references.map((reference) => reference.name.trim()).filter(Boolean);
  if (!typeName || !campaigns.length) return '';
  return `${typeName} ${campaigns.length > 1 ? 'nhiều chiến dịch' : campaigns[0]}`;
}

export function materialDescription(fields: MaterialFields): CampaignRichTextDocument {
  return materialRichText(fields.material_description_rich_text || fields.note_rich_text || fields.description_rich_text, fields.note);
}

export function materialFormReferences(fields: MaterialFields, campaigns: MaterialPortalBootstrap['campaigns']): MaterialCampaignReference[] {
  const structured = parseMaterialCampaignRefs(fields.campaign_refs);
  if (structured.length) return structured;
  const legacy = (fields.campaign || fields.campaign_name || '').trim();
  if (!legacy) return [];
  const matches = campaigns.filter((campaign) => campaign.campaign_code === fields.campaign_code || campaign.campaign_name === legacy);
  if (matches.length === 1) return [{ kind: 'SYSTEM', id: matches[0]!.campaign_id, name: matches[0]!.campaign_name }];
  return [{ kind: 'TEMPORARY', id: `temp:legacy-${fields.material_id || 'material'}`, name: legacy }];
}

export function materialFormLinks(fields: MaterialFields): MaterialSupplementaryLink[] {
  const structured = parseMaterialSupplementaryLinks(fields.supplementary_links);
  if (structured.length) return structured;
  return fields.supplementary_link ? [{ label: 'Link bổ sung', url: fields.supplementary_link }] : [];
}

export function materialFormGroup(fields: MaterialFields) {
  return fields.material_group || inferMaterialGroup(fields.material_type);
}

export function inheritedMaterialMarkets(references: MaterialCampaignReference[], campaigns: MaterialPortalBootstrap['campaigns']) {
  const byId = new Map(campaigns.map((campaign) => [campaign.campaign_id, campaign]));
  const selected = references.flatMap((reference) => reference.kind === 'SYSTEM' && byId.has(reference.id) ? [byId.get(reference.id)!] : []);
  selected.sort((left, right) => right.market_codes.length - left.market_codes.length || left.campaign_id.localeCompare(right.campaign_id));
  return selected[0] || null;
}
