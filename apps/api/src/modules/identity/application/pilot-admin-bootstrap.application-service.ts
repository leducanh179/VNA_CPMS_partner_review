import { normalizeWorkEmail } from '@cpms/domain';
import { z } from 'zod';
import { generateLocalCredential, hashLocalPassword } from './local-auth-security';

const birthDate = z.iso.date().refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed < new Date();
}, 'Ngày sinh không hợp lệ.');

export const pilotAdminProfileSchema = z.object({
  employeeCode: z.string().trim().regex(/^[A-Z0-9]{4,32}$/),
  fullName: z.string().trim().min(2).max(160),
  email: z.email().transform(normalizeWorkEmail).refine((email) => email.endsWith('@vietnamairlines.com')),
  organizationName: z.string().trim().min(2).max(200),
  departmentName: z.string().trim().min(2).max(200),
  jobTitle: z.string().trim().min(2).max(200),
  gender: z.enum(['Nam', 'Nữ', 'Khác']),
  birthDate,
  phoneText: z.string().trim().regex(/^0\d{9}$/),
}).strict();

export type PilotAdminProfile = z.infer<typeof pilotAdminProfileSchema>;

export abstract class PilotAdminBootstrapRepository {
  abstract canBootstrap(): Promise<boolean>;
  abstract create(input: { profile: PilotAdminProfile; passwordHash: string }): Promise<{ actorId: string }>;
}

/** One-time, private CLI command. No HTTP endpoint or demo credential fallback. */
export class PilotAdminBootstrapApplicationService {
  constructor(private readonly repository: PilotAdminBootstrapRepository) {}

  async preview(input: unknown) {
    const profile = pilotAdminProfileSchema.parse(input);
    return { profile, canBootstrap: await this.repository.canBootstrap() };
  }

  async apply(input: unknown, deliverCredential: (value: { email: string; temporaryPassword: string }) => Promise<void>) {
    const { profile, canBootstrap } = await this.preview(input);
    if (!canBootstrap) throw new Error('Pilot identity database is not empty; first-admin bootstrap was not run.');
    const temporaryPassword = generateLocalCredential();
    const passwordHash = await hashLocalPassword(temporaryPassword);
    // A failed private-file write must not leave an active account with an undelivered password.
    await deliverCredential({ email: profile.email, temporaryPassword });
    const result = await this.repository.create({ profile, passwordHash });
    return { ...result, email: profile.email, mustChangePassword: true };
  }
}
