import { Module } from '@nestjs/common';
import { GridDraftApplicationService } from './application/grid-draft.application-service';
import { GridDraftRepository } from './application/grid-draft.repository';
import { PrismaGridDraftRepository } from './infrastructure/prisma-grid-draft.repository';
import { GridDraftController } from './transport/grid-draft.controller';

@Module({ controllers: [GridDraftController], providers: [GridDraftApplicationService,
  { provide: GridDraftRepository, useClass: PrismaGridDraftRepository }] })
export class GridDraftModule {}
