import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Get, Inject, Param, Put, ValidationPipe } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { GridDraftApplicationService } from '../application/grid-draft.application-service';

class SaveGridDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() value!: Record<string, unknown>;
}
@Controller('grid-drafts')
export class GridDraftController {
  constructor(@Inject(GridDraftApplicationService) private readonly drafts: GridDraftApplicationService) {}
  @Get(':scope') get(@CurrentActor() actor: ActorContext, @Param('scope') scope: string) { return this.drafts.get(actor, scope); }
  @Put(':scope') save(@CurrentActor() actor: ActorContext, @Param('scope') scope: string, @Body(new ValidationPipe({ expectedType: SaveGridDraftDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: SaveGridDraftDto) {
    return this.drafts.save(actor, scope, body.value, body.expectedVersion);
  }
}
