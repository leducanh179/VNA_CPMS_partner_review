import 'reflect-metadata';import 'dotenv/config';
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {PrismaClient} from '@prisma/client';import {NestFactory} from '@nestjs/core';import {json} from 'express';
import {PrismaService} from '../src/infrastructure/prisma/prisma.service';
import {ContractsApplicationService} from '../src/modules/contracts/application/contracts.application-service';
import {BookingApplicationService} from '../src/modules/booking/application/booking.application-service';
import {syntheticSource} from '../src/modules/contracts/domain/supply-fixtures';
import {ACCESS_CATALOG} from '../src/modules/access/application/access-catalog';
import type {ActorContext,BookingFields,BookingView} from '@cpms/domain';
import { verifyContractRefinement } from './contract-allocation-refinement';
import { verifyContractAnalytics } from './contract-analytics';
import { verifyBookingWorkflow } from './booking-workflow.integration';
import { verifyQcttPlan } from './qctt-plan.integration';
import { verifyQcttCatalog } from './qctt-catalog.integration';
import { ConfigService } from '@nestjs/config';
import { verifyBookingDelegation } from './booking-delegation.integration';
async function main(){
 const target=new URL(process.env.DATABASE_URL!);assert(['localhost','127.0.0.1'].includes(target.hostname));const databaseName=`cpms_booking_test_${Date.now()}`,adminUrl=new URL(target);adminUrl.pathname='/postgres';const admin=new PrismaClient({datasourceUrl:adminUrl.href,log:[]});try{await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);}finally{await admin.$disconnect();}
 target.pathname=`/${databaseName}`;process.env.DATABASE_URL=target.href;process.env.AUTH_MODE='OPEN_DEMO';process.env.ALLOW_OPEN_DEMO='true';process.env.NODE_ENV='test';process.env.WEB_ORIGIN='http://localhost:5173';process.env.AI_MODE='OFF';process.env.LOCAL_DEMO_CREDENTIALS='false';process.env.LOCAL_DEMO_IMPERSONATION='false';const actorId='00000000-0000-4000-8000-000000000099';process.env.DEMO_ACTOR_ID=actorId;
 await mkdir('private-local/booking-v1',{recursive:true});const migrations=(await readdir('database/migrations')).filter(n=>/^\d/.test(n)).sort();const sql=(await Promise.all(migrations.map(n=>readFile(path.join('database/migrations',n,'migration.sql'),'utf8')))).join('\n');const sqlPath=path.resolve('private-local/booking-v1/synthetic-migrations.sql');await writeFile(sqlPath,sql);execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','execute','--schema','database/schema.prisma','--file',sqlPath],{env:process.env,stdio:'pipe'});
 const db=new PrismaService({datasourceUrl:target.href,log:[]});await db.$connect();await db.role.create({data:{code:'ADMIN',displayName:'Synthetic Admin',description:'Synthetic'}});await db.actor.create({data:{id:actorId,key:'demo-superuser',displayName:'Synthetic Admin',loginEmail:'manager@example.test',accountKind:'LEGACY',roles:{create:{roleCode:'ADMIN'}}}});await db.permissionDefinition.createMany({data:ACCESS_CATALOG,skipDuplicates:true});await db.organizationUnit.createMany({data:['UNIT_A','UNIT_B'].map((code,i)=>({code,displayName:i?'Unit B':'Unit A',category:'QUICK_SELECT',sourceProvider:'SYNTHETIC',displayOrder:i}))});
 const actor:ActorContext={id:actorId,key:'demo-superuser',displayName:'Synthetic Admin',roles:['ADMIN']};const {AppModule}=await import('../src/app.module');const app=await NestFactory.create(AppModule,{logger:false,bodyParser:false});app.setGlobalPrefix('api');app.use(json({limit:'10mb'}));await app.listen(0,'127.0.0.1');const service=app.get(BookingApplicationService),contracts=app.get(ContractsApplicationService);const checks:string[]=[];const pass=(name:string)=>{checks.push(name);console.log(`PASS ${name}`);};
 try{
  if(!process.argv.includes('--delegation-only')&&!process.argv.includes('--plans-only')){
  const preview=await contracts.importPreview(syntheticSource(),actor);const supply=await contracts.importApply(preview.id,{idempotencyKey:randomUUID(),acknowledgeWarnings:true},actor);const allocation=supply.allocations.find(a=>a.sourceKey==='A-1')!;
  const fields:BookingFields={allocationId:allocation.id,campaignId:null,campaignLabel:'Synthetic campaign',startDate:'2026-09-10',endDate:'2026-09-20',quantity:'10',materialId:null,materialUrl:null,note:'Synthetic test'};
  const batch=(quantity:string)=>({idempotencyKey:randomUUID(),items:[{fields:{...fields,quantity}}]});const original=batch('10');const result=await service.save(original,actor) as {ids:string[]};assert.equal(result.ids.length,1);await service.save(original,actor);assert.equal(await db.bookingRecord.count(),1);assert.equal(await db.bookingRevision.count(),1);assert.equal((await contracts.detail(supply.contract.id,actor)).inventory.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'10');pass('create uses real inventory; retried command does not duplicate');
  let row=(await service.detail(result.ids[0]!,actor)).booking;assert.equal(row.amount,'1000');assert.equal(row.vat,'80');assert.equal(row.gross,'1080');const get=async()=>row=(await service.detail(row.id,actor)).booking;
  const plan={version:1,mode:'CUSTOM',fillRemainder:true,segments:[{startDate:'2026-09-10',endDate:'2026-09-10',quantity:'3'}]};
  const beforePreview={count:await db.bookingRecord.count(),revision:await db.bookingRevision.count(),commands:await db.bookingCommand.count(),audit:await db.auditEvent.count()};
  const impact=await service.impact({idempotencyKey:randomUUID(),items:[{id:row.id,recordVersion:row.recordVersion,fields:{...fields,quantity:'12',timeDistribution:plan}}]},actor);
  assert.equal(impact.valid,true);assert.equal(impact.contracts[0]!.before.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'10');assert.equal(impact.contracts[0]!.after.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'12');
  assert.deepEqual({count:await db.bookingRecord.count(),revision:await db.bookingRevision.count(),commands:await db.bookingCommand.count(),audit:await db.auditEvent.count()},beforePreview);
  const badImpact=await service.impact({idempotencyKey:randomUUID(),items:[{fields:{...fields,quantity:'25'}},{fields:{...fields,quantity:'25'}}]},actor);assert.equal(badImpact.valid,false);assert.equal(badImpact.contracts[0]!.after.rows.find(r=>r.allocationId===allocation.id)!.remaining.booked.qty,'-30');
  await service.save({idempotencyKey:randomUUID(),items:[{id:row.id,recordVersion:row.recordVersion,fields:{...fields,timeDistribution:plan,overallStartDate:'2026-09-01',overallEndDate:'2026-09-30'}}]},actor);await get();assert.deepEqual(row.timeDistribution,plan);assert.equal(row.overallStartDate,'2026-09-01');assert.equal(row.amount,'1000');
  await service.save({idempotencyKey:randomUUID(),items:[{id:row.id,recordVersion:row.recordVersion,fields:{...fields,note:'Old client preserves schedule'}}]},actor);await get();assert.deepEqual(row.timeDistribution,plan);
  await assert.rejects(service.save({idempotencyKey:randomUUID(),items:[{id:row.id,recordVersion:row.recordVersion,fields:{...fields,startDate:'2026-09-11'}}]},actor));assert.equal((await get()).startDate,'2026-09-10');
  const hiddenActor={...actor,id:randomUUID()};await assert.rejects(service.impact(batch('1'),hiddenActor));
  pass('time plan persists with audit/version; preview replaces old usage, aggregates drafts and writes nothing');
  const analyticsBefore = { count: await db.bookingRecord.count(), revision: await db.bookingRevision.count(), commands: await db.bookingCommand.count(), audit: await db.auditEvent.count() };
  await verifyContractAnalytics(app, contracts, row, actor);
  assert.deepEqual({ count: await db.bookingRecord.count(), revision: await db.bookingRevision.count(), commands: await db.bookingCommand.count(), audit: await db.auditEvent.count() }, analyticsBefore);
  pass('Contract analytics HTTP reads saved custom plan, conserves all grains, deduplicates selections, enforces access and writes nothing');
  await assert.rejects(service.save({...batch('25'),items:[{fields:{...fields,quantity:'5'}},{fields:{...fields,quantity:'25'}}]},actor));assert.equal(await db.bookingRecord.count(),1);pass('over-limit batch rolls back every row');
  const action=async(action:string,r:BookingView=row)=>service.lifecycle({idempotencyKey:randomUUID(),action,items:[{id:r.id,recordVersion:r.recordVersion}]},actor);
  await action('PAUSE');await get();assert.equal(row.state,'PAUSED');assert.equal((await contracts.detail(supply.contract.id,actor)).inventory.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'10');await action('RESUME');await get();
  const template=await service.configureTemplate({contractId:supply.contract.id,name:'Synthetic report',definition:{metrics:['impression','linkClick','conversion'],conversionDenominator:'linkClick',excludedSlotIds:[]}},actor);
  const report=(r:BookingView= row)=>({idempotencyKey:randomUUID(),contractId:supply.contract.id,items:[{id:r.id,recordVersion:r.recordVersion,templateId:template.id,state:'ACCEPTED',acceptedQty:'4',values:{impression:'1000',linkClick:'20',conversion:'2',fileUrl:'https://example.test/evidence'}}]});
  await service.reports(report(),actor);await get();assert.equal(row.reportData.conversionRate,'10');await action('DELETE');await get();assert(row.deletedAt);assert.equal((await contracts.detail(supply.contract.id,actor)).inventory.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'4');await assert.rejects(action('PURGE'));pass('pause retains quota; delete retains accepted usage; accepted rows cannot be purged');
  const second=await service.save(batch('26'),actor) as {ids:string[]};await assert.rejects(action('RESTORE'));assert((await get()).deletedAt);const secondRow=(await service.detail(second.ids[0]!,actor)).booking;await action('DELETE',secondRow);await action('RESTORE');await get();assert.equal(row.deletedAt,null);pass('restore rechecks quota under transaction and succeeds only after capacity is freed');
  await assert.rejects(service.save({idempotencyKey:randomUUID(),items:[{id:row.id,recordVersion:1,fields}]},actor));await assert.rejects(service.reports({...report(),items:[{...report().items[0],values:{linkClickRate:'999'}}]},actor));await assert.rejects(service.reports({...report(),contractId:randomUUID()},actor));await assert.rejects(service.reports({...report(),items:[{...report().items[0],acceptedQty:'11'}]},actor));pass('stale versions, foreign template/contract, forged rates and excessive acceptance rejected');
  const results=await Promise.allSettled([service.save(batch('15'),actor),service.save(batch('15'),actor)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await contracts.detail(supply.contract.id,actor)).inventory.rows.find(r=>r.allocationId===allocation.id)!.usage.booked.qty,'25');pass('concurrent saves cannot oversell the same remaining quantity');
  let d=await contracts.detail(supply.contract.id,actor);d=await contracts.saveAdjustment(d.contract.id,{expectedVersion:d.contract.recordVersion,fields:{kind:'CUT',name:'Cut below booking',reason:'Test invariant',evidence:'Synthetic',effectiveDate:'2026-09-10',lines:[{allocationId:allocation.id,expectedAllocationVersion:allocation.recordVersion,deltaQty:'-20',deltaAmount:'-2000'}]}},actor);const g=d.adjustments.find(g=>g.name==='Cut below booking')!;d=await contracts.transition(d.contract.id,'adjustment',g.id,{expectedVersion:d.contract.recordVersion,recordVersion:g.recordVersion,action:'SUBMIT',idempotencyKey:randomUUID()},actor);await assert.rejects(contracts.transition(d.contract.id,'adjustment',g.id,{expectedVersion:d.contract.recordVersion,recordVersion:d.adjustments.find(x=>x.id===g.id)!.recordVersion,action:'APPROVE',idempotencyKey:randomUUID()},actor));pass('contract adjustment cannot reduce inventory below reserved bookings');
  const response=await fetch(`${await app.getUrl()}/api/bookings`);assert.equal(response.status,200);const items=await response.json() as BookingView[];assert.equal(items.length,2);const bad=await fetch(`${await app.getUrl()}/api/bookings/batch-save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...batch('1'),items:[{fields:{...fields,amount:'1'}}]})});assert.equal(bad.status,400);await assert.rejects(service.save(batch('1'),{...actor,id:randomUUID()}));assert.equal(await db.campaign.count(),0);assert.equal(await db.materialRecord.count(),0);pass('HTTP schema and actor boundary reject forged values without collateral writes');
  await verifyContractRefinement(app,contracts,service,actor,pass);
  await verifyBookingWorkflow(app,db,actor,pass);
  }
  if(!process.argv.includes('--plans-only'))await verifyBookingDelegation(app,db,actor,pass);
  const planFixture=!process.argv.includes('--delegation-only') ? await verifyQcttPlan(app,db,actor,pass) : null;
  if(!process.argv.includes('--delegation-only'))await verifyQcttCatalog(app,db,actor,pass);
  await writeFile('private-local/booking-v1/integration-result.json',JSON.stringify({status:'PASS',databaseName,checks},null,2));
  if (process.argv.includes('--serve-plans')) {
    app.get(ConfigService).set('AUTH_MODE','LOCAL_SESSION');
    app.get(ConfigService).set('WEB_ORIGIN','http://localhost:5174');
    console.log(JSON.stringify({ qaApi: await app.getUrl(), databaseName, ...planFixture }));
    await new Promise<void>(()=>{});
  }
 }finally{await app.close();await db.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.stack:'Booking integration failed');process.exitCode=1;});
