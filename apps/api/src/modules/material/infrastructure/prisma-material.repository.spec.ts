import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PrismaMaterialRepository } from './prisma-material.repository';

describe('PrismaMaterialRepository', () => {
  it('uses create-only persistence for a new material so an ID collision cannot overwrite another row', async () => {
    const create = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const transaction = {
      materialRecord: { findMany: vi.fn(async () => []), create, update },
      auditEvent: { createMany: vi.fn(async () => ({})) },
    };
    const prisma = {
      inTransaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
      database: { materialRecord: { findMany: vi.fn(async () => [{
        id: 'id', materialId: 'MTR-202610-A2C9T8', data: { material_name: 'Tư liệu' }, recordVersion: 1,
        isDeleted: false, createdBy: DEMO_ACTOR.key, updatedBy: DEMO_ACTOR.key,
        createdAt: new Date('2026-10-03T00:00:00Z'), updatedAt: new Date('2026-10-03T00:00:00Z'),
      }]) } },
    } as unknown as PrismaService;
    const repository = new PrismaMaterialRepository(prisma);
    await repository.saveBatch([{ materialId: 'MTR-202610-A2C9T8', fields: { material_name: 'Tư liệu' }, recordVersion: 1,
      isDeleted: false, createdBy: DEMO_ACTOR.key, updatedBy: DEMO_ACTOR.key }], DEMO_ACTOR, 'material.batch_saved');
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('purges an unlinked version, removing comments while retaining the audit event', async () => {
    const commentUpdate = vi.fn(async () => ({ count: 2 }));
    const commentDelete = vi.fn(async () => ({ count: 2 }));
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const auditCreate = vi.fn(async () => ({}));
    const transaction = {
      materialRecord: { findUnique: vi.fn(async () => ({ id: 'record-uuid', recordVersion: 3, isDeleted: true })), deleteMany },
      bookingRecord: { count: vi.fn(async () => 0) },
      materialComment: { updateMany: commentUpdate, deleteMany: commentDelete },
      auditEvent: { create: auditCreate },
    };
    const prisma = { inTransaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) } as unknown as PrismaService;
    await new PrismaMaterialRepository(prisma).purge('MTR-202610-A2C9T8', 3, DEMO_ACTOR);
    expect(commentUpdate).toHaveBeenCalled();
    expect(commentDelete).toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({ where: { materialId: 'MTR-202610-A2C9T8', recordVersion: 3 } });
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'material.purged', entityId: 'MTR-202610-A2C9T8' }) });
  });

  it('refuses permanent deletion when a Booking still references the record', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      materialRecord: { findUnique: vi.fn(async () => ({ id: 'record-uuid', recordVersion: 3, isDeleted: true })), deleteMany },
      bookingRecord: { count: vi.fn(async () => 1) },
      materialComment: { updateMany: vi.fn(), deleteMany: vi.fn() },
    };
    const prisma = { inTransaction: (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) } as unknown as PrismaService;
    await expect(new PrismaMaterialRepository(prisma).purge('MTR-202610-A2C9T8', 3, DEMO_ACTOR)).rejects.toThrow('Đặt chỗ');
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
