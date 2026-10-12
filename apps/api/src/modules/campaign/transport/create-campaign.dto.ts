import {
  CAMPAIGN_LEVEL_CODES, CAMPAIGN_LIFECYCLE_STATES,
  type CampaignFieldValues, type CampaignLevelCode, type CampaignLifecycleState,
} from '@cpms/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CampaignV2OptionalFieldsDto } from './campaign-v2.dto';

export class CreateCampaignDto extends CampaignV2OptionalFieldsDto {
  @ApiPropertyOptional({ type: String, example: 'CPG-202605-AMS1' })
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^CPG-[A-Z0-9-]+$/i)
  code?: string;

  @ApiProperty({ type: String, example: 'Ưu đãi mùa thu' })
  @IsString() @IsNotEmpty() @MaxLength(240)
  name!: string;

  @ApiProperty({ type: String, enum: CAMPAIGN_LEVEL_CODES, example: 'CLV_01' })
  @IsIn(CAMPAIGN_LEVEL_CODES)
  levelCode!: CampaignLevelCode;

  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_LIFECYCLE_STATES, example: 'DRAFT' })
  @IsOptional() @IsIn(CAMPAIGN_LIFECYCLE_STATES)
  lifecycleState?: CampaignLifecycleState;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) startDate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) endDate?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @IsObject() fieldValues?: CampaignFieldValues;
}
