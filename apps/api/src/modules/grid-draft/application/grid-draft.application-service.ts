import type { ActorContext } from '@cpms/domain';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { GridDraftRepository } from './grid-draft.repository';

/** Actor-private input buffer only. Applying business data still requires the module's own command. */
@Injectable()
export class GridDraftApplicationService {
  constructor(@Inject(GridDraftRepository) private readonly repository: GridDraftRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}
  private validateScope(scope: string) {
    if (!scope || scope.length > 240 || [...scope].some(char => char.charCodeAt(0) < 32)) throw new BadRequestException('Địa chỉ bảng không hợp lệ.');
  }
  get(actor: ActorContext, scope: string) { return this.access.run(actor, async () => {
    this.validateScope(scope);
    return await this.repository.get(scope, actor.id) ?? { value: {}, recordVersion: 0 };
  }); }
  save(actor: ActorContext, scope: string, value: Record<string, unknown>, expectedVersion: number) { return this.access.run(actor, async () => {
    this.validateScope(scope);
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 1_048_576)
      throw new BadRequestException('Bản nhập dở không hợp lệ hoặc vượt 1 MB.');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new BadRequestException('Phiên bản bản nhập dở không hợp lệ.');
    return this.repository.save(scope, value, expectedVersion, actor);
  }); }
}
