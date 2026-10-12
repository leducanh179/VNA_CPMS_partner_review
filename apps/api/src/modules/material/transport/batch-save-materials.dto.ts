import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

export class BatchSaveMaterialItemDto {
  @IsString()
  @MaxLength(120)
  clientKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  materialId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @IsOptional()
  @IsObject()
  baselineFields?: Record<string, string | null>;

  @IsObject()
  fields!: Record<string, string | null>;
}

export class BatchSaveMaterialsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchSaveMaterialItemDto)
  items!: BatchSaveMaterialItemDto[];
}
