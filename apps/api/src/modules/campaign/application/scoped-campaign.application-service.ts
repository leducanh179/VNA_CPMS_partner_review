import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { inspectCampaignFieldChanges, isProtectedCampaignField, type ActorContext, type CampaignBatchResult, type CampaignBatchSaveItem,
  type CampaignChangeSource, type CampaignLifecycleState, type CreateCampaignCommand, type UpdateCampaignCommand } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { CatalogApplicationService } from '../../catalog/application/catalog.application-service';
import { CAMPAIGN_REPOSITORY, type CampaignRepository } from './campaign.repository';
import { CampaignApplicationService } from './campaign.application-service';
import { prepareCampaignAccessUpdate } from './campaign-access-fields';
import { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';

/** Pending DI replacement for the existing service token after every secondary entrypoint is integrated.
 * Inherits established business validation/audit operations; public overrides supply the final access boundary. */
@Injectable()
export class ScopedCampaignApplicationService extends CampaignApplicationService {
  constructor(@Inject(CAMPAIGN_REPOSITORY) private readonly scopedRepository: CampaignRepository,
    @Inject(CatalogApplicationService) private readonly scopedCatalogs: CatalogApplicationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
    @Inject(CampaignWorkflowApplicationService) private readonly workflow: CampaignWorkflowApplicationService) { super(scopedRepository, scopedCatalogs); }

  @AccessBoundary()
  override async list(trash = false) {
    const visible = await this.access.visibleCampaignIds(trash);
    const rows = await this.scopedRepository.list(trash, visible);
    return Promise.all(rows.map(async (row) => ({ ...row, access: this.access.capabilities(await this.access.campaign(row.id)) })));
  }
  @AccessBoundary()
  override async get(id: string) {
    const resource = await this.access.campaign(id);
    return { ...await super.get(id), access: this.access.capabilities(resource) };
  }
  @AccessBoundary(1)
  override async create(command: CreateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'API') {
    this.access.require('campaign.create');
    if (['XLSX_CSV','GOOGLE_SHEETS','IMPORTER'].includes(source)) this.access.require('campaign.import');
    if (command.lifecycleState && command.lifecycleState !== 'DRAFT') throw new BadRequestException('Campaign mới phải là nháp; trạng thái phê duyệt đi qua command workflow.');
    const before: Record<string, unknown> = { campaign_code: command.code ?? null, campaign_lifecycle_state: 'DRAFT' };
    for (const [key, value] of Object.entries(command.fieldValues ?? {})) if (isProtectedCampaignField(key) && value == null) before[key] = null;
    const changes = inspectCampaignFieldChanges(before, Object.fromEntries(Object.entries(command).filter(([, value]) => value !== undefined)));
    if (changes.errors.length) throw new BadRequestException({ message: 'Không tạo Campaign từ trường hệ thống hoặc field không được nhận diện.', fields: changes.errors });
    const created = await super.create(command, actor, source);
    return { ...created, access: this.access.capabilities(await this.access.campaign(created.id)) };
  }
  @AccessBoundary(2)
  override async update(id: string, command: UpdateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'API') {
    const resource = await this.access.campaign(id);
    if (['XLSX_CSV','GOOGLE_SHEETS','IMPORTER'].includes(source)) this.access.require('campaign.import', resource);
    const current = await super.get(id);
    const prepared = prepareCampaignAccessUpdate(current, command, await this.scopedCatalogs.listCampaignObjectives());
    const changed = this.access.requireChangedFields(resource, prepared.before, prepared.patch);
    if (!changed.length) {
      if (command.expectedVersion === undefined) throw new BadRequestException('expectedVersion là bắt buộc khi cập nhật chiến dịch.');
      if (current.isDeleted || command.expectedVersion !== current.recordVersion) throw new ConflictException('Chiến dịch không còn ở phiên bản được phép chỉnh sửa.');
      // A no-op must not normalize legacy aliases, advance a subject revision or emit an audit on read-only access.
      return { ...current, access: this.access.capabilities(resource) };
    }
    await this.workflow.requireEditable(id, changed.length > 0);
    const updated = await super.update(id, prepared.command, actor, source);
    if (changed.length) await this.workflow.afterContentChanged(id);
    return { ...updated, access: this.access.capabilities(await this.access.campaign(id)) };
  }
  @AccessBoundary(2)
  override async regenerateCode(id: string, expectedVersion: number, actor: ActorContext) {
    const identity = this.access.snapshot().identity;
    if (identity.mode !== 'DIRECT' || !identity.effectiveSuperadmin || identity.originalActorId !== identity.effectiveActorId) {
      throw new ForbiddenException('Chỉ superadmin đăng nhập trực tiếp được chuẩn hóa mã Chiến dịch.');
    }
    this.access.require('access.manage');
    const resource = await this.access.campaign(id);
    this.access.require('campaign.access.manage', resource);
    return super.regenerateCode(id, expectedVersion, actor);
  }
  @AccessBoundary()
  override async findSimilar(query: string, excludeId?: string) {
    const visible = await this.access.visibleCampaignIds();
    return this.similarWithinVisibility(query, excludeId, visible);
  }
  @AccessBoundary()
  async prepareChangeProposal(id: string, command: UpdateCampaignCommand) {
    const resource = await this.access.campaign(id); const current = await super.get(id);
    const prepared = prepareCampaignAccessUpdate(current, command, await this.scopedCatalogs.listCampaignObjectives());
    if (!this.access.requireChangedFields(resource, prepared.before, prepared.patch).length) throw new BadRequestException('Chưa có nội dung thay đổi.');
    await super.validateProposedUpdate(id, prepared.command);
    return prepared;
  }
  @AccessBoundary(2)
  async applyReviewedChange(id: string, command: UpdateCampaignCommand, actor: ActorContext, reason: string, requesterId: string) {
    await this.workflow.requireLeadDivisionLeader(actor, id);
    const resource = await this.access.campaign(id); const current = await super.get(id);
    const prepared = prepareCampaignAccessUpdate(current, command, await this.scopedCatalogs.listCampaignObjectives());
    await this.access.requireProposedFields(requesterId, resource, prepared.before, prepared.patch);
    await super.validateProposedUpdate(id, prepared.command);
    const updated = await super.update(id, prepared.command, actor);
    await this.workflow.recordApprovedChange(actor, id, reason, requesterId);
    return updated;
  }
  @AccessBoundary(2)
  async applyPolicyManagedChange(id: string, command: UpdateCampaignCommand, actor: ActorContext) {
    const resource = await this.access.campaign(id); const current = await super.get(id);
    const prepared = prepareCampaignAccessUpdate(current, command, await this.scopedCatalogs.listCampaignObjectives());
    if (await this.workflow.requiresApproval(id, 'EDIT')) throw new ForbiddenException('Sửa đổi vẫn cần được phê duyệt theo chính sách hiện hành.');
    this.access.requireChangedFields(resource, prepared.before, prepared.patch);
    await super.validateProposedUpdate(id, prepared.command);
    return super.update(id, prepared.command, actor);
  }
  /** Internal completion path for an approved cancellation request. The leader
   * authorizes the request; the Campaign is then soft-deleted through the same
   * audited repository boundary used by the regular Trash action. */
  @AccessBoundary(1)
  async applyReviewedCancellation(id: string, actor: ActorContext) {
    await this.workflow.requireLeadDivisionLeader(actor, id);
    this.access.require('campaign.approve', await this.access.campaign(id));
    return super.moveToTrash(id, actor, 'API');
  }
  @AccessBoundary(1)
  async applyPolicyCancellation(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    this.access.require('campaign.submit', resource);
    if (await this.workflow.requiresApproval(id, 'CANCEL')) throw new ForbiddenException('Xóa Chiến dịch vẫn cần được phê duyệt theo chính sách hiện hành.');
    return super.moveToTrash(id, actor, 'API');
  }
  @AccessBoundary(1)
  async applyReviewedRestoration(id: string, actor: ActorContext) {
    await this.workflow.requireLeadDivisionLeader(actor, id);
    this.access.require('campaign.approve', await this.access.campaign(id));
    return super.restore(id, actor, 'API');
  }
  @AccessBoundary(1)
  async applyPolicyRestoration(id: string, actor: ActorContext) {
    const resource = await this.access.campaign(id);
    this.access.require('campaign.submit', resource);
    if (await this.workflow.requiresApproval(id, 'RESTORE')) throw new ForbiddenException('Khôi phục Chiến dịch vẫn cần được phê duyệt theo chính sách hiện hành.');
    return super.restore(id, actor, 'API');
  }
  @AccessBoundary(1)
  override async moveToTrash(id: string, actor: ActorContext, source: CampaignChangeSource = 'API') {
    this.access.require('campaign.delete', await this.access.campaign(id));
    await this.workflow.requireLifecycleApproval(id, 'CANCEL');
    return super.moveToTrash(id, actor, source);
  }
  @AccessBoundary(1)
  override async restore(id: string, actor: ActorContext, source: CampaignChangeSource = 'API') {
    this.access.require('campaign.restore', await this.access.campaign(id));
    return super.restore(id, actor, source);
  }
  @AccessBoundary(1)
  override async deletePermanently(id: string, actor: ActorContext, source: CampaignChangeSource = 'API') {
    this.access.require('campaign.purge', await this.access.campaign(id));
    await this.workflow.requireLifecycleApproval(id, 'PURGE');
    this.access.requirePurgeVerification(id);
    return super.deletePermanently(id, actor, source);
  }
  @AccessBoundary()
  async requireLifecycleApproval(id: string, action: 'CANCEL' | 'PURGE') { await this.access.campaign(id); await this.workflow.requireLifecycleApproval(id, action); }
  override async batchSave(items: CampaignBatchSaveItem[], actor: ActorContext): Promise<CampaignBatchResult> {
    const results: CampaignBatchResult['items'] = [];
    for (const item of items) {
      try {
        const row = await this.access.run(actor, async () => {
          if (!item.id && item.code) await this.access.campaignByCode(item.code);
          return super.batchSave([item], actor);
        });
        results.push(...row.items);
      } catch (error) {
        results.push({ clientKey: item.clientKey, ...(item.id ? { id: item.id } : {}), ok: false,
          message: error instanceof ForbiddenException || error instanceof BadRequestException ? error.message : 'Không thể lưu dòng trong phạm vi hoặc phiên bản hiện hành.' });
      }
    }
    const succeeded = results.filter((row) => row.ok).length;
    return { ok: succeeded === results.length, total: results.length, succeeded, failed: results.length - succeeded, items: results };
  }
  @AccessBoundary(2)
  override async bulkTransition(_ids: string[], _state: CampaignLifecycleState, _actor: ActorContext): Promise<CampaignBatchResult> {
    throw new ForbiddenException('Không đổi trạng thái bằng PATCH/bulk-transition. Hãy dùng command workflow với task và phiên bản hiện hành.');
  }
}
