import { normalizeDirectorySearch, previewPersonnelImport, type DirectoryImportSnapshot, type DirectorySourceRow, type ParsedDirectory, type PendingDirectoryContact } from '@cpms/domain';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { DirectoryImportRepository, DirectoryTransaction } from '../application/directory-import.application-service';
import { PersonnelBootstrapRepository, type BootstrapRolePlan } from '../application/personnel-bootstrap.application-service';
import { lockCpmsSecurity, requireCurrentSession } from './prisma-identity.repository';

const NAMESPACE = 'personnel-xlsx-v1';
async function snapshot(transaction: Prisma.TransactionClient) {
  const [state, people, actors, pending] = await Promise.all([
    transaction.identityImportState.findUnique({ where: { key: NAMESPACE } }),
    transaction.personnelDirectoryEntry.findMany({ select: { employeeCode: true, fullName: true, email: true, organizationName: true,
      departmentName: true, displayGroup: true, jobTitle: true, sourceReference: true, recordVersion: true, account: { select: { id: true } } } }),
    transaction.actor.findMany({ where: { loginEmail: { not: null } }, select: { id: true, personnelEmployeeCode: true, loginEmail: true } }),
    transaction.pendingDirectoryContact.findMany({ select: { email: true } }),
  ]);
  const data: DirectoryImportSnapshot = { identities: people.map((person) => ({ employeeCode: person.employeeCode, actorId: person.account?.id ?? null,
    email: person.email, recordVersion: person.recordVersion, profile: { fullName: person.fullName, organizationName: person.organizationName,
      departmentName: person.departmentName, displayGroup: person.displayGroup, jobTitle: person.jobTitle, sourceReference: person.sourceReference } })),
    accounts: actors.map((actor) => ({ actorId: actor.id, employeeCode: actor.personnelEmployeeCode, email: actor.loginEmail! })), pendingEmails: pending.map((item) => item.email) };
  return { version: state?.recordVersion ?? 0, data, alreadyBootstrapped: Boolean(state?.bootstrappedAt) };
}
function advance(transaction: Prisma.TransactionClient) {
  return transaction.identityImportState.upsert({ where: { key: NAMESPACE }, create: { key: NAMESPACE }, update: { recordVersion: { increment: 1 } } });
}
async function organization(transaction: Prisma.TransactionClient, name: string, parentId: string | null) {
  // Internal identity keys are not official organization codes; a division's parent is part of its identity.
  const identityKey = createHash('sha256').update(JSON.stringify([parentId, normalizeDirectorySearch(name)])).digest('hex');
  return transaction.employmentOrgUnit.upsert({ where: { identityKey }, create: { identityKey, sourceName: name,
    kind: parentId ? 'DIVISION' : 'DEPARTMENT', parentId, sourceProvider: NAMESPACE }, update: {} });
}
async function upsertPerson(transaction: Prisma.TransactionClient, person: DirectorySourceRow, expectedVersion: number | null, auditActorId: string, reservedActorId?: string) {
  const prior = await transaction.personnelDirectoryEntry.findUnique({ where: { employeeCode: person.employeeCode }, include: { account: true } });
  if ((prior?.recordVersion ?? null) !== expectedVersion) throw new ConflictException('Hồ sơ đã thay đổi sau khi xem trước.');
  const fields = { fullName: person.fullName, email: person.email, organizationName: person.organizationName, departmentName: person.departmentName,
    displayGroup: person.displayGroup, jobTitle: person.jobTitle, sourceReference: person.sourceReference };
  await transaction.personnelDirectoryEntry.upsert({ where: { employeeCode: person.employeeCode }, create: { employeeCode: person.employeeCode, ...fields, sourceProvider: NAMESPACE },
    update: { ...fields, recordVersion: { increment: 1 } } });
  const department = await organization(transaction, person.organizationName, null);
  const division = person.departmentName ? await organization(transaction, person.departmentName, department.id) : null;
  const actor = await transaction.actor.upsert({ where: { personnelEmployeeCode: person.employeeCode },
    create: { id: reservedActorId ?? randomUUID(), key: `personnel:${randomUUID()}`, accountKind: 'PERSONNEL', personnelEmployeeCode: person.employeeCode, loginEmail: person.email, displayName: person.fullName },
    update: { loginEmail: person.email, displayName: person.fullName, authzVersion: { increment: 1 } } });
  await transaction.employmentMembership.upsert({ where: { actorId: actor.id },
    create: { actorId: actor.id, departmentId: department.id, divisionId: division?.id ?? null, displayGroup: person.displayGroup },
    update: { departmentId: department.id, divisionId: division?.id ?? null, displayGroup: person.displayGroup, recordVersion: { increment: 1 } } });
  if (prior?.account) await transaction.localSession.updateMany({ where: { revokedAt: null, OR: [{ originalActorId: actor.id }, { effectiveActorId: actor.id }] }, data: { revokedAt: new Date() } });
  await transaction.auditEvent.create({ data: { actorId: auditActorId, originalActorId: auditActorId, contextMode: 'DIRECT',
    entityType: 'Actor', entityId: actor.id, action: prior ? 'PERSONNEL_PROFILE_UPDATED' : 'PERSONNEL_PROFILE_CREATED',
    payload: { source: NAMESPACE, sourceSheet: person.sheetName, sourceRow: person.rowNumber, expectedVersion, rolesChanged: false, credentialsChanged: false } } });
  await advance(transaction);
  return actor;
}
async function upsertPending(transaction: Prisma.TransactionClient, contact: PendingDirectoryContact, actorId: string) {
  const created = await transaction.pendingDirectoryContact.createMany({ data: { email: contact.email, sourceSheet: contact.sheetName, sourceRow: contact.rowNumber }, skipDuplicates: true });
  if (!created.count) return;
  await transaction.auditEvent.create({ data: { actorId, originalActorId: actorId, contextMode: 'DIRECT', entityType: 'DirectoryImport', entityId: NAMESPACE,
    action: 'PERSONNEL_CONTACT_PENDING', payload: { sourceSheet: contact.sheetName, sourceRow: contact.rowNumber, accountCreated: false } } });
  await advance(transaction);
}

