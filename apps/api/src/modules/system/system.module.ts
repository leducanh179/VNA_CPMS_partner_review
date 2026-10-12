import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemApplicationService, SystemRepository } from './system.application-service';
import { PrismaSystemRepository } from './prisma-system.repository';

@Module({ controllers: [SystemController], providers: [SystemApplicationService, { provide: SystemRepository, useClass: PrismaSystemRepository }] })
export class SystemModule {}
