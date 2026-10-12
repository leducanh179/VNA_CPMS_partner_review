import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignFormDraftRepository } from './campaign-form-draft.repository';

@Injectable()
export class CampaignFormDraftApplicationService {
  constructor(@Inject(CampaignFormDraftRepository) private readonly repository: CampaignFormDraftRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}

  list(actor: ActorContext) { return this.access.run(actor, async () => { this.access.require('campaign.create'); return this.repository.list(actor.id); }); }
  get(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    this.access.require('campaign.create');
    const row = await this.repository.get(id, actor.id);
    if (!row) throw new NotFoundException('Không tìm thấy bản nhập dở.');
    return row;
  }); }
  save(actor: ActorContext, id: string, value: unknown, expectedVersion: number) { return this.access.run(actor, async () => {
    this.access.require('campaign.create');
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 262_144) throw new BadRequestException('Dữ liệu nhập dở không hợp lệ hoặc vượt 256 KB.');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new BadRequestException('Phiên bản bản nhập dở không hợp lệ.');
    return this.repository.save(id, value as Record<string, unknown>, expectedVersion, actor);
  }); }
  remove(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    this.access.require('campaign.create');
    return { removed: await this.repository.remove(id, actor.id, actor) };
  }); }
}