@Injectable()
export class PrismaDirectoryImportRepository implements DirectoryImportRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  withImportTransaction<T>(operation: (transaction: DirectoryTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCpmsSecurity(transaction);
      return operation({ requireDirectSuperadmin: async (id) => {
        const session = await requireCurrentSession(transaction, id, true);
        if (session.original.accountKind !== 'PERSONNEL') throw new ForbiddenException('Chỉ quản trị viên nhân sự được nhập lại danh bạ.');
        return { actorId: session.effective.id };
      },
        snapshot: () => snapshot(transaction),
        upsertPersonWithAudit: async (person, version, actorId) => { await upsertPerson(transaction, person, version, actorId); },
        upsertPendingWithAudit: (contact, actorId) => upsertPending(transaction, contact, actorId) });
    }, { maxWait: 10_000, timeout: 120_000 });
  }
}

@Injectable()
export class PrismaPersonnelBootstrapRepository extends PersonnelBootstrapRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async preview(source: ParsedDirectory) {
    return this.prisma.$transaction(async (transaction) => {
      await lockCpmsSecurity(transaction);
      const current = await snapshot(transaction);
      return { preview: previewPersonnelImport(source, current.data), version: current.version, alreadyBootstrapped: current.alreadyBootstrapped };
    });
  }
  async apply(input: { source: ParsedDirectory; sourceHash: string; expectedVersion: number; administrator: DirectorySourceRow; roles: BootstrapRolePlan[]; passwordHash: string }) {
    return this.prisma.$transaction(async (transaction) => {
      await lockCpmsSecurity(transaction);
      const current = await snapshot(transaction);
      if (current.alreadyBootstrapped || current.version !== input.expectedVersion || await transaction.actor.count({ where: { accountKind: 'PERSONNEL' } })) {
        throw new ConflictException('Khởi tạo chỉ được chạy một lần trên danh tính chưa provision.');
      }
      const preview = previewPersonnelImport(input.source, current.data);
      if (preview.counts.CONFLICT || preview.counts.INVALID) throw new ConflictException('Danh bạ có xung đột; chưa áp dụng.');
      const adminItem = preview.items.find((item) => item.person?.employeeCode === input.administrator.employeeCode);
      if (!adminItem?.person || input.roles.filter((plan) => plan.role === 'ADMIN').length !== 1 ||
          !input.roles.some((plan) => plan.role === 'ADMIN' && plan.employeeCode === input.administrator.employeeCode)) throw new ConflictException('Danh tính quản trị chưa được xác minh.');
      const administratorId = randomUUID();
      await upsertPerson(transaction, adminItem.person, adminItem.expectedVersion, administratorId, administratorId);
      let people = 1; let pending = 0;
      for (const item of preview.items) {
        if (item.person && item.person.employeeCode !== input.administrator.employeeCode && ['CREATE', 'UPDATE'].includes(item.status)) {
          await upsertPerson(transaction, item.person, item.expectedVersion, administratorId); people++;
        } else if (item.pending && item.status === 'PENDING') { await upsertPending(transaction, item.pending, administratorId); pending++; }
      }
      for (const plan of input.roles) {
        const actor = await transaction.actor.findUniqueOrThrow({ where: { personnelEmployeeCode: plan.employeeCode }, include: { employment: true } });
        await transaction.role.upsert({ where: { code: plan.role }, create: { code: plan.role, displayName: plan.role, description: 'Scoped CPMS role preset' }, update: {} });
        const orgId = plan.scope === 'DEPARTMENT' ? actor.employment?.departmentId : plan.scope === 'DIVISION' ? actor.employment?.divisionId : null;
        if (['DEPARTMENT', 'DIVISION'].includes(plan.scope) && !orgId) throw new ConflictException('Thiếu đơn vị cho vai trò lãnh đạo.');
        const scopeType = plan.scope === 'SYSTEM' ? 'SYSTEM' : orgId ? 'MODULE_ORG' : 'MODULE';
        const module = plan.scope === 'SYSTEM' ? null : 'CAMPAIGN';
        const scopeKey = JSON.stringify([scopeType, module, orgId ?? null, null]);
        await transaction.scopedRoleBinding.create({ data: { actorId: actor.id, roleCode: plan.role, scopeKey, scopeType, module, orgId: orgId ?? null } });
        await transaction.actorRole.create({ data: { actorId: actor.id, roleCode: plan.role } });
        await transaction.auditEvent.create({ data: { actorId: administratorId, originalActorId: administratorId, contextMode: 'DIRECT', entityType: 'Actor', entityId: actor.id,
          action: 'BOOTSTRAP_ROLE_GRANTED', payload: { role: plan.role, scopeType, module, orgId: orgId ?? null, source: 'PRIVATE_REVIEWED_CONFIGURATION' } } });
      }
      await transaction.localCredential.create({ data: { actorId: administratorId, passwordHash: input.passwordHash, mustChangePassword: true } });
      await transaction.identityImportState.update({ where: { key: NAMESPACE }, data: { bootstrappedAt: new Date(), sourceHash: input.sourceHash, recordVersion: { increment: 1 } } });
      await transaction.auditEvent.create({ data: { actorId: administratorId, originalActorId: administratorId, contextMode: 'DIRECT', entityType: 'DirectoryImport', entityId: NAMESPACE,
        action: 'PERSONNEL_BOOTSTRAP_COMPLETED', payload: { people, pending, credentialCount: 1, sourceHash: input.sourceHash } } });
      return { people, pending, administratorId };
    }, { maxWait: 10_000, timeout: 120_000 });
  }
}
