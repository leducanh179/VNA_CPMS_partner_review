import type { ActorContext } from '@cpms/domain';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { MaterialFormDraftRepository } from './material-form-draft.repository';
import { MaterialSharingApplicationService } from './material-sharing.application-service';

@Injectable()
export class MaterialFormDraftApplicationService {
  constructor(@Inject(MaterialFormDraftRepository) private readonly repository: MaterialFormDraftRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(MaterialSharingApplicationService) private readonly sharing: MaterialSharingApplicationService) {}

  private async requireDraft(value?: Record<string, unknown>) {
    if (typeof value?.materialId === 'string') {
      const demo = this.access.snapshot().identity.readOnlyDemo;
      await this.sharing.get(value.materialId, demo ? 'view' : 'edit');
      if (demo) this.access.requireFormDraft('material');
    } else this.access.requireFormDraft('material');
  }

  list(actor: ActorContext) { return this.access.run(actor, async () => {
    const visible = [];
    for (const row of await this.repository.list(actor.id)) {
      try {
        await this.requireDraft(row.materialId ? { materialId: row.materialId } : undefined);
        visible.push(row);
      } catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
      }
    }
    return visible;
  }); }

  get(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    const row = await this.repository.get(id, actor.id);
    if (!row) throw new NotFoundException('Không tìm thấy bản nhập dở.');
    await this.requireDraft(row.formData);
    return row;
  }); }

  save(actor: ActorContext, id: string, value: unknown, expectedVersion: number) { return this.access.run(actor, async () => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 262_144)
      throw new BadRequestException('Dữ liệu nhập dở không hợp lệ hoặc vượt 256 KB.');
    await this.requireDraft(value as Record<string, unknown>);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new BadRequestException('Phiên bản bản nhập dở không hợp lệ.');
    return this.repository.save(id, value as Record<string, unknown>, expectedVersion, actor);
  }); }

  remove(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    const row = await this.repository.get(id, actor.id);
    if (!row) throw new NotFoundException('Không tìm thấy bản nhập dở.');
    await this.requireDraft(row.formData);
    return { removed: await this.repository.remove(id, actor.id, actor) };
  }); }
}
