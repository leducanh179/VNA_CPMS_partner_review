import {
  CAMPAIGN_LEVEL_CODES, CAMPAIGN_LIFECYCLE_STATES,
  type CampaignFieldValues, type CampaignLevelCode, type CampaignLifecycleState,
} from '@cpms/domain';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty,
  IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CampaignV2OptionalFieldsDto } from './campaign-v2.dto';

export class CampaignBatchSaveItemDto extends CampaignV2OptionalFieldsDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(160) clientKey!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) @IsOptional() @IsUUID('4') id?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(80) @Matches(/^CPG-[A-Z0-9-]+$/i) code?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(240) name?: string;
  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_LEVEL_CODES, nullable: true }) @IsOptional() @IsIn(CAMPAIGN_LEVEL_CODES) levelCode?: CampaignLevelCode | null;
  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_LIFECYCLE_STATES }) @IsOptional() @IsIn(CAMPAIGN_LIFECYCLE_STATES) lifecycleState?: CampaignLifecycleState;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) @IsOptional() @IsDateString({ strict: true }) startDate?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) @IsOptional() @IsDateString({ strict: true }) endDate?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() fieldValues?: CampaignFieldValues;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class BatchSaveCampaignsDto {
  @ApiProperty({ type: () => [CampaignBatchSaveItemDto], maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true })
  @Type(() => CampaignBatchSaveItemDto)
  items!: CampaignBatchSaveItemDto[];
}
