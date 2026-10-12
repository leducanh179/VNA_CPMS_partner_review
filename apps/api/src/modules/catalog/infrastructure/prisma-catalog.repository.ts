import type {
  CampaignLevelCatalogItem,
  CampaignLevelCode,
  CampaignObjectiveCatalogItem,
  CampaignObjectiveCode,
  ContentPillarCatalogItem,
  MarketCatalogItem,
  MarketRegionCatalogItem,
  OrganizationUnitCatalogItem,
  PersonnelDirectoryCatalogItem,
  ProvinceCatalogItem,
} from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QcttCatalogRepository } from '../../qctt-catalog/application/qctt-catalog.repository';
import { qcttCatalogAvailable } from '@cpms/domain';
import type { CatalogRepository } from '../application/catalog.repository';

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QcttCatalogRepository) private readonly qcttCatalog: QcttCatalogRepository) {}

  async listCampaignLevels(): Promise<CampaignLevelCatalogItem[]> {
    const rows = await this.prisma.database.campaignLevel.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
    return rows.map((row) => ({ ...row, code: row.code as CampaignLevelCode }));
  }

  async findCampaignLevel(code: string): Promise<CampaignLevelCatalogItem | null> {
    const row = await this.prisma.database.campaignLevel.findFirst({ where: { code, isActive: true } });
    return row ? { ...row, code: row.code as CampaignLevelCode } : null;
  }

  async listCampaignObjectives(): Promise<CampaignObjectiveCatalogItem[]> {
    const rows = await this.prisma.database.campaignObjective.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
    return rows.map((row) => ({ ...row, code: row.code as CampaignObjectiveCode }));
  }

  async findCampaignObjective(code: string): Promise<CampaignObjectiveCatalogItem | null> {
    const row = await this.prisma.database.campaignObjective.findFirst({ where: { code, isActive: true } });
    return row ? { ...row, code: row.code as CampaignObjectiveCode } : null;
  }

  async listMarketRegions(): Promise<MarketRegionCatalogItem[]> {
    const regions = await this.prisma.database.marketRegion.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: { markets: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } } },
    });
    return regions.map((region) => ({
      code: region.code,
      name: region.name,
      displayOrder: region.displayOrder,
      markets: region.markets.map((market) => ({
        code: market.code,
        name: market.name,
        regionCode: market.regionCode,
        displayOrder: market.displayOrder,
        isActive: market.isActive,
      })),
    }));
  }

  listActiveMarkets(): Promise<MarketCatalogItem[]> {
    return this.prisma.database.market.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
  }

  listProvinces(): Promise<ProvinceCatalogItem[]> {
    return this.prisma.database.province.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' }, select: { code: true, name: true, displayOrder: true } });
  }

  findActiveProvinces(codes: string[]): Promise<ProvinceCatalogItem[]> {
    return this.prisma.database.province.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true, name: true, displayOrder: true } });
  }

  listActiveMarketsByRegion(regionCode: string): Promise<MarketCatalogItem[]> {
    return this.prisma.database.market.findMany({ where: { regionCode, isActive: true }, orderBy: { displayOrder: 'asc' } });
  }

  findActiveMarkets(codes: string[]): Promise<MarketCatalogItem[]> {
    return this.prisma.database.market.findMany({ where: { code: { in: codes }, isActive: true }, orderBy: { displayOrder: 'asc' } });
  }

  async listOrganizationUnits(query: string, foreignBranchesOnly: boolean): Promise<OrganizationUnitCatalogItem[]> {
    const units = await this.prisma.database.organizationUnit.findMany({
      where: {
        isActive: true,
        ...(foreignBranchesOnly ? { category: 'FOREIGN_BRANCH' } : {}),
        ...(query ? { OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
          { sourceName: { contains: query, mode: 'insensitive' } },
          { sourceUnitCode: { contains: query, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
      take: 100,
    });
    return units.map((unit) => ({ ...unit, category: unit.category as OrganizationUnitCatalogItem['category'] }));
  }

  async findOrganizationUnits(codes: string[]): Promise<OrganizationUnitCatalogItem[]> {
    const units = await this.prisma.database.organizationUnit.findMany({ where: { code: { in: codes }, isActive: true } });
    return units.map((unit) => ({ ...unit, category: unit.category as OrganizationUnitCatalogItem['category'] }));
  }

  async listPersonnel(query: string): Promise<PersonnelDirectoryCatalogItem[]> {
    return this.prisma.database.personnelDirectoryEntry.findMany({
      where: {
        isActive: true,
        ...(query ? { OR: [
          { employeeCode: { contains: query, mode: 'insensitive' } },
          { fullName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { organizationCode: { contains: query, mode: 'insensitive' } },
          { organizationName: { contains: query, mode: 'insensitive' } },
          { departmentName: { contains: query, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ fullName: 'asc' }, { employeeCode: 'asc' }],
      take: 100,
      select: {
        employeeCode: true, fullName: true, organizationCode: true,
        organizationName: true, departmentName: true, jobTitle: true, email: true,
      },
    });
  }

  findPersonnel(employeeCode: string): Promise<PersonnelDirectoryCatalogItem | null> {
    return this.prisma.database.personnelDirectoryEntry.findFirst({
      where: { employeeCode, isActive: true },
      select: {
        employeeCode: true, fullName: true, organizationCode: true,
        organizationName: true, departmentName: true, jobTitle: true, email: true,
      },
    });
  }

  async listContentPillars(year: number): Promise<ContentPillarCatalogItem[]> {
    const entries = await this.qcttCatalog.entries(), day = new Date().toISOString().slice(0,10);
    return entries.filter(e => (e.kind === 'PILLAR' || e.kind === 'TOPIC') && e.year === year && qcttCatalogAvailable(e,day)
      && (e.kind !== 'TOPIC' || entries.some(p => p.code === e.parentCode && qcttCatalogAvailable(p,day))))
      .map(e => ({ code:e.code,label:e.name,year:e.year!,level:e.kind === 'PILLAR' ? 1 : 2,parentCode:e.parentCode }))
      .sort((a,b) => a.level-b.level || a.code.localeCompare(b.code));
  }
}
