import { describe, expect, it, vi } from 'vitest';
import { IdentityApplicationService, isDirectLocalSuperadmin, isLoginAccount } from './identity.application-service';
import type { IdentityRepository, LocalAccount, StoredLocalSession } from './identity.repository';

const account = (id: string, roles: LocalAccount['roles']): LocalAccount => ({
  id, key: `test:${id}`, displayName: id, loginEmail: `${id}@example.test`, accountKind: 'PERSONNEL', isActive: true,
  authzVersion: 1, roles, personnelEmployeeCode: `TEST${id}`, profile: { organizationName: 'Ban thử', departmentName: 'Phòng thử', jobTitle: 'Thử nghiệm', gmailEmail: null },
  employment: { departmentId: 'test-department', divisionId: 'test-division' }, credential: { passwordHash: 'synthetic', credentialVersion: 1, mustChangePassword: false },
});
const direct = (): StoredLocalSession => ({
  id: 'session', tokenHash: 'synthetic', csrfHash: 'synthetic', credentialVersion: 1, mode: 'DIRECT',
  createdAt: new Date(Date.now() - 1000), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null,
  original: account('admin', ['ADMIN']), effective: account('admin', ['ADMIN']),
});

describe('pilot identity administration', () => {
  it('recognizes a separate pilot admin without inventing a personnel link', () => {
    const pilot = { ...account('pilot', ['ADMIN']), accountKind: 'PILOT_ADMIN', personnelEmployeeCode: null, profile: null, employment: null };
    const session = { ...direct(), original: pilot, effective: pilot };
    expect(isLoginAccount(pilot)).toBe(true);
    expect(isDirectLocalSuperadmin(session)).toBe(true);
    expect(new IdentityApplicationService({} as IdentityRepository).isCurrent(session)).toBe(true);
    expect(isLoginAccount({ ...pilot, roles: [] })).toBe(false);
    expect(isLoginAccount({ ...pilot, personnelEmployeeCode: 'TEST' })).toBe(false);
  });

  it('provisions a communication specialist only from a direct personnel administrator', async () => {
    const createCommunicationSpecialist = vi.fn().mockResolvedValue(account('specialist', ['COMM_CAMPAIGN_MANAGER']));
    const service = new IdentityApplicationService({ createCommunicationSpecialist } as unknown as IdentityRepository);
    await expect(service.createCommunicationSpecialist(direct(), { employeeCode: 'TEST123', email: 'specialist@example.test', password: 'short', reason: 'Pilot' })).rejects.toThrow();
    await service.createCommunicationSpecialist(direct(), { employeeCode: 'TEST123', email: 'Specialist@example.test', password: 'abcdefgh', reason: 'Pilot' });
    expect(createCommunicationSpecialist).toHaveBeenCalledWith('session', 'TEST123', 'specialist@example.test', expect.stringMatching(/^scrypt\$v1\$/), 'Pilot');
    const pilot = { ...account('pilot', ['ADMIN']), accountKind: 'PILOT_ADMIN', personnelEmployeeCode: null };
    await expect(service.createCommunicationSpecialist({ ...direct(), original: pilot, effective: pilot }, { employeeCode: 'TEST123', email: 'specialist@example.test', password: 'abcdefgh', reason: 'Pilot' })).rejects.toThrow();
  });

  it('restricts pilot admin creation to a personnel administrator and a work email', async () => {
    const createPilotAdmin = vi.fn().mockResolvedValue({ ...account('pilot', ['ADMIN']), accountKind: 'PILOT_ADMIN', personnelEmployeeCode: null });
    const service = new IdentityApplicationService({ createPilotAdmin } as unknown as IdentityRepository);
    await expect(service.createPilotAdmin(direct(), { email: 'pilot@example.test', displayName: 'Pilot Admin', password: 'abcdefgh', reason: 'Pilot' })).rejects.toThrow();
    expect(createPilotAdmin).not.toHaveBeenCalled();
    await service.createPilotAdmin(direct(), { email: 'pilot@vietnamairlines.com', displayName: 'Pilot Admin', password: 'abcdefgh', reason: 'Pilot' });
    expect(createPilotAdmin).toHaveBeenCalledWith('session', 'pilot@vietnamairlines.com', 'Pilot Admin', expect.stringMatching(/^scrypt\$v1\$/), 'Pilot');
    const pilot = { ...account('pilot', ['ADMIN']), accountKind: 'PILOT_ADMIN', personnelEmployeeCode: null };
    await expect(service.createPilotAdmin({ ...direct(), original: pilot, effective: pilot }, { email: 'another@vietnamairlines.com', displayName: 'Another Pilot', password: 'abcdefgh', reason: 'Pilot' })).rejects.toThrow();
  });

  it('keeps a direct session valid through an eight-hour workday but not beyond its absolute expiry', () => {
    const service = new IdentityApplicationService({} as IdentityRepository);
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60_000);
    const session = { ...direct(), createdAt: sevenHoursAgo, lastSeenAt: sevenHoursAgo,
      expiresAt: new Date(Date.now() + 60 * 60_000) };
    expect(service.isCurrent(session)).toBe(true);
    expect(service.isCurrent({ ...session, expiresAt: new Date(Date.now() - 1) })).toBe(false);
    expect(service.isCurrent({ ...session, createdAt: new Date(Date.now() - 8 * 60 * 60_000 - 1),
      lastSeenAt: new Date(Date.now() - 8 * 60 * 60_000 - 1) })).toBe(false);
  });

  it('creates a division leader only through direct superadmin with the selected initial-password policy', async () => {
    const createDivisionLeader = vi.fn().mockResolvedValue(account('leader', ['DIVISION_LEADER']));
    const service = new IdentityApplicationService({ createDivisionLeader } as unknown as IdentityRepository);
    const profile = { employeeCode: 'TEST0390', fullName: 'Synthetic Leader', email: 'leader@vietnamairlines.com', gmailEmail: null,
      organizationName: 'Ban Truyền thông', departmentName: 'Phòng Thương hiệu', jobTitle: 'Phó trưởng phòng',
      gender: 'Nữ', birthDate: '1987-05-02', phoneText: '0123456789' };
    await expect(service.createDivisionLeader(direct(), { profile, password: 'abcdefg', mustChangePassword: false, reason: 'Synthetic pilot' })).rejects.toThrow();
    expect(createDivisionLeader).not.toHaveBeenCalled();
    const created = await service.createDivisionLeader(direct(), { profile, password: 'abcdefgh', mustChangePassword: false, reason: 'Synthetic pilot' });
    expect(created.roles).toEqual(['DIVISION_LEADER']);
    expect(createDivisionLeader).toHaveBeenCalledWith('session', expect.objectContaining({ employeeCode: 'TEST0390', gmailEmail: null }),
      expect.stringMatching(/^scrypt\$v1\$/), false, 'Synthetic pilot');
    await expect(service.createDivisionLeader({ ...direct(), mode: 'ADMIN_ASSIST' }, { profile, password: 'abcdefgh', mustChangePassword: false, reason: 'Synthetic pilot' })).rejects.toThrow();
  });

  it('requires reason, forbids admin targets, rotates into a short audited assist session and back', async () => {
    const rotateSession = vi.fn().mockImplementation(async (_id, replacement) => ({ ...direct(), mode: replacement.mode, effective: replacement.mode === 'DIRECT' ? account('admin', ['ADMIN']) : account('leader', ['DIVISION_LEADER']), expiresAt: replacement.expiresAt }));
    const accountById = vi.fn().mockResolvedValue(account('leader', ['DIVISION_LEADER']));
    const service = new IdentityApplicationService({ rotateSession, accountById } as unknown as IdentityRepository);
    await expect(service.switchAssist(direct(), 'leader', ' ')).rejects.toThrow();
    expect(rotateSession).not.toHaveBeenCalled();
    const assist = await service.switchAssist(direct(), 'leader', 'Synthetic support');
    expect(assist.me.mode).toBe('ADMIN_ASSIST');
    expect(assist.me.directSuperadmin).toBe(false);
    expect(rotateSession).toHaveBeenCalledWith('session', expect.objectContaining({ mode: 'ADMIN_ASSIST', originalActorId: 'admin', effectiveActorId: 'leader' }), 'ASSIST_START', 'Synthetic support');
    expect(rotateSession.mock.calls[0]![1].expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    await service.switchAssist(assist.session, null);
    expect(rotateSession).toHaveBeenCalledWith('session', expect.objectContaining({ mode: 'DIRECT', effectiveActorId: 'admin' }), 'ASSIST_END', undefined);
    accountById.mockResolvedValue(account('another-admin', ['ADMIN']));
    await expect(service.switchAssist(direct(), 'another-admin', 'Synthetic support')).rejects.toThrow();
  });
});
