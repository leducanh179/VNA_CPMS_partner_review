import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractFormDraftRepository, type ContractFormDraftValue } from './contract-form-draft.repository';

@Injectable()
export class ContractFormDraftApplicationService {
  constructor(@Inject(ContractFormDraftRepository) private readonly repository: ContractFormDraftRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}

  list(actor: ActorContext) { return this.access.run(actor, async () => {
    this.access.require('contract.create');
    return this.repository.list(actor.id);
  }); }

  get(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    this.access.require('contract.create');
    const row = await this.repository.get(id, actor.id);
    if (!row) throw new NotFoundException('Không tìm thấy bản nhập dở.');
    return row;
  }); }

  save(actor: ActorContext, id: string, value: unknown, expectedVersion: number) { return this.access.run(actor, async () => {
    this.access.require('contract.create');
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 262_144) throw new BadRequestException('Dữ liệu nhập dở không hợp lệ hoặc vượt 256 KB.');
    const form = value as Partial<ContractFormDraftValue>;
    if (!['PAID', 'OWNED_NEW', 'OWNED_ACTIVITY'].includes(form.kind ?? '') ||
      !form.fields || typeof form.fields !== 'object' || Array.isArray(form.fields) ||
      (form.marketCodes !== undefined && (!Array.isArray(form.marketCodes) || form.marketCodes.some(code => typeof code !== 'string'))) ||
      (form.kind === 'OWNED_ACTIVITY' && (typeof form.activityCode !== 'string' || !form.activityCode.trim())) ||
      !Number.isInteger(expectedVersion) || expectedVersion < 0) throw new BadRequestException('Bản nhập dở không hợp lệ.');
    return this.repository.save(id, form as ContractFormDraftValue, expectedVersion, actor);
  }); }

  remove(actor: ActorContext, id: string) { return this.access.run(actor, async () => {
    this.access.require('contract.create');
    return { removed: await this.repository.remove(id, actor.id, actor) };
  }); }
}
