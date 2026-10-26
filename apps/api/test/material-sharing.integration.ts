import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { hashLocalPassword, newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import { MaterialApplicationService } from '../src/modules/material/application/material.application-service';
import { MaterialSharingApplicationService } from '../src/modules/material/application/material-sharing.application-service';
import { MaterialCollaborationApplicationService } from '../src/modules/material/application/material-collaboration.application-service';
import { MaterialFormDraftApplicationService } from '../src/modules/material/application/material-form-draft.application-service';
import { GridDraftApplicationService } from '../src/modules/grid-draft/application/grid-draft.application-service';
import { BookingApplicationService } from '../src/modules/booking/application/booking.application-service';
import type { MaterialSummary } from '@cpms/domain';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert(['localhost','127.0.0.1'].includes(target.hostname), 'Local synthetic target only');
  const binding = execFileSync('docker', ['port', 'cpms-postgres', '5432/tcp'], { encoding: 'utf8' }).trim();
  assert(binding === `127.0.0.1:${target.port || '5432'}`, 'Backup container must match the local DB target');
  target.hostname = '127.0.0.1'; // Docker binds IPv4; Windows localhost can resolve to ::1.
  const name = `cpms_material_test_${Date.now()}_${randomUUID().slice(0,8)}`, restoreName = name + '_restore';
  assert(/^cpms_material_test_\d+_[a-f0-9]{8}$/.test(name));
  const original = target.href, adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${restoreName}"`);
  } finally { await admin.$disconnect(); }
  target.pathname = '/' + name; assert.notEqual(original, target.href); process.env.DATABASE_URL = target.href;
  Object.assign(process.env, { AUTH_MODE:'LOCAL_SESSION', ALLOW_OPEN_DEMO:'false', LOCAL_DEMO_CREDENTIALS:'false', LOCAL_DEMO_IMPERSONATION:'false',
    NODE_ENV:'test', WEB_ORIGIN:'http://localhost:5173', AI_MODE:'OFF', GOOGLE_PROVIDER_WRITES:'BLOCKED', GOOGLE_DRIVE_WRITES:'BLOCKED' });
  const migrations = (await readdir('database/migrations')).filter(n => /^\d/.test(n)).sort();
  const cutoff = migrations.indexOf('20261020090000_material_sharing'); assert(cutoff >= 0);
  const sql = async (names: string[]) => (await Promise.all(names.map(n => readFile(`database/migrations/${n}/migration.sql`, 'utf8')))).join('\n');
  const execute = (text: string) => execFileSync(process.execPath, ['node_modules/prisma/build/index.js','db','execute','--schema','database/schema.prisma','--stdin'], { input:text, stdio:['pipe','pipe','pipe'], env:process.env });
  execute(await sql(migrations.slice(0,cutoff)));
  const db = new PrismaService(); await db.$connect();
  const legacyId = randomUUID();
  await db.$executeRaw`INSERT INTO material_records(id,material_id,data,record_version,is_deleted,created_by,updated_by,updated_at) VALUES (${legacyId}::uuid,'SYN-LEGACY','{"material_name":"Synthetic preserved","visibility":"INTERNAL","unknown":" keep  spaces "}'::jsonb,7,false,'unknown historical author','unknown historical author',now())`;
  const before = await db.$queryRaw`SELECT md5(to_jsonb(m)::text) AS hash FROM material_records m WHERE id=${legacyId}::uuid`;
  const dump = execFileSync('docker', ['exec','cpms-postgres','pg_dump','-U',decodeURIComponent(target.username),'-Fc',name], { maxBuffer:64*1024*1024 });
  execFileSync('docker', ['exec','-i','cpms-postgres','pg_restore','-U',decodeURIComponent(target.username),'--dbname',restoreName,'--exit-on-error'], { input:dump });
  const restoreUrl = new URL(target); restoreUrl.pathname = '/' + restoreName;
  const restored = new PrismaClient({ datasourceUrl:restoreUrl.href });
  try { assert.deepEqual(await restored.$queryRaw`SELECT md5(to_jsonb(m)::text) AS hash FROM material_records m WHERE id=${legacyId}::uuid`, before); }
  finally { await restored.$disconnect(); }
  execute(await sql(migrations.slice(cutoff)));
  assert.deepEqual(await db.$queryRaw`SELECT md5((to_jsonb(m)-ARRAY['sharing_mode','owner_actor_id','sharing_campaign_ids','sharing_grants'])::text) AS hash FROM material_records m WHERE id=${legacyId}::uuid`, before);
  assert.equal((await db.materialRecord.findUniqueOrThrow({where:{id:legacyId}})).sharingMode,'LEGACY');
  console.log('PASS M17 additive migration preserves old data/version/author; synthetic backup restored and hash verified');

  await db.role.upsert({where:{code:'ADMIN'},create:{code:'ADMIN',displayName:'Admin',description:'Synthetic'},update:{}});
  const department = await db.employmentOrgUnit.create({data:{identityKey:'synthetic-unit',sourceName:'Synthetic unit',kind:'DEPARTMENT',sourceProvider:'SYNTHETIC'}});
  const passwordHash = await hashLocalPassword(randomBytes(24).toString('hex'));
  const identities = new PrismaIdentityRepository(db), identity = new IdentityApplicationService(identities);
  const account = async (key:string, administrator=false) => {
    if(!administrator)await db.personnelDirectoryEntry.create({data:{employeeCode:key,fullName:key,email:`${key}@example.test`,organizationName:'Synthetic unit',sourceProvider:'SYNTHETIC'}});
    const row = await db.actor.create({data:{key,displayName:key,loginEmail:`${key}@example.test`,accountKind:administrator?'PILOT_ADMIN':'PERSONNEL',
      ...(administrator?{}:{personnelEmployeeCode:key,employment:{create:{departmentId:department.id}}}),
      credential:{create:{passwordHash,mustChangePassword:false}},
      ...(administrator?{scopedBindings:{create:{roleCode:'ADMIN',scopeType:'SYSTEM',scopeKey:JSON.stringify(['SYSTEM',null,null,null])}}}:{})}});
    const token=newOpaqueSecret(),csrf=newOpaqueSecret();
    const session=await identities.createSession({tokenHash:token.hash,csrfHash:csrf.hash,originalActorId:row.id,effectiveActorId:row.id,mode:'DIRECT',credentialVersion:1,expiresAt:new Date(Date.now()+600_000)});
    return {actor:identity.actor(session),token:token.token,csrf:csrf.token};
  };
  const owner=await account('synthetic-owner',true), reader=await account('synthetic-reader'), outsider=await account('synthetic-outsider');
  const {AppModule}=await import('../src/app.module');
  const app=await NestFactory.create(AppModule,{logger:false}); app.setGlobalPrefix('api'); await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(), access=app.get(AccessApplicationService), materials=app.get(MaterialApplicationService), sharing=app.get(MaterialSharingApplicationService);
  const collaboration=app.get(MaterialCollaborationApplicationService);
  const checks:string[]=[]; const pass=(name:string)=>{checks.push(name);console.log('PASS '+name);};
  const as=<T>(actor:typeof owner.actor,fn:()=>Promise<T>)=>access.withRequestActor(actor,fn);
  try {
    await access.initializeCatalog(owner.actor);
    const create=await materials.batchSave([{clientKey:'synthetic-create',fields:{material_name:'Synthetic public KV',material_type:'Key Visual',material_link:'https://example.test/folder'}}],owner.actor);
    assert.equal(create.succeeded,1); let current=create.items[0]!.material!;
    assert.equal(current.sharing?.mode,'SHARED'); assert.equal(current.sharing?.ownerActorId,owner.actor.id);
    assert((await as(outsider.actor,()=>materials.list())).some(r=>r.materialId===current.materialId));
    assert.equal((await as(outsider.actor,()=>materials.bootstrap())).campaigns.length,0);
    pass('M01/M02 new SHARED persisted; unrelated authenticated reader can view without campaign/module grants');
    const publicUrl=base+'/api/public/materials/'+current.materialId;
    const response=await fetch(publicUrl); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    const publicData=await response.json(); assert.equal(publicData.url,'https://example.test/folder'); assert(!('sharing' in publicData)); assert(!('fields' in publicData));
    const list=await (await fetch(base+'/api/public/materials?pageSize=1&q=Synthetic')).json(); assert.equal(list.total,1); assert.equal(list.items.length,1);
    for(const path of ['/api/materials','/api/campaigns','/api/materials/'+current.materialId+'/journal','/api/materials/sharing-directory'])
      assert.equal((await fetch(base+path)).status,401);
    for(const method of ['POST','PATCH','DELETE'])assert.equal((await fetch(publicUrl,{method})).status,401);
    pass('M03/M04/M13/M16/M18 real HTTP anonymous allowlist, pagination, no cache; internal paths/writes denied; saved unpublished visible');
    const change=async(mode:'SHARED'|'CAMPAIGN'|'RESTRICTED',campaignIds:string[]=[],grants:NonNullable<MaterialSummary['sharing']>['grants']=[])=>{
      current=await sharing.change(current.materialId,{mode,campaignIds,grants,expectedVersion:current.recordVersion},owner.actor);return current;
    };
    await change('RESTRICTED',[],[{kind:'ACCOUNT',id:reader.actor.id,permission:'VIEW'}]);
    assert.equal((await fetch(publicUrl)).status,404);
    assert.equal((await fetch(base+'/api/public/materials/missing')).status,404);
    assert.equal((await (await fetch(base+'/api/public/materials')).json()).total,0);
    assert.equal((await as(reader.actor,()=>sharing.detail(current.materialId))).capabilities?.edit,false);
    assert.equal((await materials.batchSave([{clientKey:'denied',materialId:current.materialId,fields:{material_name:'Attack'}}],reader.actor)).failed,1);
    await assert.rejects(as(outsider.actor,()=>collaboration.comments(current.materialId)));
    pass('M05/M06/M10/M12 restricted revokes public immediately; viewer cannot edit, outsider cannot read comments');
    await db.accountPermissionOverride.create({data:{actorId:outsider.actor.id,permissionCode:'booking.read',effect:'ALLOW',scopeType:'MODULE',module:'BOOKING',scopeKey:JSON.stringify(['MODULE','BOOKING',null,null,null])}});
    assert(!(await app.get(BookingApplicationService).bootstrap(outsider.actor)).materials.some(item=>item.id===current.id));
    await assert.rejects(as(outsider.actor,()=>collaboration.journal(current.materialId)));
    const draftId=randomUUID(), drafts=app.get(MaterialFormDraftApplicationService);
    await drafts.save(owner.actor,draftId,{materialId:current.id,title:'Private draft',fields:{material_name:'Private draft'},sharing:{mode:'SHARED'}},0);
    await assert.rejects(drafts.get(outsider.actor,draftId));
    await app.get(GridDraftApplicationService).save(owner.actor,'MATERIAL:synthetic',{title:'Private grid draft',sharing:{mode:'SHARED'}},0);
    assert.deepEqual((await app.get(GridDraftApplicationService).get(outsider.actor,'MATERIAL:synthetic')).value,{});
    assert.equal((await (await fetch(base+'/api/public/materials?q=Private')).json()).total,0);
    pass('M13/M18 Booking options and journal honor ACL; form/grid drafts remain actor-private even when SHARED is selected');
    await change('RESTRICTED',[],[{kind:'ORG',id:department.id,permission:'EDIT'}]);
    assert.equal((await as(reader.actor,()=>sharing.detail(current.materialId))).capabilities?.edit,true);
    await db.employmentMembership.delete({where:{actorId:reader.actor.id}});
    await assert.rejects(as(reader.actor,()=>sharing.detail(current.materialId)));
    await db.employmentMembership.create({data:{actorId:reader.actor.id,departmentId:department.id}});
    pass('M09 membership removal takes effect on next access');
    const campaign=await db.campaign.create({data:{code:'SYN-CAMPAIGN',name:'Synthetic campaign',createdByActorId:owner.actor.id}});
    const otherCampaign=await db.campaign.create({data:{code:'SYN-OTHER',name:'Synthetic other campaign',createdByActorId:owner.actor.id}});
    await db.accountPermissionOverride.create({data:{actorId:reader.actor.id,permissionCode:'campaign.read',effect:'ALLOW',scopeType:'RECORD',module:'CAMPAIGN',campaignId:campaign.id,scopeKey:JSON.stringify(['RECORD','CAMPAIGN',null,campaign.id,null])}});
    await change('CAMPAIGN',[otherCampaign.id,campaign.id]);
    assert.equal((await as(reader.actor,()=>sharing.detail(current.materialId))).capabilities?.view,true);
    const edit=await materials.batchSave([{clientKey:'business-link',materialId:current.materialId,expectedVersion:current.recordVersion,fields:{campaign_refs:JSON.stringify([{kind:'SYSTEM',id:otherCampaign.id,name:otherCampaign.name}])}}],owner.actor);
    assert.equal(edit.succeeded,1); current=edit.items[0]!.material!;
    assert.deepEqual(current.sharing!.campaignIds,[otherCampaign.id,campaign.id]);
    pass('M07/M08 campaign union is live and independent of business-linked campaigns');
    const version=current.recordVersion;
    await change('SHARED');
    const auditCount=await db.auditEvent.count({where:{action:'material.sharing_changed'}});
    await assert.rejects(sharing.change(current.materialId,{mode:'RESTRICTED',campaignIds:[],grants:[],expectedVersion:version},owner.actor));
    assert.equal(await db.auditEvent.count({where:{action:'material.sharing_changed'}}),auditCount);
    const audit=await db.auditEvent.findFirstOrThrow({where:{action:'material.sharing_changed'},orderBy:{createdAt:'desc'}});
    assert.equal(audit.actorId,owner.actor.id); assert('before' in (audit.payload as object)&&'after' in (audit.payload as object));
    pass('M15 conflicting version rolls back with no extra audit; successful ACL command has before/after and real actor');
    const removed=await materials.bulkAction([{materialId:current.materialId,expectedVersion:current.recordVersion}],'SOFT_DELETE',owner.actor);
    assert.equal(removed.succeeded,1); current=removed.items[0]!.material!;
    assert.equal((await fetch(publicUrl)).status,404);
    const restoredMaterial=await materials.bulkAction([{materialId:current.materialId,expectedVersion:current.recordVersion}],'RESTORE',owner.actor);
    assert.equal(restoredMaterial.succeeded,1); assert.equal((await fetch(publicUrl)).status,200);
    pass('M14 Trash removes public read; explicit restore preserves original sharing mode');
    current=restoredMaterial.items[0]!.material!;
    const authored=await materials.batchSave([{clientKey:'specialist-create',fields:{material_name:'Specialist synthetic',material_link:'https://example.test/specialist'}}],reader.actor);
    assert.equal(authored.succeeded,1); assert.equal(authored.items[0]!.material!.sharing!.ownerActorId,reader.actor.id);
    await sharing.change(authored.items[0]!.material!.materialId,{mode:'RESTRICTED',campaignIds:[],grants:[],expectedVersion:1},reader.actor);
    pass('M01 actual non-admin specialist creates SHARED then manages own sharing');
    await db.role.upsert({where:{code:'VIEWER'},create:{code:'VIEWER',displayName:'Viewer',description:'Synthetic'},update:{}});
    const demoRow=await db.actor.create({data:{key:'synthetic-demo',displayName:'Synthetic demo',loginEmail:'synthetic-demo@example.test',accountKind:'PARTNER_DEMO',
      credential:{create:{passwordHash,mustChangePassword:false}},scopedBindings:{create:{roleCode:'VIEWER',scopeType:'SYSTEM',scopeKey:JSON.stringify(['SYSTEM',null,null,null])}}}});
    const demoToken=newOpaqueSecret(),demoCsrf=newOpaqueSecret();
    const demoSession=await identities.createSession({tokenHash:demoToken.hash,csrfHash:demoCsrf.hash,originalActorId:demoRow.id,effectiveActorId:demoRow.id,mode:'DIRECT',credentialVersion:1,expiresAt:new Date(Date.now()+600_000)});
    const demoActor=identity.actor(demoSession);
    for(const permission of ['EDIT','MANAGE_SHARING'] as const){
      await change('RESTRICTED',[],[{kind:'ACCOUNT',id:demoActor.id,permission}]);
      assert.equal((await as(demoActor,()=>sharing.detail(current.materialId))).capabilities?.edit,false);
      await assert.rejects(sharing.change(current.materialId,{mode:'SHARED',campaignIds:[],grants:[],expectedVersion:current.recordVersion},demoActor));
      assert.equal((await fetch(base+'/api/materials/'+current.materialId+'/sharing',{method:'PATCH',headers:{cookie:`cpms_session=${demoToken.token}`,origin:'http://localhost:5173','x-cpms-csrf':demoCsrf.token,'content-type':'application/json'},body:JSON.stringify({mode:'SHARED',campaignIds:[],grants:[],expectedVersion:current.recordVersion})})).status,403);
    }
    pass('M11 real PARTNER_DEMO session cannot write via application commands or HTTP despite EDIT/MANAGE_SHARING grants');
    await change('SHARED');
    let browserResult: unknown = null;
    if (process.env.CPMS_QA_PLAYWRIGHT_PATH) {
      const helper=pathToFileURL(resolve('scripts/qa/material-sharing-browser.mjs')).href;
      const {checkMaterialSharingBrowser}=await import(helper);
      browserResult=await checkMaterialSharingBrowser({apiBase:base,playwrightPath:process.env.CPMS_QA_PLAYWRIGHT_PATH,owner,reader,materialId:current.materialId,change,
        configureOrigin:(origin:string)=>app.get(ConfigService).set('WEB_ORIGIN',origin)});
      pass('M03/M10/M12/M15 browser checks with real sessions, anonymous context and isolated API');
    }
    await mkdir('private-local/material-sharing',{recursive:true});
    await writeFile('private-local/material-sharing/integration-result.json',JSON.stringify({database:name,restoreDatabase:restoreName,checks,browserResult,migrationPreserved:true,syntheticRestoreVerified:true,productionTouched:false},null,2));
  } finally { await app.close(); await db.$disconnect(); }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
