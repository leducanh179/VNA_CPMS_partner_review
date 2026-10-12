import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { QcttPlanApplicationService } from '../../qctt-plan/application/qctt-plan.application-service';
import type { AccessPermission, AccessResource, ActorContext, BookingAllocationAccess, BookingBatchItem, BookingBootstrap, BookingCheck, BookingContext, BookingListItem, BookingTemplate, BookingView, SupplyAggregate } from '@cpms/domain';
import { BOOKING_METRICS, automaticBookingDistribution, formatSupplyPeriod, type BookingImpact, type SupplyInventory } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractsRepository } from '../../contracts/application/contracts.repository';
import { buildInventory, decimal, numeric } from '../../contracts/domain/supply-engine';
import { BookingRepository } from './booking.repository';
import { bookingBatch, bookingLifecycle, bookingReport } from './booking.commands';
import { calculateBookingReport, checkBookingLimits, priceBooking } from '../domain/booking-engine';
import { bookingEffective, bookingPending, bookingSnapshot, bookingReportPeriods, bookingApprovalLabels, bookingExecutionAsOf, bookingPlanDays, bookingStepReceivedAt, bookingDeadlines, type BookingPolicy, type BookingReportPeriod } from '@cpms/domain';
import { availableBookingActions, bookingResponsibilities, proposalWorkflow } from '../domain/booking-workflow';
import { bookingWorkflowCommand } from './booking.commands';
import { BookingConsumptionProvider, projectBookingConsumption } from '../infrastructure/booking-consumption.provider';
import { contractBookingSnapshot } from '@cpms/domain';
import { BOOKING_APPROVAL_OPERATIONS, bookingApprovalRequired, bookingOperationLabels, type BookingAction, type BookingApprovalActions } from '@cpms/domain';
import { activeBookingDelegation, bookingDelegationSnapshot, bookingRequestDelegations } from '@cpms/domain';

