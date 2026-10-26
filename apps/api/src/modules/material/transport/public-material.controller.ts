import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicMaterialApplicationService } from '../application/public-material.application-service';

@ApiTags('public-materials')
@Controller('public/materials')
export class PublicMaterialController {
  constructor(@Inject(PublicMaterialApplicationService) private readonly materials: PublicMaterialApplicationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Anonymous, paginated public material allowlist; never internal fields' })
  list(@Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.materials.list({ ...(q ? { q } : {}), ...(page ? { page } : {}), ...(pageSize ? { pageSize } : {}) }); }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a saved SHARED material; missing/private/Trash use the same 404' })
  detail(@Param('id') id: string) { return this.materials.detail(id); }
}
