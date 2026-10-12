import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActorContext, BookingAllocationAccess, BookingTemplate, BookingView, BookingPolicy, BookingDelegation } from '@cpms/domain';
import { Prisma as PrismaValues } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BookingRepository } from '../application/booking.repository';

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const wire = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const normalize = (v: unknown) => { const row = wire<BookingView>(v); row.startDate=row.startDate.slice(0,10);row.endDate=row.endDate.slice(0,10); row.overallStartDate=row.overallStartDate?.slice(0,10)??null;row.overallEndDate=row.overallEndDate?.slice(0,10)??null;return row; };
@Injectable()
export class PrismaBookingRepository extends BookingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async delegations(contractId?:string) { return wire<BookingDelegation[]>(await this.db.bookingApprovalDelegation.findMany({where:contractId?{contractId}:{},orderBy:[{contractId:'asc'},{version:'desc'}]})); }
  async saveDelegation(value:BookingDelegation,expectedVersion:number,actor:ActorContext) {
    await this.lock([value.contractId]);
    const before=(await this.delegations(value.contractId)).find(g=>g.delegateActorId===value.delegateActorId)??null;
    if((before?.version??0)!==expectedVersion)throw new ConflictException('Ủy quyền đã thay đổi. Tải lại trước khi lưu.');
    await this.db.bookingApprovalDelegation.create({data:{...value,actions:json(value.actions),createdAt:new Date(value.createdAt)}});
    await this.audit(actor,value.revoked?'booking.delegation.revoke':'booking.delegation.save',value.contractId,{before,after:value});
  }
  async policy():Promise<BookingPolicy> { const p=await this.db.bookingWorkflowPolicy.findFirst({orderBy:{version:'desc'}});return p?{...p,actions:p.actions as NonNullable<BookingPolicy['actions']>|null,createdAt:p.createdAt.toISOString()}:{version:0,required:false,actorId:null,createdAt:null,reason:'Cơ chế đặt chỗ trước khi khởi tạo lớp duyệt'}; }
  async savePolicy(required:boolean,expectedVersion:number,reason:string,actor:ActorContext,actions?:BookingPolicy['actions']) {
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpms:booking:policy'))`;
    const old=await this.policy();if(old.version!==expectedVersion)throw new ConflictException('Chính sách đã thay đổi. Tải lại để đối chiếu.');
    await this.db.bookingWorkflowPolicy.create({data:{version:old.version+1,required,actions:actions?json(actions):PrismaValues.DbNull,actorId:actor.id,reason}});
    await this.audit(actor,'booking.policy','booking',{before:old,required,actions,reason});return this.policy();
  }
  async allocationScopes(contractIds:string[]){return (await this.db.supplyAllocation.findMany({where:{contractId:{in:contractIds}},include:{period:true}})).map(a=>({allocationId:a.id,slotId:a.slotId,scopeKind:a.scopeKind,periodStart:a.period.startDate.toISOString().slice(0,10),periodEnd:a.period.endDate.toISOString().slice(0,10),beneficiaryUnitCode:a.beneficiaryUnitCode}));}
  async all(contractIds?: string[]) {
    const rows=await this.db.bookingRecord.findMany({where:contractIds?{contractId:{in:contractIds}}:{},orderBy:[{createdAt:'desc'},{id:'asc'}],take:10001});
    if(rows.length>10000)throw new ConflictException('Phạm vi vượt 10.000 booking; cần thu hẹp hợp đồng trước khi xử lý.');
    return rows.map(normalize);
  }
  async get(ids:string[]) { return (await this.db.bookingRecord.findMany({where:{id:{in:ids}}})).map(normalize); }
  async lock(ids:string[]) { for(const id of [...new Set(ids)].sort()) await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cpms:supply:${id}`}))`; }
  async allocationAccess() { return wire<BookingAllocationAccess[]>(await this.db.bookingAllocationAccess.findMany()); }
  async templates(ids?:string[]) { return wire<BookingTemplate[]>(await this.db.bookingReportTemplate.findMany({where:ids?{contractId:{in:ids}}:{},orderBy:{version:'desc'}})); }
  async catalog() {
    const [people,departments,campaigns,materials]=await Promise.all([
      this.db.actor.findMany({where:{isActive:true},select:{id:true,displayName:true,loginEmail:true}}),
      this.db.employmentOrgUnit.findMany({where:{isActive:true},select:{id:true,sourceName:true}}),
      this.db.campaign.findMany({where:{deletedAt:null},select:{id:true,code:true,name:true,lifecycleState:true,startDate:true,endDate:true},orderBy:{updatedAt:'desc'},take:10000}),
      this.db.materialRecord.findMany({where:{isDeleted:false},select:{id:true,materialId:true,data:true},take:10000}),
    ]);
    return {people:people.map(p=>({id:p.id,name:p.displayName,email:p.loginEmail})),departments:departments.map(d=>({id:d.id,name:d.sourceName})),
      campaigns:campaigns.map(c=>({id:c.id,code:c.code,name:c.name,status:c.lifecycleState,startDate:c.startDate?.toISOString().slice(0,10)??null,endDate:c.endDate?.toISOString().slice(0,10)??null})),materials:materials.map(m=>{const d=m.data as Record<string,unknown>;return{id:m.id,name:String(d.material_name??m.materialId),url:typeof d.material_link==='string'?d.material_link:null};})};
  }
  private async audit(actor:ActorContext,action:string,id:string,data:unknown) {
    await this.db.auditEvent.create({data:{actorId:actor.id,originalActorId:actor.session?.originalActorId??actor.id,contextMode:actor.session?.mode??'DIRECT',action,entityType:'booking',entityId:id,payload:json(data)}});
  }
  async save(row:BookingView,before:BookingView|null,actor:ActorContext,action:string) {
    const {id,createdAt,updatedAt,...fields}=row;void createdAt;void updatedAt;
    const data={...fields,planItemId:row.planItemId??null,lifecycleRequest:row.lifecycleRequest?json(row.lifecycleRequest):PrismaValues.DbNull,contractSnapshot:row.contractSnapshot?json(row.contractSnapshot):PrismaValues.DbNull,workflow:row.workflow?json(row.workflow):PrismaValues.DbNull,execution:row.execution??'NOT_STARTED',reportPeriods:json(row.reportPeriods??[]),startDate:new Date(row.startDate),endDate:new Date(row.endDate),overallStartDate:row.overallStartDate?new Date(row.overallStartDate):null,overallEndDate:row.overallEndDate?new Date(row.overallEndDate):null,campaignDatesAuto:row.campaignDatesAuto??false,timeDistribution:json(row.timeDistribution??{version:1,mode:'AUTO',segments:[],fillRemainder:true}),deletedAt:row.deletedAt?new Date(row.deletedAt):null,reportData:json(row.reportData),source:json(row.source)};
    if(before){const changed=await this.db.bookingRecord.updateMany({where:{id,recordVersion:before.recordVersion},data});if(changed.count!==1)throw new ConflictException('Booking đã thay đổi. Tải lại để đối chiếu.');}
    else await this.db.bookingRecord.create({data:{id,...data}});
    await this.db.bookingRevision.create({data:{bookingId:id,version:row.recordVersion,actorId:actor.id,action,data:json({before,after:row})}});
    await this.audit(actor,action,id,{version:row.recordVersion,before,after:row});
  }
  async purge(row:BookingView,actor:ActorContext) {
    const deleted=await this.db.bookingRecord.deleteMany({where:{id:row.id,recordVersion:row.recordVersion,deletedAt:{not:null}}});
    if(deleted.count!==1)throw new ConflictException('Booking đã thay đổi hoặc chưa nằm trong Thùng rác.');
    await this.db.bookingRevision.create({data:{bookingId:row.id,version:row.recordVersion+1,actorId:actor.id,action:'booking.purge',data:json({before:row,after:null})}});
    await this.audit(actor,'booking.purge',row.id,{before:row});
  }
  async history(id:string){const rows=await this.db.bookingRevision.findMany({where:{bookingId:id},include:{actor:{select:{displayName:true}}},orderBy:{version:'desc'},take:100});return wire<Awaited<ReturnType<BookingRepository['history']>>>(rows.map(({actor,...r})=>({...r,actorName:actor.displayName})));}
  async command(key:string){return this.db.bookingCommand.findUnique({where:{key}});}
  async saveCommand(key:string,digest:string,result:unknown,actor:ActorContext){await this.db.bookingCommand.create({data:{key,digest,result:json(result),actorId:actor.id}});}
  async saveAccess(value:BookingAllocationAccess,actor:ActorContext){
    const {allocationId,...data}=value;
    const old=await this.db.bookingAllocationAccess.findUnique({where:{allocationId}});
    if(old && old.recordVersion!==value.recordVersion)throw new ConflictException('Phân công đã thay đổi.');
    await this.db.bookingAllocationAccess.upsert({where:{allocationId},create:{allocationId,...data},update:{...data,recordVersion:{increment:1}}});
    await this.audit(actor,'booking.assignment',allocationId,{before:old,after:value});
  }
  async saveTemplate(value:BookingTemplate,actor:ActorContext){await this.db.bookingReportTemplate.create({data:{...value,definition:json(value.definition)}});await this.audit(actor,'booking.template',value.id,value);}
}
