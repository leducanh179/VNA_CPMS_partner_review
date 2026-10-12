import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOOKING_APPROVAL_OPERATIONS, bookingDeadlines, bookingVietnamDate, type ActorContext, type BookingApprovalOperation, type BookingFields, type BookingListItem, type BookingWorkflowAction } from '@cpms/domain';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { BookingApplicationService } from '../src/modules/booking/application/booking.application-service';
import { BookingDelegationApplicationService } from '../src/modules/booking/application/booking-delegation.application-service';
import { ContractsApplicationService } from '../src/modules/contracts/application/contracts.application-service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { generateLocalCredential, hashLocalPassword } from '../src/modules/identity/application/local-auth-security';
import { syntheticSource } from '../src/modules/contracts/domain/supply-fixtures';

/** All mutations in this acceptance scenario target an isolated, synthetic database. */
export async function verifyBookingDelegation(app:INestApplication,db:PrismaService,admin:ActorContext,pass:(name:string)=>void){
  assert(/^\/cpms_booking_test_\d+$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const bookings=app.get(BookingApplicationService), grants=app.get(BookingDelegationApplicationService), contracts=app.get(ContractsApplicationService), identity=app.get(IdentityApplicationService);
  const department=await db.employmentOrgUnit.create({data:{identityKey:'synthetic-delegation',sourceName:'Synthetic Delegation',kind:'DEPARTMENT',sourceProvider:'SYNTHETIC'}});
  const person=async(name:string,permissions:string[])=>{
    const code=`SYN-DELEGATE-${name}`,email=`delegate-${name}@example.test`,password=generateLocalCredential();
    await db.personnelDirectoryEntry.create({data:{employeeCode:code,fullName:name,email,organizationName:'Synthetic Delegation',sourceProvider:'SYNTHETIC'}});
    const account=await db.actor.create({data:{key:code,displayName:name,loginEmail:email,accountKind:'PERSONNEL',personnelEmployeeCode:code,employment:{create:{departmentId:department.id}},credential:{create:{passwordHash:await hashLocalPassword(password),mustChangePassword:false}}}});
    for(const permissionCode of permissions){const module=permissionCode.startsWith('contract.')?'CONTRACT':'BOOKING';await db.accountPermissionOverride.create({data:{actorId:account.id,permissionCode,scopeType:'MODULE',module,scopeKey:JSON.stringify(['MODULE',module,null,null,null]),effect:'ALLOW',relation:'ASSIGNED'}});}
    const login=await identity.login(email,password,'127.0.0.1');return {actor:identity.actor(login.session),login};
  };
  const base=['booking.read','booking.create','booking.update','booking.delete','booking.restore','booking.submit'];
  const manager=await person('manager',[...base,'booking.approve','contract.read']);
  const operator=await person('operator',['booking.read','booking.approve']);
  const vendor=await person('vendor',[...base,'booking.confirm']);
  const leader=await person('leader',['booking.read','booking.approve','contract.read','contract.approve']);
  const outsider=await person('outsider',['booking.read','booking.approve','contract.read','contract.approve']);
  const source=syntheticSource();source.spreadsheetId='synthetic-booking-delegation';
  for(const sheet of source.sheets)for(const row of sheet.rows)for(const cell of row)if(typeof cell.value==='string')cell.value=cell.value.replaceAll('CON-SYN-1','DELEGATE-CON').replaceAll('SLOT-SYN-1','DELEGATE-SLOT').replaceAll('manager@example.test','delegate-manager@example.test');
  const allocationSheet=source.sheets.find(s=>s.name==='cpms_slot_allocation_period')!;
  const vatColumn=allocationSheet.rows[0]!.findIndex(c=>c.value==='planned_tax_rate');
  for(const row of allocationSheet.rows.slice(1))row[vatColumn]!.value??=0.08;
  const preview=await contracts.importPreview(source,admin),supply=await contracts.importApply(preview.id,{idempotencyKey:randomUUID(),acknowledgeWarnings:true},admin);
  // Establish initial fixture assignment, before any request or delegation exists.
  await db.supplyContract.update({where:{id:supply.contract.id},data:{leaderActorId:leader.actor.id}});
  const allocation=supply.allocations.find(a=>a.sourceKey==='A-1')!,outside=supply.allocations.find(a=>a.sourceKey==='A-2')!;
  for(const a of supply.allocations)await bookings.configureAllocation({allocationId:a.id,recordVersion:1,ownerDepartmentId:null,beneficiaryDepartmentId:null,leaderActorIds:[leader.actor.id],operatorActorIds:a.id===allocation.id?[operator.actor.id]:[],beneficiaryActorIds:[],vendorActorIds:[vendor.actor.id]},admin);
  const policy=await bookings.policy(admin);
  await bookings.configurePolicy({required:true,expectedVersion:policy.version,reason:'Delegation acceptance',actions:Object.fromEntries(BOOKING_APPROVAL_OPERATIONS.map(a=>[a,true]))},admin);
  const fields:BookingFields={allocationId:allocation.id,campaignId:null,campaignLabel:'Delegation acceptance',startDate:'2026-09-01',endDate:'2026-09-30',quantity:'1',materialId:null,materialUrl:null,note:'Synthetic only'};
  const get=(id:string,actor=manager.actor)=>bookings.detail(id,actor).then(r=>r.booking);
  const save=async(actor:ActorContext,before?:BookingListItem,patch:Partial<BookingFields>={})=>{
    const r=await bookings.save({idempotencyKey:randomUUID(),submit:true,items:[{...(before?{id:before.id,recordVersion:before.recordVersion}:{}),fields:{...fields,...patch}}]},actor) as {ids:string[]};return get(r.ids[0]!);
  };
  const action=async(row:BookingListItem,actor:ActorContext,action:BookingWorkflowAction)=>{await bookings.workflow({idempotencyKey:randomUUID(),action,reason:'Acceptance decision',items:[{id:row.id,recordVersion:row.recordVersion}]},actor);return get(row.id);};
  const config=async(recipient=manager.actor.id,actions:BookingApprovalOperation[]=[...BOOKING_APPROVAL_OPERATIONS],revoke=false,actor=leader.actor)=>{
    const option=(await grants.list(admin)).contracts.find(c=>c.id===supply.contract.id)!;
    return grants.save(option.id,{delegateActorId:recipient,assignmentVersion:option.assignmentVersion,expectedVersion:option.history.find(g=>g.delegateActorId===recipient)?.version??0,actions,startsOn:bookingVietnamDate(),endsOn:null,reason:'Acceptance grant',revoke},actor);
  };
  let earlier=await save(manager.actor);earlier=await action(earlier,vendor.actor,'CONFIRM');
  const options=await grants.list(leader.actor);assert.deepEqual(options.contracts.map(c=>c.id),[supply.contract.id]);assert.equal(options.contracts[0]?.operators[0]?.id,operator.actor.id);
  await assert.rejects(grants.list(outsider.actor));
  await assert.rejects(grants.list(manager.actor));await assert.rejects(grants.list(vendor.actor));
  await assert.rejects(config(outsider.actor.id));await assert.rejects(config(manager.actor.id,undefined,false,manager.actor));
  const mg=await config();assert.equal(mg.scope,'CONTRACT');assert.equal(mg.actorId,leader.actor.id);
  const og=await config(operator.actor.id,['CREATE','PAUSE'],false,admin);assert.equal(og.scope,'ASSIGNED');assert.equal(og.recipientRole,'OPERATOR');
  await assert.rejects(grants.save(supply.contract.id,{delegateActorId:manager.actor.id,assignmentVersion:options.contracts[0]!.assignmentVersion,expectedVersion:0,actions:['CREATE'],startsOn:bookingVietnamDate(),endsOn:null,reason:'Stale'},leader.actor));
  assert.equal((await get(earlier.id)).canApproveByDelegation,false);await assert.rejects(action(earlier,manager.actor,'APPROVE'));
  await action(earlier,leader.actor,'APPROVE');
  const runtime=app.get(ConfigService);runtime.set('AUTH_MODE','LOCAL_SESSION');
  try{
    const http=await fetch(`${await app.getUrl()}/api/bookings/delegations`,{headers:{Cookie:`cpms_session=${leader.login.token}`}});assert.equal(http.status,200);assert.equal((await http.json() as {contracts:unknown[]}).contracts.length,1);
    const capabilities=await fetch(`${await app.getUrl()}/api/access/capabilities`,{headers:{Cookie:`cpms_session=${leader.login.token}`}});assert.equal(capabilities.status,200);
    const permissions=(await capabilities.json() as {permissions:Record<string,boolean>}).permissions;assert.equal(permissions['contract.approve'],true);assert.equal(permissions['booking.policy.manage'],false);
    assert.equal((await fetch(`${await app.getUrl()}/api/bookings/delegations`,{headers:{Cookie:`cpms_session=${manager.login.token}`}})).status,403);
    assert.equal((await fetch(`${await app.getUrl()}/api/bookings/delegations`)).status,401);
    const forbidden=await fetch(`${await app.getUrl()}/api/bookings/delegations/${supply.contract.id}`,{method:'POST',headers:{Cookie:`cpms_session=${leader.login.token}`,origin:'http://localhost:5173','x-cpms-csrf':leader.login.csrfToken,'Content-Type':'application/json'},body:JSON.stringify({delegateActorId:manager.actor.id,expectedVersion:1,assignmentVersion:options.contracts[0]!.assignmentVersion,actions:['CREATE'],startsOn:bookingVietnamDate(),endsOn:null,reason:'Forged self-approval option',allowSelfApproval:false})});assert.equal(forbidden.status,400);
  }finally{runtime.set('AUTH_MODE','OPEN_DEMO');}
  pass('Delegation: scoped admin/leader configuration, independent recipients, optimistic versions, strict authenticated HTTP and no adoption of old requests');

  let row=await save(manager.actor);assert.equal(row.workflow?.status,'PENDING_VENDOR');assert.equal(row.canApproveByDelegation,false);await assert.rejects(action(row,manager.actor,'APPROVE'));
  row=await action(row,vendor.actor,'CONFIRM');assert.equal(row.canApproveByDelegation,true);assert((await bookings.inbox(manager.actor)).items.some(i=>i.id===row.id&&i.canRespond));
  const snapshot=row.contractSnapshot;row=await action(row,manager.actor,'APPROVE');assert.equal(row.workflow?.status,'APPROVED');assert.deepEqual(row.contractSnapshot,snapshot);
  assert.equal(row.workflow?.decisions.at(-1)?.delegation?.id,mg.id);assert.equal(row.workflow?.decisions.at(-1)?.actorId,manager.actor.id);
  row=await save(manager.actor,row,{quantity:'2'});assert.equal(row.workflow?.effective?.quantity,'1');row=await action(row,vendor.actor,'CONFIRM');row=await action(row,manager.actor,'APPROVE');assert.equal(row.workflow?.effective?.quantity,'2');
  const lifecycle=async(kind:string)=>{await bookings.lifecycle({idempotencyKey:randomUUID(),action:kind,items:[{id:row.id,recordVersion:row.recordVersion}]},manager.actor);row=await get(row.id);assert.equal(row.lifecycleRequest?.status,'PENDING');row=await action(row,manager.actor,'LIFECYCLE_APPROVE');assert.equal(row.lifecycleRequest?.decidedDelegation?.id,mg.id);};
  await lifecycle('PAUSE');assert.equal(row.state,'PAUSED');await lifecycle('RESUME');assert.equal(row.state,'ACTIVE');await lifecycle('DELETE');assert(row.deletedAt);await lifecycle('RESTORE');assert.equal(row.deletedAt,null);
  pass('Delegation: manager self-approves all six selected operations after prerequisites; persisted decisions, price snapshot and lifecycle semantics retained');

  let operated=await save(vendor.actor);operated=await action(operated,operator.actor,'APPROVE');assert.equal(operated.workflow?.status,'APPROVED');assert.equal(operated.workflow?.decisions.length,2);assert.equal(operated.workflow?.decisions[0]?.step,'PENDING_INTERNAL');assert.equal(operated.workflow?.decisions[1]?.delegation?.id,og.id);
  let offscope=await save(manager.actor,undefined,{allocationId:outside.id});offscope=await action(offscope,vendor.actor,'CONFIRM');await assert.rejects(action(offscope,operator.actor,'APPROVE'));await action(offscope,manager.actor,'APPROVE');
  operated=await save(manager.actor,operated,{quantity:'2'});operated=await action(operated,vendor.actor,'CONFIRM');assert.equal((await get(operated.id,operator.actor)).canApproveByDelegation,false);await assert.rejects(action(operated,operator.actor,'APPROVE'));operated=await action(operated,manager.actor,'APPROVE');
  const operatorCreated=await save(operator.actor);assert.equal(operatorCreated.workflow?.status,'PENDING_VENDOR');
  await assert.rejects(save(operator.actor,undefined,{allocationId:outside.id}));
  await bookings.lifecycle({idempotencyKey:randomUUID(),action:'PAUSE',items:[{id:operated.id,recordVersion:operated.recordVersion}]},manager.actor);operated=await get(operated.id);operated=await action(operated,operator.actor,'LIFECYCLE_APPROVE');assert.equal(operated.state,'PAUSED');
  assert((await bookings.bootstrap(operator.actor)).contracts.every(c=>!c.approvalDelegations?.length));
  pass('Delegation: operator creates only assigned allocation; selected approval actions and configuration-history boundaries remain enforced');

  let pending=await save(manager.actor);pending=await action(pending,vendor.actor,'CONFIRM');const deadline=bookingDeadlines(pending).find(d=>!d.completedAt)?.dueAt;
  await config(operator.actor.id,['CREATE','PAUSE'],true,admin);assert.equal((await get(pending.id,operator.actor)).canApproveByDelegation,false);assert.equal((await get(pending.id)).canApproveByDelegation,true);
  await config(manager.actor.id,undefined,true);await assert.rejects(action(pending,manager.actor,'APPROVE'));assert.equal(bookingDeadlines(await get(pending.id)).find(d=>!d.completedAt)?.dueAt,deadline);
  assert((await bookings.inbox(leader.actor)).items.some(i=>i.id===pending.id&&i.canRespond));pending=await action(pending,leader.actor,'APPROVE');
  assert.equal((await get(row.id)).workflow?.decisions.at(-1)?.delegation?.id,mg.id);
  await config(operator.actor.id,['CREATE']);let removed=await save(manager.actor);removed=await action(removed,vendor.actor,'CONFIRM');
  const assignment=(await bookings.bootstrap(admin)).contracts.find(c=>c.contract.id===supply.contract.id)!.access.find(a=>a.allocationId===allocation.id)!;
  await bookings.configureAllocation({...assignment,operatorActorIds:[]},admin);await assert.rejects(action(removed,operator.actor,'APPROVE'));await action(removed,leader.actor,'APPROVE');
  await config();let denied=await save(manager.actor);denied=await action(denied,vendor.actor,'CONFIRM');
  await db.accountPermissionOverride.updateMany({where:{actorId:manager.actor.id,permissionCode:'booking.approve'},data:{effect:'DENY'}});
  await assert.rejects(action(denied,manager.actor,'APPROVE'));await action(denied,leader.actor,'APPROVE');
  assert(await db.auditEvent.count({where:{action:'booking.delegation.save',actorId:leader.actor.id}}));
  const current=(await grants.list(admin)).contracts.find(c=>c.id===supply.contract.id)!;
  runtime.set('AUTH_MODE','LOCAL_SESSION');
  try{
    const response=await fetch(`${await app.getUrl()}/api/bookings/delegations/${supply.contract.id}`,{method:'POST',headers:{Cookie:`cpms_session=${leader.login.token}`,origin:'http://localhost:5173','x-cpms-csrf':leader.login.csrfToken,'Content-Type':'application/json'},body:JSON.stringify({delegateActorId:manager.actor.id,assignmentVersion:current.assignmentVersion,expectedVersion:current.history.find(g=>g.delegateActorId===manager.actor.id)!.version,revoke:true,actions:['CREATE'],startsOn:bookingVietnamDate(),endsOn:null,reason:'HTTP revoke'})});
    assert.equal(response.status,201);assert.equal((await response.json() as {revoked:boolean}).revoked,true);
  }finally{runtime.set('AUTH_MODE','OPEN_DEMO');}
  pass('Delegation: revoke/assignment removal/explicit deny take effect immediately, another valid delegate remains, leader fallback keeps deadline and historical decisions');
  for(const p of [manager,operator,vendor,leader,outsider])await identity.logout(p.login.session);
}
