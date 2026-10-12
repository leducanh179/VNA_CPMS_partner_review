import { Global, Module } from '@nestjs/common';
import { AccessApplicationService } from './application/access.application-service';
import { AccessRepository } from './application/access.repository';
import { PrismaAccessRepository } from './infrastructure/prisma-access.repository';
import { AccessAdministrationApplicationService } from './application/access-administration.application-service';
import { AccessAdministrationRepository } from './application/access-administration.repository';
import { PrismaAccessAdministrationRepository } from './infrastructure/prisma-access-administration.repository';
import { AccessAdministrationController } from './transport/access-administration.controller';

@Global()
@Module({ controllers: [AccessAdministrationController], providers: [AccessApplicationService, PrismaAccessRepository,
  { provide: AccessRepository, useExisting: PrismaAccessRepository }, AccessAdministrationApplicationService,
  { provide: AccessAdministrationRepository, useClass: PrismaAccessAdministrationRepository }], exports: [AccessApplicationService] })
export class AccessModule {}
