import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignFormDraftApplicationService } from './campaign-form-draft.application-service';
import type { CampaignFormDraftRepository } from './campaign-form-draft.repository';

const id = '10000000-0000-4000-8000-000000000099';
const actor = DEMO_ACTOR;

function setup() {
  const repository = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async (_id: string, value: Record<string, unknown>) => ({ id, title: String(value.name ?? ''), levelCode: null, formData: value, recordVersion: 1, updatedAt: new Date() })),
    remove: vi.fn(async () => false),
  };
  const access = { run: vi.fn(async (_actor: typeof actor, fn: () => Promise<unknown>) => fn()), require: vi.fn() };
  return { service: new CampaignFormDraftApplicationService(repository as unknown as CampaignFormDraftRepository, access as unknown as AccessApplicationService), repository, access };
}

describe('private Campaign form drafts', () => {
  it('persists incomplete input without creating a Campaign and scopes by authenticated actor', async () => {
    const { service, repository, access } = setup();
    await service.save(actor, id, { name: 'Chiến dịch nhập dở', levelCode: null }, 0);
    expect(repository.save).toHaveBeenCalledWith(id, { name: 'Chiến dịch nhập dở', levelCode: null }, 0, actor);
    await service.list(actor);
    expect(repository.list).toHaveBeenCalledWith(actor.id);
    expect(access.require).toHaveBeenCalledWith('campaign.create');
  });

  it('does not disclose another actor’s draft and rejects oversized input', async () => {
    const { service, repository } = setup();
    await expect(service.get(actor, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.get).toHaveBeenCalledWith(id, actor.id);
    await expect(service.save(actor, id, { name: 'x'.repeat(262_145) }, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
