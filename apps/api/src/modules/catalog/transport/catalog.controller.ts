import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/permission.guard';
import { CatalogApplicationService } from '../application/catalog.application-service';

@ApiTags('catalogs')
@Controller('catalogs')
export class CatalogController {
  constructor(@Inject(CatalogApplicationService) private readonly catalogs: CatalogApplicationService) {}

  @Get('campaign-levels')
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List the three active Campaign level definitions' })
  listCampaignLevels() {
    return this.catalogs.listCampaignLevels();
  }

  @Get('campaign-objectives')
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List the five active primary Campaign objectives' })
  listCampaignObjectives() {
    return this.catalogs.listCampaignObjectives();
  }

  @Get('market-regions')
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List active regions, markets, and the computed Global preset' })
  listMarketRegions() {
    return this.catalogs.listMarketRegions();
  }

  @Get('organization-units')
  @RequirePermission('campaign.read')
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'foreignBranches', required: false, type: Boolean })
  @ApiOperation({ summary: 'Search active organization units and foreign branches' })
  listOrganizationUnits(@Query('query') query?: string, @Query('foreignBranches') foreignBranches?: string) {
    return this.catalogs.listOrganizationUnits(query, foreignBranches === 'true');
  }

  @Get('provinces')
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List current Vietnamese provinces and centrally governed cities' })
  listProvinces() {
    return this.catalogs.listProvinces();
  }

  @Get('personnel')
  @RequirePermission('campaign.read')
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiOperation({ summary: 'Search the demo personnel directory by code, name, email, unit, or department' })
  listPersonnel(@Query('query') query?: string) {
    return this.catalogs.listPersonnel(query);
  }

  @Get('content-pillars')
  @RequirePermission('campaign.read')
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiOperation({ summary: 'List the active parent-child content pillar catalog for a year' })
  listContentPillars(@Query('year') year?: string) {
    const parsed = Number.parseInt(year ?? '2026', 10);
    return this.catalogs.listContentPillars(Number.isFinite(parsed) ? parsed : 2026);
  }
}
