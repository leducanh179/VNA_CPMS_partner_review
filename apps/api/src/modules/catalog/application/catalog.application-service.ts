import type {
  CampaignLevelCode,
  CampaignMarketSelectionOrigin,
  CampaignObjectiveCode,
  MarketRegionCatalogResponse,
  OrganizationUnitCatalogItem,
  PersonnelDirectoryCatalogItem,
} from '@cpms/domain';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CATALOG_REPOSITORY, type CatalogRepository } from './catalog.repository';

@Injectable()
export class CatalogApplicationService {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly repository: CatalogRepository) {}

  listCampaignLevels() {
    return this.repository.listCampaignLevels();
  }

  findCampaignLevel(code: CampaignLevelCode) {
    return this.repository.findCampaignLevel(code);
  }

  listCampaignObjectives() {
    return this.repository.listCampaignObjectives();
  }

  findCampaignObjective(code: CampaignObjectiveCode) {
    return this.repository.findCampaignObjective(code);
  }

  async listMarketRegions(): Promise<MarketRegionCatalogResponse> {
    const [regions, activeMarkets] = await Promise.all([
      this.repository.listMarketRegions(),
      this.repository.listActiveMarkets(),
    ]);
    return {
      regions,
      globalPreset: { code: 'GLOBAL', label: 'Toàn cầu', marketCodes: activeMarkets.map((market) => market.code) },
    };
  }

  listOrganizationUnits(query = '', foreignBranchesOnly = false) {
    return this.repository.listOrganizationUnits(query.trim(), foreignBranchesOnly);
  }

  listProvinces() {
    return this.repository.listProvinces();
  }

  async requireProvinces(codes: string[]): Promise<string[]> {
    const uniqueCodes = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (uniqueCodes.length === 0) return [];
    const found = await this.repository.findActiveProvinces(uniqueCodes);
    const known = new Set(found.map((province) => province.code));
    const invalid = uniqueCodes.filter((code) => !known.has(code));
    if (invalid.length) throw new BadRequestException(`Mã tỉnh/thành không hợp lệ: ${invalid.join(', ')}.`);
    return uniqueCodes;
  }

  listPersonnel(query = '') {
    return this.repository.listPersonnel(query.trim());
  }

  listContentPillars(year = 2026) {
    return this.repository.listContentPillars(year);
  }

  findPersonnel(employeeCode: string): Promise<PersonnelDirectoryCatalogItem | null> {
    return this.repository.findPersonnel(employeeCode);
  }

  async resolveMarketSelection(
    requestedCodes: string[] | undefined,
    origin: CampaignMarketSelectionOrigin | undefined,
    selectionCode: string | null | undefined,
  ) {
    const selectedOrigin = origin ?? 'CUSTOM';
    if (selectedOrigin === 'GLOBAL') {
      const markets = await this.repository.listActiveMarkets();
      return { marketCodes: markets.map((market) => market.code), origin: selectedOrigin, selectionCode: 'GLOBAL' as const };
    }
    if (selectedOrigin === 'REGION') {
      const regionCode = selectionCode?.trim().toUpperCase();
      if (!regionCode) throw new BadRequestException('marketSelectionCode is required for a REGION selection.');
      const markets = await this.repository.listActiveMarketsByRegion(regionCode);
      if (markets.length === 0) throw new BadRequestException(`Market region ${regionCode} was not found or has no active markets.`);
      return { marketCodes: markets.map((market) => market.code), origin: selectedOrigin, selectionCode: regionCode };
    }
    if (selectedOrigin === 'LEGACY') throw new BadRequestException('LEGACY market selection is reserved for controlled normalization.');

    const marketCodes = [...new Set((requestedCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))];
    if (origin === 'CUSTOM' && requestedCodes !== undefined && marketCodes.length === 0) {
      throw new BadRequestException('A CUSTOM market selection must contain at least one market code.');
    }
    if (marketCodes.length === 0) return { marketCodes: [], origin: selectedOrigin, selectionCode: null };
    const markets = await this.repository.findActiveMarkets(marketCodes);
    const found = new Set(markets.map((market) => market.code));
    const invalid = marketCodes.filter((code) => !found.has(code));
    if (invalid.length > 0) throw new BadRequestException(`Unknown or inactive market code(s): ${invalid.join(', ')}.`);
    return { marketCodes, origin: selectedOrigin, selectionCode: null };
  }

  async requireOrganizationUnits(codes: string[]): Promise<OrganizationUnitCatalogItem[]> {
    const uniqueCodes = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (uniqueCodes.length === 0) return [];
    const units = await this.repository.findOrganizationUnits(uniqueCodes);
    const found = new Set(units.map((unit) => unit.code));
    const invalid = uniqueCodes.filter((code) => !found.has(code));
    if (invalid.length > 0) throw new BadRequestException(`Unknown or inactive organization unit code(s): ${invalid.join(', ')}.`);
    return units;
  }
}
