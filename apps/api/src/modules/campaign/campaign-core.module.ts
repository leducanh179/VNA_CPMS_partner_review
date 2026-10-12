import { Module } from '@nestjs/common';
import { SPREADSHEET_DOCUMENT_PORT } from '@cpms/integrations';
import { CatalogModule } from '../catalog/catalog.module';
import { CampaignApplicationService } from './application/campaign.application-service';
import { CampaignSpreadsheetApplicationService } from './application/campaign-spreadsheet.application-service';
import { CAMPAIGN_REPOSITORY } from './application/campaign.repository';
import { ExcelJsSpreadsheetAdapter } from './infrastructure/exceljs-spreadsheet.adapter';
import { PrismaCampaignRepository } from './infrastructure/prisma-campaign.repository';
import { ScopedCampaignApplicationService } from './application/scoped-campaign.application-service';
import { ScopedCampaignSpreadsheetApplicationService } from './application/scoped-campaign-spreadsheet.application-service';
import { CampaignOperationsApplicationService } from './application/campaign-operations.application-service';
import { CampaignOperationsRepository } from './application/campaign-operations.repository';
import { PrismaCampaignOperationsRepository } from './infrastructure/prisma-campaign-operations.repository';
import { CampaignFormDraftApplicationService } from './application/campaign-form-draft.application-service';
import { CampaignFormDraftRepository } from './application/campaign-form-draft.repository';
import { PrismaCampaignFormDraftRepository } from './infrastructure/prisma-campaign-form-draft.repository';

@Module({
  imports: [CatalogModule],
  providers: [
    CampaignOperationsApplicationService,
    CampaignFormDraftApplicationService,
    { provide: CampaignFormDraftRepository, useClass: PrismaCampaignFormDraftRepository },
    { provide: CampaignOperationsRepository, useClass: PrismaCampaignOperationsRepository },
    ScopedCampaignApplicationService,
    ScopedCampaignSpreadsheetApplicationService,
    { provide: CampaignApplicationService, useExisting: ScopedCampaignApplicationService },
    { provide: CampaignSpreadsheetApplicationService, useExisting: ScopedCampaignSpreadsheetApplicationService },
    PrismaCampaignRepository,
    ExcelJsSpreadsheetAdapter,
    { provide: CAMPAIGN_REPOSITORY, useExisting: PrismaCampaignRepository },
    { provide: SPREADSHEET_DOCUMENT_PORT, useExisting: ExcelJsSpreadsheetAdapter },
  ],
  exports: [CampaignApplicationService, CampaignSpreadsheetApplicationService, ScopedCampaignApplicationService, ScopedCampaignSpreadsheetApplicationService, CampaignOperationsApplicationService, CampaignFormDraftApplicationService],
})
export class CampaignCoreModule {}
