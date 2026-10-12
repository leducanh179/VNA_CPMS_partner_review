import { Module } from '@nestjs/common';
import { MaterialApplicationService } from './application/material.application-service';
import { MATERIAL_REPOSITORY } from './application/material.repository';
import { PrismaMaterialRepository } from './infrastructure/prisma-material.repository';
import { MaterialController } from './transport/material.controller';
import { ScopedMaterialApplicationService } from './application/scoped-material.application-service';
import { CampaignCoreModule } from '../campaign/campaign-core.module';
import { MaterialCollaborationApplicationService } from './application/material-collaboration.application-service';
import { MATERIAL_COLLABORATION_REPOSITORY } from './application/material-collaboration.repository';
import { PrismaMaterialCollaborationRepository } from './infrastructure/prisma-material-collaboration.repository';
import { MaterialFormDraftController } from './transport/material-form-draft.controller';
import { MaterialFormDraftApplicationService } from './application/material-form-draft.application-service';
import { MaterialFormDraftRepository } from './application/material-form-draft.repository';
import { PrismaMaterialFormDraftRepository } from './infrastructure/prisma-material-form-draft.repository';

@Module({
  imports: [CampaignCoreModule],
  controllers: [MaterialController, MaterialFormDraftController],
  providers: [
    ScopedMaterialApplicationService,
    MaterialCollaborationApplicationService,
    MaterialFormDraftApplicationService,
    { provide: MaterialFormDraftRepository, useClass: PrismaMaterialFormDraftRepository },
    { provide: MaterialApplicationService, useExisting: ScopedMaterialApplicationService },
    PrismaMaterialRepository,
    PrismaMaterialCollaborationRepository,
    { provide: MATERIAL_COLLABORATION_REPOSITORY, useExisting: PrismaMaterialCollaborationRepository },
    { provide: MATERIAL_REPOSITORY, useExisting: PrismaMaterialRepository },
  ],
})
export class MaterialModule {}
