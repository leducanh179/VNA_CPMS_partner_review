import { normalizeDirectorySearch, ROLE_CODES, type RoleCode } from '@cpms/domain';
import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { IdentityRepository, type AccountAdministrationChange, type DivisionLeaderProfile, type LocalAccount, type NewLocalSession, type StoredLocalSession } from '../application/identity.repository';
import { isDemoCredentialHash, isSessionCurrent, localDemoCredentialsEnabled } from '../application/local-auth-security';

export const localAccountInclude = { roles: true, credential: true,
  scopedBindings: { select: { roleCode: true, scopeType: true, expiresAt: true } },
  personnel: { select: { organizationName: true, departmentName: true, jobTitle: true, gmailEmail: true } },
  employment: { select: { departmentId: true, divisionId: true } },
} satisfies Prisma.ActorInclude;
const sessionInclude = { originalActor: { include: localAccountInclude }, effectiveActor: { include: localAccountInclude } } satisfies Prisma.LocalSessionInclude;
type AccountRow = Prisma.ActorGetPayload<{ include: typeof localAccountInclude }>;
type SessionRow = Prisma.LocalSessionGetPayload<{ include: typeof sessionInclude }>;

export function localAccount(row: AccountRow): LocalAccount {
  const bindings = ['PERSONNEL', 'PILOT_ADMIN'].includes(row.accountKind) ? row.scopedBindings.filter((binding) =>
    (!binding.expiresAt || binding.expiresAt.getTime() > Date.now()) && (binding.roleCode !== 'ADMIN' || binding.scopeType === 'SYSTEM')) : row.roles;
  return { id: row.id, key: row.key, displayName: row.displayName, loginEmail: row.loginEmail, accountKind: row.accountKind,
    isActive: row.isActive, authzVersion: row.authzVersion, roles: [...new Set(bindings.map((binding) => binding.roleCode).filter((code): code is RoleCode => (ROLE_CODES as readonly string[]).includes(code)))],
    personnelEmployeeCode: row.personnelEmployeeCode, profile: row.personnel, employment: row.employment, credential: row.credential };
}
function localSession(row: SessionRow): StoredLocalSession {
  if (row.mode !== 'DIRECT' && row.mode !== 'DEMO_IMPERSONATION' && row.mode !== 'ADMIN_ASSIST') throw new UnauthorizedException('Phiên không hợp lệ.');
  return { id: row.id, tokenHash: row.tokenHash, csrfHash: row.csrfHash, credentialVersion: row.credentialVersion, mode: row.mode,
    createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
    original: localAccount(row.originalActor), effective: localAccount(row.effectiveActor) };
}
export async function lockCpmsSecurity(transaction: Prisma.TransactionClient) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpms:security'))`;
}
export async function requireCurrentSession(transaction: Prisma.TransactionClient, id: string, admin = false): Promise<StoredLocalSession> {
  const row = await transaction.localSession.findUnique({ where: { id }, include: sessionInclude });
  if (!row) throw new UnauthorizedException('Phiên đã hết hạn.');
  const session = localSession(row);
  if (session.original.credential && isDemoCredentialHash(session.original.credential.passwordHash) && !localDemoCredentialsEnabled()) throw new UnauthorizedException('Phiên demo local không được phép trong môi trường này.');
  const valid = [session.original, session.effective].every((account) => account.accountKind === 'PERSONNEL' && Boolean(account.personnelEmployeeCode) ||
    account.accountKind === 'PILOT_ADMIN' && !account.personnelEmployeeCode && account.roles.includes('ADMIN')) &&
    session.original.credential?.credentialVersion === session.credentialVersion &&
    (session.mode === 'DIRECT' || session.original.roles.includes('ADMIN')) &&
    isSessionCurrent({ createdAt: session.createdAt.getTime(), lastSeenAt: session.lastSeenAt.getTime(), expiresAt: session.expiresAt.getTime(),
      revokedAt: session.revokedAt?.getTime() ?? null, effectiveActive: session.effective.isActive, originalActive: session.original.isActive }, Date.now(), 8 * 3_600_000);
  if (!valid) throw new UnauthorizedException('Phiên đã hết hạn hoặc bị thu hồi.');
  if (admin && (session.mode !== 'DIRECT' || !session.effective.roles.includes('ADMIN') || session.original.credential?.mustChangePassword)) throw new ForbiddenException('Cần phiên superadmin trực tiếp.');
  return session;
}
export function identityAudit(transaction: Prisma.TransactionClient, session: StoredLocalSession, action: string, targetActorId: string, payload: Prisma.InputJsonValue) {
  return transaction.auditEvent.create({ data: { actorId: session.effective.id, originalActorId: session.original.id, contextMode: session.mode,
    action, entityType: 'Actor', entityId: targetActorId, payload } });
}

