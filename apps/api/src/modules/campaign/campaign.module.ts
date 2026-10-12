import { Module } from '@nestjs/common';
import { QcttPlanModule } from '../qctt-plan/qctt-plan.module';
import { CampaignDriveModule } from '../campaign-drive/campaign-drive.module';
import { CampaignCoreModule } from './campaign-core.module';
import { CampaignController } from './transport/campaign.controller';
import { CampaignOperationsController } from './transport/campaign-operations.controller';
import { CampaignFormDraftController } from './transport/campaign-form-draft.controller';

@Module({
  imports: [CampaignCoreModule, CampaignDriveModule, QcttPlanModule],
  controllers: [CampaignController, CampaignOperationsController, CampaignFormDraftController],
})
export class CampaignModule {}
