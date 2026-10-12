import type { ActorContext } from '@cpms/domain';
import { Controller, Get, Inject, Query, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignJournalApplicationService } from '../application/campaign-journal.application-service';
import { CampaignJournalListQueryDto } from './campaign-collaboration.dto';

@ApiTags('campaign-journal')
@Controller('campaign-journal')
export class CampaignJournalController {
  constructor(@Inject(CampaignJournalApplicationService) private readonly journal: CampaignJournalApplicationService) {}

  @Get()
  @RequirePermission('campaign.journal.read')
  @ApiOperation({ summary: 'List the user-facing projection of major Campaign audit events' })
  list(
    @Query(new ValidationPipe({ expectedType: CampaignJournalListQueryDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) query: CampaignJournalListQueryDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.journal.list(query, actor); }
}
