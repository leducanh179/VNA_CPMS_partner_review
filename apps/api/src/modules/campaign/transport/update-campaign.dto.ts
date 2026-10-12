import {
  CAMPAIGN_LEVEL_CODES, CAMPAIGN_LIFECYCLE_STATES,
  type CampaignFieldValues, type CampaignLevelCode, type CampaignLifecycleState,
} from '@cpms/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CampaignV2OptionalFieldsDto } from './campaign-v2.dto';

export class UpdateCampaignDto extends CampaignV2OptionalFieldsDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(240)
  name?: string;

  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_LEVEL_CODES, nullable: true })
  @IsOptional() @IsIn(CAMPAIGN_LEVEL_CODES)
  levelCode?: CampaignLevelCode | null;

  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_LIFECYCLE_STATES })
  @IsOptional() @IsIn(CAMPAIGN_LIFECYCLE_STATES)
  lifecycleState?: CampaignLifecycleState;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) startDate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) endDate?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @IsObject() fieldValues?: CampaignFieldValues;

  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt() @Min(1)
  expectedVersion!: number;
}
