import { describe, expect, it, vi } from 'vitest';
import { PilotAdminBootstrapApplicationService, type PilotAdminBootstrapRepository } from './pilot-admin-bootstrap.application-service';

const profile = {
  employeeCode: 'TEST0001', fullName: 'Nguyễn Thử Nghiệm', email: 'Pilot.Admin@VietnamAirlines.com',
  organizationName: 'Ban Kiểm thử', departmentName: 'Phòng Thử nghiệm', jobTitle: 'Chuyên viên',
  gender: 'Nam', birthDate: '1990-01-02', phoneText: '0123456789',
};

describe('pilot first-admin bootstrap', () => {
  it('validates the complete profile and normalizes the work email', async () => {
    const repository = { canBootstrap: vi.fn().mockResolvedValue(true) } as unknown as PilotAdminBootstrapRepository;
    const service = new PilotAdminBootstrapApplicationService(repository);
    const result = await service.preview(profile);
    expect(result.profile.email).toBe('pilot.admin@vietnamairlines.com');
    expect(result.profile.birthDate).toBe(profile.birthDate);
    await expect(service.preview({ ...profile, birthDate: '1990-02-30' })).rejects.toThrow();
    await expect(service.preview({ ...profile, phoneText: 'not-a-phone' })).rejects.toThrow();
    await expect(service.preview({ ...profile, extra: 'unexpected' })).rejects.toThrow();
  });

  it('never delivers a credential when an identity already exists', async () => {
    const repository = { canBootstrap: vi.fn().mockResolvedValue(false), create: vi.fn() } as unknown as PilotAdminBootstrapRepository;
    const deliver = vi.fn();
    await expect(new PilotAdminBootstrapApplicationService(repository).apply(profile, deliver)).rejects.toThrow('not empty');
    expect(deliver).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('delivers the one-time credential before the audited repository command', async () => {
    const events: string[] = [];
    const repository = {
      canBootstrap: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockImplementation(async (input: { passwordHash: string }) => {
        events.push('persist');
        expect(input.passwordHash).toMatch(/^scrypt\$v1\$/);
        return { actorId: 'test-actor-id' };
      }),
    } as unknown as PilotAdminBootstrapRepository;
    const result = await new PilotAdminBootstrapApplicationService(repository).apply(profile, async (credential) => {
      events.push('deliver');
      expect(credential.email).toBe('pilot.admin@vietnamairlines.com');
      expect(credential.temporaryPassword.length).toBeGreaterThanOrEqual(24);
    });
    expect(events).toEqual(['deliver', 'persist']);
    expect(result).toEqual({ actorId: 'test-actor-id', email: 'pilot.admin@vietnamairlines.com', mustChangePassword: true });
  });
});
