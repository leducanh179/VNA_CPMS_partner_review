import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PrismaDirectoryImportRepository, PrismaPersonnelBootstrapRepository } from '../src/modules/identity/infrastructure/prisma-directory.repository';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { DirectoryImportApplicationService } from '../src/modules/identity/application/directory-import.application-service';
import { PersonnelBootstrapApplicationService, type PrivateBootstrapConfiguration } from '../src/modules/identity/application/personnel-bootstrap.application-service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { ExcelJsSpreadsheetAdapter } from '../src/modules/campaign/infrastructure/exceljs-spreadsheet.adapter';
import { generateLocalCredential, newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { exerciseScopedAccess } from './scoped-access.integration';

let stage = 'isolated target validation';
let db: PrismaService | undefined;
const passed: string[] = [];
const check = (name: string) => { passed.push(name); console.log(`PASS ${name}`); stage = name; };
async function main() {
  // Do not inherit the real local demo credential file into synthetic tests.
  process.env.LOCAL_DEMO_CREDENTIALS = 'false'; delete process.env.LOCAL_DEMO_CREDENTIAL_FILE;
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const databaseName = `cpms_access_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
  assert(/^cpms_access_test_\d+_[a-f0-9]{8}$/.test(databaseName));
  assert(url.pathname !== `/${databaseName}`);
  const root = path.resolve(__dirname, '../../..');
  const privateRoot = path.join(root, 'private-local/access-demo');
  execFileSync('git', ['check-ignore', '--quiet', '--', privateRoot], { cwd: root });
  await mkdir(privateRoot, { recursive: true });
  const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href, log: [] });
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`); } finally { await admin.$disconnect(); }
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  db = new PrismaService({ datasourceUrl: url.href, log: [] });
  const runSql = (file: string) => execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'execute', '--schema', 'database/schema.prisma', '--file', file], { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, stdio: 'pipe', timeout: 60_000 });
  const migrationNames = (await readdir(path.join(root, 'database/migrations'))).filter((name) => /^\d/.test(name)).sort();
  const targetIndex = migrationNames.indexOf('202609080001_local_identity');
  assert(targetIndex === 8);
  const beforeSql = (await Promise.all(migrationNames.slice(0, targetIndex).map((name) => readFile(path.join(root, 'database/migrations', name, 'migration.sql'), 'utf8')))).join('\n');
  const beforePath = path.join(privateRoot, 'synthetic-rehearsal-before.sql');
  await writeFile(beforePath, beforeSql);
  stage = 'baseline synthetic schema'; runSql(beforePath);
  const legacyId = randomUUID(); const campaignId = randomUUID();
  await db.$executeRaw`INSERT INTO actors (id,key,display_name,updated_at) VALUES (${legacyId}::uuid,'synthetic-legacy','Synthetic legacy',now())`;
  await db.$executeRaw`INSERT INTO roles (code,display_name,description) VALUES ('ADMIN','ADMIN','Synthetic legacy role')`;
  await db.$executeRaw`INSERT INTO actor_roles (actor_id,role_code) VALUES (${legacyId}::uuid,'ADMIN')`;
  await db.$executeRaw`INSERT INTO campaigns (id,code,name,updated_at,created_by_actor_id,field_values) VALUES (${campaignId}::uuid,'QA-ACCESS-LEGACY','Synthetic preserved campaign',now(),${legacyId}::uuid,'{"unknown":"preserve  spaces"}'::jsonb)`;
  await db.$executeRaw`INSERT INTO personnel_directory_entries (employee_code,full_name,email,organization_name,source_provider,phone_text,updated_at) VALUES ('SYN-ADMIN','Synthetic Admin','admin@example.test','Synthetic Communications','synthetic','SYNTHETIC_PRESERVE',now())`;
  const before = await db.$queryRaw`SELECT md5(to_jsonb(c)::text) AS hash FROM campaigns c WHERE id=${campaignId}::uuid`;
  stage = 'additive migration rehearsal'; runSql(path.join(root, 'database/migrations/202609080001_local_identity/migration.sql'));
  assert.deepEqual(await db.$queryRaw`SELECT md5(to_jsonb(c)::text) AS hash FROM campaigns c WHERE id=${campaignId}::uuid`, before);
  stage = 'scoped policy additive migration rehearsal';
  runSql(path.join(root, 'database/migrations/202609080002_scoped_access/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609080003_campaign_workflow/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609080004_campaign_review/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609090001_campaign_recovery/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609090002_campaign_policy_modes/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609090003_optional_rejection_opinion/migration.sql'));
  runSql(path.join(root, 'database/migrations/202609090004_campaign_action_approval/migration.sql'));
  for (const name of migrationNames.slice(migrationNames.indexOf('202609090005_contract_supply_v1'))) {
    runSql(path.join(root, 'database/migrations', name, 'migration.sql'));
  }
  assert.deepEqual(await db.$queryRaw`SELECT md5((to_jsonb(c) - ARRAY['requesting_department_id','requesting_division_id','business_revision'])::text) AS hash FROM campaigns c WHERE id=${campaignId}::uuid`, before);
  assert((await db.actor.findUniqueOrThrow({ where: { id: legacyId } })).accountKind === 'LEGACY');
  await db.permissionDefinition.create({ data: { code: 'campaign.update', label: 'Synthetic update', module: 'CAMPAIGN', groupLabel: 'Synthetic', description: 'Synthetic constraints', supportedScopes: ['SYSTEM','MODULE','MODULE_ORG','RECORD','FIELD'], implementationStatus: 'RESERVED' } });
  await assert.rejects(db.accountPermissionOverride.create({ data: { actorId: legacyId, permissionCode: 'campaign.update', effect: 'ALLOW', scopeType: 'FIELD', module: 'CAMPAIGN', campaignId, scopeKey: JSON.stringify(['FIELD','CAMPAIGN',null,campaignId,null]) } }));
  await assert.rejects(db.accountPermissionOverride.create({ data: { actorId: legacyId, permissionCode: 'campaign.update', effect: 'ALLOW', scopeType: 'RECORD', module: 'CAMPAIGN', campaignId, scopeKey: '[]' } }));
  await assert.rejects(db.accountPermissionOverride.create({ data: { actorId: legacyId, permissionCode: 'campaign.update', effect: 'ALLOW', scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: randomUUID(), scopeKey: JSON.stringify(['RECORD','CAMPAIGN',null,campaignId,null]) } }));
  check('both additive migrations preserve legacy campaign bytes; SQL rejects incomplete/dangling/ambiguous scopes');

  const spreadsheets = new ExcelJsSpreadsheetAdapter();
  const importer = new DirectoryImportApplicationService(spreadsheets);
  const bootstrap = new PersonnelBootstrapApplicationService(importer, new PrismaPersonnelBootstrapRepository(db));
  const directory = new PrismaDirectoryImportRepository(db);
  const identities = new PrismaIdentityRepository(db);
  const identity = new IdentityApplicationService(identities);
  const workbook = { sheets: [{ name: 'Directory', rows: [
    ['Mã nhân viên', 'Họ và tên', 'Email', 'Ban', 'Phòng', 'Chức danh công việc'],
    ['SYN-ADMIN', 'Synthetic Admin', 'admin@example.test', 'Synthetic Communications', 'Brand', 'Specialist'],
    ['SYN-LEADER', 'Synthetic Leader', 'leader@example.test', 'Synthetic Communications', 'Brand', 'Division leader'],
    ['SYN-STAFF', 'Synthetic Staff', 'staff@example.test', 'Synthetic Communications', 'Brand', 'Specialist'],
    ['SYN-OTHER', 'Synthetic Requester', 'other@example.test', 'Synthetic Sales', 'Brand', 'Specialist'],
  ] }, { name: 'Pending', rows: [['Email'], ['pending@example.test']] }] };
  const input = { fileName: 'synthetic.xlsx', content: await spreadsheets.write(workbook) };
  const inspected = await importer.inspect(input);
  const config: PrivateBootstrapConfiguration = { sourceHash: inspected.sourceHash, administrator: { employeeCode: 'SYN-ADMIN', fullName: 'Synthetic Admin', email: 'admin@example.test' },
    communicationOrganizationName: 'Synthetic Communications', leaders: [{ employeeCode: 'SYN-LEADER', fullName: 'Synthetic Leader', email: 'leader@example.test', role: 'DIVISION_LEADER' }] };
  const preview = await bootstrap.preview(input, config);
  assert(preview.preview.counts.CONFLICT === 0 && preview.preview.counts.UPDATE === 1);
  await assert.rejects(bootstrap.apply(input, config, preview.version, async () => { throw new Error('Synthetic private delivery failure'); }));
  assert(await db.actor.count({ where: { accountKind: 'PERSONNEL' } }) === 0 && await db.localCredential.count() === 0);
  const result = await bootstrap.apply(input, config, preview.version);
  assert(!result.alreadyBootstrapped);
  if (result.alreadyBootstrapped) throw new Error('Unreachable');
  assert(await db.actor.count({ where: { accountKind: 'PERSONNEL' } }) === 4);
  assert(await db.localCredential.count() === 1);
  assert(await db.pendingDirectoryContact.count() === 1);
  assert(await db.employmentOrgUnit.count({ where: { kind: 'DIVISION', sourceName: 'Brand' } }) === 2);
  assert((await db.personnelDirectoryEntry.findUniqueOrThrow({ where: { employeeCode: 'SYN-ADMIN' } })).phoneText === 'SYNTHETIC_PRESERVE');
  const credentialBefore = await db.localCredential.findMany();
  const auditsBefore = await db.auditEvent.count();
  assert((await bootstrap.apply(input, config, 0)).alreadyBootstrapped);
  assert.deepEqual(await db.localCredential.findMany(), credentialBefore);
  assert(await db.auditEvent.count() === auditsBefore);
  check('private bootstrap is atomic/idempotent, preserves old PII and creates one credential');

  stage = 'password and session enforcement';
  const first = await identity.login('ADMIN@example.test', result.temporaryPassword, 'synthetic-bootstrap');
  assert(first.me.mustChangePassword);
  assert(await db.localSession.count({ where: { tokenHash: first.token } }) === 0);
  await assert.rejects(identity.switchDemo(first.session, (await identities.accountByEmail('staff@example.test'))!.id));
  const password = generateLocalCredential();
  await identity.changePassword(first.session, result.temporaryPassword, password);
  assert(await identity.authenticate(first.token) === null);
  await assert.rejects(identity.login('admin@example.test', result.temporaryPassword, 'synthetic-old-password'));
  let direct = await identity.login('admin@example.test', password, 'synthetic-direct');
  assert(!direct.me.mustChangePassword && direct.me.directSuperadmin);
  await assert.rejects(identity.login('staff@example.test', password, 'synthetic-no-credential'));
  check('password change revokes sessions; legacy/unconfigured accounts cannot login');

  stage = 'directory repeat and stale version';
  const reimport = await importer.preview(input, direct.session.id, directory);
  const repeat = await importer.apply(input, { sourceHash: reimport.sourceHash, expectedSnapshotVersion: reimport.expectedSnapshotVersion, sessionId: direct.session.id }, directory);
  assert(repeat.appliedPeople === 0 && repeat.appliedPending === 0);
  assert(await db.auditEvent.count() > auditsBefore); // Authentication added audit, repeat import did not.
  const staff = (await identities.accountByEmail('staff@example.test'))!;
  const demo = await identity.switchDemo(direct.session, staff.id);
  assert(await identity.authenticate(direct.token) === null);
  assert(!demo.me.directSuperadmin && demo.session.original.id === direct.session.original.id && demo.session.effective.id === staff.id);
  assert.deepEqual(identity.actor(demo.session).roles, staff.roles);
  assert(!identity.actor(demo.session).roles.includes('ADMIN'));
  await assert.rejects(identity.accounts(demo.session));
  await assert.rejects(identity.resetPassword(demo.session, staff.id, staff.authzVersion, 'synthetic forbidden'));
  await assert.rejects(importer.preview(input, demo.session.id, directory));
  await assert.rejects(identity.switchDemo(demo.session, (await identities.accountByEmail('other@example.test'))!.id));
  const ended = await identity.switchDemo(demo.session, null);
  assert(ended.me.directSuperadmin && await identity.authenticate(demo.token) === null);
  const switchedAudit = await db.auditEvent.findFirstOrThrow({ where: { action: 'DEMO_END' } });
  assert(switchedAudit.originalActorId === direct.session.original.id && switchedAudit.actorId === staff.id);
  await assert.rejects(identity.status(ended.session, ended.session.original.id, ended.session.original.authzVersion, false, 'synthetic last admin'));
  check('impersonation rotates sessions, isolates privileges and audits both identities');

  stage = 'reset race and lock revocation';
  const resets = await Promise.allSettled([
    identity.resetPassword(ended.session, staff.id, staff.authzVersion, 'synthetic concurrent reset A'),
    identity.resetPassword(ended.session, staff.id, staff.authzVersion, 'synthetic concurrent reset B'),
  ]);
  assert(resets.filter((entry) => entry.status === 'fulfilled').length === 1);
  assert((await identities.accountById(staff.id))!.authzVersion === staff.authzVersion + 1);
  const demo2 = await identity.switchDemo(ended.session, staff.id);
  direct = await identity.login('admin@example.test', password, 'synthetic-lock');
  await identity.status(direct.session, staff.id, staff.authzVersion + 1, false, 'synthetic lock');
  assert(await identity.authenticate(demo2.token) === null);
  await assert.rejects(identity.switchDemo(direct.session, staff.id));
  const badSecret = newOpaqueSecret();
  await assert.rejects(db.localSession.create({ data: { originalActorId: direct.session.original.id, effectiveActorId: staff.id, tokenHash: badSecret.hash, csrfHash: badSecret.hash,
    credentialVersion: 1, mode: 'DIRECT', expiresAt: new Date(Date.now() + 60_000) } }));
  check('PostgreSQL version fence serializes competing resets and account lock revokes impersonation');

  stage = 'updated profile preserves roles and actor';
  workbook.sheets[0]!.rows[3]![2] = 'staff-new@example.test';
  workbook.sheets[0]!.rows[3]![5] = 'Department leader';
  const changed = { fileName: 'synthetic.xlsx', content: await spreadsheets.write(workbook) };
  const beforeRoles = await db.actorRole.findMany({ where: { actorId: staff.id } });
  const changedPreview = await importer.preview(changed, direct.session.id, directory);
  await importer.apply(changed, { sourceHash: changedPreview.sourceHash, expectedSnapshotVersion: changedPreview.expectedSnapshotVersion, sessionId: direct.session.id }, directory);
  assert((await identities.accountByEmail('staff-new@example.test'))!.id === staff.id);
  assert(!(await identities.accountByEmail('staff-new@example.test'))!.isActive);
  assert.deepEqual(await db.actorRole.findMany({ where: { actorId: staff.id } }), beforeRoles);
  await assert.rejects(importer.apply(changed, { sourceHash: changedPreview.sourceHash, expectedSnapshotVersion: changedPreview.expectedSnapshotVersion, sessionId: direct.session.id }, directory));
  assert.deepEqual(await db.$queryRaw`SELECT md5((to_jsonb(c) - ARRAY['requesting_department_id','requesting_division_id','business_revision'])::text) AS hash FROM campaigns c WHERE id=${campaignId}::uuid`, before);
  check('profile changes preserve stable UUID, explicit roles, locked status and legacy data');

  stage = 'HTTP middleware and cookie boundary';
  process.env.AUTH_MODE = 'LOCAL_SESSION'; process.env.ALLOW_OPEN_DEMO = 'false'; process.env.LOCAL_DEMO_IMPERSONATION = 'true';
  process.env.WEB_ORIGIN = 'http://localhost:5173'; process.env.NODE_ENV = 'test';
  // No external calls in this harness. App startup only constructs the existing provider adapters.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  try {
    const endpoint = await app.getUrl();
    const send = (route: string, init?: RequestInit) => fetch(`${endpoint}/api${route}`, init);
    assert((await send('/campaigns')).status === 401);
    assert((await send('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password }) })).status === 403);
    const login = await send('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: process.env.WEB_ORIGIN }, body: JSON.stringify({ email: 'admin@example.test', password }) });
    assert(login.ok);
    const cookies = login.headers.getSetCookie();
    assert(cookies.some((cookie) => cookie.startsWith('cpms_session=') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
    const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
    const csrf = cookies.find((entry) => entry.startsWith('cpms_csrf='))!.split(';')[0]!.slice('cpms_csrf='.length);
    assert((await send('/auth/me', { headers: { Cookie: cookie } })).status === 200);
    assert((await send('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: process.env.WEB_ORIGIN } })).status === 403);
    assert((await send('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: process.env.WEB_ORIGIN, 'x-cpms-csrf': csrf } })).status === 201);
    assert((await send('/auth/me', { headers: { Cookie: cookie } })).status === 401);
    check('real Nest HTTP rejects anonymous access/login CSRF/session CSRF and enforces logout');
  } finally { await app.close(); }
  stage = 'explicit demo credential policy';
  process.env.LOCAL_DEMO_CREDENTIALS = 'true';
  const demoPassword = generateLocalCredential().slice(0, 8);
  const demoPolicy = await identity.configureDemoPasswords(direct.session, demoPassword, 'synthetic explicit local demo policy');
  assert(demoPolicy.configured === 4 && await db.localCredential.count({ where: { mustChangePassword: true } }) === 0);
  assert(new Set((await db.localCredential.findMany()).map((row) => row.passwordHash)).size === 4);
  assert(await identity.authenticate(direct.token) === null);
  assert(!(await identities.accountById(staff.id))!.isActive);
  const demoLogin = await identity.login('other@example.test', demoPassword, 'synthetic-shared-demo');
  assert(!demoLogin.me.mustChangePassword && !demoLogin.me.directSuperadmin);
  process.env.LOCAL_DEMO_CREDENTIALS = 'false';
  assert(await identity.authenticate(demoLogin.token) === null);
  await assert.rejects(identity.login('other@example.test', demoPassword, 'synthetic-demo-disabled'));
  check('explicit local demo defaults keep hashing/lock/session gates and are rejected outside demo mode');
  stage = 'persistent scoped policy and transaction fencing';
  await exerciseScopedAccess(db);
  check('persisted scopes enforce visibility/field aliases/read gates/expiry and serialize revocation with business rollback');
  check('persistent workflow HTTP validates scoped tasks, atomic assignments, races, cooperation and policy revisions');
  stage = 'isolated specialist and pilot-admin provisioning';
  process.env.LOCAL_DEMO_CREDENTIALS = 'true';
  const rootSession = await identity.login('admin@example.test', demoPassword, 'synthetic-provision');
  await db.personnelDirectoryEntry.create({ data: { employeeCode: 'SYN-COMM', fullName: 'Synthetic Communications Specialist',
    email: 'synthetic-comm@example.test', organizationName: 'Ban Truyền thông', departmentName: 'Phòng thử nghiệm', sourceProvider: 'SYNTHETIC_TEST' } });
  const specialist = await identity.createCommunicationSpecialist(rootSession.session, { employeeCode: 'SYN-COMM',
    email: 'synthetic-comm@example.test', password: 'abcdefgh', reason: 'Synthetic rehearsal' });
  assert(specialist.employeeCode === 'SYN-COMM' && specialist.roles.includes('COMM_CAMPAIGN_MANAGER') && specialist.mustChangePassword);
  assert(await db.personnelDirectoryEntry.count({ where: { employeeCode: 'SYN-COMM' } }) === 1);
  await assert.rejects(identity.createCommunicationSpecialist(rootSession.session, { employeeCode: 'SYN-COMM',
    email: 'synthetic-comm@example.test', password: 'abcdefgh', reason: 'Duplicate rehearsal' }));
  const pilot = await identity.createPilotAdmin(rootSession.session, { email: 'synthetic-pilot@vietnamairlines.com',
    displayName: 'Synthetic Pilot Admin', password: 'abcdefgh', reason: 'Synthetic rehearsal' });
  assert(pilot.accountKind === 'PILOT_ADMIN' && pilot.employeeCode === null && pilot.roles.includes('ADMIN'));
  assert(await db.personnelDirectoryEntry.count({ where: { email: 'synthetic-pilot@vietnamairlines.com' } }) === 0);
  const pilotSession = await identity.login('synthetic-pilot@vietnamairlines.com', 'abcdefgh', 'synthetic-pilot');
  assert(pilotSession.me.directSuperadmin && (await identity.accounts(pilotSession.session)).some((account) => account.id === pilot.id));
  await assert.rejects(identity.status(pilotSession.session, rootSession.session.original.id, rootSession.session.original.authzVersion,
    false, 'Synthetic forbidden lock'));
  await assert.rejects(identity.resetPassword(pilotSession.session, rootSession.session.original.id,
    rootSession.session.original.authzVersion, 'Synthetic forbidden reset'));
  await assert.rejects(importer.preview(input, pilotSession.session.id, directory));
  await identity.status(rootSession.session, pilot.id, pilot.recordVersion, false, 'Synthetic recovery');
  assert(await identity.authenticate(pilotSession.token) === null);
  process.env.LOCAL_DEMO_CREDENTIALS = 'false';
  check('directory specialist stays linked once; separate pilot admin can sign in but personnel admin can revoke it');
  await writeFile(path.join(privateRoot, 'identity-integration-result.json'), JSON.stringify({ status: 'PASS', recordedAt: new Date().toISOString(), databaseName, syntheticOnly: true,
    migrationAppliedToLive: false, tests: passed, retainedForInspection: true }, null, 2));
  console.log(`Integration PASS (${passed.length} groups); private report written. Synthetic database retained; live database untouched.`);
}
void main().catch(async (error: unknown) => {
  await writeFile(path.resolve('private-local/access-demo/identity-integration-failure.json'), JSON.stringify({ stage,
    type: error instanceof Error ? error.name : 'Unknown', message: error instanceof Error ? error.message : 'Unknown',
    stack: error instanceof Error ? error.stack : null }, null, 2));
  console.error(`Integration FAIL during ${stage}. Private diagnostic written. No reset/drop or live database migration attempted.`); process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });
