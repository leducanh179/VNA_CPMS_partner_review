import { normalizeDirectorySearch } from '@cpms/domain';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PilotAdminBootstrapRepository, type PilotAdminProfile } from '../application/pilot-admin-bootstrap.application-service';

const SOURCE = 'PILOT_ADMIN_MANUAL_V1';
const STATE = 'pilot-admin-manual-v1';

async function isEmpty(transaction: Prisma.TransactionClient) {
  const [actors, people, credentials, bootstrap] = await Promise.all([
    transaction.actor.count(),
    transaction.personnelDirectoryEntry.count(),
    transaction.localCredential.count(),
    transaction.identityImportState.findFirst({ where: { bootstrappedAt: { not: null } }, select: { key: true } }),
  ]);
  return actors === 0 && people === 0 && credentials === 0 && !bootstrap;
}

async function organization(transaction: Prisma.TransactionClient, name: string, parentId: string | null) {
  const identityKey = createHash('sha256').update(JSON.stringify([parentId, normalizeDirectorySearch(name)])).digest('hex');
  return transaction.employmentOrgUnit.upsert({ where: { identityKey }, create: {
    identityKey, sourceName: name, kind: parentId ? 'DIVISION' : 'DEPARTMENT', parentId, sourceProvider: SOURCE,
  }, update: {} });
}

@Injectable()
export class PrismaPilotAdminBootstrapRepository extends PilotAdminBootstrapRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  canBootstrap() { return this.prisma.withSecurityLock(isEmpty); }

  create(input: { profile: PilotAdminProfile; passwordHash: string }) {
    return this.prisma.withSecurityLock(async (transaction) => {
      if (!await isEmpty(transaction)) throw new ConflictException('Pilot identity database changed; first-admin bootstrap stopped.');
      const { profile } = input;
      const actorId = randomUUID();
      const department = await organization(transaction, profile.organizationName, null);
      const division = await organization(transaction, profile.departmentName, department.id);
      await transaction.personnelDirectoryEntry.create({ data: {
        employeeCode: profile.employeeCode, fullName: profile.fullName, email: profile.email,
        organizationName: profile.organizationName, departmentName: profile.departmentName,
        jobTitle: profile.jobTitle, gender: profile.gender, phoneText: profile.phoneText,
        birthYear: Number(profile.birthDate.slice(0, 4)), birthDate: new Date(`${profile.birthDate}T00:00:00.000Z`),
        sourceProvider: SOURCE, sourceReference: 'USER_CONFIRMED_PILOT_PROFILE',
      } });
      await transaction.actor.create({ data: {
        id: actorId, key: `personnel:${randomUUID()}`, accountKind: 'PERSONNEL',
        personnelEmployeeCode: profile.employeeCode, loginEmail: profile.email, displayName: profile.fullName,
      } });
      await transaction.employmentMembership.create({ data: { actorId, departmentId: department.id, divisionId: division.id } });
      await transaction.role.upsert({ where: { code: 'ADMIN' }, create: {
        code: 'ADMIN', displayName: 'Quản trị hệ thống', description: 'CPMS system administrator',
      }, update: {} });
      await transaction.actorRole.create({ data: { actorId, roleCode: 'ADMIN' } });
      await transaction.scopedRoleBinding.create({ data: {
        actorId, roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: JSON.stringify(['SYSTEM', null, null, null]),
      } });
      await transaction.localCredential.create({ data: { actorId, passwordHash: input.passwordHash, mustChangePassword: true } });
      const sourceHash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
      await transaction.identityImportState.create({ data: { key: STATE, bootstrappedAt: new Date(), sourceHash } });
      await transaction.auditEvent.create({ data: {
        actorId, originalActorId: actorId, contextMode: 'DIRECT', entityType: 'Actor', entityId: actorId,
        action: 'PILOT_FIRST_ADMIN_BOOTSTRAPPED', payload: {
          source: SOURCE, employeeCode: profile.employeeCode, role: 'ADMIN', scopeType: 'SYSTEM',
          credentialCount: 1, mustChangePassword: true,
        },
      } });
      return { actorId };
    });
  }
}
