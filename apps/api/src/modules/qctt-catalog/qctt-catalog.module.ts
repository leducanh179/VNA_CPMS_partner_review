import { Module } from '@nestjs/common';
import { QcttCatalogApplicationService } from './application/qctt-catalog.application-service';
import { QcttCatalogRepository } from './application/qctt-catalog.repository';
import { PrismaQcttCatalogRepository } from './infrastructure/prisma-qctt-catalog.repository';
import { QcttCatalogController } from './transport/qctt-catalog.controller';
@Module({ controllers: [QcttCatalogController], providers: [QcttCatalogApplicationService,
  { provide: QcttCatalogRepository, useClass: PrismaQcttCatalogRepository }],
  exports: [QcttCatalogApplicationService, QcttCatalogRepository] })
export class QcttCatalogModule {}
