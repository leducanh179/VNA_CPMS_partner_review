import { Module } from '@nestjs/common';
import { EngagementApplicationService } from './application/engagement.application-service';
import { EngagementRepository } from './application/engagement.repository';
import { PrismaEngagementRepository } from './infrastructure/prisma-engagement.repository';
import { EngagementController } from './transport/engagement.controller';
@Module({ exports: [EngagementApplicationService], controllers: [EngagementController], providers: [EngagementApplicationService, { provide: EngagementRepository, useClass: PrismaEngagementRepository }] })
export class EngagementModule {}
