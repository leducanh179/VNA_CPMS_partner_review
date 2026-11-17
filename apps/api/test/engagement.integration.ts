import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ACCESS_CATALOG } from '../src/modules/access/application/access-catalog';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { hashLocalPassword } from '../src/modules/identity/application/local-auth-security';
import { EngagementApplicationService } from '../src/modules/engagement/application/engagement.application-service';
import { CampaignApplicationService } from '../src/modules/campaign/application/campaign.application-service';
import { CampaignWorkflowApplicationService } from '../src/modules/campaign-workflow/application/campaign-workflow.application-service';

async function main() {
  const target = new URL(process.env.DATABASE_URL!); assert(['localhost','127.0.0.1'].includes(target.hostname));
  const name = `cpms_engagement_test_${Date.now()}_${randomUUID().slice(0,8)}`;
  const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href }); await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  target.pathname = `/${name}`; process.env.DATABASE_URL = target.href;
  process.env.AUTH_MODE = 'LOCAL_SESSION'; process.env.NODE_ENV = 'test'; process.env.WEB_ORIGIN = process.env.ENGAGEMENT_QA_HOLD === 'true' ? 'http://127.0.0.1:4176' : 'http://localhost:5173';
  process.env.AI_MODE = 'OFF'; process.env.GOOGLE_PROVIDER_WRITES = 'BLOCKED'; process.env.GOOGLE_DRIVE_WRITES = 'BLOCKED';
  process.env.LOCAL_DEMO_CREDENTIALS = 'false'; process.env.LOCAL_DEMO_IMPERSONATION = 'false';
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js','migrate','deploy','--schema','database/schema.prisma'], { env: process.env, stdio: 'pipe' });
    const { AppModule } = await import('../src/app.module'); app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api'); await app.listen(process.env.ENGAGEMENT_QA_HOLD === 'true' ? 3184 : 0,'127.0.0.1');
    const db = app.get(PrismaService), identities = app.get(IdentityApplicationService), missions = app.get(EngagementApplicationService);
    await db.role.create({ data: { code: 'ADMIN', displayName: 'Synthetic administrator', description: 'Synthetic fixture' } });
    await db.role.create({ data: { code: 'VIEWER', displayName: 'Synthetic viewer', description: 'Synthetic fixture' } });
    await db.permissionDefinition.createMany({ data: ACCESS_CATALOG, skipDuplicates: true });
    await db.accessPolicyState.create({ data: { key: 'access' } });
    const password = 'SyntheticMission2026!';
    const owner = await db.actor.create({ data: { key: 'synthetic-mission-owner', displayName: 'Synthetic owner', loginEmail: 'mission-owner@example.test', accountKind: 'PILOT_ADMIN',
      credential: { create: { passwordHash: await hashLocalPassword(password), mustChangePassword: false } }, roles: { create: { roleCode: 'ADMIN' } } } });
    const reader = await db.actor.create({ data: { key: 'synthetic-mission-reader', displayName: 'Synthetic reader', loginEmail: 'mission-reader@example.test', accountKind: 'PARTNER_DEMO',
      credential: { create: { passwordHash: await hashLocalPassword(password), mustChangePassword: false } } } });
    await db.scopedRoleBinding.create({ data: { actorId: owner.id, roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: '["SYSTEM",null,null,null]', relation: 'PRESET' } });
    await db.scopedRoleBinding.create({ data: { actorId: reader.id, roleCode: 'VIEWER', scopeType: 'SYSTEM', scopeKey: '["SYSTEM",null,null,null]', relation: 'PRESET' } });
    const actor = identities.actor((await identities.login(owner.loginEmail!,password,'127.0.0.1')).session);
    const other = identities.actor((await identities.login(reader.loginEmail!,password,'127.0.0.1')).session);
    await missions.configure(actor,{enabled:false});
    assert.equal((await missions.state(actor)).enabled,false);
    await assert.rejects(missions.configure(other,{enabled:true}));
    await missions.configure(actor,{enabled:true}); await missions.start(other,{mode:'DEMO'});
    await assert.rejects(missions.start(other,{mode:'REAL',restart:true}));
    await assert.rejects(missions.demoSubmit(other,{runNumber:1}));
    await missions.demoDraft(other,{runNumber:1,name:'Synthetic practice',level:'1'});
    await Promise.all([missions.demoSubmit(other,{runNumber:1}),missions.demoSubmit(other,{runNumber:1})]);
    assert.equal((await missions.state(other)).progress?.completedCount,1); assert.equal((await missions.state(actor)).inventory.length,0);
    assert.equal(await db.personalCollectible.count(),1); assert.equal(await db.campaign.count(),0);
    await missions.acknowledge(other,{runNumber:1}); assert((await missions.state(other)).progress?.rewardSeenAt);
    await missions.start(other,{mode:'DEMO',restart:true}); await assert.rejects(missions.demoSubmit(other,{runNumber:1}));
    await missions.demoDraft(other,{runNumber:2,name:'Synthetic practice again',level:'2'}); await missions.demoSubmit(other,{runNumber:2});
    assert.equal((await missions.state(other)).progress?.completedCount,2); assert.equal(await db.personalCollectible.count(),1);
    // Exercise the real Campaign Application Service and actual workflow command, not fabricated reward evidence.
    await db.campaignLevel.upsert({where:{code:'CLV_01'},create:{code:'CLV_01',label:'Synthetic Level',ruleDescription:'Synthetic rule',displayOrder:1},update:{}});
    const department = await db.employmentOrgUnit.create({data:{identityKey:'synthetic-department',sourceName:'Synthetic department',kind:'DEPARTMENT',sourceProvider:'SYNTHETIC'}});
    const workflow = app.get(CampaignWorkflowApplicationService); await workflow.initialize(actor,department.id,false);
    const campaigns = app.get(CampaignApplicationService);
    const old = await campaigns.create({name:'Synthetic old campaign',levelCode:'CLV_01'},actor);
    await missions.start(actor,{mode:'REAL'}); await missions.reconcile(actor); assert.equal((await missions.state(actor)).progress?.stage,'ACTIVE');
    const fresh = await campaigns.create({name:'Synthetic mission campaign',levelCode:'CLV_01'},actor);
    await db.campaignWorkflowCommand.create({data:{campaignId:fresh.id,actorId:actor.id,originalActorId:actor.id,contextMode:'DIRECT',idempotencyKey:randomUUID(),operation:'SUBMIT',payloadHash:'0'.repeat(64),result:{}}});
    await missions.reconcile(actor); assert.equal((await missions.state(actor)).progress?.stage,'DRAFT_SAVED'); assert.equal((await missions.state(actor)).inventory.length,0);
    const command={operation:'SUBMIT',idempotencyKey:randomUUID(),expectedVersion:0,expectedSubjectRevision:(await db.campaign.findUniqueOrThrow({where:{id:fresh.id},select:{businessRevision:true}})).businessRevision,receivingDivisionId:null};
    await workflow.command(actor,fresh.id,command);
    const completed=await missions.state(actor); assert.equal(completed.progress?.stage,'COMPLETED'); assert.equal(completed.progress?.campaignId,fresh.id);
    assert.notEqual(completed.progress?.campaignId,old.id); assert.equal(completed.inventory.length,1);
    await workflow.command(actor,fresh.id,command); await missions.reconcile(actor); assert.equal((await missions.state(actor)).progress?.completedCount,1);
    await missions.configure(actor,{enabled:false}); await assert.rejects(missions.start(other,{mode:'DEMO',restart:true})); assert.equal((await missions.state(actor)).inventory.length,1);
    assert.equal(await db.auditEvent.count({where:{action:'engagement.mission_completed'}}),3);
    assert.equal((await fetch(`${await app.getUrl()}/api/engagement`)).status,401);
    if (process.env.ENGAGEMENT_QA_HOLD === 'true') {
      await missions.configure(actor,{enabled:true}); await missions.start(actor,{mode:'DEMO',restart:true});
      console.log('QA API ready on 127.0.0.1:3184 · synthetic login mission-owner@example.test / SyntheticMission2026!');
      await new Promise<void>(resolve => { process.once('SIGINT',resolve); process.once('SIGTERM',resolve); });
    }
    console.log('PASS: persisted real submission reward, demo replay, concurrency/idempotency, owner isolation, readonly/admin gates, disable/retain, anonymous 401; disposable database only.');
  } finally {
    if(app) await app.close(); await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.$disconnect();
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
