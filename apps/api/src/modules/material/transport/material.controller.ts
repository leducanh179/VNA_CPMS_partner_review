import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { MaterialApplicationService } from '../application/material.application-service';
import { MaterialCollaborationApplicationService } from '../application/material-collaboration.application-service';
import { BatchSaveMaterialsDto } from './batch-save-materials.dto';
import { BulkMaterialActionDto } from './bulk-material-action.dto';
import { CreateMaterialCommentDto, UpdateMaterialCommentDto } from './material-comment.dto';

const materialDtoPipe = (expectedType: new () => object) => new ValidationPipe({
  expectedType,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@ApiTags('materials')
@Controller('materials')
export class MaterialController {
  constructor(@Inject(MaterialApplicationService) private readonly materials: MaterialApplicationService,
    @Inject(MaterialCollaborationApplicationService) private readonly collaboration: MaterialCollaborationApplicationService) {}

  @Get()
  @RequirePermission('material.read')
  @ApiOperation({ summary: 'List up to 5,000 material records' })
  list(@Query('trash') trash?: string) {
    return this.materials.list(trash === 'true');
  }

  @Get('bootstrap')
  @RequirePermission('material.read')
  @ApiOperation({ summary: 'Load Material Portal options, users and role rules' })
  bootstrap() {
    return this.materials.bootstrap();
  }

  @Post('batch-save')
  @ApiBody({ type: BatchSaveMaterialsDto })
  @ApiOperation({ summary: 'Save up to 50 dirty rows using one database transaction' })
  batchSave(@Body(materialDtoPipe(BatchSaveMaterialsDto)) input: BatchSaveMaterialsDto, @CurrentActor() actor: ActorContext) {
    return this.materials.batchSave(input.items, actor);
  }

  @Post('bulk-action')
  @ApiBody({ type: BulkMaterialActionDto })
  @ApiOperation({ summary: 'Confirm one audited action for up to 50 selected materials' })
  bulkAction(@Body(materialDtoPipe(BulkMaterialActionDto)) input: BulkMaterialActionDto, @CurrentActor() actor: ActorContext) {
    return this.materials.bulkAction(input.items, input.action, actor, input.reason);
  }

  @Delete(':id')
  @RequirePermission('system.manage')
  @ApiOperation({ summary: 'Permanently delete one trashed material after version and dependency checks' })
  async purge(@Param('id') id: string, @Query('expectedVersion', ParseIntPipe) expectedVersion: number, @CurrentActor() actor: ActorContext) {
    await this.materials.purge(id, expectedVersion, actor);
    return { materialId: id, deleted: true };
  }

  @Get(':id/comments')
  @RequirePermission('material.read')
  comments(@Param('id') id: string) { return this.collaboration.comments(id); }

  @Get(':id/journal')
  @RequirePermission('material.read')
  journal(@Param('id') id: string) { return this.collaboration.journal(id); }

  @Post(':id/comments')
  @RequirePermission('material.update')
  createComment(@Param('id') id: string, @Body(materialDtoPipe(CreateMaterialCommentDto)) input: CreateMaterialCommentDto, @CurrentActor() actor: ActorContext) {
    return this.collaboration.create(id, input.body, input.parentId || null, actor);
  }

  @Patch(':id/comments/:commentId')
  @RequirePermission('material.update')
  updateComment(@Param('id') id: string, @Param('commentId') commentId: string, @Body(materialDtoPipe(UpdateMaterialCommentDto)) input: UpdateMaterialCommentDto, @CurrentActor() actor: ActorContext) {
    return this.collaboration.update(id, commentId, input.body, input.expectedVersion, actor);
  }

  @Delete(':id/comments/:commentId')
  @RequirePermission('material.update')
  deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @Query('expectedVersion', ParseIntPipe) expectedVersion: number, @CurrentActor() actor: ActorContext) {
    return this.collaboration.remove(id, commentId, expectedVersion, actor);
  }
}
