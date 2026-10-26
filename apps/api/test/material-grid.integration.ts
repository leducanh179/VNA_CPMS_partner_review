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
import type { MaterialSummary, MaterialBatchSaveResult } from '@cpms/domain';
import { CampaignApplicationService } from '../src/modules/campaign/application/campaign.application-service';
import { MaterialApplicationService } from '../src/modules/material/application/material.application-service';
import { hashLocalPassword } from '../src/modules/identity/application/local-auth-security';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(target.hostname)); target.hostname = '127.0.0.1';
  const databaseName = `cpms_material_test_${Date.now()}`;
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

    const materials = app.get(MaterialApplicationService);
    await db.campaignLevel.upsert({ where: { code: 'CLV_01' }, create: { code: 'CLV_01', label: 'Synthetic', ruleDescription: 'Synthetic', displayOrder: 1 }, update: {} });
    const campaigns = app.get(CampaignApplicationService);
    const campaign = await campaigns.create({ name: 'Synthetic Material Campaign', levelCode: 'CLV_01', lifecycleState: 'DRAFT' }, other);
    const campaignTwo = await campaigns.create({ name: 'Synthetic Material Campaign 2', levelCode: 'CLV_01', lifecycleState: 'DRAFT' }, other);
    const api = `${await app.getUrl()}/api/materials`;
    const createKey = 'lost-response-' + randomUUID();
    const fields = { material_name: 'Synthetic KV', material_group: 'Hình ảnh', material_type: 'Key Visual', material_link: 'https://example.test/material',
      material_languages: JSON.stringify(['Tiếng Việt','Tiếng Anh']), material_update_date: '2024-01-02', campaign_refs: JSON.stringify([campaign,campaignTwo].map(c => ({ kind: 'SYSTEM', id:c.id, name:c.name }))),
      material_description_rich_text: JSON.stringify({schemaVersion:1,type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Synthetic bold',marks:[{type:'bold'}]}]}]}) };
    const httpSave = async (items: unknown[]) => {
      const response = await fetch(api + '/batch-save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items}) });
      assert.equal(response.status,201,await response.clone().text());return response.json() as Promise<MaterialBatchSaveResult>;
    };
    const partial = await httpSave([{clientKey:'partial',fields:{material_name:'Only a title'}}]);assert.equal(partial.failed,1);assert.equal(await db.materialRecord.count(),0);
    const attempts = await Promise.all([httpSave([{clientKey:createKey,fields}]),httpSave([{clientKey:createKey,fields}])]);
    for(const attempt of attempts)assert.equal(attempt.succeeded,1,JSON.stringify(attempt));
    let material = attempts[0]!.items[0]!.material!;
    assert.equal(attempts[1]!.items[0]!.materialId,material.materialId);assert.equal(await db.materialRecord.count(),1);
    assert.equal(await db.auditEvent.count({where:{entityId:material.materialId,action:'material.batch_saved'}}),1);
    assert.equal(await db.auditEvent.count({where:{action:'material.create_receipt'}}),1);
    assert.equal(material.fields.material_update_date,'2024-01-02');assert.equal(JSON.parse(material.fields.campaign_refs!).length,2);
    const current = async () => ((await (await fetch(api)).json()) as MaterialSummary[]).find(row=>row.materialId===material.materialId)!;
    const baseline=material;
    const changed=await httpSave([{clientKey:material.materialId,materialId:material.materialId,expectedVersion:baseline.recordVersion,baselineFields:baseline.fields,fields:{note:'Edited note'}}]);assert.equal(changed.succeeded,1);
    const merged=await httpSave([{clientKey:material.materialId,materialId:material.materialId,expectedVersion:baseline.recordVersion,baselineFields:baseline.fields,fields:{material_name:'Merged title'}}]);assert.equal(merged.succeeded,1);
    const conflict=await httpSave([{clientKey:material.materialId,materialId:material.materialId,expectedVersion:baseline.recordVersion,baselineFields:baseline.fields,fields:{note:'Conflicting note'}}]);assert.equal(conflict.failed,1);
    material=await current();assert.equal(material.fields.note,'Edited note');assert.equal(material.fields.material_name,'Merged title');
    assert.equal(material.recordVersion,3);
    const copy=await httpSave([{clientKey:'copy-'+randomUUID(),fields:{...fields,material_name:'Synthetic copy'}}]);assert.equal(copy.succeeded,1);
    const copyRecord=copy.items[0]!.material!;assert.notEqual(copyRecord.materialId,material.materialId);assert.equal(copyRecord.fields.publish_status,'NOT_PUBLISHED');
    const action=async (operation:'PUBLISH'|'PAUSE_PUBLISH'|'UNPUBLISH'|'SOFT_DELETE'|'RESTORE')=>{
      const response=await fetch(api+'/bulk-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{materialId:material.materialId,expectedVersion:material.recordVersion}],action:operation,reason:'Synthetic QA'})});
      const result=await response.json() as MaterialBatchSaveResult;assert.equal(result.succeeded,1,JSON.stringify(result));material=result.items[0]!.material!;return material;
    };
    await action('PUBLISH');assert.equal(material.fields.publish_status,'PUBLISHED');await action('PAUSE_PUBLISH');assert.equal(material.fields.publish_status,'PAUSED');await action('UNPUBLISH');assert.equal(material.fields.publish_status,'NOT_PUBLISHED');
    await action('SOFT_DELETE');assert.equal(material.isDeleted,true);assert.equal(((await (await fetch(api)).json()) as MaterialSummary[]).some(row=>row.materialId===material.materialId),false);
    const retryDeleted=await httpSave([{clientKey:createKey,fields}]);assert.equal(retryDeleted.failed,1);
    await action('RESTORE');assert.equal(material.isDeleted,false);
    await materials.purge(copyRecord.materialId,copyRecord.recordVersion,other);
    const purgedRetry=await httpSave([{clientKey:'copy-'+randomUUID(),materialId:copyRecord.materialId,expectedVersion:1,fields}]);assert.equal(purgedRetry.failed,1);
    const journal=await db.auditEvent.findMany({where:{entityId:material.materialId,entityType:'material'}});
    assert.equal(journal.length,8);assert(journal.every(event=>event.actorId===actorId));
    const listResponse=await fetch(api);const listed=await listResponse.json() as MaterialSummary[];assert.equal(listed.length,1);assert.equal(listed[0]!.recordVersion,8);
    assert(JSON.parse(listed[0]!.fields.campaign_refs!).every((ref:{id:string})=>[campaign.id,campaignTwo.id].includes(ref.id)));
    console.log('PASS material: real HTTP create/edit, partial input rejected, concurrent idempotent retry, exact canonical versions, baseline merge/conflict, typed fields, two Campaigns, publication/Trash/restore/purge and audit');
    await writeFile('private-local/grid-save/material-integration-result.json', JSON.stringify({ status: 'PASS', checks: ['all migrations in isolated PostgreSQL', 'GridDraft owner isolation and conflict', 'HTTP create/edit with exact canonical versions', 'partial input fails without a business row', 'concurrent idempotent create and lost-response replay', 'baseline merge and same-field conflict', 'typed languages/rich text and multi-Campaign refs', 'publication, Trash, restore and purge', 'audit actor and one receipt per created row', 'all data synthetic; disposable database dropped in finally'] }, null, 2));
    console.log('PASS grid draft: PostgreSQL persistence, owner isolation, version/concurrency conflicts, HTTP whitelist, audit and no business side effects');
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    assert(/^cpms_material_test_\d+$/.test(databaseName));
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
