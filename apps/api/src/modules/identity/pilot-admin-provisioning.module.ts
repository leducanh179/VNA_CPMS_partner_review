import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PilotAdminBootstrapApplicationService, PilotAdminBootstrapRepository } from './application/pilot-admin-bootstrap.application-service';
import { PrismaPilotAdminBootstrapRepository } from './infrastructure/prisma-pilot-admin-bootstrap.repository';

/** Private one-time CLI composition root. Deliberately has no HTTP controller. */
@Module({ imports: [PrismaModule], providers: [
  { provide: PilotAdminBootstrapRepository, useClass: PrismaPilotAdminBootstrapRepository },
  { provide: PilotAdminBootstrapApplicationService, inject: [PilotAdminBootstrapRepository],
    useFactory: (repository: PilotAdminBootstrapRepository) => new PilotAdminBootstrapApplicationService(repository) },
] })
export class PilotAdminProvisioningModule {}
