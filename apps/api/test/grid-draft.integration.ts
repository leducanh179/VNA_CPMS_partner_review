import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import type { ActorContext } from '@cpms/domain';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { GridDraftApplicationService } from '../src/modules/grid-draft/application/grid-draft.application-service';
import { ACCESS_CATALOG } from '../src/modules/access/application/access-catalog';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { hashLocalPassword } from '../src/modules/identity/application/local-auth-security';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(target.hostname)); target.hostname = '127.0.0.1';
  const databaseName = `cpms_grid_test_${Date.now()}`;
  const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  target.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = target.href;
  process.env.AUTH_MODE = 'OPEN_DEMO'; process.env.ALLOW_OPEN_DEMO = 'true'; process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = 'http://localhost:5173'; process.env.AI_MODE = 'OFF';
  process.env.LOCAL_DEMO_CREDENTIALS = 'false'; process.env.LOCAL_DEMO_IMPERSONATION = 'false';
  const actorId = randomUUID(); process.env.DEMO_ACTOR_ID = actorId;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let db: PrismaService | undefined;
  try {
    await mkdir('private-local/grid-save', { recursive: true });
    const migrations = (await readdir('database/migrations')).filter(name => /^\d/.test(name)).sort();
    const sql = (await Promise.all(migrations.map(name => readFile(`database/migrations/${name}/migration.sql`, 'utf8')))).join('\n');
    await writeFile('private-local/grid-save/synthetic-migrations.sql', sql);
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--schema', 'database/schema.prisma', '--file', 'private-local/grid-save/synthetic-migrations.sql'], { env: process.env, stdio: 'pipe' });
    db = new PrismaService({ datasourceUrl: target.href }); await db.$connect();
    await db.role.create({ data: { code: 'ADMIN', displayName: 'Synthetic', description: 'Synthetic' } });
    await db.permissionDefinition.createMany({ data: ACCESS_CATALOG, skipDuplicates: true });
    const actor: ActorContext = { id: actorId, key: 'demo-superuser', displayName: 'Synthetic grid editor', roles: ['ADMIN'] };
    let other: ActorContext = { ...actor, id: randomUUID(), key: 'synthetic-other' };
    for (const who of [actor, other]) await db.actor.create({ data: { id: who.id, key: who.key, displayName: who.displayName,
      ...(who === other ? { loginEmail: 'synthetic-grid@example.test', accountKind: 'PILOT_ADMIN', credential: { create: { passwordHash: await hashLocalPassword('SyntheticGrid2026!'), mustChangePassword: false } } } : {}), roles: { create: { roleCode: 'ADMIN' } } } });
    await db.scopedRoleBinding.create({ data: { actorId: other.id, roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: '["SYSTEM",null,null,null]', relation: 'PRESET' } });
    const { AppModule } = await import('../src/app.module');
    app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
    app.setGlobalPrefix('api'); app.use(json({ limit: '10mb' })); await app.listen(0, '127.0.0.1');
    const identity = app.get(IdentityApplicationService);
    other = identity.actor((await identity.login('synthetic-grid@example.test', 'SyntheticGrid2026!', '127.0.0.1')).session);
    const service = app.get(GridDraftApplicationService), scope = 'synthetic-grid';
    const first = await service.save(actor, scope, { rows: [{ id: 'new', name: 'Synthetic incomplete' }] }, 0);
    assert.equal(first.recordVersion, 1);
    assert.deepEqual((await service.get(other, scope)).value, {});
    await assert.rejects(service.save(actor, scope, { rows: [] }, 0));
    const second = await service.save(actor, scope, { rows: [{ id: 'new', name: 'Synthetic newer' }] }, 1);
    assert.equal(second.recordVersion, 2);
    const race = await Promise.allSettled([service.save(actor, scope, { note: 'A' }, 2), service.save(actor, scope, { note: 'B' }, 2)]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await service.get(actor, scope)).recordVersion, 3);
    const url = `${await app.getUrl()}/api/grid-drafts/${scope}`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: -1, value: {} }) })).status, 400);
    assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 3, value: {}, ownerActorId: other.id }) })).status, 400);
    assert.equal(await db.campaign.count(), 0); assert.equal(await db.bookingRecord.count(), 0); assert.equal(await db.materialRecord.count(), 0); assert.equal(await db.supplyContract.count(), 0);
    assert.equal(await db.auditEvent.count({ where: { action: 'grid.draft_saved', actorId } }), 3);
    await writeFile('private-local/grid-save/integration-result.json', JSON.stringify({ status: 'PASS', checks: ['all migrations in isolated PostgreSQL', 'owner isolation', 'optimistic conflict', 'concurrent save conflict', 'HTTP whitelist', 'audit actor', 'no business side effects'] }, null, 2));
    console.log('PASS grid draft: PostgreSQL persistence, owner isolation, version/concurrency conflicts, HTTP whitelist, audit and no business side effects');
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    assert(/^cpms_grid_test_\d+$/.test(databaseName));
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
