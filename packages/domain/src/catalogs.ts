import type { CampaignLevelCode, CampaignObjectiveCode } from './campaign';

export interface CampaignLevelCatalogItem {
  code: CampaignLevelCode;
  label: string;
  ruleDescription: string;
  displayOrder: number;
}

export interface CampaignObjectiveCatalogItem {
  code: CampaignObjectiveCode;
  label: string;
  requiresOtherText: boolean;
  displayOrder: number;
}

export interface MarketCatalogItem {
  code: string;
  name: string;
  regionCode: string;
  displayOrder: number;
  isActive: boolean;
}

export interface MarketRegionCatalogItem {
  code: string;
  name: string;
  displayOrder: number;
  markets: MarketCatalogItem[];
}

export interface MarketRegionCatalogResponse {
  regions: MarketRegionCatalogItem[];
  globalPreset: { code: 'GLOBAL'; label: 'Toàn cầu'; marketCodes: string[] };
}

export interface ProvinceCatalogItem {
  code: string;
  name: string;
  displayOrder: number;
}

export interface OrganizationUnitCatalogItem {
  code: string;
  displayName: string;
  sourceName: string | null;
  category: 'QUICK_SELECT' | 'FOREIGN_BRANCH';
  sourceProvider: string;
  sourceUnitId: string | null;
  sourceUnitCode: string | null;
  marketCode: string | null;
}

export interface PersonnelDirectoryCatalogItem {
  employeeCode: string;
  fullName: string;
  organizationCode: string | null;
  organizationName: string;
  departmentName: string | null;
  jobTitle: string | null;
  email: string | null;
}

export interface ContentPillarCatalogItem {
  code: string;
  label: string;
  year: number;
  level: number;
  parentCode: string | null;
}