@Injectable()
export class PrismaIdentityRepository extends IdentityRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (transaction) => { await lockCpmsSecurity(transaction); return operation(transaction); }, { maxWait: 10_000, timeout: 20_000 });
  }
  async accountByEmail(loginEmail: string) { const row = await this.prisma.actor.findUnique({ where: { loginEmail }, include: localAccountInclude }); return row ? localAccount(row) : null; }
  async accountById(id: string) { const row = await this.prisma.actor.findUnique({ where: { id }, include: localAccountInclude }); return row ? localAccount(row) : null; }
  async sessionByHash(tokenHash: string) { const row = await this.prisma.localSession.findUnique({ where: { tokenHash }, include: sessionInclude }); return row ? localSession(row) : null; }
  async reserveLoginAttempt(emailHash: string, ipHash: string) {
    return this.transaction(async (transaction) => {
      const now = new Date(); let permitted = true;
      for (const [keyHash, limit] of [[emailHash, 5], [ipHash, 30]] as const) {
        const current = await transaction.localLoginBucket.findUnique({ where: { keyHash } });
        const expired = !current || now.getTime() - current.windowStartedAt.getTime() >= 900_000;
        const attempts = expired ? 1 : Math.min(current.attempts + 1, 10_000);
        const windowStartedAt = expired ? now : current.windowStartedAt;
        await transaction.localLoginBucket.upsert({ where: { keyHash }, create: { keyHash, attempts, windowStartedAt }, update: { attempts, windowStartedAt } });
        if (attempts > limit) permitted = false;
      }
      return permitted;
    });
  }
  async createSession(input: NewLocalSession) {
    return this.transaction(async (transaction) => {
      const account = await transaction.actor.findUnique({ where: { id: input.originalActorId }, include: localAccountInclude });
      if (!account?.isActive || !(account.accountKind === 'PERSONNEL' && account.personnelEmployeeCode ||
          account.accountKind === 'PILOT_ADMIN' && !account.personnelEmployeeCode && localAccount(account).roles.includes('ADMIN')) ||
          account.credential?.credentialVersion !== input.credentialVersion || input.originalActorId !== input.effectiveActorId || input.mode !== 'DIRECT') throw new UnauthorizedException('Thông tin đăng nhập đã thay đổi.');
      const session = localSession(await transaction.localSession.create({ data: input, include: sessionInclude }));
      await identityAudit(transaction, session, 'AUTH_LOGIN', account.id, { mode: 'DIRECT' });
      return session;
    });
  }
  async touchSession(id: string, lastSeenAt: Date) {
    await this.prisma.localSession.updateMany({ where: { id, revokedAt: null, expiresAt: { gt: lastSeenAt } }, data: { lastSeenAt } });
  }
  async revokeSession(id: string) {
    await this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, id);
      await transaction.localSession.update({ where: { id }, data: { revokedAt: new Date() } });
      await identityAudit(transaction, session, 'AUTH_LOGOUT', session.effective.id, { mode: session.mode });
    });
  }
  async rotateSession(id: string, replacement: NewLocalSession, action: 'DEMO_START' | 'DEMO_END' | 'ASSIST_START' | 'ASSIST_END', reason?: string) {
    return this.transaction(async (transaction) => {
      const starting = action === 'DEMO_START' || action === 'ASSIST_START';
      const prior = await requireCurrentSession(transaction, id, starting);
      if (prior.original.credential?.mustChangePassword || !prior.original.roles.includes('ADMIN') || replacement.originalActorId !== prior.original.id || replacement.credentialVersion !== prior.credentialVersion || replacement.expiresAt.getTime() > prior.expiresAt.getTime()) throw new ForbiddenException('Ngữ cảnh trình diễn không hợp lệ.');
      if (!starting && (prior.mode !== (action === 'DEMO_END' ? 'DEMO_IMPERSONATION' : 'ADMIN_ASSIST') || replacement.effectiveActorId !== prior.original.id || replacement.mode !== 'DIRECT')) throw new ForbiddenException('Không có phiên hỗ trợ hợp lệ.');
      if (action === 'ASSIST_START' && (!reason?.trim() || replacement.expiresAt.getTime() > Date.now() + 30 * 60_000)) throw new ForbiddenException('Hỗ trợ tài khoản cần lý do và chỉ có hiệu lực tối đa 30 phút.');
      const target = await transaction.actor.findUnique({ where: { id: replacement.effectiveActorId }, include: { scopedBindings: { where: { roleCode: 'ADMIN', scopeType: 'SYSTEM' } } } });
      if (!target?.isActive || (starting ? target.accountKind !== 'PERSONNEL' || !target.personnelEmployeeCode :
          !['PERSONNEL', 'PILOT_ADMIN'].includes(target.accountKind))) throw new ForbiddenException('Tài khoản không đủ điều kiện trình diễn.');
      if (starting && (prior.mode !== 'DIRECT' || replacement.mode !== (action === 'DEMO_START' ? 'DEMO_IMPERSONATION' : 'ADMIN_ASSIST') || target.id === prior.original.id ||
          (action === 'ASSIST_START' && target.scopedBindings.some((binding) => !binding.expiresAt || binding.expiresAt > new Date())))) throw new ForbiddenException('Không cho lồng, tự chuyển vai hoặc hỗ trợ tài khoản quản trị.');
      await transaction.localSession.update({ where: { id }, data: { revokedAt: new Date() } });
      const next = localSession(await transaction.localSession.create({ data: replacement, include: sessionInclude }));
      await identityAudit(transaction, prior, action, target.id, { originalActorId: prior.original.id, effectiveActorId: target.id, mode: next.mode, ...(reason ? { reason: reason.trim() } : {}) });
      return next;
    });
  }
  async changeCredential(sessionId: string, actorId: string, expectedCredentialVersion: number, passwordHash: string) {
    await this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId);
      if (session.mode !== 'DIRECT' || session.effective.id !== actorId) throw new ForbiddenException('Không được đổi mật khẩu người khác.');
      const result = await transaction.localCredential.updateMany({ where: { actorId, credentialVersion: expectedCredentialVersion }, data: { passwordHash, mustChangePassword: false, credentialVersion: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('Mật khẩu đã được thay đổi. Hãy đăng nhập lại.');
      await transaction.localSession.updateMany({ where: { OR: [{ originalActorId: actorId }, { effectiveActorId: actorId }], revokedAt: null }, data: { revokedAt: new Date() } });
      await identityAudit(transaction, session, 'AUTH_PASSWORD_CHANGED', actorId, { sessionsRevoked: true });
    });
  }
  async resetCredential(sessionId: string, actorId: string, expectedVersion: number, passwordHash: string, reason: string, mustChangePassword: boolean) {
    await this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      if (!mustChangePassword && (!localDemoCredentialsEnabled() || !isDemoCredentialHash(passwordHash))) throw new ForbiddenException('Chỉ credential demo local được bỏ yêu cầu đổi mật khẩu.');
      const target = await transaction.actor.findUnique({ where: { id: actorId } });
      if (!target || !['PERSONNEL', 'PILOT_ADMIN'].includes(target.accountKind) || !target.isActive || !reason.trim() ||
          (session.original.accountKind === 'PILOT_ADMIN' && target.id !== session.original.id && target.accountKind === 'PILOT_ADMIN')) throw new ForbiddenException('Không thể thiết lập đăng nhập cho tài khoản này.');
      if (session.original.accountKind === 'PILOT_ADMIN' && target.accountKind === 'PERSONNEL' &&
          await transaction.scopedRoleBinding.count({ where: { actorId: target.id, roleCode: 'ADMIN', scopeType: 'SYSTEM' } })) {
        throw new ForbiddenException('Tài khoản thử nghiệm không được đặt lại mật khẩu quản trị viên nhân sự.');
      }
      if (target.authzVersion !== expectedVersion) throw new ConflictException('Tài khoản đã thay đổi. Hãy tải lại.');
      await transaction.localCredential.upsert({ where: { actorId }, create: { actorId, passwordHash, mustChangePassword }, update: { passwordHash, mustChangePassword, credentialVersion: { increment: 1 } } });
      await transaction.actor.update({ where: { id: actorId }, data: { authzVersion: { increment: 1 } } });
      await transaction.localSession.updateMany({ where: { OR: [{ originalActorId: actorId }, { effectiveActorId: actorId }], revokedAt: null }, data: { revokedAt: new Date() } });
      await identityAudit(transaction, session, 'AUTH_CREDENTIAL_RESET', actorId, { reason, expectedVersion, sessionsRevoked: true });
    });
  }
  async changeAccountStatus(sessionId: string, change: AccountAdministrationChange) {
    await this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      const target = await transaction.actor.findUnique({ where: { id: change.targetActorId }, include: localAccountInclude });
      if (!target || !['PERSONNEL', 'PILOT_ADMIN'].includes(target.accountKind) || !change.reason.trim()) throw new ForbiddenException('Không thể thay đổi tài khoản này.');
      if (session.original.accountKind === 'PILOT_ADMIN' && (target.accountKind === 'PILOT_ADMIN' || localAccount(target).roles.includes('ADMIN'))) {
        throw new ForbiddenException('Tài khoản thử nghiệm không được khóa quản trị viên khác.');
      }
      if (target.authzVersion !== change.expectedVersion) throw new ConflictException('Tài khoản đã thay đổi.');
      if (!change.isActive && target.accountKind === 'PERSONNEL' && localAccount(target).roles.includes('ADMIN')) {
        const activeAdmins = await transaction.actor.count({ where: { isActive: true, accountKind: 'PERSONNEL', scopedBindings: { some: { roleCode: 'ADMIN', scopeType: 'SYSTEM', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } });
        if (activeAdmins <= 1 || target.id === session.original.id) throw new ForbiddenException('Không được tự khóa hoặc khóa superadmin cuối cùng.');
      }
      if (target.isActive === change.isActive) return;
      await transaction.actor.update({ where: { id: target.id }, data: { isActive: change.isActive, authzVersion: { increment: 1 } } });
      if (!change.isActive) await transaction.localSession.updateMany({ where: { OR: [{ originalActorId: target.id }, { effectiveActorId: target.id }], revokedAt: null }, data: { revokedAt: new Date() } });
      await identityAudit(transaction, session, 'ACCOUNT_STATUS_CHANGED', target.id, { before: target.isActive, after: change.isActive, reason: change.reason });
    });
  }
  async createDivisionLeader(sessionId: string, profile: DivisionLeaderProfile, passwordHash: string, mustChangePassword: boolean, reason: string) {
    return this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      const duplicate = await transaction.actor.findFirst({ where: { OR: [{ personnelEmployeeCode: profile.employeeCode }, { loginEmail: profile.email }] }, select: { id: true } });
      if (duplicate || await transaction.personnelDirectoryEntry.findUnique({ where: { employeeCode: profile.employeeCode }, select: { employeeCode: true } })) {
        throw new ConflictException('Mã nhân viên hoặc email đã có hồ sơ; không tạo trùng hay ghi đè.');
      }
      const readPermissions = ['campaign.read', 'material.read', 'contract.read', 'booking.read'] as const;
      const definitions = await transaction.permissionDefinition.findMany({ where: { code: { in: [...readPermissions] }, implementationStatus: 'IMPLEMENTED' }, select: { code: true } });
      const leaderPreset = await transaction.rolePermission.findFirst({ where: { roleCode: 'DIVISION_LEADER', permissionCode: 'campaign.read', effect: 'ALLOW' }, select: { id: true } });
      if (definitions.length !== readPermissions.length || !leaderPreset) throw new ConflictException('Danh mục quyền chưa được khởi tạo đầy đủ.');
      const org = async (name: string, parentId: string | null) => {
        const identityKey = createHash('sha256').update(JSON.stringify([parentId, normalizeDirectorySearch(name)])).digest('hex');
        return transaction.employmentOrgUnit.upsert({ where: { identityKey }, create: {
          identityKey, sourceName: name, kind: parentId ? 'DIVISION' : 'DEPARTMENT', parentId, sourceProvider: 'PILOT_LEADER_MANUAL_V1',
        }, update: {} });
      };
      const department = await org(profile.organizationName, null);
      const division = await org(profile.departmentName, department.id);
      if (!department.isActive || !division.isActive) throw new ForbiddenException('Đơn vị công tác đã ngừng hoạt động.');
      await transaction.personnelDirectoryEntry.create({ data: {
        employeeCode: profile.employeeCode, fullName: profile.fullName, email: profile.email, gmailEmail: profile.gmailEmail,
        organizationName: profile.organizationName, departmentName: profile.departmentName, jobTitle: profile.jobTitle,
        gender: profile.gender, phoneText: profile.phoneText, birthDate: new Date(`${profile.birthDate}T00:00:00.000Z`),
        birthYear: Number(profile.birthDate.slice(0, 4)), sourceProvider: 'PILOT_LEADER_MANUAL_V1', sourceReference: 'USER_CONFIRMED_PILOT_PROFILE',
      } });
      const actor = await transaction.actor.create({ data: {
        id: randomUUID(), key: `personnel:${randomUUID()}`, accountKind: 'PERSONNEL', personnelEmployeeCode: profile.employeeCode,
        loginEmail: profile.email, displayName: profile.fullName,
        employment: { create: { departmentId: department.id, divisionId: division.id } },
        credential: { create: { passwordHash, mustChangePassword } },
        roles: { create: { roleCode: 'DIVISION_LEADER' } },
        scopedBindings: { create: { roleCode: 'DIVISION_LEADER', scopeType: 'MODULE_ORG', module: 'CAMPAIGN', orgId: division.id,
          scopeKey: JSON.stringify(['MODULE_ORG', 'CAMPAIGN', division.id, null]) } },
      } });
      for (const permissionCode of readPermissions) {
        const module = permissionCode.split('.')[0]!.toUpperCase();
        await transaction.accountPermissionOverride.create({ data: { actorId: actor.id, permissionCode,
          scopeType: 'MODULE', module, scopeKey: JSON.stringify(['MODULE', module, null, null, null]), effect: 'ALLOW', relation: 'ALL' } });
      }
      await transaction.accessPolicyState.upsert({ where: { key: 'access' }, create: { key: 'access' }, update: { recordVersion: { increment: 1 } } });
      await identityAudit(transaction, session, 'ACCOUNT_DIVISION_LEADER_CREATED', actor.id, {
        employeeCode: profile.employeeCode, role: 'DIVISION_LEADER', divisionId: division.id,
        readableModules: readPermissions.map((code) => code.split('.')[0]!), mustChangePassword, gmailRecorded: Boolean(profile.gmailEmail), reason,
      });
      return localAccount(await transaction.actor.findUniqueOrThrow({ where: { id: actor.id }, include: localAccountInclude }));
    });
  }
  async createCommunicationSpecialist(sessionId: string, employeeCode: string, email: string, passwordHash: string, reason: string) {
    return this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      if (session.original.accountKind !== 'PERSONNEL') throw new ForbiddenException('Chỉ quản trị viên nhân sự được cấp tài khoản.');
      const person = await transaction.personnelDirectoryEntry.findUnique({ where: { employeeCode } });
      if (!person?.isActive || person.email?.toLowerCase() !== email || !person.departmentName ||
          normalizeDirectorySearch(person.organizationName) !== normalizeDirectorySearch('Ban Truyền thông')) {
        throw new ConflictException('Hồ sơ danh bạ không khớp chuyên viên Ban Truyền thông đang hoạt động.');
      }
      if (await transaction.actor.findFirst({ where: { OR: [{ personnelEmployeeCode: employeeCode }, { loginEmail: email }] }, select: { id: true } })) {
        throw new ConflictException('Nhân sự hoặc email đã có tài khoản.');
      }
      const unit = async (name: string, parentId: string | null) => {
        const identityKey = createHash('sha256').update(JSON.stringify([parentId, normalizeDirectorySearch(name)])).digest('hex');
        return transaction.employmentOrgUnit.upsert({ where: { identityKey }, create: { identityKey, sourceName: name,
          kind: parentId ? 'DIVISION' : 'DEPARTMENT', parentId, sourceProvider: person.sourceProvider }, update: {} });
      };
      const department = await unit(person.organizationName, null);
      const division = await unit(person.departmentName, department.id);
      if (!department.isActive || !division.isActive) throw new ForbiddenException('Đơn vị công tác đã ngừng hoạt động.');
      const actor = await transaction.actor.create({ data: { id: randomUUID(), key: `personnel:${randomUUID()}`,
        accountKind: 'PERSONNEL', personnelEmployeeCode: employeeCode, loginEmail: email, displayName: person.fullName,
        employment: { create: { departmentId: department.id, divisionId: division.id, displayGroup: person.displayGroup } },
        credential: { create: { passwordHash, mustChangePassword: true } },
        roles: { create: { roleCode: 'COMM_CAMPAIGN_MANAGER' } },
        scopedBindings: { create: { roleCode: 'COMM_CAMPAIGN_MANAGER', scopeType: 'MODULE_ORG', module: 'CAMPAIGN', orgId: division.id,
          scopeKey: JSON.stringify(['MODULE_ORG', 'CAMPAIGN', division.id, null]) } },
      } });
      await transaction.accessPolicyState.upsert({ where: { key: 'access' }, create: { key: 'access' }, update: { recordVersion: { increment: 1 } } });
      await identityAudit(transaction, session, 'ACCOUNT_SPECIALIST_CREATED', actor.id, {
        employeeCode, role: 'COMM_CAMPAIGN_MANAGER', divisionId: division.id, mustChangePassword: true, reason,
      });
      return localAccount(await transaction.actor.findUniqueOrThrow({ where: { id: actor.id }, include: localAccountInclude }));
    });
  }
  async createPilotAdmin(sessionId: string, email: string, displayName: string, passwordHash: string, reason: string) {
    return this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      if (session.original.accountKind !== 'PERSONNEL') throw new ForbiddenException('Chỉ quản trị viên nhân sự được cấp tài khoản thử nghiệm.');
      if (await transaction.actor.findUnique({ where: { loginEmail: email }, select: { id: true } }) ||
          await transaction.personnelDirectoryEntry.findFirst({ where: { email }, select: { employeeCode: true } })) {
        throw new ConflictException('Email đã thuộc tài khoản hoặc nhân sự thật.');
      }
      const actor = await transaction.actor.create({ data: { id: randomUUID(), key: `pilot-admin:${randomUUID()}`,
        accountKind: 'PILOT_ADMIN', loginEmail: email, displayName,
        credential: { create: { passwordHash, mustChangePassword: false } }, roles: { create: { roleCode: 'ADMIN' } },
        scopedBindings: { create: { roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: JSON.stringify(['SYSTEM', null, null, null]) } },
      } });
      await transaction.accessPolicyState.upsert({ where: { key: 'access' }, create: { key: 'access' }, update: { recordVersion: { increment: 1 } } });
      await identityAudit(transaction, session, 'PILOT_ADMIN_CREATED', actor.id, {
        accountKind: 'PILOT_ADMIN', role: 'ADMIN', mustChangePassword: false, removableByPersonnelAdmin: true, reason,
      });
      return localAccount(await transaction.actor.findUniqueOrThrow({ where: { id: actor.id }, include: localAccountInclude }));
    });
  }
  async updateGmail(sessionId: string, actorId: string, expectedVersion: number, gmailEmail: string | null, reason: string) {
    await this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      const target = await transaction.actor.findUnique({ where: { id: actorId }, include: { personnel: true } });
      if (!target || target.accountKind !== 'PERSONNEL' || !target.personnel || !target.isActive) throw new ForbiddenException('Tài khoản không hợp lệ.');
      if (session.original.accountKind === 'PILOT_ADMIN' &&
          await transaction.scopedRoleBinding.count({ where: { actorId, roleCode: 'ADMIN', scopeType: 'SYSTEM' } })) {
        throw new ForbiddenException('Tài khoản thử nghiệm không được sửa hồ sơ quản trị viên nhân sự.');
      }
      if (target.authzVersion !== expectedVersion) throw new ConflictException('Hồ sơ đã thay đổi. Hãy tải lại.');
      if (target.personnel.gmailEmail === gmailEmail) return;
      await transaction.personnelDirectoryEntry.update({ where: { employeeCode: target.personnel.employeeCode }, data: { gmailEmail, recordVersion: { increment: 1 } } });
      await transaction.actor.update({ where: { id: actorId }, data: { authzVersion: { increment: 1 } } });
      await identityAudit(transaction, session, 'ACCOUNT_GMAIL_UPDATED', actorId, {
        before: target.personnel.gmailEmail, after: gmailEmail, reason, googleAuthorizationChanged: false,
      });
    });
  }
  async listAccounts(sessionId: string) {
    return this.transaction(async (transaction) => { await requireCurrentSession(transaction, sessionId, true);
      return (await transaction.actor.findMany({ where: { accountKind: { in: ['PERSONNEL', 'PILOT_ADMIN'] } }, include: localAccountInclude, orderBy: { displayName: 'asc' } })).map(localAccount);
    });
  }
  async configureLocalDemoCredentials(sessionId: string, credentials: { actorId: string; expectedVersion: number; passwordHash: string }[], reason: string) {
    return this.transaction(async (transaction) => {
      const session = await requireCurrentSession(transaction, sessionId, true);
      if (!localDemoCredentialsEnabled() || !reason.trim()) throw new ForbiddenException('Chỉ cho phép cấu hình demo local tường minh.');
      const targets = await transaction.actor.findMany({ where: { accountKind: 'PERSONNEL' }, select: { id: true, authzVersion: true } });
      if (credentials.length !== targets.length || new Set(credentials.map((item) => item.actorId)).size !== targets.length ||
          credentials.some((item) => !isDemoCredentialHash(item.passwordHash) || !targets.some((target) => target.id === item.actorId && target.authzVersion === item.expectedVersion))) {
        throw new ConflictException('Danh sách tài khoản đã thay đổi sau khi chuẩn bị.');
      }
      for (const item of credentials) {
        await transaction.localCredential.upsert({ where: { actorId: item.actorId }, create: { actorId: item.actorId, passwordHash: item.passwordHash, mustChangePassword: false },
          update: { passwordHash: item.passwordHash, mustChangePassword: false, credentialVersion: { increment: 1 } } });
        await transaction.actor.update({ where: { id: item.actorId }, data: { authzVersion: { increment: 1 } } });
      }
      await transaction.localSession.updateMany({ where: { revokedAt: null, OR: [{ originalActorId: { in: targets.map((target) => target.id) } }, { effectiveActorId: { in: targets.map((target) => target.id) } }] }, data: { revokedAt: new Date() } });
      await identityAudit(transaction, session, 'LOCAL_DEMO_CREDENTIALS_CONFIGURED', session.effective.id, { configured: targets.length, reason, forceFirstChange: false, sessionsRevoked: true });
      return { configured: targets.length };
    });
  }
  async readLocalDemoDefaultPassword(): Promise<string> {
    if (!localDemoCredentialsEnabled() || !process.env.LOCAL_DEMO_CREDENTIAL_FILE) throw new ForbiddenException('Chưa cấu hình mật khẩu demo local.');
    const expectedRoot = path.resolve(__dirname, '../../../../../../private-local/access-demo');
    const privateRoot = await realpath(expectedRoot);
    const file = await realpath(process.env.LOCAL_DEMO_CREDENTIAL_FILE);
    const relative = path.relative(privateRoot, file);
    if (privateRoot.toLowerCase() !== expectedRoot.toLowerCase() || !relative || relative.startsWith('..') || path.isAbsolute(relative) ||
        path.extname(file) !== '.json' || (await stat(file)).size > 4096) throw new ForbiddenException('Đường dẫn credential demo không hợp lệ.');
    const value: unknown = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || !('password' in value) || typeof value.password !== 'string' || Array.from(value.password).length < 8 || Buffer.byteLength(value.password, 'utf8') > 1024) throw new ForbiddenException('Cấu hình credential demo không hợp lệ.');
    return value.password;
  }
}
