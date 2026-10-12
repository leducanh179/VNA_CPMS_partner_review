import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BOOKING_APPROVAL_OPERATIONS, contractAccessResource, type ActorContext, type BookingDelegation, type BookingDelegationOption, type SupplyContractView } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractsRepository } from '../../contracts/application/contracts.repository';
import { BookingRepository } from './booking.repository';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Ngày không hợp lệ');
const command = z.object({ delegateActorId:z.string().uuid(),expectedVersion:z.number().int().min(0), assignmentVersion:z.number().int().positive(), revoke:z.boolean().default(false),
  actions:z.array(z.enum(BOOKING_APPROVAL_OPERATIONS)).min(1).max(6), startsOn:date, endsOn:date.nullable(), reason:z.string().trim().min(1).max(2000) }).strict();

@Injectable()
export class BookingDelegationApplicationService {
  constructor(@Inject(BookingRepository) private readonly repository:BookingRepository,
    @Inject(ContractsRepository) private readonly contracts:ContractsRepository,
    @Inject(AccessApplicationService) private readonly access:AccessApplicationService){}
  private admin(){const i=this.access.snapshot().identity;return i.effectiveSuperadmin&&i.mode==='DIRECT';}
  private eligible(c:SupplyContractView){return !c.deletedAt && this.access.check('contract.read',contractAccessResource(c)).allowed
    && (this.admin() || c.leaderActorId===this.access.snapshot().actor.id && this.access.check('contract.approve',contractAccessResource(c)).allowed);}
  private require(c:SupplyContractView){
    if(!this.eligible(c))throw new NotFoundException('Không tìm thấy hợp đồng được phép cấu hình ủy quyền.');
    this.access.require('contract.read',contractAccessResource(c));
    this.access.require(this.admin()?'booking.policy.manage':'contract.approve',this.admin()?undefined:contractAccessResource(c));
  }
  async list(actor?:ActorContext){return this.access.run(actor,async()=>{
    const [contracts,catalog,history,assignments]=await Promise.all([this.contracts.list(),this.repository.catalog(),this.repository.delegations(),this.repository.allocationAccess()]);
    const scoped=contracts.filter(c=>this.eligible(c));
    if(!this.admin()&&!scoped.length)throw new ForbiddenException('Chỉ LĐP phụ trách hoặc quản trị viên được cấu hình ủy quyền.');
    const options:BookingDelegationOption[]=await Promise.all(scoped.map(async c=>{
      this.require(c);const aggregate=(await this.contracts.get(c.id))!;
      const allocations=aggregate.allocations.filter(a=>!a.supersededAt&&a.scopeKind==='ENTITLEMENT');
      const local=assignments.filter(a=>allocations.some(l=>l.id===a.allocationId));
      const operators=catalog.people.filter(p=>p.id!==c.managerActorId&&local.some(a=>a.operatorActorIds.includes(p.id))).map(p=>({...p,slotNames:[...new Set(local.filter(a=>a.operatorActorIds.includes(p.id)).map(a=>aggregate.slots.find(s=>s.id===allocations.find(l=>l.id===a.allocationId)?.slotId)?.name??''))]}));
      return {id:c.id,code:c.code,name:c.name,leader:catalog.people.find(p=>p.id===c.leaderActorId)??null,operators,
        delegate:catalog.people.find(p=>p.id===c.managerActorId)??null,assignmentVersion:c.recordVersion,history:history.filter(g=>g.contractId===c.id)};
    }));return {contracts:options};
  });}
  async save(contractId:string,input:unknown,actor?:ActorContext){
    if(!z.string().uuid().safeParse(contractId).success)throw new NotFoundException('Không tìm thấy hợp đồng.');
    const parsed=command.safeParse(input);if(!parsed.success)throw new BadRequestException(parsed.error.issues.map(i=>i.message).join('; '));
    const value=parsed.data;
    if(value.endsOn&&value.endsOn<value.startsOn||new Set(value.actions).size!==value.actions.length)throw new BadRequestException('Thời gian hoặc danh sách thao tác không hợp lệ.');
    return this.access.run(actor,async()=>{
      await this.repository.lock([contractId]);const aggregate=await this.contracts.get(contractId);
      if(!aggregate)throw new NotFoundException('Không tìm thấy hợp đồng.');const c=aggregate.contract;this.require(c);
      if(c.recordVersion!==value.assignmentVersion)throw new ConflictException('Hợp đồng hoặc phân công đã thay đổi. Tải lại trước khi lưu.');
      const old=(await this.repository.delegations(contractId)).find(g=>g.delegateActorId===value.delegateActorId);
      if((old?.version??0)!==value.expectedVersion)throw new ConflictException('Ủy quyền đã thay đổi. Tải lại trước khi lưu.');
      if(value.revoke&&(!old||old.revoked))throw new BadRequestException('Không có ủy quyền để thu hồi.');
      const people=(await this.repository.catalog()).people;
      const leader=people.find(p=>p.id===c.leaderActorId),delegate=people.find(p=>p.id===value.delegateActorId);
      const assignments=await this.repository.allocationAccess(),isManager=value.delegateActorId===c.managerActorId;
      const allocations=aggregate.allocations.filter(a=>!a.supersededAt&&a.scopeKind==='ENTITLEMENT');
      const scopes=allocations.filter(a=>isManager||assignments.find(s=>s.allocationId===a.id)?.operatorActorIds.includes(value.delegateActorId));
      if(!value.revoke&&(!leader||!delegate||leader.id===delegate.id||!isManager&&!scopes.length))throw new BadRequestException('Chọn CV phụ trách hoặc Slot operator đang được phân công, khác LĐP và có tài khoản hoạt động.');
      if(!value.revoke){
        if(!await this.access.eligibleContractActor(contractAccessResource(c),'contract.approve',leader!.id))throw new BadRequestException('LĐP không có quyền phụ trách hợp đồng.');
        for(const a of scopes){
          const assigned=assignments.find(s=>s.allocationId===a.id);
          const resource={type:'BOOKING' as const,id:a.id,exists:true,deleted:false,createdByActorId:'',state:'ACTIVE',assignedActorIds:[delegate!.id,...(assigned?.leaderActorIds??[])],orgIds:[assigned?.ownerDepartmentId,assigned?.beneficiaryDepartmentId].filter((v):v is string=>Boolean(v))};
          if(!(await this.access.eligibleBookingAssignees(resource,'booking.approve',[delegate!.id])).length)throw new BadRequestException('Người nhận cần quyền xem và duyệt đặt chỗ của các hạng mục được ủy quyền.');
        }
      }
      const who=this.access.snapshot().actor;
      const grant:BookingDelegation={id:randomUUID(),contractId,version:value.expectedVersion+1,leaderActorId:value.revoke?old!.leaderActorId:leader!.id,delegateActorId:value.revoke?old!.delegateActorId:delegate!.id,
        leaderName:value.revoke?old!.leaderName:leader!.name,delegateName:value.revoke?old!.delegateName:delegate!.name,
        recipientRole:value.revoke?old!.recipientRole:isManager?'MANAGER':'OPERATOR',scope:value.revoke?old!.scope:isManager?'CONTRACT':'ASSIGNED',
        actions:value.revoke?old!.actions:value.actions,startsOn:value.revoke?old!.startsOn:value.startsOn,endsOn:value.revoke?old!.endsOn:value.endsOn,revoked:value.revoke,
        reason:value.reason,actorId:who.id,actorName:people.find(p=>p.id===who.id)?.name??who.id,createdAt:new Date().toISOString()};
      await this.repository.saveDelegation(grant,value.expectedVersion,who);return grant;
    });
  }
}
