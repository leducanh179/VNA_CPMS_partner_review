import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { PrismaClient } from '@prisma/client';
import { hashLocalPassword } from '../src/modules/identity/application/local-auth-security';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { ContractsApplicationService } from '../src/modules/contracts/application/contracts.application-service';

/** Runs the real web/API against an already verified synthetic DB; never targets the live CPMS DB. */
async function main() {
  const result=JSON.parse(await readFile('private-local/contracts-v1/integration-result.json','utf8')) as {databaseName:string;status:string};
  assert.equal(result.status,'PASS');assert.match(result.databaseName,/^cpms_supply_test_\d+$/);
  const url=new URL(process.env.DATABASE_URL!);assert(['localhost','127.0.0.1'].includes(url.hostname));url.pathname=`/${result.databaseName}`;
  process.env.DATABASE_URL=url.href;process.env.AUTH_MODE='LOCAL_SESSION';process.env.ALLOW_OPEN_DEMO='false';process.env.LOCAL_DEMO_CREDENTIALS='false';process.env.LOCAL_DEMO_IMPERSONATION='false';process.env.WEB_ORIGIN='http://localhost:5173';process.env.NODE_ENV='test';process.env.AI_MODE='OFF';
  const db=new PrismaClient({datasourceUrl:url.href,log:[]});
  const password=`Synthetic-QA-${randomUUID()}`;const passwordHash=await hashLocalPassword(password);
  const org=await db.employmentOrgUnit.upsert({where:{identityKey:'SYNTHETIC-QA'},create:{identityKey:'SYNTHETIC-QA',sourceName:'Synthetic QA',kind:'DEPARTMENT',sourceProvider:'SYNTHETIC'},update:{}});
  const accounts:Record<string,string>={};
  for(const [key,roleCode] of [['admin','ADMIN'],['requester','REQUESTER'],['manager','CONTRACT_MANAGER']] as const){
    await db.role.upsert({where:{code:roleCode},create:{code:roleCode,displayName:roleCode,description:'Synthetic QA'},update:{}});
    const employeeCode=`SYN-QA-${key}`;const email=`${key}@supply.example.test`;accounts[key]=email;
    await db.personnelDirectoryEntry.upsert({where:{employeeCode},create:{employeeCode,email,fullName:`Synthetic ${key}`,organizationName:'Synthetic QA',sourceProvider:'SYNTHETIC'},update:{}});
    const actor=await db.actor.upsert({where:{key:`synthetic-qa-${key}`},create:{key:`synthetic-qa-${key}`,displayName:`Synthetic ${key}`,accountKind:'PERSONNEL',loginEmail:email,personnelEmployeeCode:employeeCode},update:{}});
    await db.employmentMembership.upsert({where:{actorId:actor.id},create:{actorId:actor.id,departmentId:org.id},update:{}});
    await db.localCredential.upsert({where:{actorId:actor.id},create:{actorId:actor.id,passwordHash,mustChangePassword:false},update:{passwordHash,mustChangePassword:false,credentialVersion:{increment:1}}});
    const scopeType=key==='admin'?'SYSTEM':'MODULE';const module=key==='admin'?null:'CONTRACT';const scopeKey=JSON.stringify([scopeType,module,null,null]);
    await db.scopedRoleBinding.upsert({where:{actorId_roleCode_scopeKey:{actorId:actor.id,roleCode,scopeKey}},create:{actorId:actor.id,roleCode,scopeKey,scopeType,module},update:{}});
    if(key==='manager')for(const permissionCode of ['contract.read','contract.update','contract.allocate','contract.export'])await db.rolePermission.upsert({where:{roleCode_permissionCode_relation:{roleCode,permissionCode,relation:'ASSIGNED'}},create:{roleCode,permissionCode,relation:'ASSIGNED',defaultScope:'MODULE'},update:{}});
  }
  const {AppModule}=await import('../src/app.module');const app=await NestFactory.create(AppModule,{logger:false,bodyParser:false});app.setGlobalPrefix('api');app.use(json({limit:'12mb'}));await app.listen(3000,'127.0.0.1');
  const identity=app.get(IdentityApplicationService),contracts=app.get(ContractsApplicationService);
  const adminLogin=await identity.login(accounts.admin!,password,'127.0.0.1');const actor=identity.actor(adminLogin.session);
  const item=(await contracts.list({},actor)).items[0]!;
  const requesterLogin=await identity.login(accounts.requester!,password,'127.0.0.1');
  const managerLogin=await identity.login(accounts.manager!,password,'127.0.0.1');
  const request=(token:string,csrfToken:string,method='GET',body?:unknown)=>fetch(`http://127.0.0.1:3000/api/contracts/${item.id}`,{method,headers:{cookie:`cpms_session=${token}`,origin:'http://localhost:5173','x-cpms-csrf':csrfToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request(requesterLogin.token,requesterLogin.csrfToken)).status,404);
  assert.equal((await request(managerLogin.token,managerLogin.csrfToken)).status,404);
  const assigned=await contracts.saveContract(item.id,{expectedVersion:item.recordVersion,fields:{managerActorId:managerLogin.session.effective.id,managerEmail:accounts.manager}},actor);
  assert.equal((await request(managerLogin.token,managerLogin.csrfToken)).status,200);
  assert.equal((await request(managerLogin.token,managerLogin.csrfToken,'PATCH',{expectedVersion:assigned.contract.recordVersion,fields:{name:assigned.contract.name}})).status,200);
  assert.equal((await request(requesterLogin.token,requesterLogin.csrfToken,'PATCH',{expectedVersion:assigned.contract.recordVersion,fields:{name:'Forbidden'}})).status,404);
  const importDenied=await fetch('http://127.0.0.1:3000/api/contracts/import/preview',{method:'POST',headers:{cookie:`cpms_session=${requesterLogin.token}`,origin:'http://localhost:5173','x-cpms-csrf':requesterLogin.csrfToken,'content-type':'application/json'},body:'{}'});assert.equal(importDenied.status,403);
  const source=await readFile('private-local/contracts-v1/integration-result.json','utf8');
  await writeFile('private-local/contracts-v1/browser-fixture.json',JSON.stringify({databaseName:result.databaseName,email:accounts.admin,password,contractId:item.id,security:'PASS: LOCAL_SESSION requester denied; manager only assigned contract; import denied',integration:JSON.parse(source)}));
  console.log('PASS real LOCAL_SESSION HTTP boundaries; synthetic browser fixture listening on port 3000. Credentials remain in private-local.');
  const close=()=>{void app.close().then(()=>db.$disconnect()).then(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Synthetic fixture failed');process.exit(1);});
