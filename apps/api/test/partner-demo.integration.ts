import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ACCESS_CATALOG } from '../src/modules/access/application/access-catalog';
import { hashLocalPassword } from '../src/modules/identity/application/local-auth-security';

/** No production data: fresh disposable PostgreSQL database, standard local sessions and actual HTTP middleware. */
async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(target.hostname)); target.hostname = '127.0.0.1';
  const name = `cpms_partner_test_${Date.now()}`;
  assert(/^cpms_partner_test_\d+$/.test(name));
  const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  target.pathname = `/${name}`;
  process.env.DATABASE_URL = target.href;
  process.env.AUTH_MODE = 'LOCAL_SESSION'; process.env.NODE_ENV = 'test';
  process.env.ALLOW_OPEN_DEMO = 'false'; process.env.LOCAL_DEMO_CREDENTIALS = 'false'; process.env.LOCAL_DEMO_IMPERSONATION = 'false';
  process.env.WEB_ORIGIN = 'http://localhost:5173'; process.env.AI_MODE = 'OFF';
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  const db = new PrismaClient({ datasourceUrl: target.href });
  try {
    await mkdir('private-local/partner-demo-test', { recursive: true });
    const migrations = (await readdir('database/migrations')).filter(name => /^\d/.test(name)).sort();
    const file = 'private-local/partner-demo-test/synthetic-migrations.sql';
    await writeFile(file, (await Promise.all(migrations.map(name => readFile(`database/migrations/${name}/migration.sql`, 'utf8')))).join('\n'));
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--schema', 'database/schema.prisma', '--file', file], { env: process.env, stdio: 'pipe' });
    for (const code of ['ADMIN', 'VIEWER']) await db.role.create({ data: { code, displayName: 'Synthetic role', description: 'Synthetic fixture' } });
    await db.permissionDefinition.createMany({ data: ACCESS_CATALOG, skipDuplicates: true });
    await db.actor.create({ data: { key: 'synthetic-partner-admin', displayName: 'Synthetic administrator', accountKind: 'PILOT_ADMIN', loginEmail: 'synthetic-admin@example.test',
      roles: { create: { roleCode: 'ADMIN' } }, scopedBindings: { create: { roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: '["SYSTEM",null,null,null]' } },
      credential: { create: { passwordHash: await hashLocalPassword('SyntheticAdmin2026!'), mustChangePassword: false } } } });
    const { AppModule } = await import('../src/app.module');
    app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
    app.setGlobalPrefix('api'); app.use(json({ limit: '2mb' }));
    await app.listen(0, '127.0.0.1');
    const endpoint = await app.getUrl();
    const send = (route: string, headers: Record<string, string>, method = 'GET', body?: unknown) => fetch(`${endpoint}/api${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (email: string, password: string) => {
      const response = await send('/auth/login', { Origin: process.env.WEB_ORIGIN!, 'Content-Type': 'application/json' }, 'POST', { email, password });
      assert.equal(response.status, 201);
      const cookies = response.headers.getSetCookie();
      const token = cookies.find(cookie => cookie.startsWith('cpms_session='))!.split(';')[0]!;
      const csrf = cookies.find(cookie => cookie.startsWith('cpms_csrf='))!.split(';')[0]!.slice('cpms_csrf='.length);
      const me = await response.json() as { directSuperadmin: boolean; mustChangePassword: boolean; account: { id: string; accountKind: string } };
      return { me, headers: { Cookie: `${token}; cpms_csrf=${csrf}`, Origin: process.env.WEB_ORIGIN!, 'x-cpms-csrf': csrf, 'Content-Type': 'application/json' } };
    };
    const root = await login('synthetic-admin@example.test', 'SyntheticAdmin2026!'); assert(root.me.directSuperadmin);
    const emails = ['synthetic-partner-a@vietnamairlines.com', 'synthetic-partner-b@vietnamairlines.com'];
    const created = await send('/auth/accounts/partner-demos', root.headers, 'POST', { emails, password: 'SyntheticPartner2026!', reason: 'Isolated partner exploration test' });
    assert.equal(created.status, 201, await created.text());
    assert.equal(await db.personnelDirectoryEntry.count(), 0);
    assert.equal(await db.auditEvent.count({ where: { action: 'PARTNER_DEMO_CREATED' } }), 2);
    const before = await db.actor.count();
    assert.equal((await send('/auth/accounts/partner-demos', root.headers, 'POST', { emails: [emails[0], 'synthetic-partner-c@vietnamairlines.com'], password: 'SyntheticPartner2026!', reason: 'Atomic duplicate check' })).status, 409);
    assert.equal(await db.actor.count(), before);
    const a = await login(emails[0]!, 'SyntheticPartner2026!'), b = await login(emails[1]!, 'SyntheticPartner2026!');
    assert(!a.me.directSuperadmin && !a.me.mustChangePassword && a.me.account.accountKind === 'PARTNER_DEMO');
    const caps = await (await send('/access/capabilities', a.headers)).json() as { permissions: Record<string, boolean> };
    for (const module of ['campaign', 'contract', 'booking', 'material']) {
      assert(caps.permissions[`${module}.read`]);
      for (const action of ['create', 'update', 'delete']) assert.equal(caps.permissions[`${module}.${action}`], false);
    }
    for (const route of ['/campaigns', '/contracts', '/bookings', '/bookings/bootstrap', '/materials', '/materials/bootstrap', '/contracts/management/catalogs']) assert.equal((await send(route, a.headers)).status, 200, route);
    for (const route of ['/campaigns', '/contracts', '/bookings/batch-save', '/materials/batch-save', '/auth/accounts/partner-demos']) {
      for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await send(route, a.headers, method, {})).status, 403, route);
    }
    for (const route of ['/directory/people', '/directory/suppliers', '/auth/accounts']) assert.equal((await send(route, a.headers)).status, 403, route);
    for (const module of ['campaign', 'contract', 'material']) {
      const id = randomUUID(), path = `/${module}-form-drafts/${id}`;
      const value = module === 'contract' ? { kind: 'PAID', fields: { name: 'Synthetic draft' }, supplierId: '', supplierSelected: false, code: '', vendorCode: '', ownedLayer: '', ownedChannel: '', reason: '', evidence: '' } : { name: 'Synthetic private input', title: 'Synthetic private input' };
      assert.equal((await send(path, a.headers, 'PUT', { expectedVersion: 0, value })).status, 200);
      assert.equal((await send(path, b.headers)).status, 404);
      assert.equal((await send(path, b.headers, 'PUT', { expectedVersion: 1, value })).status, 404);
      const list = await (await send(`/${module}-form-drafts`, b.headers)).json() as unknown[]; assert.equal(list.length, 0);
      assert.equal((await send(path, a.headers, 'PUT', { expectedVersion: 0, value })).status, 409);
      assert.equal((await send(path, a.headers, 'DELETE')).status, 200);
    }
    const grid = '/grid-drafts/cpms.booking.partner-form.v1';
    assert.equal((await send(grid, a.headers, 'PUT', { expectedVersion: 0, value: { campaignLabel: 'Synthetic booking input', lines: [] } })).status, 200);
    const other = await (await send(grid, b.headers)).json() as { value: object }; assert.deepEqual(other.value, {});
    assert.equal(await db.bookingRecord.count(), 0); assert.equal(await db.campaign.count(), 0); assert.equal(await db.supplyContract.count(), 0);
    await send('/auth/logout', a.headers, 'POST');
    assert.equal((await send('/campaigns', a.headers)).status, 401);
    console.log('PASS isolated partner provisioning, duplicate atomicity, read-only HTTP, private drafts, actor isolation, versions, audit and session revocation');
  } finally {
    if (app) await app.close(); await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.$disconnect();
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
