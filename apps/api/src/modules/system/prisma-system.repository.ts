import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SystemRepository } from './system.application-service';

@Injectable()
export class PrismaSystemRepository extends SystemRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async checkDatabase(): Promise<void> { await this.prisma.database.$queryRaw`SELECT 1`; }
}
