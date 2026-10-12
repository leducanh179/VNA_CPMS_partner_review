import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put, ValidationPipe } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { ContractFormDraftApplicationService } from '../application/contract-form-draft.application-service';

class SaveContractFormDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() value!: Record<string, unknown>;
}
const pipe = new ValidationPipe({ expectedType: SaveContractFormDraftDto, transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('contract-form-drafts')
export class ContractFormDraftController {
  constructor(@Inject(ContractFormDraftApplicationService) private readonly drafts: ContractFormDraftApplicationService) {}
  @Get() list(@CurrentActor() actor: ActorContext) { return this.drafts.list(actor); }
  @Get(':id') get(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.get(actor, id); }
  @Put(':id') save(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(pipe) body: SaveContractFormDraftDto) { return this.drafts.save(actor, id, body.value, body.expectedVersion); }
  @Delete(':id') remove(@CurrentActor() actor: ActorContext, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.drafts.remove(actor, id); }
}
