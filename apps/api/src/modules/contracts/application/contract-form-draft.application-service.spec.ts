import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractFormDraftApplicationService } from './contract-form-draft.application-service';
import type { ContractFormDraftRepository, ContractFormDraftValue } from './contract-form-draft.repository';

const id = '10000000-0000-4000-8000-000000000299';
const value: ContractFormDraftValue = { kind: 'PAID', fields: { name: 'Hợp đồng đang nhập' }, supplierId: '', supplierSelected: false, code: '', vendorCode: '', ownedLayer: '', ownedChannel: '', reason: '', evidence: '' };

function setup() {
  const repository = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => ({ id, kind: value.kind, title: value.fields.name!, activityCode: null, formData: value, recordVersion: 1, updatedAt: new Date() })),
    remove: vi.fn(async () => false),
  };
  const access = { run: vi.fn(async (_actor: typeof DEMO_ACTOR, fn: () => Promise<unknown>) => fn()), require: vi.fn() };
  return { service: new ContractFormDraftApplicationService(repository as unknown as ContractFormDraftRepository, access as unknown as AccessApplicationService), repository, access };
}

describe('private Contract and owned-channel form drafts', () => {
  it('stores unfinished input apart from contracts and lists only the creator’s drafts', async () => {
    const { service, repository, access } = setup();
    await service.save(DEMO_ACTOR, id, value, 0);
    expect(repository.save).toHaveBeenCalledWith(id, value, 0, DEMO_ACTOR);
    await service.list(DEMO_ACTOR);
    expect(repository.list).toHaveBeenCalledWith(DEMO_ACTOR.id);
    expect(access.require).toHaveBeenCalledWith('contract.create');
  });

  it('does not disclose another creator’s draft and rejects malformed input', async () => {
    const { service, repository } = setup();
    await expect(service.get(DEMO_ACTOR, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.get).toHaveBeenCalledWith(id, DEMO_ACTOR.id);
    await expect(service.save(DEMO_ACTOR, id, { ...value, kind: 'OWNED_ACTIVITY', activityCode: '' }, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save(DEMO_ACTOR, id, { ...value, fields: { name: 'x'.repeat(262_145) } }, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
