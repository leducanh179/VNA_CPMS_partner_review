import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put, ValidationPipe } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { MaterialFormDraftApplicationService } from '../application/material-form-draft.application-service';

class SaveMaterialFormDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() value!: Record<string, unknown>;
}

const pipe = new ValidationPipe({ expectedType: SaveMaterialFormDraftDto, transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('material-form-drafts')
export class MaterialFormDraftController {
  constructor(@Inject(MaterialFormDraftApplicationService) private readonly drafts: MaterialFormDraftApplicationService) {}
  @Get() @RequirePermission('material.create') list(@CurrentActor() actor: ActorContext) { return this.drafts.list(actor); }
  @Get(':id') @RequirePermission('material.create') get(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.get(actor, id); }
  @Put(':id') @RequirePermission('material.create') save(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(pipe) body: SaveMaterialFormDraftDto) { return this.drafts.save(actor, id, body.value, body.expectedVersion); }
  @Delete(':id') @RequirePermission('material.create') remove(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.remove(actor, id); }
}
