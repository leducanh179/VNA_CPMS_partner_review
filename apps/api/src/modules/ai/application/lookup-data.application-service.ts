import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext, CampaignSummary, MaterialSummary } from '@cpms/domain';
import { parseMaterialCampaignRefs } from '@cpms/domain';
import type { LookupReadRequirement, LookupSource, LookupToolName, LookupToolResult } from '@cpms/ai-contracts';
import { z } from 'zod';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignApplicationService } from '../../campaign/application/campaign.application-service';
import { MaterialApplicationService } from '../../material/application/material.application-service';
import { MaterialSharingApplicationService } from '../../material/application/material-sharing.application-service';
import { normalizeSearch } from '../domain/lookup-policy';
import { LookupRecordApplicationService } from './lookup-record.application-service';
import { AiWorkspaceApplicationService } from './workspace.application-service';

const search = z.object({ query: z.string().max(120), campaignId: z.string().uuid().nullable() }).strict();
const detail = z.object({ id: z.string().min(1).max(120) }).strict();
function compact(value: unknown): string {
  // CPMS rich text is data, never model instructions, HTML or executable links.
  if (value == null) return '';
  if (typeof value === 'string') {
    try { return compact(JSON.parse(value)); } catch { return value.replace(/<[^>]*>/g, ' ').slice(0, 900); }
  }
  if (Array.isArray(value)) return value.map(compact).join(' ').slice(0, 900);
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    return [typeof node.text === 'string' ? node.text : '', compact(node.content)].join(' ').trim().slice(0, 900);
  }
  return String(value);
}

function effectivePeriodStatus(row: CampaignSummary): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  if (!row.effectiveStartDate && !row.effectiveEndDate) return 'Chưa xác định';
  if (row.effectiveStartDate && today < row.effectiveStartDate) return 'Chưa hiệu lực';
  if (row.effectiveEndDate && today > row.effectiveEndDate) return 'Hết hiệu lực';
  return 'Đang hiệu lực';
}

