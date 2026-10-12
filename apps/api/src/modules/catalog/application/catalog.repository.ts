import type {
  CampaignLevelCatalogItem,
  CampaignObjectiveCatalogItem,
  ContentPillarCatalogItem,
  MarketCatalogItem,
  MarketRegionCatalogItem,
  OrganizationUnitCatalogItem,
  PersonnelDirectoryCatalogItem,
  ProvinceCatalogItem,
} from '@cpms/domain';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface CatalogRepository {
  listCampaignLevels(): Promise<CampaignLevelCatalogItem[]>;
  findCampaignLevel(code: string): Promise<CampaignLevelCatalogItem | null>;
  listCampaignObjectives(): Promise<CampaignObjectiveCatalogItem[]>;
  findCampaignObjective(code: string): Promise<CampaignObjectiveCatalogItem | null>;
  listMarketRegions(): Promise<MarketRegionCatalogItem[]>;
  listActiveMarkets(): Promise<MarketCatalogItem[]>;
  listProvinces(): Promise<ProvinceCatalogItem[]>;
  findActiveProvinces(codes: string[]): Promise<ProvinceCatalogItem[]>;
  listActiveMarketsByRegion(regionCode: string): Promise<MarketCatalogItem[]>;
  findActiveMarkets(codes: string[]): Promise<MarketCatalogItem[]>;
  listOrganizationUnits(query: string, foreignBranchesOnly: boolean): Promise<OrganizationUnitCatalogItem[]>;
  findOrganizationUnits(codes: string[]): Promise<OrganizationUnitCatalogItem[]>;
  listPersonnel(query: string): Promise<PersonnelDirectoryCatalogItem[]>;
  findPersonnel(employeeCode: string): Promise<PersonnelDirectoryCatalogItem | null>;
  listContentPillars(year: number): Promise<ContentPillarCatalogItem[]>;
}
