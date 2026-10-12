import { CAMPAIGN_LIFECYCLE_STATES, type CampaignLifecycleState } from '@cpms/domain';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator';

export class BulkTransitionCampaignsDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ type: String, enum: CAMPAIGN_LIFECYCLE_STATES, example: 'CM_ACCEPTED' })
  @IsIn(CAMPAIGN_LIFECYCLE_STATES)
  lifecycleState!: CampaignLifecycleState;
}
