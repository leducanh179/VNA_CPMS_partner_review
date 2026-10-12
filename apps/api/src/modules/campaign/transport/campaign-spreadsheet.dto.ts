import { CAMPAIGN_SPREADSHEET_FIELDS, type CampaignSpreadsheetFieldKey } from '@cpms/domain';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBase64, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString,
  MaxLength, Min, ValidateNested,
} from 'class-validator';

const FIELD_KEYS = CAMPAIGN_SPREADSHEET_FIELDS.map((field) => field.key);

export class CampaignSpreadsheetFileDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(240) fileName!: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(160) mimeType?: string;
  @ApiProperty({ type: String, format: 'byte' }) @IsString() @IsBase64() @MaxLength(8_100_000) contentBase64!: string;
}

export class CampaignSpreadsheetExportDto {
  @ApiProperty({ enum: ['DATA', 'TEMPLATE'] }) @IsIn(['DATA', 'TEMPLATE']) mode!: 'DATA' | 'TEMPLATE';
  @ApiProperty({ enum: ['ALL_CURRENT', 'SELECTED', 'FILTERED'] }) @IsIn(['ALL_CURRENT', 'SELECTED', 'FILTERED']) recordScope!: 'ALL_CURRENT' | 'SELECTED' | 'FILTERED';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) campaignIds?: string[];
  @ApiProperty({ enum: ['ACTIVE_V2', 'VISIBLE', 'CUSTOM'] }) @IsIn(['ACTIVE_V2', 'VISIBLE', 'CUSTOM']) fieldScope!: 'ACTIVE_V2' | 'VISIBLE' | 'CUSTOM';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) fieldKeys?: CampaignSpreadsheetFieldKey[];
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() includeLegacyReadOnly?: boolean;
}

export class CampaignSpreadsheetMappingDto {
  @ApiProperty({ type: Number }) @IsInt() @Min(0) columnIndex!: number;
  @ApiProperty({ type: String }) @IsString() @MaxLength(240) sourceHeader!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsIn([...FIELD_KEYS, null]) fieldKey!: CampaignSpreadsheetFieldKey | null;
  @ApiProperty({ type: Boolean }) @IsBoolean() recognized!: boolean;
}

export class CampaignSpreadsheetPreviewDto extends CampaignSpreadsheetFileDto {
  @ApiProperty({ type: String }) @IsString() @IsNotEmpty() @MaxLength(120) sheetName!: string;
  @ApiPropertyOptional({ type: () => [CampaignSpreadsheetMappingDto] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CampaignSpreadsheetMappingDto) mapping?: CampaignSpreadsheetMappingDto[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(1_000) @IsInt({ each: true }) @Min(1, { each: true }) selectedRows?: number[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsIn(FIELD_KEYS, { each: true }) selectedFieldKeys?: CampaignSpreadsheetFieldKey[];
}

export class CampaignSpreadsheetImportDecisionDto {
  @ApiProperty({ type: Number }) @IsInt() @Min(1) rowNumber!: number;
  @ApiProperty({ enum: ['CREATE', 'UPDATE', 'SKIP'] }) @IsIn(['CREATE', 'UPDATE', 'SKIP']) action!: 'CREATE' | 'UPDATE' | 'SKIP';
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsIn(FIELD_KEYS, { each: true }) selectedFieldKeys!: CampaignSpreadsheetFieldKey[];
  @ApiPropertyOptional({ type: Number }) @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class CampaignSpreadsheetImportDto extends CampaignSpreadsheetPreviewDto {
  @ApiProperty({ type: () => [CampaignSpreadsheetImportDecisionDto] }) @IsArray() @ArrayMaxSize(1_000) @ValidateNested({ each: true }) @Type(() => CampaignSpreadsheetImportDecisionDto) decisions!: CampaignSpreadsheetImportDecisionDto[];
}
