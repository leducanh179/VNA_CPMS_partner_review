import { Module } from '@nestjs/common';
import { IdentityApplicationService } from './application/identity.application-service';
import { IdentityRepository } from './application/identity.repository';
import { PrismaIdentityRepository } from './infrastructure/prisma-identity.repository';
import { IdentityController } from './transport/identity.controller';

@Module({ providers: [IdentityApplicationService, { provide: IdentityRepository, useClass: PrismaIdentityRepository }],
  controllers: [IdentityController], exports: [IdentityApplicationService, IdentityRepository] })
export class IdentityModule {}
