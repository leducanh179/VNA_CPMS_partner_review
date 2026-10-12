import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { CampaignCommentApplicationService } from '../application/campaign-comment.application-service';
import { ScopedCampaignCommentApplicationService } from '../application/scoped-campaign-comment.application-service';
import {
  CampaignCommentListQueryDto,
  CreateCampaignCommentDto,
  SetCampaignCommentReactionDto,
  UpdateCampaignCommentDto,
  ModerateCampaignCommentDto,
} from './campaign-collaboration.dto';

const dtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });

@ApiTags('campaign-comments')
@Controller('campaign-comments')
export class CampaignCommentQueryController {
  constructor(@Inject(CampaignCommentApplicationService) private readonly comments: CampaignCommentApplicationService) {}

  @Get()
  @RequirePermission('campaign.read')
  @ApiOperation({ summary: 'List Campaign comment threads, optionally filtered by Campaign' })
  list(@Query(dtoPipe(CampaignCommentListQueryDto)) query: CampaignCommentListQueryDto, @CurrentActor() actor: ActorContext) {
    return this.comments.list(query, actor);
  }
}

@ApiTags('campaign-comments')
@Controller('campaigns/:campaignId/comments')
export class CampaignCommentMutationController {
  constructor(@Inject(ScopedCampaignCommentApplicationService) private readonly comments: ScopedCampaignCommentApplicationService) {}

  @Post(':commentId/moderation')
  @ApiOperation({ summary: 'Superadmin soft-delete with an explicit reason; preserves original author and body' })
  moderate(@Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body(dtoPipe(ModerateCampaignCommentDto)) input: ModerateCampaignCommentDto,
    @CurrentActor() actor: ActorContext) { return this.comments.moderate(campaignId, commentId, input, actor); }

  @Post()
  @RequirePermission('campaign.comment')
  @ApiOperation({ summary: 'Create a root Campaign comment or one-level reply' })
  create(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Body(dtoPipe(CreateCampaignCommentDto)) input: CreateCampaignCommentDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.comments.create(campaignId, input, actor); }

  @Patch(':commentId')
  @RequirePermission('campaign.comment')
  @ApiOperation({ summary: 'Edit an owned Campaign comment with optimistic locking' })
  update(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body(dtoPipe(UpdateCampaignCommentDto)) input: UpdateCampaignCommentDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.comments.update(campaignId, commentId, input, actor); }

  @Delete(':commentId')
  @RequirePermission('campaign.comment')
  @ApiOperation({ summary: 'Soft-delete an owned Campaign comment with optimistic locking' })
  remove(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Query('expectedVersion', ParseIntPipe) expectedVersion: number,
    @CurrentActor() actor: ActorContext,
  ) { return this.comments.remove(campaignId, commentId, expectedVersion, actor); }

  @Put(':commentId/reaction')
  @RequirePermission('campaign.comment')
  @ApiOperation({ summary: 'Set or switch the current actor reaction on a Campaign comment' })
  setReaction(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body(dtoPipe(SetCampaignCommentReactionDto)) input: SetCampaignCommentReactionDto,
    @CurrentActor() actor: ActorContext,
  ) { return this.comments.setReaction(campaignId, commentId, input.type, actor); }

  @Delete(':commentId/reaction')
  @RequirePermission('campaign.comment')
  @ApiOperation({ summary: 'Remove the current actor reaction from a Campaign comment' })
  removeReaction(
    @Param('campaignId', new ParseUUIDPipe({ version: '4' })) campaignId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @CurrentActor() actor: ActorContext,
  ) { return this.comments.removeReaction(campaignId, commentId, actor); }
}
