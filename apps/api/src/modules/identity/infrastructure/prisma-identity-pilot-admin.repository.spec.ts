import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PrismaIdentityRepository } from './prisma-identity.repository';

const actor = (kind: 'PERSONNEL' | 'PILOT_ADMIN', id: string) => ({
  id, key: `${kind}:${id}`, displayName: id, loginEmail: `${id}@example.test`, accountKind: kind,
  personnelEmployeeCode: kind === 'PERSONNEL' ? `TEST${id}` : null, isActive: true, authzVersion: 1,
  roles: [{ roleCode: 'ADMIN' }], scopedBindings: [{ roleCode: 'ADMIN', scopeType: 'SYSTEM', expiresAt: null }],
  credential: { passwordHash: 'synthetic', credentialVersion: 1, mustChangePassword: false },
  personnel: null, employment: null,
});
const session = (original: ReturnType<typeof actor>) => ({
  id: 'session', tokenHash: 'synthetic', csrfHash: 'synthetic', mode: 'DIRECT', credentialVersion: 1,
  createdAt: new Date(Date.now() - 60_000), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null,
  originalActor: original, effectiveActor: original,
});
function repository(original: ReturnType<typeof actor>, target: ReturnType<typeof actor>) {
  const transaction = {
    $executeRaw: vi.fn(), localSession: { findUnique: vi.fn().mockResolvedValue(session(original)), updateMany: vi.fn() },
    actor: { findUnique: vi.fn().mockResolvedValue(target), update: vi.fn(), count: vi.fn().mockResolvedValue(1) },
    scopedRoleBinding: { count: vi.fn().mockResolvedValue(1) }, auditEvent: { create: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)) };
  return { repository: new PrismaIdentityRepository(prisma as unknown as PrismaService), transaction };
}

describe('pilot administrator recovery boundary', () => {
  it('does not let a pilot administrator disable or reset the personnel administrator', async () => {
    const root = actor('PERSONNEL', 'root');
    const { repository: store, transaction } = repository(actor('PILOT_ADMIN', 'pilot'), root);
    await expect(store.changeAccountStatus('session', { targetActorId: root.id, expectedVersion: 1, isActive: false, reason: 'test' })).rejects.toThrow();
    await expect(store.resetCredential('session', root.id, 1, 'synthetic', 'test', true)).rejects.toThrow();
    expect(transaction.actor.update).not.toHaveBeenCalled();
    expect(transaction.localSession.updateMany).not.toHaveBeenCalled();
  });

  it('lets the personnel administrator disable a pilot administrator and revoke its sessions', async () => {
    const pilot = actor('PILOT_ADMIN', 'pilot');
    const { repository: store, transaction } = repository(actor('PERSONNEL', 'root'), pilot);
    await store.changeAccountStatus('session', { targetActorId: pilot.id, expectedVersion: 1, isActive: false, reason: 'test' });
    expect(transaction.actor.update).toHaveBeenCalledWith({ where: { id: pilot.id }, data: { isActive: false, authzVersion: { increment: 1 } } });
    expect(transaction.localSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ACCOUNT_STATUS_CHANGED', entityId: pilot.id }) }));
  });
});
