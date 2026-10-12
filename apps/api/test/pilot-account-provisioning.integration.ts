import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import { PrismaAccessRepository } from '../src/modules/access/infrastructure/prisma-access.repository';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { PrismaDirectoryImportRepository } from '../src/modules/identity/infrastructure/prisma-directory.repository';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert(/^\/cpms_access_test_\d+_[a-f0-9]{8}$/.test(url.pathname));
  process.env.AUTH_MODE = 'LOCAL_SESSION'; process.env.LOCAL_DEMO_CREDENTIALS = 'true';
  process.env.NODE_ENV = 'test'; process.env.WEB_ORIGIN = 'http://localhost:5173';
  const db = new PrismaService({ datasourceUrl: url.href, log: [] });
  try {
    const identities = new PrismaIdentityRepository(db);
    const identity = new IdentityApplicationService(identities);
    const root = await identities.accountByEmail('admin@example.test');
    assert(root?.credential && root.isActive && root.roles.includes('ADMIN'));
    const rootSession = await identities.createSession({ tokenHash: newOpaqueSecret().hash, csrfHash: newOpaqueSecret().hash,
      originalActorId: root.id, effectiveActorId: root.id, mode: 'DIRECT', credentialVersion: root.credential.credentialVersion,
      expiresAt: new Date(Date.now() + 600_000) });
    const suffix = randomUUID().slice(0, 8);
    const employeeCode = `SYN-${suffix.toUpperCase()}`;
    const specialistEmail = `synthetic-specialist-${suffix}@example.test`;
    await db.personnelDirectoryEntry.create({ data: { employeeCode, fullName: 'Synthetic Communications Specialist',
      email: specialistEmail, organizationName: 'Ban Truyền thông', departmentName: 'Phòng thử nghiệm', sourceProvider: 'SYNTHETIC_TEST' } });
    const specialist = await identity.createCommunicationSpecialist(rootSession, { employeeCode, email: specialistEmail,
      password: 'abcdefgh', reason: 'Synthetic rehearsal' });
    assert(specialist.employeeCode === employeeCode && specialist.roles.includes('COMM_CAMPAIGN_MANAGER') && specialist.mustChangePassword);
    assert(await db.personnelDirectoryEntry.count({ where: { employeeCode } }) === 1);
    await assert.rejects(identity.createCommunicationSpecialist(rootSession, { employeeCode, email: specialistEmail,
      password: 'abcdefgh', reason: 'Synthetic duplicate rehearsal' }));
    const pilotEmail = `synthetic-pilot-${suffix}@vietnamairlines.com`;
    const pilot = await identity.createPilotAdmin(rootSession, { email: pilotEmail, displayName: 'Synthetic Pilot Admin',
      password: 'abcdefgh', reason: 'Synthetic rehearsal' });
    assert(pilot.accountKind === 'PILOT_ADMIN' && pilot.employeeCode === null && pilot.roles.includes('ADMIN'));
    assert(await db.personnelDirectoryEntry.count({ where: { email: pilotEmail } }) === 0);
    const pilotLogin = await identity.login(pilotEmail, 'abcdefgh', `synthetic-${suffix}`);
    assert(pilotLogin.me.directSuperadmin && (await identity.accounts(pilotLogin.session)).some((account) => account.id === pilot.id));
    const access = new AccessApplicationService(new PrismaAccessRepository(db));
    await access.initializeCatalog(identity.actor(rootSession));
    await access.run(identity.actor(pilotLogin.session), async () => { access.require('system.manage'); });
    await assert.rejects(identity.status(pilotLogin.session, root.id, root.authzVersion, false, 'Synthetic forbidden lock'));
    await assert.rejects(identity.resetPassword(pilotLogin.session, root.id, root.authzVersion, 'Synthetic forbidden reset'));
    await assert.rejects(new PrismaDirectoryImportRepository(db).withImportTransaction((tx) => tx.requireDirectSuperadmin(pilotLogin.session.id)));
    await identity.status(rootSession, pilot.id, pilot.recordVersion, false, 'Synthetic recovery');
    assert(await identity.authenticate(pilotLogin.token) === null);
    await assert.rejects(access.run(identity.actor(pilotLogin.session), async () => { access.require('system.manage'); }));
    const rootAfter = await identities.accountById(root.id);
    assert(rootAfter?.isActive && rootAfter.loginEmail === root.loginEmail && rootAfter.credential?.credentialVersion === root.credential.credentialVersion);
    assert(await db.auditEvent.count({ where: { entityId: pilot.id, action: 'ACCOUNT_STATUS_CHANGED' } }) === 1);
    console.log('PASS isolated specialist provisioning, pilot-admin login, personnel-admin recovery and audit');
  } finally { await db.$disconnect(); }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
