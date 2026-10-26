import type { AccessPermission, ActorContext, MaterialBatchSaveItem, MaterialBulkAction, MaterialBulkActionItem, Permission, MaterialSummary, MaterialCapabilities } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { MaterialApplicationService } from './material.application-service';
import { MATERIAL_REPOSITORY, type MaterialRepository } from './material.repository';
import { MaterialSharingApplicationService } from './material-sharing.application-service';

@Injectable()
export class ScopedMaterialApplicationService extends MaterialApplicationService {
  constructor(@Inject(MATERIAL_REPOSITORY) repository: MaterialRepository,
    @Inject(ScopedCampaignApplicationService) private readonly campaigns: ScopedCampaignApplicationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
    @Inject(MaterialSharingApplicationService) private readonly sharing: MaterialSharingApplicationService) { super(repository); }
  @AccessBoundary()
  override async list(includeDeleted = false) {
    if (includeDeleted) this.access.require('material.manage');
    return this.sharing.visible(await super.list(includeDeleted));
  }
  @AccessBoundary()
  override async bootstrap() {
    const result = await super.bootstrap();
    const visible = await this.campaigns.list();
    const materials = await this.list();
    return { ...result, users: [], fieldRules: [], roleRules: [], settings: {},
      options: { ...result.options, materialTypes: [...new Set(materials.map(m => m.fields.material_type || '').filter(Boolean))] },
      campaigns: visible.map((campaign) => ({ campaign_id: campaign.id, campaign_code: campaign.code, campaign_name: campaign.name, market_codes: campaign.markets.map((market) => market.marketCode), effectiveStartDate: campaign.effectiveStartDate ?? null, effectiveEndDate: campaign.effectiveEndDate ?? null, departureStartDate: campaign.departureStartDate ?? null, departureEndDate: campaign.departureEndDate ?? null })) };
  }
  protected override async selectableCampaigns() {
    return (await this.campaigns.list()).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      code: campaign.code,
      marketCodes: campaign.markets.map((market) => market.marketCode),
    }));
  }
  @AccessBoundary(1)
  override async batchSave(items: readonly MaterialBatchSaveItem[], actor: ActorContext) {
    const result = await super.batchSave(items, actor);
    for (const item of result.items) if (item.material) item.material = await this.sharing.project(item.material);
    return result;
  }
  @AccessBoundary(2)
  override async bulkAction(items: readonly MaterialBulkActionItem[], action: MaterialBulkAction, actor: ActorContext, reason?: string) {
    const result = await super.bulkAction(items, action, actor, reason);
    for (const item of result.items) if (item.material) {
      const capabilities = await this.sharing.capabilities(item.material);
      if (capabilities.view) item.material = await this.sharing.project(item.material);
      else item.material = { ...item.material, fields: {}, capabilities,
        ...(item.material.sharing ? { sharing: { ...item.material.sharing, ownerActorId: null, campaignIds: [], grants: [] } } : {}) };
    }
    return result;
  }
  @AccessBoundary(2)
  override async purge(materialId: string, expectedVersion: number, actor: ActorContext) {
    this.access.require('material.manage');
    this.access.require('system.manage');
    return super.purge(materialId, expectedVersion, actor);
  }
  protected override canPerform(_actor: ActorContext, permission: Permission) {
    // These callers only produce module-level material actions; Campaign role rules cannot match them.
    if (!permission.startsWith('material.')) return false;
    const decision = this.access.check(permission as AccessPermission);
    if (decision.allowed) this.access.require(permission as AccessPermission);
    return decision.allowed || permission !== 'material.create' && decision.reason === 'DEFAULT_DENY';
  }
  protected override async authorizeRecord(record: MaterialSummary, action: keyof MaterialCapabilities) { await this.sharing.require(record, action); }
  protected override async initialSharing(item: MaterialBatchSaveItem, actor: ActorContext) {
    return { ...await this.sharing.validate(item.sharing ?? { mode: 'SHARED', campaignIds: [], grants: [] }), ownerActorId: actor.id };
  }
}
