import { CAMPAIGN_SPREADSHEET_FIELDS, type CampaignSpreadsheetFieldKey } from '@cpms/domain';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { CampaignSpreadsheetImportDecisionDto, CampaignSpreadsheetMappingDto } from '../../campaign/transport/campaign-spreadsheet.dto';

const FIELD_KEYS = CAMPAIGN_SPREADSHEET_FIELDS.map((field) => field.key);

export class GoogleSpreadsheetUrlDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(500) spreadsheetUrl!: string;
}

export class GoogleSheetSourceDto extends GoogleSpreadsheetUrlDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(120) sheetName!: string;
  @ApiPropertyOptional({ type: () => [CampaignSpreadsheetMappingDto] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CampaignSpreadsheetMappingDto) mapping?: CampaignSpreadsheetMappingDto[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(1_000) @IsInt({ each: true }) @Min(1, { each: true }) selectedRows?: number[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsIn(FIELD_KEYS, { each: true }) selectedFieldKeys?: CampaignSpreadsheetFieldKey[];
}

export class GoogleSheetImportDto extends GoogleSheetSourceDto {
  @ApiProperty({ type: () => [CampaignSpreadsheetImportDecisionDto] }) @IsArray() @ArrayMaxSize(1_000) @ValidateNested({ each: true }) @Type(() => CampaignSpreadsheetImportDecisionDto) decisions!: CampaignSpreadsheetImportDecisionDto[];
}

export class GoogleSheetCompareDto extends GoogleSheetSourceDto {
  @ApiProperty({ enum: ['COMMUNICATION', 'UPDATED_AT'] }) @IsIn(['COMMUNICATION', 'UPDATED_AT']) timeBasis!: 'COMMUNICATION' | 'UPDATED_AT';
  @ApiPropertyOptional({ type: String, format: 'date' }) @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @ApiPropertyOptional({ type: String, format: 'date' }) @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() includeOnlyOneSide!: boolean;
}

export class GoogleSheetResultTabDto extends GoogleSheetCompareDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') idempotencyKey!: string;
}
