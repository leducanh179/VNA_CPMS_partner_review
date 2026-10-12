import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { QcttPlanApplicationService } from './application/qctt-plan.application-service';
import { QcttPlanRepository } from './application/qctt-plan.repository';
import { PrismaQcttPlanRepository } from './infrastructure/prisma-qctt-plan.repository';
import { QcttPlanController, QcttPlanListController } from './transport/qctt-plan.controller';
@Module({ imports: [ContractsModule], providers: [QcttPlanApplicationService, { provide: QcttPlanRepository, useClass: PrismaQcttPlanRepository }],
  controllers: [QcttPlanController, QcttPlanListController], exports: [QcttPlanApplicationService] })
export class QcttPlanModule {}