@Injectable()
export class LookupDataApplicationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(CampaignApplicationService) private readonly campaigns: CampaignApplicationService,
    @Inject(MaterialApplicationService) private readonly materials: MaterialApplicationService,
    @Inject(MaterialSharingApplicationService) private readonly sharing: MaterialSharingApplicationService,
    @Inject(LookupRecordApplicationService) private readonly records: LookupRecordApplicationService,
    @Inject(AiWorkspaceApplicationService) private readonly workspace: AiWorkspaceApplicationService) {}

  async checkRequirements(actor: ActorContext, requirements: LookupReadRequirement[]) {
    return this.access.run(actor, async () => {
      for (const requirement of requirements) {
        if (requirement.kind === 'MATERIAL') {
          const row = await this.sharing.get(requirement.id);
          if (row.isDeleted) throw new NotFoundException('Không tìm thấy bản ghi.');
        } else if (requirement.kind === 'CONTRACT' || requirement.kind === 'BOOKING') {
          await this.records.read(actor, requirement.kind, requirement.id);
        } else {
          const resource = await this.access.campaign(requirement.id);
          if (resource.deleted) throw new NotFoundException('Không tìm thấy bản ghi.');
          for (const field of requirement.fields) this.access.require('campaign.read', resource, field);
        }
      }
    });
  }
  execute(actor: ActorContext, tool: LookupToolName, input: Record<string, unknown>): Promise<LookupToolResult & { requirements: LookupReadRequirement[] }> {
    return this.access.run(actor, async () => {
      if (tool === 'search_library') return this.workspace.search(actor,input);
      if (tool === 'get_contract' || tool === 'get_booking') {
        const parsed = detail.safeParse(input);
        if (!parsed.success || !z.uuid().safeParse(parsed.data.id).success) throw new BadRequestException('Mã hồ sơ không hợp lệ.');
        return this.records.read(actor, tool === 'get_contract' ? 'CONTRACT' : 'BOOKING', parsed.data.id);
      }
      if (tool === 'get_campaign' || tool === 'get_material') {
        const parsed = detail.safeParse(input);
        if (!parsed.success) throw new BadRequestException('Mã bản ghi không hợp lệ.');
        if (tool === 'get_campaign') {
          if (!z.uuid().safeParse(parsed.data.id).success) throw new NotFoundException('Không tìm thấy bản ghi.');
          const item = await this.campaign(await this.campaigns.get(parsed.data.id));
          return { content: { item: item.data }, sources: [item.source], requirements: [item.requirement] };
        }
        const item = await this.material(await this.sharing.detail(parsed.data.id));
        return { content: { item: item.data, fileContentRead: false }, sources: [item.source], requirements: [item.requirement] };
      }
      const parsed = search.safeParse(input);
      if (!parsed.success) throw new BadRequestException('Bộ lọc tra cứu không hợp lệ.');
      const { query, campaignId } = parsed.data;
      const needle = normalizeSearch(query);
      if (campaignId) await this.access.campaign(campaignId);
      if (tool === 'search_materials') {
        const records = await this.materials.list();
        const items = [];
        for (const record of records) {
          if (campaignId && !parseMaterialCampaignRefs(record.fields.campaign_refs).some(ref => ref.kind === 'SYSTEM' && ref.id === campaignId)) continue;
          const item = await this.material(record);
          if (!needle || normalizeSearch(JSON.stringify(item.data)).includes(needle)) items.push(item);
        }
        return { content: { items: items.slice(0, 5).map(i => i.data), matchingInSearchWindow: items.length, returned: Math.min(items.length, 5),
          moreMatches: items.length > 5, searchWindow: 'Tối đa 5.000 tư liệu mới cập nhật, sau đó lọc quyền. Không phải tổng toàn kho.',
          fileContentRead: false }, sources: items.slice(0, 5).map(i => i.source), requirements: items.map(i => i.requirement) };
      }
      if (!['search_campaigns', 'summarize_campaigns'].includes(tool)) throw new BadRequestException('Công cụ không được phép.');
      const ids = campaignId ? [campaignId] : await this.access.visibleCampaignIds();
      if (ids.length > 2000) throw new BadRequestException('Phạm vi quá rộng. Hãy chọn một chiến dịch để tra cứu.');
      const items = [];
      for (const id of ids.sort()) {
        const item = await this.campaign(await this.campaigns.get(id));
        if (!needle || normalizeSearch(JSON.stringify(item.data)).includes(needle)) items.push(item);
      }
      if (tool === 'summarize_campaigns') {
        const byApprovalStatus: Record<string, number> = {};
        const byWorkflowStatus: Record<string, number> = {};
        const byEffectivePeriod: Record<string, number> = {};
        for (const item of items) {
          for (const [groups, field] of [[byApprovalStatus, 'campaign_approval_status'], [byWorkflowStatus, 'campaign_workflow_status'],
            [byEffectivePeriod, 'campaign_effective_status']] as const) {
            const state = String(item.data[field] ?? 'Không được xem trạng thái');
            groups[state] = (groups[state] ?? 0) + 1;
          }
        }
        return { content: { total: items.length, byApprovalStatus, byWorkflowStatus, byEffectivePeriod, query,
          scope: 'Toàn bộ chiến dịch chưa xóa mà bạn được xem; khớp chuỗi tìm kiếm. Hiệu lực chỉ xét khoảng ngày, không phải trạng thái phê duyệt.' },
          sources: [{ kind: 'CAMPAIGN', id: 'collection', title: 'Danh sách chiến dịch theo quyền hiện tại', href: '/campaigns', version: 0 }], requirements: items.map(i => i.requirement) };
      }
      return { content: { items: items.slice(0, 5).map(i => i.data), total: items.length, returned: Math.min(items.length, 5), moreMatches: items.length > 5 },
        sources: items.slice(0, 5).map(i => i.source), requirements: items.map(i => i.requirement) };
    });
  }

  private async campaign(row: CampaignSummary) {
    if (row.isDeleted) throw new NotFoundException('Không tìm thấy bản ghi.');
    const resource = await this.access.campaign(row.id);
    // The legacy Campaign.lifecycleState remains DRAFT after workflow approval. Never present it as approval evidence.
    const approval = row.approvalStatus === 'Đã duyệt' && row.qcttStatus === 'Nháp'
      ? 'Bản trước đã duyệt; nội dung hiện tại chưa duyệt' : row.approvalStatus ?? 'Chưa xác định';
    const values: { key: string; value: unknown; permissions: string[] }[] = [
      { key: 'campaign_code', value: row.code, permissions: ['campaign_code'] },
      { key: 'campaign_name', value: row.name, permissions: ['campaign_name'] },
      { key: 'requesting_unit', value: row.requestingUnit, permissions: ['requesting_unit'] },
      { key: 'campaign_approval_status', value: approval, permissions: ['department_approval_state', 'division_approval_state'] },
      { key: 'campaign_workflow_status', value: row.qcttStatus ?? 'Nháp', permissions: ['campaign_lifecycle_state', 'department_approval_state', 'division_approval_state'] },
      { key: 'campaign_operational_state', value: row.operationalState ?? 'Chưa xác định', permissions: ['campaign_lifecycle_state'] },
      { key: 'campaign_effective_status', value: effectivePeriodStatus(row), permissions: ['campaign_effect_start_date', 'campaign_effect_end_date'] },
      { key: 'campaign_effect_start_date', value: row.effectiveStartDate, permissions: ['campaign_effect_start_date'] },
      { key: 'campaign_effect_end_date', value: row.effectiveEndDate, permissions: ['campaign_effect_end_date'] },
      { key: 'campaign_departure_start_date', value: row.departureStartDate ?? null, permissions: ['campaign_departure_start_date'] },
      { key: 'campaign_departure_end_date', value: row.departureEndDate ?? null, permissions: ['campaign_departure_end_date'] },
      { key: 'campaign_comm_start_date', value: row.startDate, permissions: ['campaign_comm_start_date'] },
      { key: 'campaign_comm_end_date', value: row.endDate, permissions: ['campaign_comm_end_date'] },
      { key: 'market', value: row.markets.map(m => m.marketName).join(', '), permissions: ['market'] },
      { key: 'request_campaign_description', value: compact(row.descriptionRichText), permissions: ['request_campaign_description'] },
    ];
    const data: Record<string, unknown> = { id: row.id };
    const fields = new Set<string>();
    for (const { key, value, permissions } of values) {
      if (permissions.every(field => this.access.check('campaign.read', resource, field).allowed)) {
        for (const field of permissions) { this.access.require('campaign.read', resource, field); fields.add(field); }
        data[key] = typeof value === 'string' ? value.slice(0, 900) : value;
      }
    }
    const source: LookupSource = { kind: 'CAMPAIGN', id: row.id, title: String(data.campaign_name ?? 'Chiến dịch'),
      href: `/campaigns/${encodeURIComponent(row.id)}`, version: row.recordVersion };
    const requirement: LookupReadRequirement = { kind: 'CAMPAIGN', id: row.id, fields: [...fields] };
    return { data, source, requirement };
  }

  private async material(row: MaterialSummary) {
    if (row.isDeleted) throw new NotFoundException('Không tìm thấy bản ghi.');
    const data: Record<string, unknown> = { id: row.materialId };
    for (const key of ['material_name', 'material_group', 'material_type', 'material_languages', 'material_link', 'publish_status', 'material_publish', 'description_rich_text', 'material_description_rich_text', 'note'] as const)
      data[key] = compact(row.fields[key]);
    // Do not expand linked campaign metadata just because the material is shared.
    const source: LookupSource = { kind: 'MATERIAL', id: row.materialId, title: String(data.material_name || 'Tư liệu'),
      href: `/materials?material=${encodeURIComponent(row.materialId)}`, version: row.recordVersion };
    const requirement: LookupReadRequirement = { kind: 'MATERIAL', id: row.materialId, fields: [] };
    return { data, source, requirement };
  }
}
