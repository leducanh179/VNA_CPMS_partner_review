import type { CampaignLevelCode, CampaignMarketSelectionOrigin, CampaignObjectiveCode } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { CatalogApplicationService } from './catalog.application-service';
import { CATALOG_REPOSITORY, type CatalogRepository } from './catalog.repository';

/** Authenticated minimal reference data; a record-specific grant never needs a global Campaign role. */
@Injectable()
export class ScopedCatalogApplicationService extends CatalogApplicationService {
  constructor(@Inject(CATALOG_REPOSITORY) repository: CatalogRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(repository); }
  @AccessBoundary()
  override async listCampaignLevels() { return super.listCampaignLevels(); }
  @AccessBoundary()
  override async findCampaignLevel(code: CampaignLevelCode) { return super.findCampaignLevel(code); }
  @AccessBoundary()
  override async listCampaignObjectives() { return super.listCampaignObjectives(); }
  @AccessBoundary()
  override async findCampaignObjective(code: CampaignObjectiveCode) { return super.findCampaignObjective(code); }
  @AccessBoundary()
  override async listMarketRegions() { return super.listMarketRegions(); }
  @AccessBoundary()
  override async listOrganizationUnits(query = '', foreignBranchesOnly = false) { return super.listOrganizationUnits(query, foreignBranchesOnly); }
  @AccessBoundary()
  override async listPersonnel(query = '') { return super.listPersonnel(query); }
  @AccessBoundary()
  override async listContentPillars(year = 2026) { return super.listContentPillars(year); }
  @AccessBoundary()
  override async findPersonnel(employeeCode: string) { return super.findPersonnel(employeeCode); }
  @AccessBoundary()
  override async resolveMarketSelection(codes: string[] | undefined, origin: CampaignMarketSelectionOrigin | undefined, code: string | null | undefined) {
    return super.resolveMarketSelection(codes, origin, code);
  }
  @AccessBoundary()
  override async requireOrganizationUnits(codes: string[]) { return super.requireOrganizationUnits(codes); }
}
