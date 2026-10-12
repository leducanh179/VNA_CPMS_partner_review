import {
  CAMPAIGN_MARKET_SELECTION_ORIGINS,
  CAMPAIGN_OBJECTIVE_CODES,
  type CampaignMarketSelectionOrigin,
  type CampaignObjectiveCode,
  type CampaignRichTextDocument,
} from '@cpms/domain';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class CampaignAdditionalInformationDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(80) id!: string;
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(160) label!: string;
  @ApiProperty({ type: String }) @IsString() @MaxLength(4_000) value!: string;
  @ApiProperty({ type: Number, minimum: 0 }) @IsInt() @Min(0) order!: number;
}

export class CampaignRequestingUnitDto {
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(80) unitCode?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(240) customName?: string;
}

export abstract class CampaignV2OptionalFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160) requestingUnit?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) effectiveStartDate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional() @IsDateString({ strict: true }) effectiveEndDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(80) requestingEmployeeCode?: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  @IsOptional() @IsEmail() @MaxLength(320) manualRequesterEmail?: string | null;

  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_OBJECTIVE_CODES, nullable: true })
  @IsOptional() @IsIn(CAMPAIGN_OBJECTIVE_CODES) primaryObjectiveCode?: CampaignObjectiveCode | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(1_000) primaryObjectiveOther?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(4_000) kpiText?: string | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  @IsOptional() @IsObject() descriptionRichText?: CampaignRichTextDocument | null;

  @ApiPropertyOptional({ type: () => [CampaignAdditionalInformationDto], maxItems: 10 })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true })
  @Type(() => CampaignAdditionalInformationDto)
  additionalInformation?: CampaignAdditionalInformationDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(27) @IsString({ each: true })
  marketCodes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Official two-digit Vietnamese province codes; empty means nationwide when VN is selected.' })
  @IsOptional() @IsArray() @ArrayMaxSize(34) @IsString({ each: true })
  provinceCodes?: string[];

  @ApiPropertyOptional({ type: String, enum: CAMPAIGN_MARKET_SELECTION_ORIGINS })
  @IsOptional() @IsIn(CAMPAIGN_MARKET_SELECTION_ORIGINS)
  marketSelectionOrigin?: CampaignMarketSelectionOrigin;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(40) marketSelectionCode?: string | null;

  @ApiPropertyOptional({ type: () => [CampaignRequestingUnitDto], maxItems: 20 })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true })
  @Type(() => CampaignRequestingUnitDto)
  requestingUnits?: CampaignRequestingUnitDto[];
}
