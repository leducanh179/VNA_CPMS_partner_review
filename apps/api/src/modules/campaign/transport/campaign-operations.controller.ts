import { Body, Controller, Get, Inject, Param, Post, ValidationPipe } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';
import type { ActorContext } from '@cpms/domain';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { CampaignOperationsApplicationService } from '../application/campaign-operations.application-service';
import { ScopedDriveOrchestrationService } from '../../campaign-drive/application/scoped-drive-orchestration.service';
import { CreateCampaignDto } from './create-campaign.dto';
import { UpdateCampaignDto } from './update-campaign.dto';
const pipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });
class CampaignEditProposalDto extends UpdateCampaignDto {
  @ApiProperty({ type: String, description: 'Bắt buộc khi thao tác Sửa đổi vẫn cần Lãnh đạo Phòng phê duyệt.' }) @IsString() @MaxLength(1000) reason!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() idempotencyKey!: string;
}
class CreateAndSubmitDto extends CreateCampaignDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() idempotencyKey!: string;
}
@Controller('campaign-operations')
export class CampaignOperationsController {
  constructor(@Inject(CampaignOperationsApplicationService) private readonly service: CampaignOperationsApplicationService,
    @Inject(ScopedDriveOrchestrationService) private readonly driveOrchestration: ScopedDriveOrchestrationService) {}
  @Post('create-and-submit') create(@CurrentActor() actor: ActorContext, @Body(pipe(CreateAndSubmitDto)) input: CreateAndSubmitDto) { const { idempotencyKey, ...command } = input; return this.driveOrchestration.createAndSubmit(actor, command, idempotencyKey); }
  @Get(':id') read(@CurrentActor() actor: ActorContext, @Param('id') id: string) { return this.service.read(actor, id); }
  @Post(':id/changes') requestEdit(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body(pipe(CampaignEditProposalDto)) input: CampaignEditProposalDto) {
    const { reason, idempotencyKey, ...command } = input;
    return this.service.requestEdit(actor, id, command, reason, idempotencyKey);
  }
  @Post(':id/commands') command(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() input: unknown) { return this.driveOrchestration.command(actor, id, input); }
}
