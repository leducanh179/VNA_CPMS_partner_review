import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { LookupProvider } from '@cpms/ai-contracts';
import { AiWorkspaceApplicationService } from '../src/modules/ai/application/workspace.application-service';
import { WorkspaceRepository } from '../src/modules/ai/application/workspace.repository';
import { LookupApplicationService } from '../src/modules/ai/application/lookup.application-service';
import { LookupProviderFactory } from '../src/modules/ai/application/lookup-provider.factory';
import { GoogleIntegrationApplicationService } from '../src/modules/google-integration/application/google-integration.application-service';
import { CampaignWorkflowApplicationService } from '../src/modules/campaign-workflow/application/campaign-workflow.application-service';
import { ScopedCampaignApplicationService } from '../src/modules/campaign/application/scoped-campaign.application-service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { DEFAULT_AI_POLICY } from '../src/modules/ai/domain/workspace-policy';
import { EMPTY_USAGE } from '../src/modules/ai/domain/lookup-policy';

/** Runs only inside ai-lookup.integration's disposable database. No live credentials or provider calls. */
export async function checkAiWorkspace(app: INestApplication, owner: ActorContext, pilot: ActorContext, other: ActorContext, campaignId: string, departmentId: string) {
  const db=app.get(PrismaService), service=app.get(AiWorkspaceApplicationService), lookup=app.get(LookupApplicationService);
  const factory=app.get(LookupProviderFactory), originalFactory=factory.create, google=app.get(GoogleIntegrationApplicationService), originalRead=google.readAiLibrary;
  const workflow=app.get(CampaignWorkflowApplicationService), campaigns=app.get(ScopedCampaignApplicationService);
  const checks:string[]=[]; const pass=(s:string)=>{checks.push(s);console.log('PASS '+s);};
  const ask=(question:string,previousId:string|null=null,conversationId:string|null=null)=>lookup.ask(pilot,{id:randomUUID(),question,previousId,conversationId});
  const header=Array.from({length:27},()=> '');
  for(const [i,label] of [[1,'Tên đầy đủ'],[8,'Link'],[13,'Root Folder ID'],[14,'Item ID'],[16,'Scope Key'],[17,'Trạng thái'],[25,'Hiệu lực sử dụng']] as const)header[i]=label;
  const file=(id:string,rights:string)=>{const row=Array.from({length:27},()=> '');Object.assign(row,{0:'File',1:'Máy bay Đà Nẵng.jpg',2:'JPG',3:'Thư viện mẫu/Đà Nẵng',8:`https://drive.google.com/file/d/${id}/view`,13:'root-synthetic-001',14:id,16:`root-synthetic-001|${id}`,17:'ACTIVE',20:'21/08/2026',25:rights});return row;};
  const provider=(answer:LookupProvider['answer'])=>{factory.create=async()=>({answer});};
  try {
    await assert.rejects(service.settings(pilot)); await assert.rejects(service.settings(other));
    let settings=await service.settings(owner);
    const policy={...DEFAULT_AI_POLICY,libraryEnabled:true,spreadsheetId:'sheet-synthetic-001',instructions:'Ưu tiên trả lời gọn và dùng link gốc.'};
    settings=await service.saveDraft(owner,{expectedVersion:settings.draftVersion,policy});
    await assert.rejects(service.saveDraft(owner,{expectedVersion:0,policy}));
    assert.equal((await service.activePolicy()).policy.libraryEnabled,false);
    settings=await service.publish(owner,{expectedVersion:settings.draftVersion});
    google.readAiLibrary=async()=>({name:'DriveIndex',rows:[header,file('synthetic-file-001','Chưa có thông tin'),file('synthetic-file-002','Hết hiệu lực')]});
    settings=await service.sync(owner);assert.equal(settings.library.count,2);
    const beforeSnapshot=await app.get(WorkspaceRepository).library();
    google.readAiLibrary=async()=>({name:'DriveIndex',rows:[['Wrong header'],file('bad','')]});
    await assert.rejects(service.sync(owner));assert.deepEqual(await app.get(WorkspaceRepository).library(),beforeSnapshot);
    provider(async input=>{const result=await input.execute('search_library',{query:'da nang',mediaType:'PHOTO'});
      assert.equal(result.sources.length,0); // Exact href is already in each model item; avoid a duplicate payload.
      const items=result.content.items as Array<{href:string}>;assert.equal(items.length,1);assert(items[0]!.href.includes('synthetic-file-001'));
      return {answer:'Một tư liệu từ chỉ mục, chưa xem ảnh.',usage:EMPTY_USAGE()};});
    const library=await ask('Tìm ảnh Đà Nẵng');assert.equal(library.artifacts?.library?.length,1);assert.equal(library.sources[0]?.kind,'LIBRARY');
    await assert.rejects(service.search(other,{query:'',mediaType:'ANY'}));
    settings=await service.saveDraft(owner,{expectedVersion:settings.draftVersion,policy:{...policy,libraryEnabled:false}});settings=await service.publish(owner,{expectedVersion:settings.draftVersion});
    assert.equal((await lookup.conversation(pilot,library.conversationId)).items[0]?.state,'REDACTED');
    settings=await service.publish(owner,{expectedVersion:settings.draftVersion,rollbackVersion:1});assert.equal(settings.published.libraryEnabled,true);
    pass('Admin-only draft/publish/rollback; source validation preserves snapshot; expired file excluded; disabled library redacts historical results');
    provider(async input=>{await input.execute('ask_library_questions',{questions:[{question:'Dùng cho kênh nào?',options:['Web','In ấn']}]});return {answer:'Chọn mục đích sử dụng.',usage:EMPTY_USAGE()};});
    const q1=await ask('Cần tư liệu'),q2=await ask('Web',q1.id,q1.conversationId);assert.equal(q2.artifacts?.clarificationCount,2);
    await assert.rejects(ask('Cho tư vấn tiếp',q2.id,q2.conversationId));
    pass('Clarification budget is enforced by server across consecutive turns');
    for(const permission of ['campaign.update','campaign.submit'])await db.accountPermissionOverride.create({data:{actorId:pilot.id,permissionCode:permission,effect:'ALLOW',scopeType:'RECORD',module:'CAMPAIGN',campaignId,scopeKey:JSON.stringify(['RECORD','CAMPAIGN',null,campaignId,null])}});
    await workflow.initialize(owner,departmentId,false);
    await db.campaignLevel.upsert({where:{code:'CLV_02'},create:{code:'CLV_02',label:'Cấp 2',ruleDescription:'Synthetic',displayOrder:2},update:{}});
    await db.campaign.update({where:{id:campaignId},data:{levelCode:'CLV_02'}});
    let nextName='AI tên mới';
    provider(async input=>{await input.execute('get_campaign',{id:campaignId});await input.execute('prepare_campaign_update',{id:campaignId,reason:'Theo nội dung người dùng thử nghiệm',changes:[{field:'name',value:nextName}]});return {answer:'Đã tạo đề xuất, cần bạn xác nhận.',usage:EMPTY_USAGE()};});
    const before=await db.campaign.findUniqueOrThrow({where:{id:campaignId}});
    const prepared=await ask('Đổi tên hồ sơ thành AI tên mới');assert(prepared.artifacts?.proposalId);
    assert.equal((await db.campaign.findUniqueOrThrow({where:{id:campaignId}})).name,before.name);
    await assert.rejects(service.confirm(other,prepared.artifacts.proposalId,{action:'SAVE',confirmed:true}));
    await assert.rejects(service.confirm(pilot,prepared.artifacts.proposalId,{action:'SAVE'}));
    const revised=await service.revise(pilot,prepared.artifacts.proposalId,[{field:'name',value:'Tên đã hiệu chỉnh'}]);
    await assert.rejects(service.confirm(pilot,prepared.artifacts.proposalId,{action:'SAVE',confirmed:true}));
    assert.equal((await lookup.conversation(pilot,prepared.conversationId)).items[0]?.artifacts?.proposalId,revised.id);
    const saved=await service.confirm(pilot,revised.id,{action:'SAVE',confirmed:true});assert.equal(saved.state,'SAVED');
    const persisted=await db.campaign.findUniqueOrThrow({where:{id:campaignId}});assert.equal(persisted.name,'Tên đã hiệu chỉnh');
    await service.confirm(pilot,revised.id,{action:'SAVE',confirmed:true});assert.equal((await db.campaign.findUniqueOrThrow({where:{id:campaignId}})).recordVersion,persisted.recordVersion);
    nextName='Đề xuất xung đột';const stale=await ask('Đổi tên');assert(stale.artifacts?.proposalId);
    await campaigns.update(campaignId,{name:'Người khác vừa sửa',expectedVersion:persisted.recordVersion},owner);
    await assert.rejects(service.confirm(pilot,stale.artifacts.proposalId,{action:'SAVE',confirmed:true}));
    nextName='Đề xuất mất quyền';const revoked=await ask('Đổi tên');assert(revoked.artifacts?.proposalId);
    await db.accountPermissionOverride.updateMany({where:{actorId:pilot.id,permissionCode:'campaign.update',campaignId},data:{effect:'DENY'}});
    await assert.rejects(service.confirm(pilot,revoked.artifacts.proposalId,{action:'SAVE',confirmed:true}));
    await db.accountPermissionOverride.updateMany({where:{actorId:pilot.id,permissionCode:'campaign.update',campaignId},data:{effect:'ALLOW'}});
    pass('Preparation does not persist business data; edited proposal supersedes old card; confirmation enforces owner, explicit choice, version, permissions and idempotency');
    nextName='Đề xuất gửi duyệt';const submit=await ask('Đổi tên và gửi Ban TT');assert(submit.artifacts?.proposalId);
    const oldCommand=workflow.command;
    const beforeFailure=await db.campaign.findUniqueOrThrow({where:{id:campaignId}});
    workflow.command=async()=>{throw new Error('Synthetic submission failure');};
    try{await assert.rejects(service.confirm(pilot,submit.artifacts.proposalId,{action:'SAVE_AND_SUBMIT',confirmed:true}));}
    finally{workflow.command=oldCommand;}
    assert.deepEqual(await db.campaign.findUniqueOrThrow({where:{id:campaignId}}),beforeFailure);
    const submitted=await service.confirm(pilot,submit.artifacts.proposalId,{action:'SAVE_AND_SUBMIT',confirmed:true});assert.equal(submitted.state,'SUBMITTED');
    const wf=await workflow.read(pilot,campaignId);assert(wf.revision);assert.equal(wf.revision.receivingDepartmentId,departmentId);assert.notEqual(wf.revision.state,'APPROVED');
    const receiptCount=await db.campaignWorkflowCommand.count({where:{campaignId}});
    await service.confirm(pilot,submit.artifacts.proposalId,{action:'SAVE_AND_SUBMIT',confirmed:true});assert.equal(await db.campaignWorkflowCommand.count({where:{campaignId}}),receiptCount);
    const audits=await db.auditEvent.findMany({where:{entityId:submit.artifacts.proposalId,action:'ai.proposal.confirmed'}});assert.equal(audits.length,1);assert.equal(audits[0]?.actorId,pilot.id);
    await lookup.deleteConversation(pilot,submit.conversationId);await assert.rejects(service.proposal(pilot,submit.artifacts.proposalId));
    pass('Save + submit roll back together on failure, route to Ban TT without auto-approval, record the real actor once, and remove private proposals with chat deletion');
  } finally {factory.create=originalFactory;google.readAiLibrary=originalRead;}
  return checks;
}
