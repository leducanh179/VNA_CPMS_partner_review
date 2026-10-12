import { CAMPAIGN_COMMENT_REACTION_TYPES, type CampaignCommentReactionType } from '@cpms/domain';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CampaignCommentListQueryDto {
  @IsOptional() @IsUUID('4') campaignId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class CreateCampaignCommentDto {
  @IsString() @MaxLength(5_000) body!: string;
  @IsOptional() @IsUUID('4') replyToCommentId?: string;
}

export class UpdateCampaignCommentDto {
  @IsString() @MaxLength(5_000) body!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class SetCampaignCommentReactionDto {
  @IsIn(CAMPAIGN_COMMENT_REACTION_TYPES) type!: CampaignCommentReactionType;
}

export class ModerateCampaignCommentDto {
  @IsString() @MaxLength(1000) reason!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class CampaignJournalListQueryDto extends CampaignCommentListQueryDto {
  @IsOptional() @IsUUID('4') actorId?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
}
