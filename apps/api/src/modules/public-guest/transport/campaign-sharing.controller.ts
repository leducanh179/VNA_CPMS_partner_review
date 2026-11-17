import type { ActorContext } from '@cpms/domain';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CampaignShareSpreadsheetApplicationService } from '../application/campaign-share-spreadsheet.application-service';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { CampaignSharingApplicationService } from '../application/campaign-sharing.application-service';

@ApiTags('campaign-sharing')
@Controller('campaign-shares')
export class CampaignSharingController {
  constructor(@Inject(CampaignSharingApplicationService) private readonly sharing: CampaignSharingApplicationService,
    @Inject(CampaignShareSpreadsheetApplicationService) private readonly spreadsheet: CampaignShareSpreadsheetApplicationService) {}

  @Get(':id/spreadsheet')
  @ApiOperation({ summary: 'Read the Google Sheet link for a managed campaign export' })
  spreadsheetStatus(@Param('id', ParseUUIDPipe) id: string) { return this.spreadsheet.status(id); }

  @Post(':id/spreadsheet')
  @ApiOperation({ summary: 'Export the saved public Campaign tabs to a managed Google Sheet' })
  publishSpreadsheet(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown, @CurrentActor() actor: ActorContext) {
    const parsed = z.object({ version: z.number().int().positive(), viewerEmail: z.string().trim().email().max(254).optional() }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Phiên bản quyền chia sẻ hoặc email Google không hợp lệ.');
    return this.spreadsheet.publish(id, parsed.data.version, actor, parsed.data.viewerEmail);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read the shared Campaign tabs for the current session' })
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: ActorContext) {
    return this.sharing.signedIn(id, actor);
  }

  @Get(':id/settings')
  @ApiOperation({ summary: 'Read Campaign link settings as creator or system administrator' })
  settings(@Param('id', ParseUUIDPipe) id: string) { return this.sharing.settings(id); }

  @Patch(':id/settings')
  @ApiOperation({ summary: 'Save versioned Campaign link settings and per-audience tabs' })
  change(@Param('id', ParseUUIDPipe) id: string, @Body() input: unknown, @CurrentActor() actor: ActorContext) {
    return this.sharing.change(id, input, actor);
  }
}
