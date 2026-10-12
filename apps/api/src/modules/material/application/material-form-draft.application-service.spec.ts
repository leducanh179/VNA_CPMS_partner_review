import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { MaterialFormDraftApplicationService } from './material-form-draft.application-service';
import type { MaterialFormDraftRepository } from './material-form-draft.repository';

const id = '10000000-0000-4000-8000-000000000199';

function setup() {
  const repository = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async (_id: string, value: Record<string, unknown>) => ({ id, materialId: null, title: String(value.title ?? ''), formData: value, recordVersion: 1, updatedAt: new Date() })),
    remove: vi.fn(async () => false),
  };
  const access = { run: vi.fn(async (_actor: typeof DEMO_ACTOR, fn: () => Promise<unknown>) => fn()), require: vi.fn() };
  return { service: new MaterialFormDraftApplicationService(repository as unknown as MaterialFormDraftRepository, access as unknown as AccessApplicationService), repository, access };
}

describe('private Material form drafts', () => {
  it('stores incomplete input separately from Materials and scopes the listing by the creator', async () => {
    const { service, repository, access } = setup();
    const value = { title: 'TVC đang nhập', fields: { material_name: 'TVC đang nhập' } };
    await service.save(DEMO_ACTOR, id, value, 0);
    expect(repository.save).toHaveBeenCalledWith(id, value, 0, DEMO_ACTOR);
    await service.list(DEMO_ACTOR);
    expect(repository.list).toHaveBeenCalledWith(DEMO_ACTOR.id);
    expect(access.require).toHaveBeenCalledWith('material.create');
  });

  it('does not disclose another creator’s draft and rejects oversized input', async () => {
    const { service, repository } = setup();
    await expect(service.get(DEMO_ACTOR, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.get).toHaveBeenCalledWith(id, DEMO_ACTOR.id);
    await expect(service.save(DEMO_ACTOR, id, { title: 'x'.repeat(262_145) }, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
