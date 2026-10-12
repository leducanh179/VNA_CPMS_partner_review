import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ActorContext, BookingFields, BookingListItem, BookingWorkflowAction } from '@cpms/domain';
import { bookingDeadlines, bookingStepReceivedAt } from '@cpms/domain';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { BookingApplicationService } from '../src/modules/booking/application/booking.application-service';
import { ContractsApplicationService } from '../src/modules/contracts/application/contracts.application-service';
import { ContractManagementApplicationService } from '../src/modules/contracts/application/contract-management.application-service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { generateLocalCredential, hashLocalPassword } from '../src/modules/identity/application/local-auth-security';
import { syntheticSource } from '../src/modules/contracts/domain/supply-fixtures';

/** Authenticated, independently assigned people and persisted workflows in the isolated test database only. */
export async function verifyBookingWorkflow(app:INestApplication,db:PrismaService,admin:ActorContext,pass:(name:string)=>void){
  assert(/^\/cpms_booking_test_\d+$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const service=app.get(BookingApplicationService),contracts=app.get(ContractsApplicationService),management=app.get(ContractManagementApplicationService),identity=app.get(IdentityApplicationService);
  const department=await db.employmentOrgUnit.create({data:{identityKey:'synthetic-booking-workflow',sourceName:'Synthetic Booking',kind:'DEPARTMENT',sourceProvider:'SYNTHETIC'}});
  const person=async(name:string,permissions:string[])=>{
    const code=`SYN-BOOKING-${name}`,email=`booking-${name}@example.test`,password=generateLocalCredential();
    await db.personnelDirectoryEntry.create({data:{employeeCode:code,fullName:name,email,organizationName:'Synthetic Booking',sourceProvider:'SYNTHETIC'}});
    const account=await db.actor.create({data:{key:code,displayName:name,loginEmail:email,accountKind:'PERSONNEL',personnelEmployeeCode:code,employment:{create:{departmentId:department.id}},credential:{create:{passwordHash:await hashLocalPassword(password),mustChangePassword:false}}}});
    for(const permissionCode of permissions)await db.accountPermissionOverride.create({data:{actorId:account.id,permissionCode,scopeType:'MODULE',module:'BOOKING',scopeKey:JSON.stringify(['MODULE','BOOKING',null,null,null]),effect:'ALLOW',relation:'ASSIGNED'}});
    const login=await identity.login(email,password,'127.0.0.1');return {actor:identity.actor(login.session),login};
  };
  const base=['booking.read','booking.create','booking.update','booking.delete','booking.restore','booking.purge','booking.submit','booking.report'];
  const manager=await person('manager',[...base,'booking.approve','booking.report.approve']);
  const vendor=await person('vendor',[...base,'booking.confirm']);
  const operator=await person('operator',['booking.read','booking.approve','booking.report','booking.report.approve']);
  const leader=await person('leader',[...base,'booking.approve','booking.report.approve']);
  const outsider=await person('outsider',[...base,'booking.approve','booking.confirm','booking.report.approve']);
  const pilotEmail=`synthetic-booking-pilot-${randomUUID()}@example.test`,pilotPassword=generateLocalCredential();
  await db.actor.create({data:{key:`synthetic-booking-pilot-${randomUUID()}`,displayName:'Synthetic Pilot Admin',loginEmail:pilotEmail,accountKind:'PILOT_ADMIN',
    credential:{create:{passwordHash:await hashLocalPassword(pilotPassword),mustChangePassword:false}},roles:{create:{roleCode:'ADMIN'}},
    scopedBindings:{create:{roleCode:'ADMIN',scopeType:'SYSTEM',scopeKey:JSON.stringify(['SYSTEM',null,null,null])}}}});
  const pilotLogin=await identity.login(pilotEmail,pilotPassword,'127.0.0.1'),pilotActor=identity.actor(pilotLogin.session);
  assert(pilotLogin.me.directSuperadmin);
  const source=syntheticSource();source.spreadsheetId='synthetic-booking-workflow';
  for(const sheet of source.sheets)for(const row of sheet.rows)for(const cell of row)if(typeof cell.value==='string')cell.value=cell.value.replaceAll('CON-SYN-1','WF-CON').replaceAll('SLOT-SYN-1','WF-SLOT').replace('manager@example.test','booking-manager@example.test');
  const preview=await contracts.importPreview(source,admin),supply=await contracts.importApply(preview.id,{idempotencyKey:randomUUID(),acknowledgeWarnings:true},admin);
  assert.equal(supply.contract.managerActorId,manager.actor.id);
  const allocation=supply.allocations.find(a=>a.sourceKey==='A-1')!;
  for(const a of supply.allocations)await service.configureAllocation({allocationId:a.id,recordVersion:1,ownerDepartmentId:department.id,beneficiaryDepartmentId:department.id,leaderActorIds:[leader.actor.id],operatorActorIds:[operator.actor.id],beneficiaryActorIds:[],vendorActorIds:[vendor.actor.id]},admin);
  const template=await service.configureTemplate({contractId:supply.contract.id,name:'Workflow evidence',definition:{metrics:['impression','linkClick'],conversionDenominator:null,excludedSlotIds:[]}},admin);
  await service.configurePolicy({required:true,expectedVersion:0,reason:'Synthetic mandatory policy'},admin);
  const fields:BookingFields={allocationId:allocation.id,campaignId:null,campaignLabel:'Synthetic workflow campaign',startDate:'2026-09-01',endDate:'2026-09-30',quantity:'10',materialId:null,materialUrl:null,note:'Synthetic only'};
  const get=(id:string,actor=manager.actor)=>service.detail(id,actor).then(r=>r.booking);
  const save=async(actor:ActorContext,quantity:string,submit=false,before?:BookingListItem,patch:Partial<BookingFields>={})=>{
    const result=await service.save({idempotencyKey:randomUUID(),submit,items:[{...(before?{id:before.id,recordVersion:before.recordVersion}:{}),fields:{...fields,quantity,...patch}}]},actor) as {ids:string[]};return get(result.ids[0]!,actor);
  };
  const action=async(row:BookingListItem,actor:ActorContext,action:BookingWorkflowAction,reportId?:string)=>{
    await service.workflow({idempotencyKey:randomUUID(),action,reason:'Synthetic decision',items:[{id:row.id,recordVersion:row.recordVersion,...(reportId?{reportId}:{})}]},actor);return get(row.id,actor);
  };
  const usage=async()=> (await contracts.detail(supply.contract.id,admin)).inventory.rows.find(r=>r.allocationId===allocation.id)!.usage;
  assert((await service.bootstrap(pilotActor)).creatableAllocationIds.includes(allocation.id));
  const pilotContract=await management.workspace(supply.contract.id,pilotActor);
  assert(pilotContract.capabilities.edit&&pilotContract.capabilities.approve&&pilotContract.capabilities.policy);
  assert((await management.catalogs(pilotActor)).people.length>0);
  const pilotDraft=await save(pilotActor,'1');
  assert.equal(pilotDraft.workflow?.status,'DRAFT');
  assert.equal(pilotDraft.createdByActorId,pilotActor.id);
  assert((await get(pilotDraft.id,pilotActor)).workflowActions?.includes('SUBMIT'));
  pass('Direct pilot administrator manages Contracts and creates audited Booking drafts without a personnel assignment');
  let row=await save(vendor.actor,'10');assert.equal(row.workflow?.status,'DRAFT');assert.equal((await usage()).booked.qty,'0');
  await assert.rejects(save(leader.actor,'1'));const operatorDraft=await save(operator.actor,'1');assert.equal(operatorDraft.workflow?.status,'DRAFT');await assert.rejects(save(outsider.actor,'1'));
  assert.equal((await service.bootstrap(leader.actor)).creatableAllocationIds?.length,0);
  row=await action(row,vendor.actor,'SUBMIT');assert.equal(row.workflow?.status,'PENDING_INTERNAL');assert.equal((await usage()).booked.qty,'10');assert.equal((await usage()).approved.qty,'0');assert.equal((await usage()).vendorConfirmed.qty,'10');
  assert((await service.inbox(operator.actor)).items.some(i=>i.id===row.id&&i.canRespond));assert((await service.inbox(manager.actor)).items.some(i=>i.id===row.id&&i.canRespond));assert(!(await service.inbox(leader.actor)).items.some(i=>i.id===row.id&&i.canRespond));
  const stale=row;row=await action(row,operator.actor,'APPROVE');assert.equal(row.workflow?.status,'PENDING_LEADER');await assert.rejects(action(stale,manager.actor,'APPROVE'));await assert.rejects(action(row,vendor.actor,'START'));
  assert.equal(row.workflow?.decisions.at(-1)?.receivedAt,stale.workflow?.submittedAt);
  row=await action(row,leader.actor,'APPROVE');assert.equal(row.workflow?.effective?.quantity,'10');assert.equal((await usage()).approved.qty,'10');
  pass('Vendor route, two pooled reviewers, leader second, scoped creation and stale task rejection');

  const plan={version:1 as const,mode:'CUSTOM' as const,fillRemainder:true,segments:[{startDate:'2026-09-01',endDate:'2026-09-01',quantity:'3'}]};
  row=await save(vendor.actor,'12',false,row,{timeDistribution:plan});assert.equal(row.workflow?.effective?.quantity,'10');assert.equal((await usage()).booked.qty,'10');
  row=await action(row,vendor.actor,'SUBMIT');assert.equal((await usage()).booked.qty,'12');assert.equal((await usage()).approved.qty,'10');
  for(const stage of ['booked','approved'] as const){const analytics=await contracts.analytics(supply.contract.id,{period:'ALL',grain:'MONTH',stage,mode:'CONTIGUOUS',beneficiary:'ALL',slotIds:[],keys:[]},admin);assert.equal(analytics.summaries[0]!.used,stage==='booked'?'12':'10');}
  row=await action(row,manager.actor,'RETURN');assert.equal((await usage()).booked.qty,'10');
  row=await action(row,vendor.actor,'SUBMIT');row=await action(row,manager.actor,'APPROVE');row=await action(row,leader.actor,'APPROVE');assert.equal(row.workflow?.effective?.quantity,'12');
  let internal=await save(manager.actor,'4',true);assert.equal(internal.workflow?.status,'PENDING_VENDOR');
  internal=await save(vendor.actor,'5',true,internal);assert.equal(internal.workflow?.status,'PENDING_INTERNAL');internal=await action(internal,operator.actor,'APPROVE');internal=await action(internal,leader.actor,'APPROVE');assert.equal(internal.workflow?.status,'APPROVED');
  pass('Manager route and Vendor amendments; effective snapshot retained, reservations never doubled, Contract analytics reconciled');

  const report=async(r:BookingListItem,state:string,qty:string,reportId?:string,start='2026-09-01',end='2026-09-07')=>{
    await service.reports({idempotencyKey:randomUUID(),contractId:supply.contract.id,items:[{id:r.id,recordVersion:r.recordVersion,templateId:template.id,state,acceptedQty:qty,periodStart:start,periodEnd:end,...(reportId?{reportId}:{}),values:{impression:'1000',linkClick:'20',fileUrl:'https://example.test/evidence'}}]},vendor.actor);return get(r.id,vendor.actor);
  };
  const assignLeader=async(enabled:boolean)=>{
    const current=(await service.bootstrap(admin)).contracts.find(c=>c.contract.id===supply.contract.id)!.access.find(a=>a.allocationId===allocation.id)!;
    await service.configureAllocation({...current,leaderActorIds:enabled?[leader.actor.id]:[]},admin);
  };
  await assignLeader(false);const beforeMissingLeader=await db.bookingRecord.count();
  await assert.rejects(save(manager.actor,'1',true),/lãnh đạo phòng/);assert.equal(await db.bookingRecord.count(),beforeMissingLeader);
  await assignLeader(true);let direct=await save(manager.actor,'1',true);
  await assert.rejects(action(direct,leader.actor,'APPROVE'));
  await assignLeader(false);await assert.rejects(action(direct,vendor.actor,'CONFIRM'),/lãnh đạo phòng/);
  assert.equal((await get(direct.id)).recordVersion,direct.recordVersion);assert.equal((await get(direct.id)).workflow?.status,'PENDING_VENDOR');
  await assignLeader(true);const beforeConfirm=direct;direct=await action(direct,vendor.actor,'CONFIRM');
  assert.equal(direct.workflow?.status,'PENDING_LEADER');assert.equal(direct.workflow?.effective,null);assert.equal(direct.sourceApprovedQty,null);
  assert.equal(direct.capabilities.report,false);assert(!direct.workflowActions?.includes('START'));
  await assert.rejects(action(direct,vendor.actor,'START'));await assert.rejects(report(direct,'SUBMITTED','1'));
  await assert.rejects(action(direct,manager.actor,'APPROVE'));await assert.rejects(action(direct,operator.actor,'APPROVE'));await assert.rejects(action(beforeConfirm,vendor.actor,'CONFIRM'));
  assert((await service.inbox(leader.actor)).items.some(i=>i.id===direct.id&&i.canRespond));
  assert((await service.inbox(manager.actor)).items.some(i=>i.id===direct.id&&!i.canRespond&&i.section==='FOLLOWING'));
  assert(!(await service.inbox(operator.actor)).items.some(i=>i.id===direct.id&&i.canRespond));
  const confirmationAt=direct.workflow!.decisions.at(-1)!.at;
  assert.equal(bookingStepReceivedAt(direct),confirmationAt);assert.equal(bookingDeadlines(direct)[0]?.dueAt,new Date(Date.parse(confirmationAt)+86400000).toISOString());
  assert.equal((await usage()).booked.qty,'18');assert.equal((await usage()).vendorConfirmed.qty,'18');assert.equal((await usage()).approved.qty,'17');
  for(const stage of ['vendorConfirmed','approved'] as const){const analytics=await contracts.analytics(supply.contract.id,{period:'ALL',grain:'MONTH',stage,mode:'CONTIGUOUS',beneficiary:'ALL',slotIds:[],keys:[]},admin);assert.equal(analytics.summaries[0]!.used,stage==='vendorConfirmed'?'18':'17');}
  direct=await action(direct,leader.actor,'APPROVE');assert.equal(direct.workflow?.status,'APPROVED');assert.equal(direct.workflow?.effective?.quantity,'1');assert.equal(direct.workflow?.decisions.length,2);assert.equal(direct.workflow?.decisions.at(-1)?.receivedAt,confirmationAt);
  assert.equal((await get(direct.id,vendor.actor)).capabilities.report,true);assert.equal((await usage()).approved.qty,'18');
  direct=await save(manager.actor,'2',true,direct);direct=await action(direct,vendor.actor,'CONFIRM');assert.equal(direct.workflow?.effective?.quantity,'1');assert.equal((await usage()).vendorConfirmed.qty,'19');assert.equal((await usage()).approved.qty,'18');
  direct=await action(direct,leader.actor,'REJECT');assert.equal(direct.workflow?.effective?.quantity,'1');assert.equal((await usage()).booked.qty,'18');assert.equal((await usage()).vendorConfirmed.qty,'18');assert.equal((await usage()).approved.qty,'18');
  pass('Manager requests require Vendor then leader, preserve rejection snapshots, hand off a fresh deadline and fail atomically without an eligible leader');

  await assert.rejects(report(row,'ACCEPTED','3'));row=await report(row,'SUBMITTED','3');assert.equal(row.acceptedQty,'0');assert.equal(row.reportState,'PENDING');assert.equal((await usage()).accepted.qty,'0');assert(!(await get(row.id,leader.actor)).workflowActions?.includes('REPORT_APPROVE'));
  await assert.rejects(action(row,leader.actor,'REPORT_APPROVE'));await assert.rejects(service.lifecycle({idempotencyKey:randomUUID(),action:'DELETE',items:[{id:row.id,recordVersion:row.recordVersion}]},vendor.actor));
  const responses=await Promise.allSettled([action(row,manager.actor,'REPORT_APPROVE'),action(row,operator.actor,'REPORT_APPROVE')]);assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
  row=await get(row.id);assert.equal(row.acceptedQty,'3');assert.equal(row.reportState,'ACCEPTED');const periodId=row.reportPeriods![0]!.id;
  row=await report(row,'DRAFT','2',periodId,'2026-09-08','2026-09-14');assert.equal(row.acceptedQty,'3');assert.equal(row.reportPeriods![0]!.approved?.startDate,'2026-09-01');
  await assert.rejects(report(row,'DRAFT','1',undefined,'2026-09-01','2026-09-07'));
  row=await report(row,'SUBMITTED','2',periodId,'2026-09-08','2026-09-14');row=await action(row,operator.actor,'REPORT_RETURN',periodId);assert.equal(row.acceptedQty,'3');row=await report(row,'SUBMITTED','2',periodId,'2026-09-08','2026-09-14');row=await action(row,manager.actor,'REPORT_APPROVE',periodId);assert.equal(row.acceptedQty,'2');
  row=await report(row,'SUBMITTED','3',undefined,'2026-09-15','2026-09-21');row=await action(row,operator.actor,'REPORT_APPROVE');assert.equal(row.acceptedQty,'5');assert.equal((await usage()).accepted.qty,'5');
  const analytic=await contracts.analytics(supply.contract.id,{period:'ALL',grain:'MONTH',stage:'accepted',mode:'CONTIGUOUS',beneficiary:'ALL',slotIds:[],keys:[]},admin);assert.equal(analytic.summaries[0]!.used,'5');
  await assert.rejects(action(row,vendor.actor,'START'));row=await action(row,vendor.actor,'FINISH');assert.equal((await usage()).booked.qty,'11');
  await assert.rejects(service.lifecycle({idempotencyKey:randomUUID(),action:'PAUSE',items:[{id:row.id,recordVersion:row.recordVersion}]},vendor.actor));
  pass('Report approval requires either reviewer, keeps approved corrections, validates periods, and releases unused quantity on completion');

  let pending=await save(vendor.actor,'1',true);await service.configurePolicy({required:false,expectedVersion:1,reason:'Synthetic optional policy'},admin);
  assert.equal((await get(pending.id)).workflow?.required,true);pending=await action(pending,manager.actor,'APPROVE');pending=await action(pending,leader.actor,'APPROVE');assert.equal(pending.workflow?.policyVersion,1);
  const automatic=await save(vendor.actor,'1');assert.equal(automatic.workflow?.status,'APPROVED');assert.equal(automatic.workflow?.route,'AUTO');await assert.rejects(save(leader.actor,'1'));await assert.rejects(service.configurePolicy({required:true,expectedVersion:1,reason:'Stale policy'},admin));
  const draftReport=await report(automatic,'SUBMITTED','1');assert.equal(draftReport.reportState,'PENDING');assert.equal(draftReport.acceptedQty,'0');
  const before=await db.bookingRecord.count();const forged=await fetch(`${await app.getUrl()}/api/bookings/batch-save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:randomUUID(),items:[{fields:{...fields,workflow:{status:'APPROVED'}}}]})});assert.equal(forged.status,400);assert.equal(await db.bookingRecord.count(),before);
  const vendorCookie={Cookie:`cpms_session=${vendor.login.token}`};const inbox=await fetch(`${await app.getUrl()}/api/bookings/inbox`,{headers:vendorCookie});assert.equal(inbox.status,200);
  assert.equal(row.reportPeriods?.[0]?.decisions?.length,3);assert.equal(row.reportPeriods?.[0]?.submissions?.length,3);
  const closing=await save(vendor.actor,'1',false,undefined,{startDate:'2026-09-01',endDate:'2026-09-01'});
  assert((await service.inbox(vendor.actor)).items.some(i=>i.id===closing.id&&i.reportDue&&i.section==='PENDING'));
  await report(closing,'SUBMITTED','0',undefined,'2026-09-01','2026-09-01');
  assert(!(await service.inbox(vendor.actor)).items.some(i=>i.id===closing.id&&i.reportDue));
  const closingAfter=await get(closing.id);assert.equal(closingAfter.acceptedQty,'0');assert.equal(closingAfter.reportPeriods?.[0]?.submissions?.length,1);
  assert((await service.inbox(operator.actor)).items.some(i=>i.id===closing.id&&i.canRespond));
  pass('Persisted handoff and report submission/decision clocks; Vendor closing-report inbox transfers to pooled report reviewers');
  const gates={CREATE:false,EDIT:true,DELETE:true,RESTORE:true,PAUSE:true,RESUME:false};
  await service.configurePolicy({required:true,actions:gates,expectedVersion:2,reason:'Per-operation test'},admin);
  let operated=await save(manager.actor,'1',true);assert.equal(operated.workflow?.status,'APPROVED');
  operated=await save(manager.actor,'2',false,operated);assert.equal(operated.workflow?.status,'DRAFT');assert.equal(operated.workflow?.effective?.quantity,'1');
  operated=await action(operated,manager.actor,'SUBMIT');operated=await action(operated,vendor.actor,'CONFIRM');operated=await action(operated,leader.actor,'APPROVE');
  const lifecycle=async(kind:string)=>{const r=await get(operated.id);await service.lifecycle({idempotencyKey:randomUUID(),action:kind,items:[{id:r.id,recordVersion:r.recordVersion}]},manager.actor);operated=await get(r.id);};
  const heldBefore=(await usage()).booked.qty;
  await lifecycle('PAUSE');assert.equal(operated.state,'ACTIVE');assert.equal(operated.lifecycleRequest?.status,'PENDING');
  assert.equal((await usage()).booked.qty,heldBefore);
  assert((await service.inbox(leader.actor)).items.some(i=>i.id===operated.id&&i.canRespond));
  await assert.rejects(action(operated,manager.actor,'LIFECYCLE_APPROVE'));
  await assert.rejects(save(manager.actor,'3',false,operated));
  operated=await action(operated,leader.actor,'LIFECYCLE_APPROVE');assert.equal(operated.state,'PAUSED');
  await lifecycle('RESUME');assert.equal(operated.state,'ACTIVE');assert.notEqual(operated.lifecycleRequest?.status,'PENDING');
  await lifecycle('DELETE');assert.equal(operated.deletedAt,null);assert.equal((await usage()).booked.qty,heldBefore);
  const staleOperation=operated;
  await service.configurePolicy({required:false,expectedVersion:3,reason:'Toggle does not resolve pending request'},admin);
  assert.equal((await get(operated.id)).lifecycleRequest?.policyVersion,3);
  operated=await action(operated,leader.actor,'LIFECYCLE_RETURN');assert.equal(operated.deletedAt,null);
  await assert.rejects(action(staleOperation,leader.actor,'LIFECYCLE_APPROVE'));
  await service.configurePolicy({required:true,actions:gates,expectedVersion:4,reason:'Restore gated actions'},admin);
  await lifecycle('DELETE');operated=await action(operated,leader.actor,'LIFECYCLE_APPROVE');assert(operated.deletedAt);
  await lifecycle('RESTORE');assert(operated.deletedAt);assert((await service.inbox(leader.actor)).items.some(i=>i.id===operated.id&&i.canRespond));
  assert(bookingDeadlines(operated).some(d=>d.id==='lifecycle-approval'&&!d.completedAt));
  operated=await action(operated,manager.actor,'LIFECYCLE_WITHDRAW');assert(operated.deletedAt);
  await lifecycle('RESTORE');operated=await action(operated,leader.actor,'LIFECYCLE_APPROVE');assert.equal(operated.deletedAt,null);
  assert.equal((await usage()).booked.qty,heldBefore);
  const malformed=await fetch(`${await app.getUrl()}/api/bookings/policy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({required:true,actions:{CREATE:false},expectedVersion:5,reason:'Incomplete gates'})});assert.equal(malformed.status,400);
  pass('Per-action policy persists; create/edit differ; lifecycle queue preserves state/holds, enforces leader, stale versions, returns, withdraws, deleted restore inbox and policy snapshots');
  for(const p of [manager,vendor,operator,leader,outsider])await identity.logout(p.login.session);
  await identity.logout(pilotLogin.session);
  pass('Optional policy preserves pending routes, never bypasses creator scope or report approval; authenticated inbox and strict HTTP schema');
}
