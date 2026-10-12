import type { AccessPermission, ActorContext, MaterialBatchSaveItem, MaterialBulkAction, MaterialBulkActionItem, Permission } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { MaterialApplicationService } from './material.application-service';
import { MATERIAL_REPOSITORY, type MaterialRepository } from './material.repository';

@Injectable()
export class ScopedMaterialApplicationService extends MaterialApplicationService {
  constructor(@Inject(MATERIAL_REPOSITORY) repository: MaterialRepository,
    @Inject(ScopedCampaignApplicationService) private readonly campaigns: ScopedCampaignApplicationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(repository); }
  @AccessBoundary()
  override async list(includeDeleted = false) {
    this.access.require('material.read');
    if (includeDeleted) this.access.require('material.manage');
    return super.list(includeDeleted);
  }
  @AccessBoundary()
  override async bootstrap() {
    this.access.require('material.read');
    const result = await super.bootstrap();
    const visible = await this.campaigns.list();
    return { ...result, users: this.access.check('access.manage').allowed ? result.users : [],
      campaigns: visible.map((campaign) => ({ campaign_id: campaign.id, campaign_code: campaign.code, campaign_name: campaign.name, market_codes: campaign.markets.map((market) => market.marketCode) })) };
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
    this.access.require('material.read');
    return super.batchSave(items, actor);
  }
  @AccessBoundary(2)
  override async bulkAction(items: readonly MaterialBulkActionItem[], action: MaterialBulkAction, actor: ActorContext, reason?: string) {
    this.access.require('material.read');
    return super.bulkAction(items, action, actor, reason);
  }
  @AccessBoundary(2)
  override async purge(materialId: string, expectedVersion: number, actor: ActorContext) {
    this.access.require('material.manage');
    this.access.require('system.manage');
    return super.purge(materialId, expectedVersion, actor);
  }
  protected override canPerform(_actor: ActorContext, permission: Permission) {
    // These callers only produce module-level material actions; Campaign role rules cannot match them.
    if (!permission.startsWith('material.') || !this.access.check(permission as AccessPermission).allowed) return false;
    this.access.require(permission as AccessPermission);
    return true;
  }
}
