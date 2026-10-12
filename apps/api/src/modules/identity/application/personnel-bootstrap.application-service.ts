import { normalizeDirectorySearch, normalizeWorkEmail, type ParsedDirectory, type DirectorySourceRow, type DirectoryPreview } from '@cpms/domain';
import { generateLocalCredential, hashLocalPassword } from './local-auth-security';
import type { DirectoryImportApplicationService } from './directory-import.application-service';

export interface PrivateBootstrapConfiguration {
  sourceHash: string;
  administrator: { employeeCode: string; fullName: string; email: string };
  communicationOrganizationName: string;
  leaders: { employeeCode: string; fullName: string; email: string; role: 'DEPARTMENT_LEADER' | 'DIVISION_LEADER' }[];
}
export interface BootstrapRolePlan {
  employeeCode: string;
  role: 'ADMIN' | 'CAMPAIGN_REQUESTER' | 'COMM_CAMPAIGN_MANAGER' | 'DEPARTMENT_LEADER' | 'DIVISION_LEADER';
  scope: 'SYSTEM' | 'MODULE' | 'DEPARTMENT' | 'DIVISION';
}
export abstract class PersonnelBootstrapRepository {
  abstract preview(source: ParsedDirectory): Promise<{ preview: DirectoryPreview; version: number; alreadyBootstrapped: boolean }>;
  abstract apply(input: { source: ParsedDirectory; sourceHash: string; expectedVersion: number; administrator: DirectorySourceRow; roles: BootstrapRolePlan[]; passwordHash: string }): Promise<{ people: number; pending: number; administratorId: string }>;
}

/** Explicit local provisioning command, separate from routine source import and never an HTTP login fallback. */
export class PersonnelBootstrapApplicationService {
  constructor(private readonly importer: DirectoryImportApplicationService, private readonly repository: PersonnelBootstrapRepository) {}
  async preview(input: { fileName: string; content: Uint8Array }, configuration: PrivateBootstrapConfiguration) {
    const source = await this.importer.inspect(input);
    if (source.sourceHash !== configuration.sourceHash) throw new Error('Source hash differs from the reviewed bootstrap configuration.');
    const exact = (identity: PrivateBootstrapConfiguration['administrator']) => {
      const candidates = source.parsed.people.filter((person) => person.employeeCode === identity.employeeCode &&
        person.email === normalizeWorkEmail(identity.email) && person.fullName === identity.fullName);
      if (candidates.length !== 1) throw new Error('Bootstrap identity must match one complete source profile by code, email and name.');
      return candidates[0]!;
    };
    const administrator = exact(configuration.administrator);
    const communication = normalizeDirectorySearch(configuration.communicationOrganizationName);
    if (!communication || normalizeDirectorySearch(administrator.organizationName) !== communication) throw new Error('Verified communication organization is required.');
    const roles: BootstrapRolePlan[] = source.parsed.people.map((person) => ({ employeeCode: person.employeeCode, role: 'CAMPAIGN_REQUESTER', scope: 'MODULE' }));
    const leaders = new Set<string>();
    for (const leader of configuration.leaders) {
      const profile = exact(leader);
      if (!['DEPARTMENT_LEADER', 'DIVISION_LEADER'].includes(leader.role) || leaders.has(profile.employeeCode) ||
          (leader.role === 'DIVISION_LEADER' && !profile.departmentName)) throw new Error('Bootstrap leadership scope is invalid or duplicated.');
      leaders.add(profile.employeeCode);
      roles.push({ employeeCode: profile.employeeCode, role: leader.role, scope: leader.role === 'DEPARTMENT_LEADER' ? 'DEPARTMENT' : 'DIVISION' });
    }
    roles.push({ employeeCode: administrator.employeeCode, role: 'ADMIN', scope: 'SYSTEM' });
    for (const person of source.parsed.people) {
      if (!leaders.has(person.employeeCode) && normalizeDirectorySearch(person.organizationName) === communication) {
        roles.push({ employeeCode: person.employeeCode, role: 'COMM_CAMPAIGN_MANAGER', scope: 'MODULE' });
      }
    }
    return { ...source, ...await this.repository.preview(source.parsed), administrator, roles };
  }
  async apply(input: { fileName: string; content: Uint8Array }, configuration: PrivateBootstrapConfiguration, expectedVersion: number,
    deliverCredential?: (value: { email: string; temporaryPassword: string }) => Promise<void>) {
    const reviewed = await this.preview(input, configuration);
    if (reviewed.alreadyBootstrapped) return { alreadyBootstrapped: true as const };
    if (reviewed.version !== expectedVersion || reviewed.preview.counts.CONFLICT || reviewed.preview.counts.INVALID) throw new Error('Bootstrap preview is stale or contains identity conflicts.');
    const temporaryPassword = generateLocalCredential();
    const passwordHash = await hashLocalPassword(temporaryPassword);
    // Deliver to the protected local file before persistence; a failed file write cannot strand an active credential.
    await deliverCredential?.({ email: reviewed.administrator.email, temporaryPassword });
    const result = await this.repository.apply({ source: reviewed.parsed, sourceHash: reviewed.sourceHash, expectedVersion,
      administrator: reviewed.administrator, roles: reviewed.roles, passwordHash });
    return { alreadyBootstrapped: false as const, ...result, temporaryPassword, mustChangePassword: true };
  }
}
