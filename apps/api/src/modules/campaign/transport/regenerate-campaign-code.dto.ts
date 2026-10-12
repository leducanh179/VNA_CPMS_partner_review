import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RegenerateCampaignCodeDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt() @Min(1) expectedVersion!: number;
}
