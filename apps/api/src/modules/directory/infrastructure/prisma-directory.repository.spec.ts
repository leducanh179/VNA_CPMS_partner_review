import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { PrismaDirectoryRepository } from './prisma-directory.repository';

describe('personnel directory projection', () => {
  it('does not select private birth or gender fields for the general directory', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { database: { personnelDirectoryEntry: { findMany } } } as unknown as PrismaService;
    const repository = new PrismaDirectoryRepository(prisma, {} as AccessApplicationService);
    expect(await repository.people()).toEqual([]);
    const selection = findMany.mock.calls[0]![0].select as Record<string, unknown>;
    expect(selection).not.toHaveProperty('birthDate');
    expect(selection).not.toHaveProperty('birthYear');
    expect(selection).not.toHaveProperty('gender');
    expect(selection.phoneText).toBe(true);
  });
});
