import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put, ValidationPipe } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignFormDraftApplicationService } from '../application/campaign-form-draft.application-service';

class SaveFormDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() value!: Record<string, unknown>;
}

const pipe = new ValidationPipe({ expectedType: SaveFormDraftDto, transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('campaign-form-drafts')
export class CampaignFormDraftController {
  constructor(@Inject(CampaignFormDraftApplicationService) private readonly drafts: CampaignFormDraftApplicationService) {}
  @Get() @RequirePermission('campaign.create') list(@CurrentActor() actor: ActorContext) { return this.drafts.list(actor); }
  @Get(':id') @RequirePermission('campaign.create') get(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.get(actor, id); }
  @Put(':id') @RequirePermission('campaign.create') save(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(pipe) body: SaveFormDraftDto) { return this.drafts.save(actor, id, body.value, body.expectedVersion); }
  @Delete(':id') @RequirePermission('campaign.create') remove(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.remove(actor, id); }
}
