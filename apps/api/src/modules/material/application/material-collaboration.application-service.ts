import type { ActorContext } from '@cpms/domain';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { MATERIAL_COLLABORATION_REPOSITORY, type MaterialCollaborationRepository } from './material-collaboration.repository';
import { MaterialSharingApplicationService } from './material-sharing.application-service';

@Injectable()
export class MaterialCollaborationApplicationService {
  constructor(
    @Inject(MATERIAL_COLLABORATION_REPOSITORY) private readonly repository: MaterialCollaborationRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(MaterialSharingApplicationService) private readonly sharing: MaterialSharingApplicationService,
  ) {}

  private async requireMaterial(materialId: string) {
    await this.sharing.get(materialId);
    if (!(await this.repository.materialExists(materialId))) throw new NotFoundException('Không tìm thấy tư liệu.');
  }

  @AccessBoundary()
  async comments(materialId: string) {
    await this.requireMaterial(materialId);
    return this.repository.listComments(materialId);
  }

  @AccessBoundary()
  async journal(materialId: string) {
    await this.requireMaterial(materialId);
    return this.repository.listJournal(materialId);
  }

  @AccessBoundary(3)
  async create(materialId: string, body: string, parentId: string | null, actor: ActorContext) {
    await this.requireMaterial(materialId);
    await this.sharing.get(materialId, 'edit');
    const text = body.trim();
    if (!text || text.length > 5000) throw new BadRequestException('Bình luận cần 1–5000 ký tự.');
    return this.repository.createComment(materialId, text, parentId, actor);
  }

  @AccessBoundary(4)
  async update(materialId: string, id: string, body: string, expectedVersion: number, actor: ActorContext) {
    await this.requireMaterial(materialId);
    await this.sharing.get(materialId, 'edit');
    const text = body.trim();
    if (!text || text.length > 5000) throw new BadRequestException('Bình luận cần 1–5000 ký tự.');
    return this.repository.updateComment(materialId, id, text, expectedVersion, actor, this.access.check('material.manage').allowed);
  }

  @AccessBoundary(3)
  async remove(materialId: string, id: string, expectedVersion: number, actor: ActorContext) {
    await this.requireMaterial(materialId);
    await this.sharing.get(materialId, 'edit');
    return this.repository.deleteComment(materialId, id, expectedVersion, actor, this.access.check('material.manage').allowed);
  }
}
