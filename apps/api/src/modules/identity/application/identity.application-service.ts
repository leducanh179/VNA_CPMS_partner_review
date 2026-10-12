import type { ActorContext } from '@cpms/domain';
import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException, HttpException } from '@nestjs/common';
import { z } from 'zod';
import { IdentityRepository, type LocalAccount, type StoredLocalSession, type NewLocalSession, type DivisionLeaderProfile } from './identity.repository';
import { pilotAdminProfileSchema } from './pilot-admin-bootstrap.application-service';
import { generateLocalCredential, hashLocalDemoPassword, hashLocalPassword, hashOpaqueSecret, isDemoCredentialHash, isSessionCurrent, localDemoCredentialsEnabled, newOpaqueSecret, PasswordCapacityError, validateNewLocalPassword, verifyLocalPassword } from './local-auth-security';

const invalidLogin = () => new UnauthorizedException('Thông tin đăng nhập không hợp lệ hoặc tài khoản chưa được thiết lập.');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const SESSION_IDLE = SESSION_TTL;
export const LOCAL_SESSION_COOKIE = 'cpms_session';
const divisionLeaderInput = z.object({
  profile: pilotAdminProfileSchema.extend({ gmailEmail: z.email().nullable() }),
  password: z.string().refine(validateNewLocalPassword, 'Mật khẩu cần ít nhất 8 ký tự và không quá 1024 byte UTF-8.'),
  mustChangePassword: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
const specialistInput = z.object({
  employeeCode: z.string().trim().min(1).max(32), email: z.email(),
  password: z.string().refine(validateNewLocalPassword), reason: z.string().trim().min(1).max(1000),
}).strict();
const pilotAdminInput = z.object({
  email: z.email(), displayName: z.string().trim().min(1).max(120),
  password: z.string().refine(validateNewLocalPassword), reason: z.string().trim().min(1).max(1000),
}).strict();

export function isLoginAccount(account: LocalAccount): boolean {
  return account.accountKind === 'PERSONNEL' && Boolean(account.personnelEmployeeCode) ||
    account.accountKind === 'PILOT_ADMIN' && account.personnelEmployeeCode === null && account.roles.includes('ADMIN');
}

export function isDirectLocalSuperadmin(session: StoredLocalSession): boolean {
  return session.mode === 'DIRECT' && session.original.id === session.effective.id &&
    isLoginAccount(session.effective) && session.effective.isActive && session.effective.roles.includes('ADMIN');
}
export function publicLocalAccount(account: LocalAccount) {
  return { id: account.id, displayName: account.displayName, email: account.loginEmail, employeeCode: account.personnelEmployeeCode,
    accountKind: account.accountKind, profile: account.profile, employment: account.employment, roles: account.roles, isActive: account.isActive,
    recordVersion: account.authzVersion, credentialConfigured: Boolean(account.credential), mustChangePassword: account.credential?.mustChangePassword ?? false };
}

@Injectable()
export class IdentityApplicationService {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository) {}

  async login(emailInput: string, password: string, ip: string) {
    const email = emailInput.trim().toLowerCase();
    if (email.length > 254 || password.length > 1024 || !email) throw invalidLogin();
    const capacity = await this.repository.reserveLoginAttempt(hashOpaqueSecret(`email:${email}`), hashOpaqueSecret(`ip:${ip}`));
    if (!capacity) throw new HttpException('Đã vượt số lần thử đăng nhập. Hãy thử lại sau 15 phút.', 429);
    const account = await this.repository.accountByEmail(email);
    let verified: boolean;
    try { verified = await verifyLocalPassword(password, account?.credential?.passwordHash ?? null, localDemoCredentialsEnabled()); }
    catch (error) { if (error instanceof PasswordCapacityError) throw new HttpException('Đăng nhập đang bận. Hãy thử lại sau.', 429); throw error; }
    if (!verified || !account || !account.isActive || !isLoginAccount(account) || !account.credential) throw invalidLogin();
    const secret = newOpaqueSecret(); const csrf = newOpaqueSecret();
    const session = await this.repository.createSession({ tokenHash: secret.hash, csrfHash: csrf.hash, originalActorId: account.id,
      effectiveActorId: account.id, credentialVersion: account.credential.credentialVersion, mode: 'DIRECT', expiresAt: new Date(Date.now() + SESSION_TTL) });
    return { token: secret.token, csrfToken: csrf.token, session, me: this.me(session) };
  }

  async authenticate(token: string | undefined): Promise<StoredLocalSession | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.repository.sessionByHash(hashOpaqueSecret(token));
    if (!session || !this.isCurrent(session)) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) await this.repository.touchSession(session.id, new Date());
    return session;
  }
  isCurrent(session: StoredLocalSession): boolean {
    if (session.original.credential && isDemoCredentialHash(session.original.credential.passwordHash) && !localDemoCredentialsEnabled()) return false;
    return isLoginAccount(session.original) && isLoginAccount(session.effective) &&
      session.original.credential?.credentialVersion === session.credentialVersion &&
      (session.mode === 'DIRECT' || session.original.roles.includes('ADMIN')) &&
      isSessionCurrent({ createdAt: session.createdAt.getTime(), lastSeenAt: session.lastSeenAt.getTime(), expiresAt: session.expiresAt.getTime(),
        revokedAt: session.revokedAt?.getTime() ?? null, effectiveActive: session.effective.isActive, originalActive: session.original.isActive }, Date.now(), SESSION_IDLE);
  }
  me(session: StoredLocalSession) {
    return { account: publicLocalAccount(session.effective), originalActor: { id: session.original.id, displayName: session.original.displayName },
      mode: session.mode, directSuperadmin: isDirectLocalSuperadmin(session), expiresAt: session.expiresAt.toISOString(),
      mustChangePassword: session.original.credential?.mustChangePassword ?? true, scopedBoundaryReady: true };
  }
  actor(session: StoredLocalSession): ActorContext {
    return { id: session.effective.id, key: session.effective.key, displayName: session.effective.displayName,
      // Informational current scoped role labels. Every business command still evaluates its actual scope.
      roles: [...session.effective.roles],
      session: { id: session.id, originalActorId: session.original.id, mode: session.mode, authzVersion: session.effective.authzVersion,
        mustChangePassword: session.original.credential?.mustChangePassword ?? true } };
  }
  async logout(session: StoredLocalSession) { await this.repository.revokeSession(session.id); }
  async changePassword(session: StoredLocalSession, currentPassword: string, nextPassword: string) {
    if (session.mode !== 'DIRECT') throw new ForbiddenException('Không đổi mật khẩu khi đang trình diễn.');
    if (!validateNewLocalPassword(nextPassword)) throw new BadRequestException('Mật khẩu CPMS cần ít nhất 8 ký tự và không quá 1024 byte UTF-8.');
    if (!await verifyLocalPassword(currentPassword, session.effective.credential?.passwordHash ?? null, localDemoCredentialsEnabled())) throw invalidLogin();
    if (currentPassword === nextPassword) throw new BadRequestException('Hãy đặt mật khẩu mới khác mật khẩu hiện tại.');
    await this.repository.changeCredential(session.id, session.effective.id, session.credentialVersion, await hashLocalPassword(nextPassword));
  }
  async resetPassword(session: StoredLocalSession, actorId: string, expectedVersion: number, reason: string) {
    this.requireAdmin(session);
    if (!reason.trim()) throw new BadRequestException('Cần lý do đặt lại mật khẩu.');
    const demo = localDemoCredentialsEnabled();
    const temporaryPassword = demo ? await this.repository.readLocalDemoDefaultPassword() : generateLocalCredential();
    await this.repository.resetCredential(session.id, actorId, expectedVersion,
      demo ? await hashLocalDemoPassword(temporaryPassword) : await hashLocalPassword(temporaryPassword), reason.trim(), !demo);
    return { temporaryPassword, mustChangePassword: !demo };
  }
  async accounts(session: StoredLocalSession) { this.requireAdmin(session); return (await this.repository.listAccounts(session.id)).map(publicLocalAccount); }
  async createDivisionLeader(session: StoredLocalSession, input: unknown) {
    this.requireAdmin(session);
    const validation = divisionLeaderInput.safeParse(input);
    if (!validation.success) throw new BadRequestException('Hồ sơ, Gmail, mật khẩu hoặc lý do tạo tài khoản không hợp lệ.');
    const parsed = validation.data;
    const account = await this.repository.createDivisionLeader(session.id, parsed.profile as DivisionLeaderProfile,
      await hashLocalPassword(parsed.password), parsed.mustChangePassword, parsed.reason);
    return publicLocalAccount(account);
  }
  async createCommunicationSpecialist(session: StoredLocalSession, input: unknown) {
    this.requirePersonnelAdmin(session);
    const parsed = specialistInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Mã nhân viên, email, mật khẩu hoặc lý do không hợp lệ.');
    return publicLocalAccount(await this.repository.createCommunicationSpecialist(session.id, parsed.data.employeeCode,
      parsed.data.email.toLowerCase(), await hashLocalPassword(parsed.data.password), parsed.data.reason));
  }
  async createPilotAdmin(session: StoredLocalSession, input: unknown) {
    this.requirePersonnelAdmin(session);
    const parsed = pilotAdminInput.safeParse(input);
    if (!parsed.success || !parsed.data.email.toLowerCase().endsWith('@vietnamairlines.com')) {
      throw new BadRequestException('Email công việc, tên, mật khẩu hoặc lý do không hợp lệ.');
    }
    return publicLocalAccount(await this.repository.createPilotAdmin(session.id, parsed.data.email.toLowerCase(),
      parsed.data.displayName, await hashLocalPassword(parsed.data.password), parsed.data.reason));
  }
  async updateGmail(session: StoredLocalSession, actorId: string, input: unknown) {
    this.requireAdmin(session);
    const validation = z.object({ expectedVersion: z.number().int().positive(), gmailEmail: z.email().nullable(), reason: z.string().trim().min(1).max(1000) }).strict().safeParse(input);
    if (!validation.success) throw new BadRequestException('Gmail, phiên bản hồ sơ hoặc lý do không hợp lệ.');
    await this.repository.updateGmail(session.id, actorId, validation.data.expectedVersion, validation.data.gmailEmail, validation.data.reason);
  }
  /** No public endpoint. The explicit local administration CLI calls this with a direct authenticated superadmin. */
  async configureDemoPasswords(session: StoredLocalSession, password: string, reason: string) {
    this.requireAdmin(session);
    if (!localDemoCredentialsEnabled() || !reason.trim()) throw new ForbiddenException('Cấu hình mật khẩu demo chỉ dành cho local và cần lý do.');
    const accounts = (await this.repository.listAccounts(session.id)).filter((account) => account.accountKind === 'PERSONNEL');
    const credentials: { actorId: string; expectedVersion: number; passwordHash: string }[] = [];
    for (let index = 0; index < accounts.length; index += 2) {
      credentials.push(...await Promise.all(accounts.slice(index, index + 2).map(async (account) => ({ actorId: account.id,
        expectedVersion: account.authzVersion, passwordHash: await hashLocalDemoPassword(password) }))));
    }
    return this.repository.configureLocalDemoCredentials(session.id, credentials, reason.trim());
  }
  async status(session: StoredLocalSession, actorId: string, expectedVersion: number, isActive: boolean, reason: string) {
    this.requireAdmin(session);
    if (!reason.trim()) throw new BadRequestException('Cần lý do đổi trạng thái tài khoản.');
    await this.repository.changeAccountStatus(session.id, { targetActorId: actorId, expectedVersion, isActive, reason: reason.trim() });
  }
  async switchDemo(session: StoredLocalSession, targetActorId: string | null) {
    if (session.original.credential?.mustChangePassword) throw new ForbiddenException('Hãy đổi mật khẩu bootstrap trước khi trình diễn.');
    if (targetActorId) this.requireAdmin(session);
    else if (session.mode !== 'DEMO_IMPERSONATION' || !session.original.roles.includes('ADMIN')) throw new ForbiddenException('Không có phiên trình diễn để kết thúc.');
    const target = targetActorId ? await this.repository.accountById(targetActorId) : session.original;
    if (!target || !target.isActive || (targetActorId ? target.accountKind !== 'PERSONNEL' || !target.personnelEmployeeCode : !isLoginAccount(target)) ||
        (targetActorId && target.id === session.original.id)) throw new BadRequestException('Không thể trình diễn tài khoản này.');
    const secret = newOpaqueSecret(); const csrf = newOpaqueSecret();
    const replacement: NewLocalSession = { tokenHash: secret.hash, csrfHash: csrf.hash, originalActorId: session.original.id, effectiveActorId: target.id,
      credentialVersion: session.credentialVersion, mode: targetActorId ? 'DEMO_IMPERSONATION' : 'DIRECT', expiresAt: session.expiresAt };
    const updated = await this.repository.rotateSession(session.id, replacement, targetActorId ? 'DEMO_START' : 'DEMO_END');
    return { token: secret.token, csrfToken: csrf.token, session: updated, me: this.me(updated) };
  }
  async switchAssist(session: StoredLocalSession, targetActorId: string | null, reason?: string) {
    if (targetActorId) {
      this.requireAdmin(session);
      if (!reason?.trim() || reason.trim().length > 1000) throw new BadRequestException('Cần lý do hỗ trợ tài khoản.');
    } else if (session.mode !== 'ADMIN_ASSIST' || !session.original.roles.includes('ADMIN')) {
      throw new ForbiddenException('Không có phiên hỗ trợ để kết thúc.');
    }
    const target = targetActorId ? await this.repository.accountById(targetActorId) : session.original;
    if (!target || !target.isActive || (targetActorId ? target.accountKind !== 'PERSONNEL' || !target.personnelEmployeeCode : !isLoginAccount(target)) ||
        (targetActorId && (target.id === session.original.id || target.roles.includes('ADMIN')))) throw new BadRequestException('Tài khoản không đủ điều kiện hỗ trợ.');
    const secret = newOpaqueSecret(); const csrf = newOpaqueSecret();
    const replacement: NewLocalSession = { tokenHash: secret.hash, csrfHash: csrf.hash, originalActorId: session.original.id, effectiveActorId: target.id,
      credentialVersion: session.credentialVersion, mode: targetActorId ? 'ADMIN_ASSIST' : 'DIRECT',
      expiresAt: targetActorId ? new Date(Math.min(session.expiresAt.getTime(), Date.now() + 29 * 60_000)) : session.expiresAt };
    const updated = await this.repository.rotateSession(session.id, replacement, targetActorId ? 'ASSIST_START' : 'ASSIST_END', reason);
    return { token: secret.token, csrfToken: csrf.token, session: updated, me: this.me(updated) };
  }
  private requireAdmin(session: StoredLocalSession) {
    if (!this.isCurrent(session) || !isDirectLocalSuperadmin(session) || session.original.credential?.mustChangePassword) throw new ForbiddenException('Chỉ superadmin trực tiếp được thực hiện thao tác này.');
  }
  private requirePersonnelAdmin(session: StoredLocalSession) {
    this.requireAdmin(session);
    if (session.original.accountKind !== 'PERSONNEL') throw new ForbiddenException('Chỉ quản trị viên nhân sự gốc được cấp tài khoản.');
  }
}
