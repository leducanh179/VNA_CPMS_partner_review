import { BadRequestException } from '@nestjs/common';
import type { CampaignSummary, UpdateCampaignCommand } from '@cpms/domain';
import { CAMPAIGN_FIELD_BY_KEY, canonicalCampaignFieldKey, isProtectedCampaignField } from '@cpms/domain';
import type { AiFieldChange } from '@cpms/ai-contracts';
import { z } from 'zod';
export const agentChangeSchema = z.object({ field: z.string().min(1).max(100), value: z.string().max(4000).nullable() }).strict();
export const agentProposalSchema = z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500), changes: z.array(agentChangeSchema).min(1).max(20) }).strict();
export const AGENT_FIELDS = {
  name: ['Tên chiến dịch','campaign_name'], startDate: ['Bắt đầu QCTT','campaign_comm_start_date'], endDate: ['Kết thúc QCTT','campaign_comm_end_date'],
  effectiveStartDate: ['Bắt đầu xuất vé','campaign_effect_start_date'], effectiveEndDate: ['Kết thúc xuất vé','campaign_effect_end_date'],
  departureStartDate: ['Bắt đầu khởi hành','campaign_departure_start_date'], departureEndDate: ['Kết thúc khởi hành','campaign_departure_end_date'],
  descriptionText: ['Mô tả chiến dịch','request_campaign_description'], kpiText: ['KPI','kpi_primary'],
  levelCode: ['Cấp độ chiến dịch','campaign_level_code'], primaryObjectiveCode: ['Mục tiêu','campaign_objective'],
  primaryObjectiveOther: ['Mục tiêu khác','primary_objective_other'],
} as const;
export function proposalField(field: string): { label: string; accessKey: string } {
  const mapped = Object.hasOwn(AGENT_FIELDS,field) ? AGENT_FIELDS[field as keyof typeof AGENT_FIELDS] : undefined;
  if (mapped) return { label: mapped[0], accessKey: mapped[1] };
  const definition = Object.hasOwn(CAMPAIGN_FIELD_BY_KEY,field) ? CAMPAIGN_FIELD_BY_KEY[field] : undefined;
  if (!definition?.editable || definition.status !== 'ACTIVE_V2' || isProtectedCampaignField(field) || ['market','additional_information','source_document_links','other_material_links'].includes(field) || !['text','longText','url','number','date','choice'].includes(definition.kind))
    throw new BadRequestException('Trường chưa được hỗ trợ để nhập liệu qua AI.');
  return { label: definition.label, accessKey: field };
}
function plain(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plain).join('\n');
  if (typeof value === 'object') { const node = value as { text?: string; content?: unknown }; return node.text ?? plain(node.content); }
  return String(value);
}
export function buildCampaignProposal(current: CampaignSummary, input: z.infer<typeof agentChangeSchema>[]) {
  const patch: UpdateCampaignCommand = { expectedVersion: current.recordVersion }, changes: AiFieldChange[] = [];
  const unique = new Set<string>();
  for (const { field: inputField, value } of input) {
    const canonical = canonicalCampaignFieldKey(inputField);
    const field = Object.entries(AGENT_FIELDS).find(([,value]) => value[1] === canonical)?.[0] ?? inputField;
    const info = proposalField(field);
    if (unique.has(info.accessKey)) throw new BadRequestException('Một trường bị đề xuất nhiều lần.');
    unique.add(info.accessKey);
    const after = value?.trim() ?? null;
    const rawBefore = field === 'descriptionText' ? current.descriptionRichText : field in AGENT_FIELDS ? current[field as keyof CampaignSummary] : current.fieldValues[field];
    const before = rawBefore == null ? null : plain(rawBefore);
    if ((before ?? '') === (after ?? '')) continue;
    if (field === 'name') { if (!after || after.length > 500) throw new BadRequestException('Tên chiến dịch cần 1–500 ký tự.'); patch.name = after; }
    else if (field === 'descriptionText') patch.descriptionRichText = after ? { schemaVersion: 1, type: 'doc', content: after.split('\n').map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })) } : null;
    else if (['startDate','endDate','effectiveStartDate','effectiveEndDate','departureStartDate','departureEndDate'].includes(field)) {
      if (after && (!/^\d{4}-\d{2}-\d{2}$/.test(after) || Number.isNaN(Date.parse(after)) || new Date(after).toISOString().slice(0,10) !== after)) throw new BadRequestException('Ngày phải là YYYY-MM-DD và có thực.');
      Object.assign(patch, { [field]: after });
    } else if (field === 'levelCode') patch.levelCode = z.enum(['CLV_01','CLV_02','CLV_03']).nullable().parse(after);
    else if (field === 'primaryObjectiveCode') patch.primaryObjectiveCode = z.enum(['BRAND_IMAGE','SALES_REVENUE','AWARENESS','RECRUITMENT','OTHER']).nullable().parse(after);
    else if (field === 'kpiText' || field === 'primaryObjectiveOther') patch[field] = after;
    else {
      const definition = CAMPAIGN_FIELD_BY_KEY[field]!;
      if (definition.kind === 'number' && after && !Number.isFinite(Number(after))) throw new BadRequestException('Giá trị số không hợp lệ.');
      patch.fieldValues = { ...patch.fieldValues, [field]: definition.kind === 'number' && after ? Number(after) : after };
    }
    changes.push({ field, label: info.label, before, after });
  }
  if (!changes.length) throw new BadRequestException('Không có trường nào thay đổi.');
  return { patch, changes };
}
