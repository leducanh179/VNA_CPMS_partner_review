import { Module } from '@nestjs/common';
import { QcttCatalogModule } from '../qctt-catalog/qctt-catalog.module';
import { CatalogApplicationService } from './application/catalog.application-service';
import { CATALOG_REPOSITORY } from './application/catalog.repository';
import { PrismaCatalogRepository } from './infrastructure/prisma-catalog.repository';
import { CatalogController } from './transport/catalog.controller';
import { ScopedCatalogApplicationService } from './application/scoped-catalog.application-service';

@Module({
  imports: [QcttCatalogModule],
  controllers: [CatalogController],
  providers: [
    ScopedCatalogApplicationService,
    { provide: CatalogApplicationService, useExisting: ScopedCatalogApplicationService },
    PrismaCatalogRepository,
    { provide: CATALOG_REPOSITORY, useExisting: PrismaCatalogRepository },
  ],
  exports: [CatalogApplicationService],
})
export class CatalogModule {}
