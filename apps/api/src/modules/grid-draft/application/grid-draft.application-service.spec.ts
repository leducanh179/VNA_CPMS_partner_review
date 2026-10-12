import { BadRequestException } from '@nestjs/common';
import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { GridDraftApplicationService } from './grid-draft.application-service';
import type { GridDraftRepository } from './grid-draft.repository';

function setup() {
  const repository = { get: vi.fn(async () => null), save: vi.fn(async (_scope: string, value: Record<string, unknown>) => ({ value, recordVersion: 1 })) };
  const access = { run: vi.fn(async (_actor: typeof DEMO_ACTOR, operation: () => Promise<unknown>) => operation()) };
  return { service: new GridDraftApplicationService(repository as unknown as GridDraftRepository, access as unknown as AccessApplicationService), repository, access };
}
describe('private spreadsheet drafts', () => {
  it('isolates reads by resolved actor and forwards optimistic version for writes', async () => {
    const { service, repository, access } = setup();
    expect(await service.get(DEMO_ACTOR, 'synthetic-grid')).toEqual({ value: {}, recordVersion: 0 });
    expect(repository.get).toHaveBeenCalledWith('synthetic-grid', DEMO_ACTOR.id);
    const value = { rows: [{ id: 'new', name: 'Synthetic unfinished row' }] };
    await service.save(DEMO_ACTOR, 'synthetic-grid', value, 0);
    expect(repository.save).toHaveBeenCalledWith('synthetic-grid', value, 0, DEMO_ACTOR);
    expect(access.run).toHaveBeenCalledWith(DEMO_ACTOR, expect.any(Function));
  });
  it('rejects oversized input, invalid versions and invalid scopes without persisting', async () => {
    const { service, repository } = setup();
    await expect(service.save(DEMO_ACTOR, 'synthetic-grid', { text: 'x'.repeat(1_048_576) }, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save(DEMO_ACTOR, 'synthetic-grid', {}, -1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get(DEMO_ACTOR, 'x'.repeat(241))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get(DEMO_ACTOR, '\n')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
