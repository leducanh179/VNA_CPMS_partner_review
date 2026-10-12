import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { bookingCommitments, contractAccessResource, contractValidity, contractBookingSnapshot, type ActorContext, type ContractChangeRequest, type ContractManagementWorkspace, type ContractRevision, type SupplyAggregate, type SupplyContractView } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { BookingRepository } from '../../booking/application/booking.repository';
import { ContractsRepository } from './contracts.repository';
import { managementAdopt, managementChange, managementCreate, managementDecision, managementPolicy, managementPurge } from './contract-management.commands';
import { decimal, numeric } from '../domain/supply-engine';
import { effectivePair } from '../domain/supply-engine';
import { applyContractItems, contractItemRows } from '../domain/contract-items';
import { PROFESSION_LAYERS, ITEM_CHANNELS, slotOverbookAllowed, supplyItemSlot, type ContractItemChanges } from '@cpms/domain';
import { DirectoryRepository } from '../../directory/application/directory.repository';
import { reservationRows } from '../../booking/domain/booking-workflow';
import { reservedBooking, slotPeakConcurrency } from '../../booking/domain/booking-engine';
import { activityForItem, canonicalLayer, canonicalChannel, isOwnedChannel, localOwnedActivity, ownedActivityCode, withLocalOwnedActivities, type ChannelActivity } from '@cpms/domain';
import { channelMapImport } from './channel-map.commands';

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => { const r = schema.safeParse(input); if (!r.success) throw new BadRequestException(r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; };
const timestamp = () => new Date().toISOString();
const copied = <T>(value: T): T => structuredClone(value);
const legalFields = ['number','vendor','serviceRecipient','marketScope','marketCodes','startDate','endDate','currency','signedAmount','signedVat'];


@Injectable()
export class ContractManagementApplicationService {
  constructor(@Inject(ContractsRepository) private readonly repository: ContractsRepository,
    @Inject(BookingRepository) private readonly bookings: BookingRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(DirectoryRepository) private readonly directory: DirectoryRepository) {}
  private admin() { const i = this.access.snapshot().identity; return i.effectiveSuperadmin && i.mode === 'DIRECT'; }
  private async catalogReader() {
    if (this.access.check('contract.read').allowed) this.access.require('contract.read');
    else if (this.access.check('contract.create').allowed) this.access.require('contract.create');
    else {
      const visible=(await this.repository.list()).find(c=>this.access.check('contract.read',contractAccessResource(c)).allowed);
      if (!visible) throw new ForbiddenException('Không có quyền xem danh mục nguồn cung.');
      this.access.require('contract.read',contractAccessResource(visible));
    }
  }
  async channelMap(actor?:ActorContext) { return this.access.run(actor,async()=>{await this.catalogReader();return this.repository.channelMap();}); }
  async importChannelMap(body:unknown,actor?:ActorContext) {
    const input=parse(channelMapImport,body);
    return this.access.run(actor,async()=>{
      this.access.require('contract.import');
      if(!this.admin())throw new ForbiddenException('Chỉ ADMIN trực tiếp được cập nhật danh mục kênh.');
      const {data}=input;
      for(const entries of [data.layers,data.channels,data.activities]) if(new Set(entries.map(e=>e.code)).size!==entries.length)throw new BadRequestException('Mã danh mục bị trùng.');
      for(const a of data.activities)if(!data.layers.some(l=>l.code===a.professionLayer)||!data.channels.some(c=>c.code===a.channelCode))throw new BadRequestException(`${a.code}: không tìm thấy lớp nghiệp vụ hoặc kênh cha.`);
      for(const c of await this.repository.list()){
        const local=localOwnedActivity(c);
        if(local){if(!data.layers.some(l=>l.code===local.professionLayer)||!data.channels.some(ch=>ch.code===local.channelCode)||data.activities.some(a=>a.code===local.code))throw new BadRequestException('Danh mục mới phải giữ lớp/kênh của hoạt động tạo tại CPMS và không dùng trùng mã hoạt động.');}
        else if(isOwnedChannel(c)&&!data.activities.some(a=>a.code===ownedActivityCode(c)&&a.supplyType==='INTERNAL'))throw new BadRequestException('Danh mục mới phải giữ hoạt động sở hữu đã có hồ sơ quản lý.');
      }
      const digest=createHash('sha256').update(JSON.stringify({...data,capturedAt:undefined})).digest('hex');
      return this.repository.saveChannelMap(data,digest,input.expectedVersion,this.access.snapshot().actor);
    });
  }
  async ownedChannels(actor?:ActorContext) {return this.access.run(actor,async()=>{
    await this.catalogReader();const catalog=await this.repository.channelMap();
    const profiles=(await this.repository.list()).filter(c=>c.supplyType==='INTERNAL'&&this.access.check('contract.read',contractAccessResource(c)).allowed);
    for(const c of profiles)this.access.require('contract.read',contractAccessResource(c));
    const managed=await Promise.all(profiles.map(async c=>{const ws=await this.workspace(c.id);return{...c,capabilities:ws.capabilities,pendingChange:ws.requests.some(r=>r.state==='PENDING')};}));
    return{catalog:withLocalOwnedActivities(catalog,profiles),profiles:managed,canCreate:this.access.check('contract.create').allowed};
  });}
  private async classifyItems(aggregate:SupplyAggregate,changes:ContractItemChanges) {
    const catalog=withLocalOwnedActivities(await this.repository.channelMap(),[aggregate.contract]),map=catalog.data;
    const oldRows=contractItemRows(aggregate,changes.periodId,changes.phase);
    for(const row of changes.rows){
      const old=oldRows.find(r=>r.slotId===row.slotId)?.value,value=row.value;
      delete value.classificationSnapshot;
      if(row.operation==='DELETE'){if(old?.classificationSnapshot)value.classificationSnapshot=copied(old.classificationSnapshot);continue;}
      const same=Boolean(old&&canonicalLayer(old.professionLayer)===canonicalLayer(value.professionLayer)&&canonicalChannel(old.channelCode)===canonicalChannel(value.channelCode)&&(old.activityCode??null)===(value.activityCode??null));
      if(same&&old?.classificationSnapshot){value.classificationSnapshot=copied(old.classificationSnapshot);continue;}
      if(same&&!value.activityCode)continue; // Legacy source rows remain editable without fabricated classifications.
      if(!map){if(value.activityCode)throw new BadRequestException('Danh mục kênh chưa được nhập.');continue;}
      const activity=activityForItem(map,value);
      if(!activity)throw new BadRequestException(`${value.name||value.code}: chọn đủ Lớp nghiệp vụ → Kênh → Hoạt động đúng danh mục.`);
      if(isOwnedChannel(aggregate.contract)&&activity.code!==ownedActivityCode(aggregate.contract))throw new BadRequestException('Hạng mục phải thuộc hoạt động của kênh sở hữu này.');
      value.professionLayer=activity.professionLayer;value.channelCode=activity.channelCode;
      value.classificationSnapshot={professionLayer:activity.professionLayer,professionLayerName:map.layers.find(l=>l.code===activity.professionLayer)!.name,channelCode:activity.channelCode,channelName:map.channels.find(c=>c.code===activity.channelCode)!.name,activityCode:activity.code,activityName:activity.name,catalogVersion:catalog.recordVersion};
    }
  }
  private async load(id: string) {
    const value = /^[0-9a-f-]{36}$/i.test(id) ? await this.repository.get(id) : null;
    if (!value || !this.access.check('contract.read', contractAccessResource(value.contract)).allowed) throw new NotFoundException('Không tìm thấy hợp đồng trong phạm vi được phân công.');
    this.access.require('contract.read', contractAccessResource(value.contract)); return value;
  }
  private version(c: SupplyContractView, expected: number) { if (c.recordVersion !== expected) throw new ConflictException('Hợp đồng đã đổi; tải lại và đối chiếu bản sửa trước khi lưu.'); }
  private editor(c: SupplyContractView, permission: 'contract.update'|'contract.delete'|'contract.restore' = 'contract.update') {
    this.access.require(permission, contractAccessResource(c));
    if (!this.admin() && ![c.managerActorId, c.leaderActorId].includes(this.access.snapshot().actor.id)) throw new ForbiddenException('Chỉ CV phụ trách hoặc LĐP phụ trách được sửa hồ sơ hợp đồng.');
  }
  private approver(c: SupplyContractView) {
    this.access.require('contract.approve', contractAccessResource(c));
    if (!this.admin() && c.leaderActorId !== this.access.snapshot().actor.id) throw new ForbiddenException('Chỉ LĐP phụ trách hợp đồng được phê duyệt.');
  }
  private async once<T>(key: string, body: unknown, work: () => Promise<T>): Promise<T> {
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex'), actor = this.access.snapshot().actor;
    const previous = await this.repository.command(`management:${key}`);
    if (previous) { if (previous.actorId !== actor.id || previous.digest !== digest) throw new ConflictException('Mã thao tác đã dùng cho nội dung khác.'); return previous.result as T; }
    const result = await work(); await this.repository.saveCommand(`management:${key}`, digest, result, actor); return result;
  }
  async workspace(id: string, actor?: ActorContext): Promise<ContractManagementWorkspace> {
    return this.access.run(actor, async () => {
      const { contract: c } = await this.load(id), resource = contractAccessResource(c), who = this.access.snapshot().actor.id;
      const [requests, revisions, policy, people, blocker] = await Promise.all([this.repository.requests(id), this.repository.revisions(id), this.repository.managementPolicy(), this.repository.managementPeople(), this.repository.purgeBlocker(id)]);
      const editRole = this.admin() || [c.managerActorId,c.leaderActorId].includes(who), pending = requests.some(r => r.state === 'PENDING');
      return { contract: c, validity: contractValidity(c), policy, requests: requests.filter(r => editRole || r.requesterActorId === who || r.state === 'APPROVED'),
        revisions: revisions.map(({ snapshot, ...r }) => { void snapshot; return r; }),
        people: editRole ? people : people.filter(p => resource.assignedActorIds.includes(p.id)),
        capabilities: { edit: !c.deletedAt && editRole && this.access.check('contract.update', resource).allowed,
          approve: (this.admin() || c.leaderActorId === who) && this.access.check('contract.approve', resource).allowed,
          delete: !c.deletedAt && editRole && this.access.check('contract.delete', resource).allowed,
          restore: Boolean(c.deletedAt) && editRole && this.access.check('contract.restore', resource).allowed,
          purge: Boolean(c.deletedAt) && !blocker && !pending && this.admin() && this.access.check('contract.purge', resource).allowed,
          purgeReason: blocker ?? (pending ? 'Hợp đồng còn đề nghị đang chờ duyệt.' : null), policy: this.access.check('contract.policy.manage').allowed } };
    });
  }
  async catalogs(actor?: ActorContext) { return this.access.run(actor, async () => { this.access.require('contract.create'); return { people: await this.repository.managementPeople(), policy: await this.repository.managementPolicy() }; }); }
  async items(id:string,periodId:string,phase:string,actor?:ActorContext){return this.access.run(actor,async()=>{const d=await this.load(id);if(!d.periods.some(p=>p.id===periodId)||!['BASELINE','EFFECTIVE'].includes(phase))throw new BadRequestException('Chọn kỳ phân bổ và giai đoạn.');return{rows:contractItemRows(d,periodId,phase as 'BASELINE'|'EFFECTIVE'),availableItems:d.slots.filter(s=>!d.allocations.some(a=>a.slotId===s.id&&a.periodId===periodId&&!a.supersededAt)&&!d.itemTerms?.some(t=>t.slotId===s.id&&t.periodId===periodId)).map(s=>({slotId:s.id,code:s.code,name:s.name,unit:s.quantityUnit??s.unit??'',unitPrice:s.unitPrice??'',priceBasis:s.priceBasis??'1',allowOverbook:slotOverbookAllowed(s)})),catalog:withLocalOwnedActivities(await this.repository.channelMap(),[d.contract]),layers:PROFESSION_LAYERS,channels:ITEM_CHANNELS,units:(await this.repository.catalogs()).units};});}
  private async validateItems(next:SupplyAggregate,previous:SupplyAggregate,submitting:boolean){
    const people=await this.repository.managementPeople(),units=(await this.repository.catalogs()).units;
    const changed=(next.itemTerms??[]).filter(t=>!previous.itemTerms?.some(o=>o.id===t.id&&o.recordVersion===t.recordVersion));
    for(const term of changed){for(const id of [term.effective.operatorActorId,term.effective.vendorActorId])if(id&&!people.some(p=>p.id===id))throw new BadRequestException('Nhân sự hạng mục không còn hoạt động.');
      for(const a of next.allocations.filter(a=>a.slotId===term.slotId&&a.periodId===term.periodId&&!a.supersededAt))if(a.beneficiaryUnitCode&&!units.some(u=>u.code===a.beneficiaryUnitCode))throw new BadRequestException('CQĐV hưởng hạn mức không hợp lệ.');}
    if(!submitting)return;
    await this.bookings.lock([next.contract.id]);
    const bookings=await this.bookings.all([next.contract.id]);
    const commitments=bookings.flatMap(reservationRows).filter(b=>reservedBooking(b).qty.gt(0));
    for(const term of changed){
      const slot=supplyItemSlot(next,term.slotId,term.periodId)!,before=supplyItemSlot(previous,term.slotId,term.periodId),period=next.periods.find(p=>p.id===term.periodId)!;
      if(slot.capacityMode==='EXCLUSIVE'&&before?.capacityMode!=='EXCLUSIVE'&&slotPeakConcurrency(term.slotId,bookings,period.startDate,period.endDate)>1)
        throw new BadRequestException(`${slot.name}: đang có đặt chỗ trùng khung thời gian. Xử lý các đặt chỗ này trước khi bỏ cho phép trùng lịch.`);
    }
    for(const a of next.allocations.filter(a=>!a.supersededAt&&a.scopeKind==='ENTITLEMENT')){const used=commitments.filter(b=>b.allocationId===a.id),limit=effectivePair(next,a,timestamp()),slot=supplyItemSlot(next,a.slotId??'',a.periodId);
      if(used.length&&(slot?.status!=='ACTIVE'||used.some(b=>slot.startDate&&b.startDate<slot.startDate||slot.endDate&&b.endDate>slot.endDate)))throw new BadRequestException('Hiệu lực hạng mục xung đột với Booking còn cam kết.');
      const qty=used.reduce((sum,b)=>sum.plus(reservedBooking(b).qty),decimal(0)),amount=used.reduce((sum,b)=>sum.plus(reservedBooking(b).amount),decimal(0));
      if(limit.qty!==null&&qty.gt(limit.qty)||limit.amount!==null&&amount.gt(limit.amount))throw new BadRequestException('Hạn mức mới thấp hơn Booking còn cam kết; xử lý Booking trước khi cắt giảm.');
    }
  }
  async revision(id: string, revisionId: string, actor?: ActorContext) { return this.access.run(actor, async () => { await this.load(id); const r = await this.repository.revision(revisionId); if (!r || r.contractId !== id) throw new NotFoundException('Không tìm thấy phiên bản.'); return r; }); }
  async policy(actor?: ActorContext) { return this.access.run(actor, async () => { this.access.require('contract.policy.manage'); return this.repository.managementPolicy(); }); }
  async configurePolicy(body: unknown, actor?: ActorContext) { const input = parse(managementPolicy, body); return this.access.run(actor, async () => { this.access.require('contract.policy.manage'); return this.repository.saveManagementPolicy(input.required, input.expectedVersion, input.reason, this.access.snapshot().actor); }); }
  private async code(vendorCode: string, start: string | null | undefined, requested?: string) {
    if (!start) throw new BadRequestException('Cần ngày bắt đầu hiệu lực dự kiến để đặt mã hợp đồng.');
    const prefix = `CON-${vendorCode}-${start.slice(0,7).replace('-','')}-`;
    if (requested) { if (!requested.startsWith(prefix)) throw new BadRequestException('Mã NCC và tháng trong mã phải khớp thông tin khi tạo hợp đồng.'); if (await this.repository.codeExists(requested)) throw new ConflictException('Mã hợp đồng đã tồn tại.'); return requested; }
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', chars = `${letters}0123456789`;
    for (let n = 0; n < 30; n++) {
      const tail = [letters[randomInt(26)]!, letters[randomInt(26)]!, ...Array.from({ length: 4 }, () => chars[randomInt(chars.length)]!)];
      for (let i = tail.length - 1; i > 0; i--) { const j = randomInt(i + 1); [tail[i],tail[j]] = [tail[j]!,tail[i]!]; }
      const code = prefix + tail.join(''); if (!await this.repository.codeExists(code)) return code;
    }
    throw new ConflictException('Chưa tạo được mã duy nhất; thử lại.');
  }
  private async validate(value: SupplyAggregate, previous: SupplyAggregate | null, submitting: boolean, evidence: string | null) {
    const c = value.contract, people = await this.repository.managementPeople();
    const marketCodes=c.marketCodes??[],marketScope=c.marketScope??'UNSPECIFIED';
    if(marketScope==='SELECTED'&&!marketCodes.length||marketScope!=='SELECTED'&&marketCodes.length)throw new BadRequestException('Chọn phạm vi thị trường và các thị trường tương ứng.');
    if(new Set(marketCodes).size!==marketCodes.length)throw new BadRequestException('Thị trường bị chọn trùng.');
    if(marketCodes.length){const markets=(await this.repository.catalogs()).markets,previousCodes=previous?.contract.marketCodes??[];if(marketCodes.some(code=>!markets.some(m=>m.code===code)&&!previousCodes.includes(code)))throw new BadRequestException('Thị trường không có trong danh mục đang hoạt động.');}
    if(isOwnedChannel(c)&&c.supplyType!=='INTERNAL')throw new BadRequestException('Hồ sơ kênh sở hữu phải giữ phân loại Sở hữu.');
    if(c.supplierId&&!c.supplierSnapshot){const supplier=(await this.directory.suppliers()).find(s=>s.id===c.supplierId&&s.isActive);if(!supplier)throw new BadRequestException('NCC không tồn tại hoặc ngừng sử dụng.');c.supplierSnapshot=copied(supplier);c.vendor=supplier.name;}
    if(c.supplierSnapshot)c.vendor=c.supplierSnapshot.name;
    if(c.leaderActorId&&(!c.responsibilitySnapshot||c.responsibilitySnapshot.leaderActorId!==c.leaderActorId)){const leader=(await this.directory.people()).find(p=>p.actorId===c.leaderActorId);if(leader)c.responsibilitySnapshot={leaderActorId:c.leaderActorId,employeeCode:leader.employeeCode,leaderName:leader.fullName,email:leader.email,departmentName:leader.departmentName,organizationName:leader.organizationName,directoryVersion:leader.recordVersion,capturedAt:timestamp()};}
    if (!c.name.trim()) throw new BadRequestException('Cần tên hợp đồng.');
    for (const id of [c.managerActorId,c.leaderActorId,c.vendorActorId]) if (id && !people.some(p => p.id === id)) throw new BadRequestException('Nhân sự được chọn không còn hoạt động.');
    c.managerEmail = people.find(p => p.id === c.managerActorId)?.email ?? null;
    c.leaderName = people.find(p => p.id === c.leaderActorId)?.name ?? null; c.managerName = people.find(p => p.id === c.managerActorId)?.name ?? null;
    c.vendorContactEmail = people.find(p => p.id === c.vendorActorId)?.email ?? null;
    if (c.startDate && c.endDate && c.startDate > c.endDate) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    if ([c.signedAmount,c.signedVat].some(n => n !== null && decimal(n).lt(0))) throw new BadRequestException('Giá trị hợp đồng không được âm.');
    c.signedGross = c.signedAmount !== null && c.signedVat !== null ? numeric(decimal(c.signedAmount).plus(c.signedVat),6) : null;
    if (submitting && (!c.managerActorId || !c.startDate || !c.endDate)) throw new BadRequestException('Cần CV phụ trách và đủ thời gian hiệu lực trước khi áp dụng.');
    if (submitting && !isOwnedChannel(c) && previous?.contract.currentRevisionId && legalFields.some(key => JSON.stringify(previous.contract[key as keyof SupplyContractView]) !== JSON.stringify(c[key as keyof SupplyContractView])) && !evidence?.trim()) throw new BadRequestException('Thay đổi thông tin pháp lý cần căn cứ hoặc liên kết tài liệu.');
    if (submitting && previous && (c.startDate !== previous.contract.startDate || c.endDate !== previous.contract.endDate)) {
      const periods = value.periods.filter(p => value.allocations.some(a => a.periodId === p.id && !a.supersededAt && a.status === 'APPROVED'));
      if (periods.some(p => c.startDate && p.startDate < c.startDate || c.endDate && p.endDate > c.endDate)) throw new BadRequestException('Thời hạn mới không bao phủ các kỳ phân bổ đã áp dụng. Chưa được sửa kỳ/slot trong chức năng này.');
      const bookings = await this.bookings.all([c.id]);
      if (bookings.flatMap(bookingCommitments).some(b => c.startDate && b.startDate < c.startDate || c.endDate && b.endDate > c.endDate)) throw new BadRequestException('Thời hạn mới xung đột với Booking còn cam kết; không tự thay đổi dữ liệu Booking cũ.');
    }
  }
  private async publish(value: SupplyAggregate, previous: SupplyAggregate, request: ContractChangeRequest) {
    const actor = this.access.snapshot().actor, revisions = await this.repository.revisions(value.contract.id);
    const id = randomUUID(); value.contract.recordVersion++; value.contract.localRevision++; value.contract.currentRevisionId = id;
    const revision: ContractRevision = { id, contractId: value.contract.id, version: (revisions[0]?.version ?? 0) + 1, snapshot: copied(value), provenance: 'PUBLISHED', reason: request.reason, evidence: request.evidence, createdByActorId: request.requesterActorId,
      approvedByActorId: request.approvalRequired ? actor.id : null, createdAt: timestamp() };
    await this.repository.createRevision(revision);
    await this.repository.save(value, previous, actor, `contract.${request.kind.toLowerCase()}.apply`);
  }
  private changed(value: SupplyAggregate, request: Pick<ContractChangeRequest,'kind'|'fields'|'reason'|'evidence'>, submitting=true) {
    const next = copied(value), c = next.contract;
    if (request.kind === 'EDIT') { const {itemChanges,newPeriod,...fields}=request.fields;Object.assign(c,fields);if('supplierId' in fields&&!('supplierSnapshot' in fields))c.supplierSnapshot=null;if('leaderActorId' in fields&&!('responsibilitySnapshot' in fields))c.responsibilitySnapshot=null;
      if('vendor' in fields&&c.supplierId&&!('supplierId' in fields)&&fields.vendor!==c.supplierSnapshot?.name)throw new BadRequestException('Chọn nhà cung cấp từ Danh bạ trong Sửa thông tin.');
      if(newPeriod){const p=newPeriod as {id:string;name:string;startDate:string;endDate:string};
        if(next.periods.some(o=>o.id===p.id)||p.startDate>p.endDate||!c.startDate||!c.endDate||p.startDate<c.startDate||p.endDate>c.endDate)throw new BadRequestException('Kỳ mới phải nằm trong thời hạn hợp đồng.');
        if(next.periods.some(o=>o.kind!=='CONTRACT'&&p.startDate<=o.endDate&&p.endDate>=o.startDate))throw new BadRequestException('Kỳ mới trùng thời gian kỳ phân bổ hiện có.');
        next.periods.push({...p,code:'P-'+p.id.slice(0,8).toUpperCase(),kind:'CUSTOM'});
      }
      if(itemChanges)applyContractItems(next,itemChanges as ContractItemChanges,{actorId:this.access.snapshot().actor.id,reason:request.reason,evidence:request.evidence,submitting,at:timestamp()});
      if (c.status === 'DRAFT') c.status = 'ACTIVE'; }
    if (request.kind === 'PAUSE') c.status = 'PAUSED';
    if (request.kind === 'RESUME') c.status = 'ACTIVE';
    if (request.kind === 'DELETE') c.deletedAt = timestamp();
    if (request.kind === 'RESTORE') c.deletedAt = null;
    return next;
  }
  async create(body: unknown, actor?: ActorContext) {
    const input = parse(managementCreate, body);
    return this.access.run(actor, () => this.once(input.idempotencyKey, input, async () => {
      this.access.require('contract.create'); const who = this.access.snapshot().actor;
      const map=(await this.repository.channelMap()).data;
      let owned:ChannelActivity|null|undefined=input.ownedActivityCode?map?.activities.find(a=>a.code===input.ownedActivityCode&&a.supplyType==='INTERNAL'):null;
      if(input.newOwnedActivity){
        const layer=canonicalLayer(input.newOwnedActivity.professionLayer),channel=canonicalChannel(input.newOwnedActivity.channelCode);
        if(!map?.layers.some(l=>l.code===layer)||!map.channels.some(ch=>ch.code===channel))throw new BadRequestException('Chọn lớp nghiệp vụ và kênh có trong danh mục.');
        if(!input.fields.name?.trim())throw new BadRequestException('Nhập tên hoạt động sở hữu.');
        owned={code:`OWN-${randomUUID().toUpperCase()}`,name:input.fields.name,professionLayer:layer!,channelCode:channel!,supplyType:'INTERNAL',unit:'',description:''};
      }
      if(input.ownedActivityCode&&!owned)throw new BadRequestException('Chọn hoạt động Sở hữu trong danh mục kênh.');
      if(owned&&(await this.repository.list()).some(c=>ownedActivityCode(c)===owned.code))throw new ConflictException('Hoạt động đã có hồ sơ quản lý. Mở hồ sơ hiện có hoặc liên hệ người phụ trách.');
      const c: SupplyContractView = { id: randomUUID(), code: await this.code(input.vendorCode,input.fields.startDate,input.code), vendorCode: input.vendorCode, codeLocked: true,
        number: null, name: '', vendor: null, serviceRecipient:'VNA', marketScope:'UNSPECIFIED', marketCodes:[], supplyType: 'PAID', ownerUnitCode: null, ownerDepartment: null, managerActorId: who.id, managerEmail: null, leaderActorId: null, vendorActorId: null,
        startDate: null, endDate: null, currency: 'VND', signedAmount: null, signedVat: null, signedGross: null, status: 'DRAFT', dossierUrl: null, source: {}, quality: [], recordVersion: 1, localRevision: 1, createdByActorId: who.id };
      Object.assign(c,input.fields);
      if(owned){c.supplyType='INTERNAL';c.source={kind:'OWNED_MEDIA',ownedActivityCode:owned.code,activity:copied(owned),...(input.newOwnedActivity?{activityOrigin:'LOCAL'}:{})};c.number=null;c.vendor=null;c.supplierId=null;c.signedAmount??='0';c.signedVat??='0';input.fields.supplyType='INTERNAL';}
      const aggregate: SupplyAggregate = { contract: c, slots: [], periods: [], allocations: [], adjustments: [] };
      await this.validate(aggregate,null,false,null); await this.repository.save(aggregate,null,who,'contract.create');
      const result = await this.saveChange(aggregate,{ ...input, expectedVersion: 1, kind: 'EDIT' }); return { ...result, code: c.code };
    }));
  }
  async change(id: string, body: unknown, actor?: ActorContext) { const input = parse(managementChange,body); return this.access.run(actor, () => this.once(input.idempotencyKey,{id,...input},async () => this.saveChange(await this.load(id),input))); }
  private async saveChange(aggregate: SupplyAggregate, input: z.infer<typeof managementChange>) {
    const c = aggregate.contract, actor = this.access.snapshot().actor;
    if (!c.codeLocked) throw new ConflictException('Hồ sơ nhập từ nguồn cần được khởi tạo mã và phiên bản trước khi sửa thông tin hợp đồng.');
    this.version(c,input.expectedVersion); this.editor(c,input.kind === 'RESTORE' ? 'contract.restore' : input.kind === 'DELETE' ? 'contract.delete' : 'contract.update');
    if(input.itemChanges)await this.classifyItems(aggregate,input.itemChanges as ContractItemChanges);
    if (Boolean(c.deletedAt) !== (input.kind === 'RESTORE')) throw new BadRequestException(c.deletedAt ? 'Phục hồi hợp đồng trước khi sửa.' : 'Hợp đồng chưa nằm trong Thùng rác.');
    if (input.kind !== 'EDIT' && (Object.keys(input.fields).length||input.itemChanges||input.newPeriod)) throw new BadRequestException('Thao tác vòng đời không nhận kèm sửa nội dung.');
    if (input.kind === 'RESUME' && !['PAUSED','ARCHIVED'].includes(c.status)) throw new BadRequestException('Hợp đồng không đang tạm dừng.');
    const requests = await this.repository.requests(c.id), previous = input.requestId ? requests.find(r => r.id === input.requestId) : null;
    if (input.requestId && (!previous || previous.requesterActorId !== actor.id || !['DRAFT','RETURNED','WITHDRAWN'].includes(previous.state))) throw new ConflictException('Không thể sửa đề nghị này; rút đề nghị chờ duyệt trước.');
    if (previous && previous.recordVersion !== input.expectedRequestVersion) throw new ConflictException('Bản nháp đã thay đổi.');
    if (requests.some(r => r.state === 'PENDING')) throw new ConflictException('Hợp đồng có đề nghị chờ duyệt; xử lý hoặc rút đề nghị trước khi sửa tiếp.');
    const policy = await this.repository.managementPolicy(), required = previous?.approvalRequired === true || policy.required;
    const request: ContractChangeRequest = { id: previous?.id ?? randomUUID(), contractId: c.id, kind: input.kind, state: 'DRAFT', fields: {...input.fields,...(input.itemChanges?{itemChanges:input.itemChanges}:{}),...(input.newPeriod?{newPeriod:input.newPeriod}:{})}, reason: input.reason, evidence: input.evidence ?? null,
      baseVersion: c.recordVersion, baseRevisionId: c.currentRevisionId ?? null, recordVersion: (previous?.recordVersion ?? 0) + 1, requesterActorId: actor.id, leaderActorId: c.leaderActorId ?? null,
      policyVersion: policy.version, approvalRequired: required, submittedAt: null, decidedAt: null, decidedByActorId: null, decisionReason: null, createdAt: previous?.createdAt ?? timestamp(), updatedAt: timestamp() };
    const next = this.changed(aggregate,request,input.mode!=='DRAFT');
    if(input.itemChanges)await this.validateItems(next,aggregate,input.mode!=='DRAFT');
    if (input.kind === 'EDIT') await this.validate(next,aggregate,input.mode !== 'DRAFT',request.evidence);
    if('supplierId' in input.fields)request.fields.supplierSnapshot=copied(next.contract.supplierSnapshot??null);if('leaderActorId' in input.fields)request.fields.responsibilitySnapshot=copied(next.contract.responsibilitySnapshot??null);
    if (input.mode !== 'DRAFT') {
      if (!request.reason) throw new BadRequestException('Ghi lý do trước khi gửi hoặc áp dụng thay đổi.');
      if (input.mode === 'SELF_APPROVE') this.approver(c);
      if (required && input.mode !== 'SELF_APPROVE') {
        if (!c.leaderActorId || !await this.access.eligibleContractActor(contractAccessResource(c),'contract.approve',c.leaderActorId)) throw new BadRequestException('Cần LĐP phụ trách đang hoạt động và có quyền nhận phê duyệt.');
        request.state = 'PENDING'; request.submittedAt = timestamp();
      } else {
        await this.publish(next,aggregate,request); request.state = 'APPROVED'; request.submittedAt = timestamp(); request.decidedAt = timestamp(); request.decidedByActorId = actor.id;
        request.decisionReason = required ? 'LĐP/ADMIN tự sửa và tự duyệt' : 'Áp dụng theo chính sách không bắt buộc duyệt';
      }
    }
    await this.repository.saveRequest(request,previous ?? null,actor);
    return { contractId: c.id, request, applied: request.state === 'APPROVED' };
  }
  async decide(id: string, requestId: string, body: unknown, actor?: ActorContext) {
    const input = parse(managementDecision,body);
    return this.access.run(actor, () => this.once(input.idempotencyKey,{id,requestId,...input},async () => {
      const aggregate = await this.load(id), c = aggregate.contract, who = this.access.snapshot().actor;
      this.version(c,input.expectedVersion); const old = (await this.repository.requests(id)).find(r => r.id === requestId);
      if (!old || old.recordVersion !== input.expectedRequestVersion) throw new ConflictException('Đề nghị đã thay đổi.');
      if (!['DRAFT','PENDING','RETURNED'].includes(old.state)) throw new ConflictException('Đề nghị đã kết thúc.');
      const next = { ...old, recordVersion: old.recordVersion + 1, updatedAt: timestamp() };
      if (input.action === 'WITHDRAW') {
        if (who.id !== old.requesterActorId) throw new ForbiddenException('Chỉ người gửi được rút đề nghị.');
        next.state = 'WITHDRAWN';
      } else {
        this.approver(c);
        if (old.state !== 'PENDING') throw new ConflictException('Đề nghị chưa được gửi duyệt.');
        if (old.baseVersion !== c.recordVersion || old.baseRevisionId !== (c.currentRevisionId ?? null)) throw new ConflictException('Phiên bản hợp đồng gốc đã đổi; cần lập lại đề nghị.');
        if (!this.admin() && old.leaderActorId !== who.id) throw new ForbiddenException('Đề nghị không được giao cho tài khoản này.');
        if (input.action === 'APPROVE') {
          if (!this.admin() && !await this.access.eligibleContractActor(contractAccessResource(c), old.kind === 'RESTORE' ? 'contract.restore' : old.kind === 'DELETE' ? 'contract.delete' : 'contract.update',old.requesterActorId)) throw new ForbiddenException('Người đề nghị không còn quyền thực hiện thay đổi.');
          const value = this.changed(aggregate,old); if(old.fields.itemChanges)await this.validateItems(value,aggregate,true);if (old.kind === 'EDIT') await this.validate(value,aggregate,true,old.evidence); await this.publish(value,aggregate,old); next.state = 'APPROVED';
        } else { if (!input.reason.trim()) throw new BadRequestException('Cần lý do trả lại.'); next.state = 'RETURNED'; }
        next.decidedByActorId = who.id; next.decidedAt = timestamp(); next.decisionReason = input.reason;
      }
      await this.repository.saveRequest(next,old,who); return { contractId: id, request: next, applied: next.state === 'APPROVED' };
    }));
  }
  async inbox(actor?: ActorContext) { return this.access.run(actor, async () => {
    const contracts = await this.repository.list(), requests = await this.repository.requests(), who = this.access.snapshot().actor.id;
    return requests.flatMap(r => { const c = contracts.find(c => c.id === r.contractId); if (!c || !this.access.check('contract.read',contractAccessResource(c)).allowed) return [];
      const mine = r.requesterActorId === who, pending = r.state === 'PENDING' && r.leaderActorId === who && c.leaderActorId === who && this.access.check('contract.approve',contractAccessResource(c)).allowed;
      if (!mine && !pending) return []; this.access.require('contract.read',contractAccessResource(c));
      return [{ request: r, contract: c, section: pending ? 'PENDING' : 'FOLLOWING', canDecide: pending }]; });
  }); }
  async purge(id: string, body: unknown, actor?: ActorContext) { const input = parse(managementPurge,body); return this.access.run(actor, () => this.once(input.idempotencyKey,{id,...input},async () => {
    const { contract: c } = await this.load(id); this.access.require('contract.purge',contractAccessResource(c)); this.version(c,input.expectedVersion);
    if (!this.admin() || !c.deletedAt || input.confirmationCode !== c.code) throw new BadRequestException('Chỉ ADMIN được xóa vĩnh viễn hồ sơ trong Thùng rác sau khi nhập đúng mã hợp đồng.');
    if ((await this.repository.requests(id)).some(r => r.state === 'PENDING')) throw new ConflictException('Xử lý đề nghị chờ duyệt trước khi xóa.');
    await this.repository.purgeEmptyContract(id,this.access.snapshot().actor,input.reason); return { contractId: id, purged: true };
  })); }
  async adopt(body: unknown, actor?: ActorContext) { const input = parse(managementAdopt,body); return this.access.run(actor, () => this.once(input.idempotencyKey,input,async () => {
    this.access.require('access.manage'); if (!this.admin()) throw new ForbiddenException('Khởi tạo cần ADMIN trực tiếp.');
    const who = this.access.snapshot().actor; await this.repository.initializeManagementPermissions(who);
    const result: Array<{id:string;before:string;code:string;bookingsPinned:number}> = [];
    const assignments = await this.bookings.allocationAccess();
    for (const item of input.contracts) {
      const old = await this.load(item.id); this.version(old.contract,item.expectedVersion);
      if (old.contract.currentRevisionId || old.contract.codeLocked) throw new ConflictException('Hợp đồng đã được khởi tạo; mã đã khóa.');
      const rows = assignments.filter(a => old.allocations.some(l => !l.supersededAt && l.id === a.allocationId));
      const leaders = [...new Set(rows.flatMap(a => a.leaderActorIds))], vendors = [...new Set(rows.flatMap(a => a.vendorActorIds))];
      const captured: ContractRevision = { id: randomUUID(), contractId: item.id, version: 1, snapshot: copied(old), provenance: 'MIGRATION_CAPTURE', reason: 'Chốt dữ liệu hiện có khi bổ sung phiên bản; không khẳng định đây là bản tại ngày Booking được tạo.', evidence: null, createdByActorId: who.id, approvedByActorId: null, createdAt: timestamp() };
      await this.repository.createRevision(captured);
      const bookings = await this.bookings.all([item.id]);
      for (const before of bookings) {
        if (before.contractRevisionId) continue;
        const snapshot = contractBookingSnapshot(captured,before.allocationId), next = { ...before, contractRevisionId: captured.id, contractSnapshot: snapshot, recordVersion: before.recordVersion + 1, updatedAt: timestamp() };
        if (next.workflow?.effective) next.workflow = { ...next.workflow, effective: { ...next.workflow.effective, contractRevisionId: captured.id, contractSnapshot: contractBookingSnapshot(captured,next.workflow.effective.allocationId) } };
        await this.bookings.save(next,before,who,'booking.contract-version.capture');
      }
      const value = copied(old); value.contract.code = await this.code(item.vendorCode,old.contract.startDate,item.code); value.contract.vendorCode = item.vendorCode; value.contract.codeLocked = true;
      value.contract.leaderActorId = leaders.length === 1 ? leaders[0]! : null; value.contract.vendorActorId = vendors.length === 1 ? vendors[0]! : null;
      await this.validate(value,null,false,null); await this.repository.preserveCodeAlias(item.id,old.contract.code);
      const request = { requesterActorId: who.id, approvalRequired: false, reason: 'Khởi tạo mã nội bộ và phân công từ dữ liệu hiện có theo yêu cầu chủ sản phẩm; không tạo lịch sử duyệt quá khứ.', evidence: null, kind: 'EDIT' } as ContractChangeRequest;
      await this.publish(value,old,request); result.push({ id: item.id, before: old.contract.code, code: value.contract.code, bookingsPinned: bookings.length });
    }
    return { contracts: result };
  })); }
}
