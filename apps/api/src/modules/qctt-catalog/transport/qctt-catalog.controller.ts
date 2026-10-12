import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { QcttCatalogApplicationService } from '../application/qctt-catalog.application-service';
@ApiTags('qctt-catalog-v1')
@Controller('catalogs/qctt')
export class QcttCatalogController {
  constructor(@Inject(QcttCatalogApplicationService) private readonly catalogs: QcttCatalogApplicationService) {}
  @Get() @ApiOperation({ summary: 'Read the versioned QCTT dictionary (Activity / Phương tiện)' })
  read() { return this.catalogs.read(); }
  @Post('commands') @ApiOperation({ summary: 'Apply audited inline dictionary changes, schema version 1' })
  command(@Body() body: unknown) { return this.catalogs.command(body); }
  @Post('import/preview') preview(@Body() body: unknown) { return this.catalogs.import(body, false); }
  @Post('import/apply') apply(@Body() body: unknown) { return this.catalogs.import(body, true); }
  @Get(':code/usage') usage(@Param('code') code: string) { return this.catalogs.usage(code); }
  @Get(':code/history') history(@Param('code') code: string) { return this.catalogs.history(code); }
}