const parse=<T>(schema:z.ZodType<T>,input:unknown)=>{const result=schema.safeParse(input);if(!result.success)throw new BadRequestException(result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return result.data;};
const distinct=(ids:string[])=>{if(new Set(ids).size!==ids.length)throw new BadRequestException('Một booking không được xuất hiện hai lần trong cùng thao tác.');};
const sumIds=(a:BookingAllocationAccess|undefined)=>a?[...a.leaderActorIds,...a.operatorActorIds,...a.beneficiaryActorIds,...a.vendorActorIds]:[];
@Injectable()
export class BookingApplicationService {
  constructor(@Inject(BookingRepository) private readonly repository:BookingRepository,
    @Inject(ContractsRepository) private readonly contracts:ContractsRepository,
    @Inject(AccessApplicationService) private readonly access:AccessApplicationService,
    @Inject(BookingConsumptionProvider) private readonly consumption:BookingConsumptionProvider,
    @Inject(QcttPlanApplicationService) private readonly plans:QcttPlanApplicationService){}
  private async contexts():Promise<BookingContext[]>{
    const [contracts,assignments,templates,delegations]=await Promise.all([this.contracts.list(),this.repository.allocationAccess(),this.repository.templates(),this.repository.delegations()]);
    const all=await Promise.all(contracts.map(c=>this.contracts.get(c.id)));
    return all.filter((c):c is SupplyAggregate=>Boolean(c)).map(c=>({...c,approvalDelegations:[...new Map(delegations.filter(g=>g.contractId===c.contract.id).reverse().map(g=>[g.delegateActorId,g])).values()],access:assignments.filter(a=>c.allocations.some(l=>l.id===a.allocationId)),templates:templates.filter(t=>t.contractId===c.contract.id)}));
  }
  private resource(row:Pick<BookingView,'id'|'allocationId'|'createdByActorId'|'state'|'deletedAt'|'workflow'|'lifecycleRequest'>,ctx:BookingContext):AccessResource{
    const assignment=ctx.access.find(a=>a.allocationId===row.allocationId);
    const effectiveAssignment=ctx.access.find(a=>a.allocationId===row.workflow?.effective?.allocationId);
    return {type:'BOOKING',id:row.id,exists:true,deleted:Boolean(row.deletedAt),pendingBookingRestoreReview:row.lifecycleRequest?.status==='PENDING'&&row.lifecycleRequest.action==='RESTORE',createdByActorId:row.createdByActorId,state:row.state,
      bookingOperators:assignment?.operatorActorIds.filter(id=>!assignment.leaderActorIds.includes(id))??[],
      assignedActorIds:[ctx.contract.managerActorId,...sumIds(assignment),...sumIds(effectiveAssignment)].filter((v):v is string=>Boolean(v)),
      orgIds:[assignment?.ownerDepartmentId,assignment?.beneficiaryDepartmentId].filter((v):v is string=>Boolean(v))};
  }
  private allowed(permission:AccessPermission,row:Pick<BookingView,'id'|'allocationId'|'createdByActorId'|'state'|'deletedAt'|'workflow'>,ctx:BookingContext){return this.access.check(permission,this.resource(row,ctx)).allowed;}
  private require(permission:AccessPermission,row:Pick<BookingView,'id'|'allocationId'|'createdByActorId'|'state'|'deletedAt'|'workflow'>,ctx:BookingContext){this.access.require(permission,this.resource(row,ctx));}
  private allocationRow(id:string){return{id,allocationId:id,createdByActorId:'',state:'ACTIVE' as const,deletedAt:null};}
  private contextFor(id:string,contexts:BookingContext[]){const ctx=contexts.find(c=>c.contract.id===id);if(!ctx)throw new NotFoundException('Không tìm thấy hợp đồng trong phạm vi được phép.');return ctx;}
  private responsibilities(ctx:BookingContext,allocationId:string){
    const roles=bookingResponsibilities(ctx,allocationId,this.access.snapshot().actor.id);
    const identity=this.access.snapshot().identity;
    return identity.effectiveSuperadmin&&identity.mode==='DIRECT'?{...roles,manager:true,creator:true,reviewer:true}:roles;
  }
  private item(row:BookingView,ctx:BookingContext):BookingListItem{
    const a=ctx.allocations.find(a=>a.id===row.allocationId)!;
    const roles=this.responsibilities(ctx,row.allocationId);
    const effective=bookingEffective(row), reportRoles=this.responsibilities(ctx,effective?.allocationId??row.allocationId);
    const reportRow={...row,...effective,workflow:null};
    const approvalDelegations=bookingRequestDelegations(row,ctx), delegated=approvalDelegations.some(g=>g.delegateActorId===this.access.snapshot().actor.id);
    const workflowActions=availableBookingActions(row,roles,p=>this.allowed(p as AccessPermission,p.startsWith('booking.report')?reportRow:row,ctx),this.access.snapshot().actor.id,reportRoles,delegated);
    return {...row,execution:bookingExecutionAsOf(row),source:{},contractName:row.contractSnapshot?.contract.name??ctx.contract.name,slotName:row.contractSnapshot?.slotName??ctx.slots.find(s=>s.id===row.slotId)?.name??'',periodName:row.contractSnapshot?.periodName??formatSupplyPeriod(ctx.periods.find(p=>p.id===a.periodId)!),beneficiaryLabel:a.beneficiaryLabel,
      reportPeriods:bookingReportPeriods(row),workflowActions,approvalDelegations,canApproveByDelegation:delegated&&workflowActions.some(a=>['APPROVE','LIFECYCLE_APPROVE'].includes(a)),
      capabilities:Object.fromEntries(['update','delete','restore','purge','report'].map(k=>[k,this.allowed(`booking.${k}` as AccessPermission,k==='report'?reportRow:row,ctx)&&row.lifecycleRequest?.status!=='PENDING'&&(k==='update'?roles.creator&&!['FINISHED','CANCELLED'].includes(row.execution??'')&&(!bookingPending(row)||row.workflow?.status==='PENDING_VENDOR'&&roles.vendor):k==='report'?Boolean(effective)&&(reportRoles.vendor||reportRoles.reviewer):roles.creator)])) as BookingListItem['capabilities']};
  }
  async bootstrap(actor?:ActorContext):Promise<BookingBootstrap>{return this.access.run(actor,async()=>{
    const [contexts,catalog,visibleCampaigns]=await Promise.all([this.contexts(),this.repository.catalog(),this.access.visibleCampaignIds()]);
    const out:BookingContext[]=[];const personIds=new Set<string>();
    for(const ctx of contexts){
      const allocations=ctx.allocations.filter(a=>!a.supersededAt&&a.scopeKind==='ENTITLEMENT'&&this.allowed('booking.read',this.allocationRow(a.id),ctx));
      if(!allocations.length)continue;
      for(const a of allocations)this.require('booking.read',this.allocationRow(a.id),ctx);
      const access=ctx.access.filter(a=>allocations.some(l=>l.id===a.allocationId));for(const a of access)sumIds(a).forEach(id=>personIds.add(id));if(ctx.contract.managerActorId)personIds.add(ctx.contract.managerActorId);
      const inventory=await buildInventory(ctx,this.consumption,new Date().toISOString());
      out.push({...ctx,approvalDelegations:[],contract:{...ctx.contract,source:{},signedAmount:null,signedVat:null,signedGross:null},allocations:allocations.map(a=>({...a,source:{}})),
        slots:ctx.slots.filter(s=>allocations.some(a=>a.slotId===s.id)).map(s=>({...s,source:{}})),access,
        adjustments:ctx.adjustments.map(g=>({...g,source:{},lines:g.lines.filter(l=>allocations.some(a=>a.id===l.allocationId))})).filter(g=>g.lines.length),
        inventory:{...inventory,rows:inventory.rows.filter(r=>allocations.some(a=>a.id===r.allocationId)),amountTotals:{baseline:null,effective:null,remaining:null,used:null},quantityTotals:[]}});
    }
    if(!out.length)this.access.require('booking.read');
    const creatable=out.flatMap(c=>c.allocations.filter(a=>this.responsibilities(c,a.id).creator&&this.allowed('booking.create',this.allocationRow(a.id),c)).map(a=>{this.require('booking.create',this.allocationRow(a.id),c);return a.id;}));
    const planning=creatable.length?await this.plans.bookingCatalog():{campaigns:[],targets:{}};
    return {workflowPolicy:await this.repository.policy(),creatableAllocationIds:creatable,contracts:out,planTargets:planning.targets,campaigns:[...planning.campaigns,...catalog.campaigns.filter(c=>visibleCampaigns.includes(c.id)&&!planning.campaigns.some(p=>p.id===c.id))],people:catalog.people.filter(p=>this.access.check('booking.manage').allowed||personIds.has(p.id)),departments:catalog.departments,
      materials:this.access.check('material.read').allowed?catalog.materials:[],canManage:this.access.check('booking.manage').allowed};
  });}
  async list(query:{trash?:string;contractId?:string;campaignId?:string}={},actor?:ActorContext){return this.access.run(actor,async()=>{
    const contexts=await this.contexts();const visible=contexts.filter(c=>c.allocations.some(a=>this.allowed('booking.read',this.allocationRow(a.id),c)));
    if(!visible.length)this.access.require('booking.read');
    const rows=await this.repository.all(visible.map(c=>c.contract.id));
    return rows.filter(r=>Boolean(r.deletedAt)===(query.trash==='true')&&(!query.contractId||r.contractId===query.contractId)&&(!query.campaignId||r.campaignId===query.campaignId)).flatMap(r=>{
      const ctx=this.contextFor(r.contractId,contexts);if(!this.allowed('booking.read',r,ctx))return[];this.require('booking.read',r,ctx);return[this.item(r,ctx)];
    });
  });}
  async detail(id:string,actor?:ActorContext){return this.access.run(actor,async()=>{
    if(!z.string().uuid().safeParse(id).success)throw new NotFoundException('Không tìm thấy booking.');
    const [row]=await this.repository.get([id]);if(!row)throw new NotFoundException('Không tìm thấy booking.');
    const ctx=this.contextFor(row.contractId,await this.contexts());if(!this.allowed('booking.read',row,ctx))throw new NotFoundException('Không tìm thấy booking.');this.require('booking.read',row,ctx);
    return{booking:this.item(row,ctx),history:await this.repository.history(id),templates:ctx.templates};
  });}
  async policy(actor?:ActorContext){return this.access.run(actor,async()=>{this.access.require('booking.policy.manage');return this.repository.policy();});}
  async configurePolicy(input:unknown,actor?:ActorContext){const value=parse(z.object({required:z.boolean(),actions:z.object(Object.fromEntries(BOOKING_APPROVAL_OPERATIONS.map(k=>[k,z.boolean()])) as Record<typeof BOOKING_APPROVAL_OPERATIONS[number],z.ZodBoolean>).strict().optional(),expectedVersion:z.number().int().min(0),reason:z.string().trim().min(1).max(2000)}).strict(),input);return this.access.run(actor,async()=>{this.access.require('booking.policy.manage');return this.repository.savePolicy(value.actions?Object.values(value.actions).some(Boolean):value.required,value.expectedVersion,value.reason,this.access.snapshot().actor,value.actions as BookingApprovalActions|undefined);});}
  private validateReportCommitments(row:BookingView){
    const effective=bookingEffective(row);if(!effective)return;
    const periods=bookingReportPeriods(row);
    if(periods.reduce((sum,r)=>sum.plus(decimal(r.quantity).gt(r.approved?.quantity??'0')?r.quantity:r.approved?.quantity??'0'),decimal(0)).gt(effective.quantity))throw new BadRequestException('Số lượng báo cáo đã duyệt hoặc đang điều chỉnh vượt lượng đặt đã duyệt.');
    for(const period of periods)for(const value of [period,period.approved])if(value?.startDate&&value.endDate&&(value.startDate<effective.startDate||value.endDate>effective.endDate))throw new BadRequestException('Lịch đặt chỗ phải bao gồm các kỳ báo cáo đã ghi nhận.');
    for(let i=0;i<periods.length;i++)for(let j=i+1;j<periods.length;j++)for(const a of [periods[i]!,periods[i]!.approved])for(const b of [periods[j]!,periods[j]!.approved])if(a&&b&&(!a.startDate||!b.startDate||a.startDate<=b.endDate!&&a.endDate!>=b.startDate))throw new BadRequestException('Kỳ báo cáo chồng lấn với kỳ đã duyệt hoặc đang điều chỉnh.');
  }
  private async submitted(row:BookingView,ctx:BookingContext,policy:BookingPolicy):Promise<BookingView>{
    await this.plans.resolveBooking(row,row,ctx,false);
    if (row.workflow?.status === 'APPROVED') return row;
    policy = { ...policy, required: bookingApprovalRequired(policy, bookingEffective(row) ? 'EDIT' : 'CREATE') };
    if (row.lifecycleRequest?.status === 'PENDING') throw new BadRequestException('Xử lý đề nghị thao tác đang chờ trước khi gửi sửa đặt chỗ.');
    const actor=this.access.snapshot().actor;const roles=this.responsibilities(ctx,row.allocationId);
    if(!roles.creator)throw new BadRequestException('Chỉ CV phụ trách HĐ, CV khai thác slot hoặc Vendor được phân công mới được gửi đặt chỗ.');
    this.require('booking.submit',row,ctx);
    const origin=roles.vendor?'VENDOR':'MANAGER';const w=row.workflow??proposalWorkflow(null,row,policy,origin);
    const assignment=ctx.access.find(a=>a.allocationId===row.allocationId);
    if(policy.required){
      const resource=this.resource(row,ctx);
      await this.requireLeaderRecipient(row,ctx);
      if(origin==='VENDOR'){
        const internal=[ctx.contract.managerActorId,...(assignment?.operatorActorIds??[])].filter((id):id is string=>Boolean(id)&&bookingResponsibilities(ctx,row.allocationId,id!).reviewer);
        if(!(await this.access.eligibleBookingAssignees(resource,'booking.approve',internal)).length)throw new BadRequestException('Cần phân công người duyệt nội bộ có tài khoản hoạt động, quyền xem và duyệt slot.');
      }else if(!(await this.access.eligibleBookingAssignees(resource,'booking.confirm',assignment?.vendorActorIds??[])).length)throw new BadRequestException('Cần phân công Vendor có tài khoản hoạt động, quyền xem và xác nhận slot.');
    }
    const delegations=policy.required?(ctx.approvalDelegations??[]).filter(g=>activeBookingDelegation(g,ctx,bookingEffective(row)?'EDIT':'CREATE',Date.now(),row.allocationId)).map(bookingDelegationSnapshot):[];
    const workflow={...w,delegations,origin,route:policy.required?origin:'AUTO',status:policy.required?(origin==='VENDOR'?'PENDING_INTERNAL':'PENDING_VENDOR'):'APPROVED',required:policy.required,policyVersion:policy.version,requestVersion:w.requestVersion+1,submittedBy:actor.id,submittedAt:new Date().toISOString(),reason:'',decisions:w.decisions,effective:policy.required?w.effective:bookingSnapshot(row)} as NonNullable<BookingView['workflow']>;
    return {...row,workflow,sourceApprovedQty:workflow.status==='APPROVED'?row.quantity:row.sourceApprovedQty};
  }
  private async requireLeaderRecipient(row:BookingView,ctx:BookingContext){
    const leaders=ctx.access.find(a=>a.allocationId===row.allocationId)?.leaderActorIds??[];
    if(!(await this.access.eligibleBookingAssignees(this.resource(row,ctx),'booking.approve',leaders)).length)throw new BadRequestException('Cần phân công lãnh đạo phòng có tài khoản hoạt động, quyền xem và duyệt slot.');
  }
  async inbox(actor?:ActorContext){return this.access.run(actor,async()=>{
    const contexts=await this.contexts(), who=this.access.snapshot().actor.id;const rows=await this.repository.all();
    const items=rows.filter(r=>!r.deletedAt||r.lifecycleRequest?.status==='PENDING').flatMap(row=>{const ctx=this.contextFor(row.contractId,contexts);if(!this.allowed('booking.read',row,ctx))return [];
      const item=this.item(row,ctx);const roles=this.responsibilities(ctx,bookingEffective(row)?.allocationId??row.allocationId);
      const reportDue=roles.vendor&&item.capabilities.report&&bookingDeadlines(row).some(t=>t.kind==='REPORT_SUBMISSION'&&['ON_TIME','OVERDUE'].includes(t.state));
      const pending=reportDue||item.workflowActions?.some(a=>['APPROVE','CONFIRM','RETURN','REPORT_APPROVE','REPORT_RETURN','LIFECYCLE_APPROVE'].includes(a));
      const following=row.createdByActorId===who||row.workflow?.submittedBy===who||row.lifecycleRequest?.requestedBy===who||row.reportPeriods?.some(r=>r.submittedBy===who);
      return pending||following?[{id:row.id,section:pending?'PENDING':'FOLLOWING',booking:item,canRespond:Boolean(pending),reportDue,label:row.lifecycleRequest?.status==='PENDING'?`Chờ ${item.approvalDelegations?.length?'CV được ủy quyền / LĐP':'LĐP'} duyệt ${bookingOperationLabels[row.lifecycleRequest.action].toLocaleLowerCase('vi-VN')}`:reportDue?'Cần nộp báo cáo cuối kỳ':row.reportState==='PENDING'?'Chờ phê duyệt báo cáo':row.workflow?.status==='PENDING_LEADER'&&item.approvalDelegations?.length?'Chờ CV được ủy quyền / LĐP duyệt':row.workflow?bookingApprovalLabels[row.workflow.status]:'Đặt chỗ đã có hiệu lực'}]:[];
    });return {items};
  });}
  async workflow(input:unknown,actor?:ActorContext){const command=parse(bookingWorkflowCommand,input);return this.access.run(actor,async()=>{
    distinct(command.items.map(i=>i.id));const contexts=await this.contexts();await this.repository.lock(contexts.map(c=>c.contract.id));
    const {digest,old}=await this.replay(command.idempotencyKey,command);if(old)return old.result;
    const all=await this.repository.all(), policy=await this.repository.policy(), changed:BookingView[]=[];const who=this.access.snapshot().actor;
    if(['RETURN','REJECT','REPORT_RETURN','LIFECYCLE_RETURN','LIFECYCLE_REJECT'].includes(command.action)&&!command.reason)throw new BadRequestException('Nhập lý do để người gửi chỉnh sửa.');
    for(const item of command.items){
      const before=all.find(r=>r.id===item.id);if(!before)throw new NotFoundException('Không tìm thấy đặt chỗ.');const ctx=this.contextFor(before.contractId,contexts);this.require('booking.read',before,ctx);
      if(before.recordVersion!==item.recordVersion)throw new ConflictException('Đặt chỗ hoặc tác vụ đã thay đổi; tải lại trước khi xử lý.');
      const available=this.item(before,ctx).workflowActions??[];if(!available.includes(command.action))throw new BadRequestException('Không có tác vụ phù hợp với người xử lý hoặc trạng thái hiện tại.');
      const grant=bookingRequestDelegations(before,ctx).find(g=>g.delegateActorId===who.id);
      const delegated=grant?.delegateActorId===who.id&&(['LIFECYCLE_APPROVE','LIFECYCLE_RETURN','LIFECYCLE_REJECT'].includes(command.action)||['APPROVE','RETURN','REJECT'].includes(command.action)&&before.workflow?.status==='PENDING_LEADER'||command.action==='APPROVE'&&before.workflow?.status==='PENDING_INTERNAL');
      if(delegated)this.access.requireAtCommit(async()=>{const fresh=(await this.repository.delegations(ctx.contract.id)).find(g=>g.delegateActorId===who.id);if(!bookingRequestDelegations(before,{...ctx,approvalDelegations:fresh?[fresh]:[]}).length)throw new BadRequestException('Ủy quyền đã hết hạn hoặc bị thu hồi; chuyển LĐP xử lý.');});
      if (command.action.startsWith('LIFECYCLE_')) {
        const request = before.lifecycleRequest!;
        this.require(command.action === 'LIFECYCLE_WITHDRAW' ? 'booking.read' : 'booking.approve', before, ctx);
        const row:BookingView = { ...structuredClone(before), recordVersion:before.recordVersion+1, updatedAt:new Date().toISOString(), lifecycleRequest:{ ...request, ...(delegated?{decidedDelegation:grant!}:{}),status:command.action==='LIFECYCLE_APPROVE'?'APPROVED':command.action==='LIFECYCLE_RETURN'?'RETURNED':command.action==='LIFECYCLE_REJECT'?'REJECTED':'WITHDRAWN', decidedBy:who.id, decidedAt:new Date().toISOString(), reason:command.reason } };
        if (command.action === 'LIFECYCLE_APPROVE') await this.applyLifecycle(row, request.action, ctx);
        changed.push(row); continue;
      }
      const permission=command.action.startsWith('REPORT_')?'booking.report.approve':['START','FINISH'].includes(command.action)?'booking.update':['SUBMIT','WITHDRAW'].includes(command.action)?'booking.submit':before.workflow?.status==='PENDING_VENDOR'?'booking.confirm':'booking.approve';this.require(permission,command.action.startsWith('REPORT_')?{...before,...bookingEffective(before),workflow:null}:before,ctx);
      let row:BookingView={...structuredClone(before),recordVersion:before.recordVersion+1,updatedAt:new Date().toISOString()};
      if(['SUBMIT','APPROVE','CONFIRM'].includes(command.action))priceBooking(row,ctx);
      if(command.action==='SUBMIT')row=await this.submitted(row,ctx,policy);
      else if(command.action==='FINISH'){if(bookingPending(row)||row.reportState==='PENDING')throw new BadRequestException('Xử lý đề nghị và báo cáo đang chờ trước khi kết thúc.');row.execution='FINISHED';}
      else if(command.action.startsWith('REPORT_')){
        const pending=(row.reportPeriods??[]).filter(p=>p.status==='PENDING'&&(!item.reportId||p.id===item.reportId));if(pending.length!==1)throw new BadRequestException('Chọn đúng một kỳ báo cáo đang chờ duyệt.');
        const report=pending[0]!;report.reason=command.reason;
        report.decisions=[...(report.decisions??[]),{at:row.updatedAt,actorId:who.id,decision:command.action as 'REPORT_APPROVE'|'REPORT_RETURN',receivedAt:report.submittedAt}];
        if(command.action==='REPORT_APPROVE'){report.status='ACCEPTED';report.approved={quantity:report.quantity,values:report.values,actorId:who.id,at:row.updatedAt,startDate:report.startDate,endDate:report.endDate};}else report.status='RETURNED';
        row.acceptedQty=(row.reportPeriods??[]).reduce((sum,r)=>sum.plus(r.approved?.quantity??'0'),decimal(0)).toFixed();row.reportState=(row.reportPeriods??[]).some(r=>r.status==='PENDING')?'PENDING':report.status;
        row.reportData=report.values;
      }else{
        const w=row.workflow!;w.decisions.push({actorId:who.id,step:w.status,at:row.updatedAt,decision:command.action,reason:command.reason,receivedAt:bookingStepReceivedAt(before),requestVersion:w.requestVersion,...(delegated&&w.status==='PENDING_LEADER'?{delegation:grant!}:{})});w.reason=command.reason;
        if(command.action==='WITHDRAW')w.status='WITHDRAWN';
        else if(command.action==='RETURN')w.status='RETURNED';
        else if(command.action==='REJECT')w.status='REJECTED';
        else if(command.action==='APPROVE'&&w.status==='PENDING_INTERNAL'||command.action==='CONFIRM'&&w.status==='PENDING_VENDOR'){
          await this.requireLeaderRecipient(row,ctx);w.status='PENDING_LEADER';
          if(delegated&&command.action==='APPROVE'){
            w.decisions.push({actorId:who.id,step:'PENDING_LEADER',at:row.updatedAt,receivedAt:row.updatedAt,decision:'APPROVE',reason:command.reason,requestVersion:w.requestVersion,delegation:grant!});
            w.status='APPROVED';w.effective=bookingSnapshot(row);row.sourceApprovedQty=row.quantity;row.vendorConfirmedQty=row.quantity;
          }
        }
        else {w.status='APPROVED';w.effective=bookingSnapshot(row);row.sourceApprovedQty=row.quantity;row.vendorConfirmedQty=row.quantity;}
      }
      this.validateReportCommitments(row);changed.push(row);
    }
    const issues=contexts.flatMap(ctx=>{const rows=changed.filter(r=>r.contractId===ctx.contract.id);return rows.length?checkBookingLimits(ctx,all.filter(r=>r.contractId===ctx.contract.id),rows,new Date().toISOString()):[];});if(issues.some(i=>i.severity==='BLOCK'))this.failure({rows:changed,issues,valid:false});
    for(const row of changed)await this.repository.save(row,all.find(r=>r.id===row.id)!,who,`booking.workflow.${command.action.toLowerCase()}`);
    const result={count:changed.length,ids:changed.map(r=>r.id)};await this.repository.saveCommand(command.idempotencyKey,digest,result,who);return result;
  });}
  private async prepare(items:BookingBatchItem[],contexts:BookingContext[],all:BookingView[],reserveDrafts=false,persistPlans=false):Promise<BookingCheck>{
    distinct(items.flatMap(i=>i.id?[i.id]:[]));const issues:BookingCheck['issues']=[];const rows:BookingView[]=[];
    const catalog=await this.repository.catalog();const actor=this.access.snapshot().actor;const policy=await this.repository.policy();
    for(const [index,item] of items.entries()){
      try{
        const before=item.id?all.find(r=>r.id===item.id):null;if(item.id&&!before)throw new Error('Không tìm thấy booking.');
        if (before?.lifecycleRequest?.status === 'PENDING') throw Error('Xử lý hoặc rút đề nghị thao tác đang chờ trước khi sửa.');
        if(before){const oldCtx=this.contextFor(before.contractId,contexts);this.require('booking.update',before,oldCtx);if(before.recordVersion!==item.recordVersion)throw new Error('Booking đã thay đổi; tải lại trước khi lưu.');}
        const ctx=contexts.find(c=>c.allocations.some(a=>a.id===item.fields.allocationId));if(!ctx)throw new Error('Không tìm thấy phân bổ.');
        this.require(before?'booking.update':'booking.create',this.allocationRow(item.fields.allocationId),ctx);
        const roles=this.responsibilities(ctx,item.fields.allocationId);
        if(policy.version>0&&!roles.creator)throw Error('Chỉ CV phụ trách HĐ, CV khai thác slot hoặc Vendor được phân công mới được tạo/sửa đặt chỗ. LĐP chỉ phê duyệt.');
        if(before&&bookingPending(before)&&!(before.workflow?.status==='PENDING_VENDOR'&&roles.vendor))throw Error('Rút đề nghị đang chờ duyệt trước khi sửa.');
        if(before&&before.contractId!==ctx.contract.id)throw Error('Không chuyển một booking sang hợp đồng khác; tạo booking riêng.');
        if(item.fields.campaignId){const open=(await this.plans.bookingCatalog()).campaigns.some(c=>c.id===item.fields.campaignId);if(!open)await this.access.campaign(item.fields.campaignId);const campaign=catalog.campaigns.find(c=>c.id===item.fields.campaignId);if(!campaign)throw new Error('Chiến dịch không còn khả dụng.');item.fields.campaignLabel=campaign.name;}
        if(item.fields.materialId){this.access.require('material.read');if(!catalog.materials.some(m=>m.id===item.fields.materialId))throw new Error('Tư liệu không còn khả dụng.');}
        if(before?.deletedAt)throw new BadRequestException('Phục hồi đặt chỗ trước khi sửa thông tin.');
        item.fields={planItemId:before?.campaignId===item.fields.campaignId&&before?.allocationId===item.fields.allocationId?before.planItemId??null:null,overallStartDate:before?.overallStartDate??null,overallEndDate:before?.overallEndDate??null,campaignDatesAuto:before?.campaignDatesAuto??false,timeDistribution:before?.timeDistribution??automaticBookingDistribution(),...item.fields};
        if(!item.fields.campaignId)item.fields.campaignDatesAuto=false;
        if (ctx.contract.deletedAt || ctx.contract.status !== 'ACTIVE') throw new Error('Hợp đồng đang tạm dừng, trong Thùng rác hoặc chưa được áp dụng.');
        const revisionId = before?.contractRevisionId ?? ctx.contract.currentRevisionId;
        const revision = revisionId ? await this.contracts.revision(revisionId) : null;
        if (revisionId && (!revision || revision.contractId !== ctx.contract.id)) throw new Error('Không tìm thấy phiên bản hợp đồng đã chốt.');
        if (before && ctx.contract.currentRevisionId && !before.contractRevisionId) throw new Error('Booking cũ cần được chốt phiên bản trước khi chỉnh sửa.');
        const priceContext=revision?{...revision.snapshot,contract:{...revision.snapshot.contract,status:ctx.contract.status}}:ctx;
        const quote=priceBooking(item.fields,priceContext);
        if(before&&(decimal(before.acceptedQty).gt(0)||bookingReportPeriods(before).length>0)&&(before.allocationId!==item.fields.allocationId||before.campaignId!==item.fields.campaignId))throw new Error('Booking đã có báo cáo: giữ nguyên phân bổ/chiến dịch, tạo booking riêng nếu cần chuyển.');
        if(before&&decimal(item.fields.quantity).lt(before.acceptedQty))throw new Error('Số lượng đặt không được nhỏ hơn số lượng đã nghiệm thu.');
        const now=new Date().toISOString();
        const row:BookingView={id:before?.id??randomUUID(),...item.fields,...quote,contractRevisionId:revision?.id??null,contractSnapshot:before?.allocationId===item.fields.allocationId&&before.contractSnapshot?before.contractSnapshot:(revision?contractBookingSnapshot(revision,item.fields.allocationId):null),state:before?.state??'ACTIVE',deletedAt:null,vendorConfirmedQty:before?.vendorConfirmedQty??null,sourceApprovedQty:before?.sourceApprovedQty??null,
          acceptedQty:before?.acceptedQty??'0',reportState:before?.reportState??'EMPTY',reportTemplateId:before?.reportTemplateId??null,reportData:before?.reportData??{},sourceKey:before?.sourceKey??null,source:before?.source??{},
          recordVersion:(before?.recordVersion??0)+1,createdByActorId:before?.createdByActorId??actor.id,createdAt:before?.createdAt??now,updatedAt:now};
        if(before&&before.allocationId===row.allocationId){row.unit=before.unit;row.unitPrice=before.unitPrice;row.priceBasis=before.priceBasis;row.taxRate=before.taxRate;row.amount=numeric(decimal(row.quantity).mul(row.unitPrice).div(row.priceBasis),6)!;row.vat=numeric(decimal(row.amount).mul(row.taxRate),6)!;row.gross=numeric(decimal(row.amount).plus(row.vat),6)!;}
        if(before&&before.allocationId!==row.allocationId){row.reportData={};row.reportState='EMPTY';row.reportTemplateId=null;row.vendorConfirmedQty=null;row.sourceApprovedQty=null;}
        row.planItemId=await this.plans.resolveBooking(row,before??null,ctx,persistPlans);
        row.execution=before?.execution??'NOT_STARTED';row.reportPeriods=before?.reportPeriods??[];row.lifecycleRequest=before?.lifecycleRequest??null;
        if(policy.version>0){
          if(before&&['FINISHED','CANCELLED'].includes(before.execution??''))throw Error('Đặt chỗ đã kết thúc; tạo đề nghị mới để tiếp tục.');
          const unchanged=before&&JSON.stringify(bookingSnapshot(before))===JSON.stringify(bookingSnapshot(row));
          row.workflow=unchanged?before.workflow:proposalWorkflow(before??null,row,policy,roles.vendor?'VENDOR':'MANAGER');
          if(unchanged&&row.workflow?.effective)row.workflow={...row.workflow,effective:{...row.workflow.effective,note:row.note,materialUrl:row.materialUrl}};
          if(row.workflow?.status==='APPROVED')row.sourceApprovedQty=row.quantity;
          if(reserveDrafts&&row.workflow&&['DRAFT','RETURNED','REJECTED','WITHDRAWN'].includes(row.workflow.status))row.workflow={...row.workflow,status:row.workflow.origin==='VENDOR'?'PENDING_INTERNAL':'PENDING_VENDOR'};
        }
        this.validateReportCommitments(row);rows.push(row);
      }catch(e){issues.push({index,field:'row',severity:'BLOCK',message:e instanceof Error?e.message:'Không thể lưu dòng.'});}
    }
    if(rows.length===items.length)for(const ctx of contexts){
      const local=rows.filter(r=>r.contractId===ctx.contract.id);if(!local.length)continue;
      for(const issue of checkBookingLimits(ctx,all.filter(r=>r.contractId===ctx.contract.id),local,new Date().toISOString()))issues.push({...issue,index:rows.indexOf(local[issue.index]!)});
    }
    return{rows,issues,valid:!issues.some(i=>i.severity==='BLOCK')};
  }
  private failure(check:BookingCheck){throw new BadRequestException({message:check.issues.filter(i=>i.severity==='BLOCK').map(i=>`Dòng ${i.index+1}: ${i.message}`).join('; '),issues:check.issues});}
  private async replay(key:string,input:unknown){const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');const old=await this.repository.command(key);if(old&&(old.actorId!==this.access.snapshot().actor.id||old.digest!==digest))throw new ConflictException('Mã thao tác đã được dùng cho nội dung khác.');return{digest,old};}
  async impact(input:unknown,actor?:ActorContext):Promise<BookingImpact>{const command=parse(bookingBatch,input);return this.access.run(actor,async()=>{
    const contexts=await this.contexts(), all=await this.repository.all();
    const check=await this.prepare(command.items,contexts,all,true), asOf=new Date().toISOString();
    const output:BookingImpact={...check,asOf,contracts:[]};
    if(check.rows.length!==command.items.length)return output;
    const ids=new Set(check.rows.map(r=>r.id));
    const next=[...all.filter(r=>!ids.has(r.id)),...check.rows];
    const affected=new Set([...check.rows.map(r=>r.allocationId),...all.filter(r=>ids.has(r.id)).map(r=>r.allocationId)]);
    const scopes=await this.repository.allocationScopes(contexts.map(c=>c.contract.id));
    for(const ctx of contexts.filter(c=>c.allocations.some(a=>affected.has(a.id)))){
      const before=await buildInventory(ctx,{read:async(s,t)=>projectBookingConsumption(s,all,scopes,t)},asOf);
      const after=await buildInventory(ctx,{read:async(s,t)=>projectBookingConsumption(s,next,scopes,t)},asOf);
      const allowed=new Set(ctx.allocations.filter(a=>(affected.has(a.id)||a.scopeKind==='CAP')&&this.allowed('booking.read',this.allocationRow(a.id),ctx)).map(a=>a.id));
      const scoped=(v:SupplyInventory):SupplyInventory=>({...v,rows:v.rows.filter(r=>allowed.has(r.allocationId)),amountTotals:{baseline:null,effective:null,remaining:null,used:null},quantityTotals:[]});
      output.contracts.push({contractId:ctx.contract.id,contractName:ctx.contract.name,before:scoped(before),after:scoped(after)});
    }
    return output;
  });}
  async check(input:unknown,actor?:ActorContext){const command=parse(bookingBatch,input);return this.access.run(actor,async()=>{
    const contexts=await this.contexts();return this.prepare(command.items,contexts,await this.repository.all());
  });}
  async save(input:unknown,actor?:ActorContext){const command=parse(bookingBatch,input);return this.access.run(actor,async()=>{
    const contexts=await this.contexts();await this.repository.lock(contexts.map(c=>c.contract.id));
    const {digest,old}=await this.replay(command.idempotencyKey,command);if(old){const saved=old.result as {ids:string[]};for(const r of await this.repository.get(saved.ids))this.require('booking.read',r,this.contextFor(r.contractId,contexts));return old.result;}
    const all=await this.repository.all();const result=await this.prepare(command.items,contexts,all,false,true);if(!result.valid)this.failure(result);
    if(command.submit){const policy=await this.repository.policy();for(let i=0;i<result.rows.length;i++){const row=result.rows[i]!;result.rows[i]=await this.submitted(row,this.contextFor(row.contractId,contexts),policy);}for(const ctx of contexts){const local=result.rows.filter(r=>r.contractId===ctx.contract.id);if(local.length)result.issues.push(...checkBookingLimits(ctx,all.filter(r=>r.contractId===ctx.contract.id),local,new Date().toISOString()));}if(result.issues.some(i=>i.severity==='BLOCK'))this.failure(result);}
    for(const row of result.rows)await this.repository.save(row,all.find(r=>r.id===row.id)??null,this.access.snapshot().actor,command.items.some(i=>i.id===row.id)?'booking.update':'booking.create');
    const response={ids:result.rows.map(r=>r.id),count:result.rows.length,issues:result.issues};await this.repository.saveCommand(command.idempotencyKey,digest,response,this.access.snapshot().actor);return response;
  });}
  private async applyLifecycle(row:BookingView, action:BookingAction, ctx:BookingContext) {
    if (['RESTORE','RESUME'].includes(action) && row.planItemId) await this.plans.resolveBooking(row,row,ctx,false);
    if (['RESTORE','PURGE'].includes(action) !== Boolean(row.deletedAt)) throw new BadRequestException('Thao tác không phù hợp với trạng thái Thùng rác.');
    if (action==='PAUSE'&&row.state!=='ACTIVE'||action==='RESUME'&&row.state!=='PAUSED') throw new BadRequestException('Trạng thái tạm dừng/nối lại không hợp lệ.');
    if (['PAUSE','RESUME'].includes(action) && (!bookingEffective(row)||['FINISHED','CANCELLED'].includes(row.execution??''))) throw new BadRequestException('Đặt chỗ chưa được duyệt hoặc đã kết thúc, không thể tạm dừng/nối lại.');
    if (action==='DELETE'&&row.reportState==='PENDING') throw new BadRequestException('Xử lý báo cáo đang chờ duyệt trước khi chuyển vào Thùng rác.');
    if (action==='PURGE'&&decimal(row.acceptedQty).gt(0)) throw new BadRequestException('Booking đã nghiệm thu không thể xóa vĩnh viễn; lịch sử và phần đã sử dụng phải được giữ.');
    if (action==='DELETE') { row.deletedAt=new Date().toISOString(); if (bookingPending(row)) row.workflow={...row.workflow!,status:'WITHDRAWN',reason:'Đã chuyển vào Thùng rác'}; }
    if (action==='RESTORE') { priceBooking({...row,...bookingEffective(row)},ctx); row.deletedAt=null; }
    if (action==='PAUSE') { row.state='PAUSED'; row.execution='PAUSED'; }
    if (action==='RESUME') { priceBooking({...row,...bookingEffective(row)},ctx); row.state='ACTIVE'; row.execution='NOT_STARTED'; }
  }
  async lifecycle(input:unknown,actor?:ActorContext){const command=parse(bookingLifecycle,input);return this.access.run(actor,async()=>{
    distinct(command.items.map(i=>i.id));const contexts=await this.contexts();await this.repository.lock(contexts.map(c=>c.contract.id));
    const {digest,old}=await this.replay(command.idempotencyKey,command);if(old)return old.result;
    const all=await this.repository.all();const rows:BookingView[]=[];const policy=await this.repository.policy();let pending=0;
    for(const item of command.items){const before=all.find(r=>r.id===item.id);if(!before)throw new NotFoundException('Không tìm thấy booking.');
      const permission=({DELETE:'booking.delete',RESTORE:'booking.restore',PURGE:'booking.purge',PAUSE:'booking.update',RESUME:'booking.update'} as const)[command.action];
      this.require(permission,before,this.contextFor(before.contractId,contexts));if(before.recordVersion!==item.recordVersion)throw new ConflictException('Booking đã thay đổi; tải lại danh sách.');
      const ctx=this.contextFor(before.contractId,contexts);
      if(policy.version>0&&!this.responsibilities(ctx,before.allocationId).creator)throw new BadRequestException('Chỉ CV phụ trách HĐ, CV khai thác slot hoặc Vendor được phân công được xử lý vận hành đặt chỗ.');
      if(before.lifecycleRequest?.status==='PENDING')throw new BadRequestException('Đang có đề nghị thao tác chờ duyệt; xử lý hoặc rút trước khi gửi đề nghị khác.');
      const row:BookingView={...structuredClone(before),recordVersion:before.recordVersion+1,updatedAt:new Date().toISOString()};
      const candidate=structuredClone(row);await this.applyLifecycle(candidate,command.action,ctx);
      if(command.action!=='PURGE'&&bookingApprovalRequired(policy,command.action)){
        if(bookingPending(before))throw new BadRequestException('Hoàn tất hoặc rút đề nghị sửa đang chờ trước khi gửi thao tác.');
        const operation=command.action; const delegations=(ctx.approvalDelegations??[]).filter(g=>activeBookingDelegation(g,ctx,operation,Date.now(),row.allocationId)).map(bookingDelegationSnapshot);
        row.lifecycleRequest={action:command.action,delegations,status:'PENDING',policyVersion:policy.version,requestedBy:this.access.snapshot().actor.id,requestedAt:row.updatedAt,reason:'',decidedAt:null,decidedBy:null};
        await this.requireLeaderRecipient(row,ctx);
        rows.push(row);pending++;
      }else rows.push(candidate);
    }
    if(['RESTORE','RESUME'].includes(command.action))for(const ctx of contexts){const local=rows.filter(r=>r.contractId===ctx.contract.id);if(!local.length)continue;const issues=checkBookingLimits(ctx,all.filter(r=>r.contractId===ctx.contract.id),local,new Date().toISOString());if(issues.some(i=>i.severity==='BLOCK'))this.failure({rows:local,issues,valid:false});}
    for(const row of rows){const before=all.find(r=>r.id===row.id)!;if(command.action==='PURGE')await this.repository.purge(before,this.access.snapshot().actor);else await this.repository.save(row,before,this.access.snapshot().actor,`booking.${command.action.toLowerCase()}${row.lifecycleRequest?.status==='PENDING'?'.requested':''}`);}
    const response={ids:rows.map(r=>r.id),count:rows.length,pending};await this.repository.saveCommand(command.idempotencyKey,digest,response,this.access.snapshot().actor);return response;
  });}
  async reports(input:unknown,actor?:ActorContext){const command=parse(bookingReport,input);return this.access.run(actor,async()=>{
    distinct(command.items.map(i=>i.id));const ctx=this.contextFor(command.contractId,await this.contexts());await this.repository.lock([command.contractId]);
    const {digest,old}=await this.replay(command.idempotencyKey,command);if(old)return old.result;
    const existing=await this.repository.get(command.items.map(i=>i.id));const rows:BookingView[]=[];const policy=await this.repository.policy();
    for(const item of command.items){const before=existing.find(r=>r.id===item.id);if(!before||before.contractId!==command.contractId)throw new BadRequestException('Chọn các booking cùng một hợp đồng để nghiệm thu.');const effective=bookingEffective(before);this.require('booking.report',{...before,...effective,workflow:null},ctx);
      if(before.recordVersion!==item.recordVersion)throw new ConflictException('Booking/báo cáo đã thay đổi; tải lại trước khi lưu.');
      const template=ctx.templates.find(t=>t.id===item.templateId);if(!template||before.reportTemplateId&&before.reportTemplateId!==template.id)throw new BadRequestException('Mẫu báo cáo không đúng hợp đồng hoặc phiên bản đã dùng.');
      let reportData:Record<string,string|null>;try{reportData=calculateBookingReport(item.values,template.definition,effective?.slotId??before.slotId);}catch(e){throw new BadRequestException(e instanceof Error?e.message:'Chỉ số không hợp lệ.');}
      if(policy.version>0){
        const roles=this.responsibilities(ctx,effective?.allocationId??before.allocationId);
        if(before.deletedAt||!effective||!(roles.vendor||roles.reviewer))throw new BadRequestException('Chỉ Vendor hoặc người vận hành được phân công được nhập báo cáo cho đặt chỗ đã duyệt.');
        const ledger=structuredClone(bookingReportPeriods(before));const oldReport=item.reportId?ledger.find(r=>r.id===item.reportId):undefined;
        if(item.reportId&&!oldReport)throw new BadRequestException('Kỳ báo cáo không tồn tại.');
        if(oldReport?.status==='PENDING')throw new BadRequestException('Báo cáo đang chờ duyệt; trả lại trước khi sửa.');
        const start=item.periodStart??null,end=item.periodEnd??null;
        if(Boolean(start)!==Boolean(end))throw new BadRequestException('Điền đủ ngày bắt đầu và kết thúc kỳ báo cáo.');
        if(start&&end){try{bookingPlanDays({startDate:start,endDate:end,quantity:'0'});}catch{throw new BadRequestException('Ngày kỳ báo cáo không hợp lệ.');}if(start<effective.startDate||end>effective.endDate)throw new BadRequestException('Kỳ báo cáo phải nằm trong lịch đặt chỗ đã duyệt.');}
        if(ledger.some(r=>r.id!==oldReport?.id&&(!start||!r.startDate||start<=r.endDate!&&end!>=r.startDate)))throw new BadRequestException('Kỳ báo cáo chồng lấn hoặc trùng báo cáo tổng; mở kỳ đã có để điều chỉnh.');
        if(item.state!=='DRAFT'&&!reportData.fileUrl&&!reportData.liveUrl)throw new BadRequestException('Cần link bằng chứng hoặc live link để gửi nghiệm thu.');
        if(item.state==='SUBMITTED'){const assignment=ctx.access.find(a=>a.allocationId===effective.allocationId),reviewers=[ctx.contract.managerActorId,...(assignment?.operatorActorIds??[])].filter((id):id is string=>Boolean(id)&&bookingResponsibilities(ctx,effective.allocationId,id!).reviewer);if(!(await this.access.eligibleBookingAssignees(this.resource({...before,...effective,workflow:null},ctx),'booking.report.approve',reviewers)).length)throw new BadRequestException('Cần phân công CV phụ trách HĐ hoặc CV khai thác slot có quyền duyệt báo cáo.');}
        const period:BookingReportPeriod={id:oldReport?.id??randomUUID(),startDate:start,endDate:end,templateId:template.id,status:item.state==='DRAFT'?'DRAFT':'PENDING',quantity:decimal(item.acceptedQty).toFixed(),values:reportData,submittedBy:this.access.snapshot().actor.id,submittedAt:item.state==='DRAFT'?null:new Date().toISOString(),reason:'',approved:oldReport?.approved??null};
        period.decisions=oldReport?.decisions??[];
        period.submissions=[...(oldReport?.submissions??(oldReport?.submittedAt?[{at:oldReport.submittedAt,actorId:oldReport.submittedBy,startDate:oldReport.startDate,endDate:oldReport.endDate}]:[])),...(period.submittedAt?[{at:period.submittedAt,actorId:period.submittedBy,startDate:start,endDate:end,bookingEndDate:effective.endDate}]:[])];
        if(item.state==='ACCEPTED'){if(!roles.reviewer)throw new BadRequestException('Vendor gửi báo cáo để CV phụ trách HĐ hoặc CV khai thác slot duyệt.');this.require('booking.report.approve',before,ctx);period.status='ACCEPTED';period.approved={quantity:period.quantity,values:period.values,actorId:this.access.snapshot().actor.id,at:new Date().toISOString(),startDate:start,endDate:end};}
        const periods=[...ledger.filter(r=>r.id!==period.id),period];
        if(periods.reduce((sum,r)=>sum.plus(r.quantity),decimal(0)).gt(effective.quantity))throw new BadRequestException('Tổng số lượng các kỳ nghiệm thu vượt lượng đặt đã duyệt.');
        const acceptedQty=periods.reduce((sum,r)=>sum.plus(r.approved?.quantity??'0'),decimal(0)).toFixed();
        const updated:BookingView={...before,reportData,reportTemplateId:template.id,reportPeriods:periods,reportState:periods.some(r=>r.status==='PENDING')?'PENDING':period.status,acceptedQty,recordVersion:before.recordVersion+1,updatedAt:new Date().toISOString()};this.validateReportCommitments(updated);rows.push(updated);continue;
      }
      if(decimal(item.acceptedQty).gt(before.quantity))throw new BadRequestException('Số lượng nghiệm thu tính vào hợp đồng vượt lượng đặt. Sửa lượng đặt trước; chỉ số thực hiện có thể lớn hơn.');
      if(item.state==='ACCEPTED'&&!reportData.fileUrl&&!reportData.liveUrl)throw new BadRequestException('Cần link bằng chứng hoặc live link để ghi nghiệm thu.');
      // Saving a report draft never erases already recorded chargeable acceptance.
      if(before.reportState==='ACCEPTED'&&item.state==='DRAFT')throw new BadRequestException('Báo cáo đã nghiệm thu: dùng Lưu nghiệm thu để ghi bản điều chỉnh có lịch sử.');
      rows.push({...before,reportData,reportTemplateId:template.id,reportState:item.state==='SUBMITTED'?'PENDING':item.state,acceptedQty:item.state==='ACCEPTED'?decimal(item.acceptedQty).toFixed():before.acceptedQty,recordVersion:before.recordVersion+1,updatedAt:new Date().toISOString()});
    }
    const issues=checkBookingLimits(ctx,await this.repository.all([command.contractId]),rows,new Date().toISOString());if(issues.some(i=>i.severity==='BLOCK'))this.failure({rows,issues,valid:false});
    for(const row of rows)await this.repository.save(row,existing.find(r=>r.id===row.id)!,this.access.snapshot().actor,'booking.report');
    const response={ids:rows.map(r=>r.id),count:rows.length};await this.repository.saveCommand(command.idempotencyKey,digest,response,this.access.snapshot().actor);return response;
  });}
  async configureAllocation(input:BookingAllocationAccess,actor?:ActorContext){return this.access.run(actor,async()=>{
    const schema=z.object({allocationId:z.string().uuid(),ownerDepartmentId:z.string().uuid().nullable(),beneficiaryDepartmentId:z.string().uuid().nullable(),leaderActorIds:z.array(z.string().uuid()).max(20),operatorActorIds:z.array(z.string().uuid()).max(20),beneficiaryActorIds:z.array(z.string().uuid()).max(20),vendorActorIds:z.array(z.string().uuid()).max(20),recordVersion:z.number().int().positive()}).strict();
    const value=parse(schema,input);this.access.require('booking.manage');const ctx=(await this.contexts()).find(c=>c.allocations.some(a=>!a.supersededAt&&a.id===value.allocationId));if(!ctx)throw new NotFoundException('Không tìm thấy phân bổ.');
    const catalog=await this.repository.catalog();if(sumIds(value).some(id=>!catalog.people.some(p=>p.id===id)))throw new BadRequestException('Tài khoản không hoạt động hoặc không tồn tại.');
    if([value.ownerDepartmentId,value.beneficiaryDepartmentId].some(id=>id&&!catalog.departments.some(d=>d.id===id)))throw new BadRequestException('CQĐV chưa được xác định.');
    await this.repository.saveAccess(value,this.access.snapshot().actor);return{saved:true};
  });}
  async configureTemplate(input:{contractId:string;name:string;definition:BookingTemplate['definition']},actor?:ActorContext){return this.access.run(actor,async()=>{
    this.access.require('booking.manage');const value=parse(z.object({contractId:z.string().uuid(),name:z.string().min(1).max(200),definition:z.object({metrics:z.array(z.enum(BOOKING_METRICS.map(m=>m.key) as [typeof BOOKING_METRICS[number]['key'],...Array<typeof BOOKING_METRICS[number]['key']>])).max(7),conversionDenominator:z.enum(['linkClick','interaction']).nullable(),excludedSlotIds:z.array(z.string().uuid()).max(100)}).strict()}).strict(),input);
    const ctx=this.contextFor(value.contractId,await this.contexts());if(value.definition.excludedSlotIds.some(id=>!ctx.slots.some(s=>s.id===id)))throw new BadRequestException('Slot không thuộc hợp đồng.');
    const template={...value,id:randomUUID(),version:Math.max(0,...ctx.templates.map(t=>t.version))+1};await this.repository.saveTemplate(template,this.access.snapshot().actor);return template;
  });}
}
