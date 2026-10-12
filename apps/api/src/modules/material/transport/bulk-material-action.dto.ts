import { MATERIAL_BULK_ACTIONS, type MaterialBulkAction } from '@cpms/domain';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class BulkMaterialActionItemDto {
  @IsString()
  @MaxLength(120)
  materialId!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class BulkMaterialActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkMaterialActionItemDto)
  items!: BulkMaterialActionItemDto[];

  @IsIn(MATERIAL_BULK_ACTIONS)
  action!: MaterialBulkAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
