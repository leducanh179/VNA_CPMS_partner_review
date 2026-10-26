import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { legacyMaterialSharing, materialSharingCapabilities, type ActorContext, type MaterialSharing, type MaterialSummary, type MaterialCapabilities } from '@cpms/domain';
import { z } from 'zod';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { MATERIAL_REPOSITORY, type MaterialRepository } from './material.repository';
import { MaterialSharingRepository } from './material-sharing.repository';

const selection = z.object({
  mode: z.enum(['SHARED', 'CAMPAIGN', 'RESTRICTED']),
  campaignIds: z.array(z.string().uuid()).max(20),
  grants: z.array(z.object({ kind: z.enum(['ACCOUNT', 'ORG']), id: z.string().uuid(), permission: z.enum(['VIEW', 'EDIT', 'MANAGE_SHARING']) }).strict()).max(100),
}).strict();
const command = selection.extend({ expectedVersion: z.number().int().positive() }).strict();
export type MaterialSharingSelection = z.infer<typeof selection>;

@Injectable()
export class MaterialSharingApplicationService {
  constructor(@Inject(MATERIAL_REPOSITORY) private readonly materials: MaterialRepository,
    @Inject(MaterialSharingRepository) private readonly repository: MaterialSharingRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) {}

  async capabilities(record: MaterialSummary): Promise<MaterialCapabilities> {
    return (await this.evaluate([record])).get(record.materialId)!;
  }
  private async evaluate(records: MaterialSummary[]) {
    const identity = this.access.snapshot().identity;
    const orgIds = await this.repository.activeOrganizationIds(identity.orgIds);
    const campaignIds = new Set(records.flatMap(record => record.sharing?.mode === 'CAMPAIGN' ? record.sharing.campaignIds : []));
    const readable = campaignIds.size ? await this.access.visibleCampaignIds() : [];
    const editable: string[] = [];
    for (const id of campaignIds) if (readable.includes(id) && this.access.capabilities(await this.access.campaign(id)).permissions['campaign.update']) editable.push(id);
    const decisions = { read: this.access.check('material.read'), update: this.access.check('material.update'), manage: this.access.check('material.manage'),
      publish: this.access.check('material.publish'), delete: this.access.check('material.delete'), restore: this.access.check('material.restore'), systemManage: this.access.check('system.manage') };
    return new Map(records.map(record => {
    const sharing = record.sharing ?? legacyMaterialSharing();
    return [record.materialId, materialSharingCapabilities({ sharing, deleted: record.isDeleted, identity: { ...identity, orgIds },
      decisions, readableCampaignIds: new Set(readable), editableCampaignIds: new Set(editable) })];
    }));
  }
  async require(record: MaterialSummary, action: keyof MaterialCapabilities) {
    const capabilities = await this.capabilities(record);
    if (!capabilities.view) throw new NotFoundException('Không tìm thấy tư liệu trong phạm vi được phép.');
    if (!capabilities[action]) throw new ForbiddenException('Không có quyền thực hiện thao tác với tư liệu này.');
    this.access.requireAtCommit(async () => {
      if (!(await this.capabilities(record))[action]) throw new ForbiddenException('Quyền đã thay đổi trước khi hoàn tất thao tác.');
    });
    return capabilities;
  }
  async project(record: MaterialSummary): Promise<MaterialSummary> {
    const capabilities = await this.require(record, 'view');
    const sharing = record.sharing ?? legacyMaterialSharing();
    return { ...record, capabilities, sharing: capabilities.manageSharing ? sharing : { ...sharing, ownerActorId: null, campaignIds: [], grants: [] } };
  }
  async visible(records: MaterialSummary[]) {
    const capabilities = await this.evaluate(records);
    return records.flatMap(record => {
      const value = capabilities.get(record.materialId)!;
      if (!value.view) return [];
      const sharing = record.sharing ?? legacyMaterialSharing();
      return [{ ...record, capabilities: value, sharing: value.manageSharing ? sharing : { ...sharing, ownerActorId: null, campaignIds: [], grants: [] } }];
    });
  }
  @AccessBoundary()
  async detail(id: string) { return this.project(await this.get(id)); }
  @AccessBoundary()
  async get(id: string, action: keyof MaterialCapabilities = 'view') {
    const [record] = await this.materials.findByMaterialIds([id]);
    if (!record) throw new NotFoundException('Không tìm thấy tư liệu trong phạm vi được phép.');
    await this.require(record, action);
    return record;
  }
  async validate(input: unknown): Promise<MaterialSharingSelection> {
    const parsed = selection.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Phạm vi chia sẻ không hợp lệ.');
    const value = parsed.data;
    if (new Set(value.campaignIds).size !== value.campaignIds.length || new Set(value.grants.map(g => `${g.kind}:${g.id}`)).size !== value.grants.length) throw new BadRequestException('Không chọn trùng đối tượng chia sẻ.');
    if (value.mode === 'CAMPAIGN' ? !value.campaignIds.length || value.grants.length > 0 : value.campaignIds.length > 0) throw new BadRequestException('Theo chiến dịch cần ít nhất một Chiến dịch chuẩn; các chế độ không dùng chung danh sách cấp quyền.');
    if (value.mode !== 'RESTRICTED' && value.grants.length) throw new BadRequestException('Chỉ chế độ Theo người, nhóm cụ thể dùng danh sách cấp quyền.');
    if (!await this.repository.validTargets(value.campaignIds, value.grants)) throw new BadRequestException('Đối tượng chia sẻ không tồn tại hoặc không còn hoạt động.');
    const visible = await this.access.visibleCampaignIds();
    if (value.campaignIds.some(id => !visible.includes(id))) throw new ForbiddenException('Không được chia sẻ theo Chiến dịch ngoài phạm vi của bạn.');
    return value;
  }
  @AccessBoundary(2)
  async change(id: string, input: unknown, actor: ActorContext) {
    const parsed = command.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Lệnh chia sẻ không hợp lệ hoặc thiếu phiên bản.');
    const record = await this.get(id, 'manageSharing');
    const { expectedVersion, ...fields } = parsed.data;
    const value = await this.validate(fields);
    const sharing: MaterialSharing = { ...value, ownerActorId: record.sharing?.ownerActorId ?? null };
    const saved = await this.repository.save(id, expectedVersion, sharing, actor);
    const capabilities = await this.capabilities(saved);
    // A delegate may intentionally revoke their own access. Commit succeeds without returning hidden content.
    if (!capabilities.view) return { ...saved, fields: {}, sharing: { ...sharing, ownerActorId: null, campaignIds: [], grants: [] }, capabilities };
    return this.project(saved);
  }
  @AccessBoundary()
  async directory(query: string, materialId?: string) {
    if (materialId) await this.get(materialId, 'manageSharing');
    else this.access.require('material.create');
    return this.repository.directory(query.trim().slice(0, 100));
  }
}
