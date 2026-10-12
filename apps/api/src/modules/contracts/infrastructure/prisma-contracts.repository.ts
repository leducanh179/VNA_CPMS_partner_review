import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActorContext, SupplyAggregate, SupplyContractView, SupplyImportPreview, SupplySourceSnapshot } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ContractsRepository, type SupplyImportRecord } from '../application/contracts.repository';
import type { NormalizedSupplyImport } from '../domain/source-import';
import type { SupplyPivotView } from '@cpms/domain';
import { parseSourceNumber } from '../domain/supply-engine';
import type { ContractChangeRequest, ContractManagementPolicy, ContractRevision } from '@cpms/domain';
import { ACCESS_CATALOG } from '../../access/application/access-catalog';
import type { ChannelMapCatalog, SupplyChannelMap } from '@cpms/domain';
import { projectQcttChannelMap, emptyQcttCatalogFields, type QcttCatalogEntry } from '@cpms/domain';
import { QcttCatalogRepository } from '../../qctt-catalog/application/qctt-catalog.repository';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const date = (value: string | null) => value ? new Date(value) : null;

@Injectable()
export class PrismaContractsRepository extends ContractsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QcttCatalogRepository) private readonly qcttCatalog: QcttCatalogRepository) { super(); }
  private get db() { return this.prisma.database; }
  async channelMap(): Promise<ChannelMapCatalog> {
    return projectQcttChannelMap(await this.qcttCatalog.entries(),await this.qcttCatalog.version(),new Date().toISOString().slice(0,10));
  }
  async saveChannelMap(data:SupplyChannelMap,digest:string,expectedVersion:number,actor:ActorContext) {
    const old = await this.channelMap();
    if (old.recordVersion !== expectedVersion) throw new ConflictException('Danh mục kênh đã đổi; tải lại trước khi nhập.');
    const entries=await this.qcttCatalog.entries(),reserved=await this.qcttCatalog.reservedCodes(),now=new Date().toISOString();
    for(const [kind,rows] of [['LAYER',data.layers],['CHANNEL',data.channels],['ACTIVITY',data.activities]] as const){
      for(const row of rows){
        if(reserved.includes(row.code))throw new ConflictException('Không được tái sử dụng mã đã xóa.');
        const before=entries.find(e=>e.code===row.code)??null;
        if(before?.deletedAt||before&&before.kind!==kind)throw new ConflictException('Mã danh mục đang trong Thùng rác hoặc thuộc loại khác.');
        const activity='professionLayer' in row?row:null;
        if(before&&activity&&['layerCode','channelCode','supplyType'].some(key=>before[key as keyof QcttCatalogEntry]!==({layerCode:activity.professionLayer,channelCode:activity.channelCode,supplyType:activity.supplyType} as Record<string,unknown>)[key])&&(await this.qcttCatalog.usage(row.code)).some(u=>u.category!=='Danh mục phụ thuộc'&&u.count>0))throw new ConflictException(`${row.code} đã được sử dụng; tạo mã thay thế để đổi phân loại.`);
        const next:QcttCatalogEntry={...emptyQcttCatalogFields(),...before,code:row.code,kind,name:row.name,status:'ACTIVE',
          ...(activity?{layerCode:activity.professionLayer,channelCode:activity.channelCode,supplyType:activity.supplyType,ownerOrgName:before?.ownerOrgName||'Chưa rà soát'}:{}),
          source:{origin:'LEGACY_IMPORT',url:data.sourceUrl,capturedAt:data.capturedAt},recordVersion:(before?.recordVersion??0)+1,
          deletedAt:null,createdAt:before?.createdAt??now,updatedAt:now};
        if(!before||before.name!==next.name||before.status!==next.status||before.layerCode!==next.layerCode||before.channelCode!==next.channelCode||before.supplyType!==next.supplyType)await this.qcttCatalog.save(next,before,actor,'catalog.legacy-import');
      }
    }
    await this.managementAudit(actor,'channel-map','contract.channel-map.import',{before:old,after:data,digest});
    return this.channelMap();
  }
  async revisions(contractId: string) { return wire<ContractRevision[]>(await this.db.supplyContractRevision.findMany({ where: { contractId }, orderBy: { version: 'desc' } })); }
  async revision(id: string) { return wire<ContractRevision | null>(await this.db.supplyContractRevision.findUnique({ where: { id } })); }
  async createRevision(revision: ContractRevision) {
    await this.db.supplyContractRevision.create({ data: { ...revision, snapshot: json(revision.snapshot), createdAt: new Date(revision.createdAt) } });
  }
  async requests(contractId?: string) { return wire<ContractChangeRequest[]>(await this.db.supplyContractChangeRequest.findMany({ where: contractId ? { contractId } : {}, orderBy: { createdAt: 'desc' }, take: 5000 })); }
  async saveRequest(request: ContractChangeRequest, previous: ContractChangeRequest | null, actor: ActorContext) {
    const { id, ...rest } = request;
    const data = { ...rest, fields: json(rest.fields), createdAt: new Date(rest.createdAt), updatedAt: new Date(rest.updatedAt), submittedAt: date(rest.submittedAt), decidedAt: date(rest.decidedAt) };
    if (previous) {
      const result = await this.db.supplyContractChangeRequest.updateMany({ where: { id, recordVersion: previous.recordVersion }, data });
      if (result.count !== 1) throw new ConflictException('Đề nghị đã thay đổi; tải lại trước khi xử lý.');
    } else await this.db.supplyContractChangeRequest.create({ data: { id, ...data } });
    await this.managementAudit(actor, request.contractId, `contract.request.${request.state.toLowerCase()}`, { before: previous, after: request });
  }
  async managementPolicy(): Promise<ContractManagementPolicy> {
    return wire<ContractManagementPolicy>(await this.db.supplyContractPolicy.findFirst({ orderBy: { version: 'desc' } }) ?? { version: 0, required: true, reason: 'Mặc định bắt buộc LĐP phê duyệt', actorId: null, createdAt: null });
  }
  async saveManagementPolicy(required: boolean, expectedVersion: number, reason: string, actor: ActorContext) {
    const old = await this.managementPolicy();
    if (old.version !== expectedVersion) throw new ConflictException('Chính sách đã thay đổi.');
    await this.db.supplyContractPolicy.create({ data: { version: old.version + 1, required, reason, actorId: actor.id } });
    await this.managementAudit(actor, 'policy', 'contract.policy', { before: old, required, reason });
    return this.managementPolicy();
  }
  async managementPeople() { return (await this.db.actor.findMany({ where: { isActive: true }, select: { id: true, displayName: true, loginEmail: true }, orderBy: { displayName: 'asc' } })).map(p => ({ id: p.id, name: p.displayName, email: p.loginEmail })); }
  async managementAudit(actor: ActorContext, contractId: string, action: string, data: unknown) {
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', entityType: 'contract', entityId: contractId, action, payload: json(data) } });
  }
  async initializeManagementPermissions(actor: ActorContext) {
    const created = await this.db.permissionDefinition.createMany({ data: ACCESS_CATALOG.filter(p => p.code.startsWith('contract.')), skipDuplicates: true });
    if (created.count) {
      await this.db.accessPolicyState.upsert({ where: { key: 'access' }, create: { key: 'access' }, update: { recordVersion: { increment: 1 } } });
      await this.managementAudit(actor, 'policy', 'contract.permissions.initialize', { count: created.count });
    }
  }
  async preserveCodeAlias(contractId: string, code: string) {
    if (!await this.db.supplyContractAlias.findFirst({ where: { contractId, provider: 'CPMS_LEGACY', alias: code } })) await this.db.supplyContractAlias.create({ data: { contractId, provider: 'CPMS_LEGACY', sourceId: contractId, alias: code, evidence: 'Mã trước khi áp dụng quy tắc mã hợp đồng bất biến' } });
  }
  async codeExists(code: string) { return Boolean(await this.db.supplyContract.findUnique({ where: { code }, select: { id: true } })); }
  async purgeBlocker(contractId: string) {
    if (await this.db.bookingRecord.count({ where: { contractId } })) return 'Hợp đồng còn Booking tham chiếu, bao gồm Booking trong Thùng rác.';
    if (await this.db.bookingRevision.count({ where: { data: { path: ['before', 'contractId'], equals: contractId } } })) return 'Hợp đồng còn được tham chiếu trong lịch sử Booking.';
    if (await this.db.supplyPeriod.count({ where: { contractId } }) || await this.db.supplyAllocationPlan.count({ where: { contractId } }) || await this.db.supplyAdjustmentGroup.count({ where: { contractId } }) || await this.db.supplyFinancialLine.count({ where: { contractId } }) || await this.db.bookingReportTemplate.count({ where: { contractId } }) || await this.db.supplySlot.count({ where: { contractId } }) || await this.db.supplyAllocation.count({ where: { contractId } }) || await this.db.supplyImport.count({ where: { contractId } }) || await this.db.supplyLegalRevision.count({ where: { contractId } })) return 'Chỉ xóa vĩnh viễn hồ sơ nhập nhầm chưa phát sinh slot, nguồn nhập hoặc nghiệp vụ phụ thuộc.';
    return null;
  }
  async purgeEmptyContract(contractId: string, actor: ActorContext, reason: string) {
    const blocker = await this.purgeBlocker(contractId); if (blocker) throw new ConflictException(blocker);
    const before = await this.get(contractId), revisions = await this.revisions(contractId), requests = await this.requests(contractId);
    await this.db.supplyContract.update({ where: { id: contractId }, data: { currentRevisionId: null } });
    await this.db.supplyPivotView.deleteMany({ where: { contractId } });
    await this.db.supplyContractChangeRequest.deleteMany({ where: { contractId } });
    await this.db.supplyContractRevision.deleteMany({ where: { contractId } });
    await this.db.supplyContractAlias.deleteMany({ where: { contractId } });
    await this.db.supplyContract.delete({ where: { id: contractId } });
    await this.managementAudit(actor, contractId, 'contract.purge', { before, revisions, requests, reason });
  }
  async pivotViews(contractId: string, actorId: string) {
    return wire<SupplyPivotView[]>(await this.db.supplyPivotView.findMany({ where: { contractId, actorId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, contractId: true, name: true, definition: true, isDefault: true, recordVersion: true, updatedAt: true } }));
  }
  private async auditPivot(action: string, view: SupplyPivotView, previous: SupplyPivotView | null, actor: ActorContext) {
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
      contextMode: actor.session?.mode ?? 'DIRECT', action, entityType: 'contract-pivot-view', entityId: view.id,
      payload: json({ contractId: view.contractId, before: previous, after: action.endsWith('.delete') ? null : view }) } });
  }
  async savePivotView(view: SupplyPivotView, previous: SupplyPivotView | null, actor: ActorContext) {
    const previousDefaults = view.isDefault ? (await this.pivotViews(view.contractId, actor.id)).filter(v => v.isDefault && v.id !== view.id) : [];
    if (view.isDefault) await this.db.supplyPivotView.updateMany({ where: { actorId: actor.id, contractId: view.contractId, id: { not: view.id }, isDefault: true }, data: { isDefault: false, recordVersion: { increment: 1 } } });
    for (const old of previousDefaults) await this.auditPivot('contract.pivot-view.update', { ...old, isDefault: false, recordVersion: old.recordVersion + 1, updatedAt: view.updatedAt }, old, actor);
    const data = { name: view.name, definition: json(view.definition), isDefault: view.isDefault, recordVersion: view.recordVersion };
    if (previous) {
      const saved = await this.db.supplyPivotView.updateMany({ where: { id: view.id, actorId: actor.id, contractId: view.contractId, recordVersion: previous.recordVersion }, data });
      if (saved.count !== 1) throw new ConflictException('View đã đổi; tải lại trước khi lưu.');
    } else await this.db.supplyPivotView.create({ data: { ...data, id: view.id, actorId: actor.id, contractId: view.contractId } });
    await this.auditPivot(previous ? 'contract.pivot-view.update' : 'contract.pivot-view.create', view, previous, actor);
  }
  async deletePivotView(view: SupplyPivotView, actor: ActorContext) {
    const result = await this.db.supplyPivotView.deleteMany({ where: { id: view.id, actorId: actor.id, contractId: view.contractId, recordVersion: view.recordVersion } });
    if (result.count !== 1) throw new ConflictException('View đã đổi; tải lại trước khi xóa.');
    await this.auditPivot('contract.pivot-view.delete', view, view, actor);
  }
  private async decorate(contracts: SupplyContractView[]) {
    const [people, assignments] = await Promise.all([this.managementPeople(), this.db.supplyAllocation.findMany({ where: { contractId: { in: contracts.map(c => c.id) }, supersededAt: null }, select: { contractId: true, bookingAccess: true } })]);
    return contracts.map(c => ({ ...c, startDate: c.startDate?.slice(0,10) ?? null, endDate: c.endDate?.slice(0,10) ?? null,
      assignedActorIds: [...new Set(assignments.filter(a => a.contractId === c.id).flatMap(a => [a.bookingAccess?.leaderActorIds, a.bookingAccess?.operatorActorIds, a.bookingAccess?.beneficiaryActorIds, a.bookingAccess?.vendorActorIds].flatMap(ids => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])))],
      leaderName: people.find(p => p.id === c.leaderActorId)?.name ?? null, managerName: people.find(p => p.id === c.managerActorId)?.name ?? null,
      vendorContactEmail: people.find(p => p.id === c.vendorActorId)?.email ?? null }));
  }
  async list() { return this.decorate(wire<SupplyContractView[]>(await this.db.supplyContract.findMany({ orderBy: { updatedAt: 'desc' }, take: 5000 }))); }
  async get(id: string): Promise<SupplyAggregate | null> {
    const contract = await this.db.supplyContract.findUnique({ where: { id } }); if (!contract) return null;
    const [slots, periods, allocations, adjustments, itemTerms] = await Promise.all([
      this.db.supplySlot.findMany({ where: { contractId: id }, include: { bookers: true }, orderBy: { code: 'asc' } }),
      this.db.supplyPeriod.findMany({ where: { contractId: id }, orderBy: { startDate: 'asc' } }),
      this.db.supplyAllocation.findMany({ where: { contractId: id }, orderBy: { sourceKey: 'asc' } }),
      this.db.supplyAdjustmentGroup.findMany({ where: { contractId: id }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
      this.db.supplyItemTerm.findMany({where:{contractId:id}}),
    ]);
    const result=wire<SupplyAggregate>({ contract, slots, periods, allocations, adjustments, itemTerms });
    result.contract = (await this.decorate([result.contract]))[0]!;
    for(const range of [result.contract,...result.slots,...result.periods]){if(range.startDate)range.startDate=range.startDate.slice(0,10);if(range.endDate)range.endDate=range.endDate.slice(0,10);}
    for(const group of result.adjustments)if(group.effectiveDate)group.effectiveDate=group.effectiveDate.slice(0,10);
    return result;
  }
  async catalogs() {
    const [units,people,actors,markets] = await Promise.all([
      this.db.organizationUnit.findMany({ where: { isActive: true }, select: { code: true, displayName: true, sourceName: true } }),
      this.db.personnelDirectoryEntry.findMany({ where: { isActive: true }, select: { employeeCode: true, email: true, fullName: true } }),
      this.db.actor.findMany({ where: { isActive: true }, select: { id: true, loginEmail: true, personnelEmployeeCode: true } }),
      this.db.market.findMany({ where: { isActive: true }, select: { code: true, name: true, regionCode: true }, orderBy: [{ regionCode: 'asc' }, { displayOrder: 'asc' }] }),
    ]); return { units, people, actors, markets };
  }
  async findSource(sourceId: string) {
    const alias = await this.db.supplyContractAlias.findFirst({ where: { provider: 'GOOGLE_SHEETS', sourceId } });
    return alias ? this.get(alias.contractId) : null;
  }
  async save(value: SupplyAggregate, previous: SupplyAggregate | null, actor: ActorContext, action: string) {
    const c = value.contract;
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cpms:supply:${c.id}`}))`;
    const contractData = { vendorCode: c.vendorCode ?? null, codeLocked: c.codeLocked ?? false, leaderActorId: c.leaderActorId ?? null, vendorActorId: c.vendorActorId ?? null, currentRevisionId: c.currentRevisionId ?? null, deletedAt: date(c.deletedAt ?? null), code: c.code, number: c.number, name: c.name, vendor: c.vendor, serviceRecipient:c.serviceRecipient??null,marketScope:c.marketScope??'UNSPECIFIED',marketCodes:json(c.marketCodes??[]),supplyType: c.supplyType, ownerUnitCode: c.ownerUnitCode,
      supplierId:c.supplierId??null,supplierSnapshot:c.supplierSnapshot?json(c.supplierSnapshot):Prisma.DbNull,responsibilitySnapshot:c.responsibilitySnapshot?json(c.responsibilitySnapshot):Prisma.DbNull,
      ownerDepartment: c.ownerDepartment, managerActorId: c.managerActorId, managerEmail: c.managerEmail, startDate: date(c.startDate), endDate: date(c.endDate), currency: c.currency,
      signedAmount: c.signedAmount, signedVat: c.signedVat, signedGross: c.signedGross, status: c.status, dossierUrl: c.dossierUrl, source: json(c.source), quality: json(c.quality), recordVersion: c.recordVersion, localRevision: c.localRevision };
    if (previous) {
      const updated = await this.db.supplyContract.updateMany({ where: { id: c.id, recordVersion: previous.contract.recordVersion }, data: contractData });
      if (updated.count !== 1) throw new ConflictException('Hợp đồng đã thay đổi; tải lại trước khi lưu.');
    } else await this.db.supplyContract.create({ data: { ...contractData, id: c.id, createdByActorId: actor.id } });
    for (const p of value.periods) {
      if (previous?.periods.some(old => old.id === p.id)) continue;
      await this.db.supplyPeriod.create({ data: { id: p.id, contractId: c.id, code: p.code, name: p.name, kind: p.kind, startDate: new Date(p.startDate), endDate: new Date(p.endDate) } });
    }
    for (const planId of new Set(value.allocations.map(a => a.planId))) {
      if (previous?.allocations.some(a => a.planId === planId)) continue;
      const latest = await this.db.supplyAllocationPlan.aggregate({ where: { contractId: c.id }, _max: { version: true } });
      await this.db.supplyAllocationPlan.create({ data: { id: planId, contractId: c.id, version: (latest._max.version ?? 0) + 1, name: action === 'contract.import' ? 'Kế hoạch nhập từ nguồn' : 'Kế hoạch phân bổ', status: action === 'contract.import' ? 'SOURCE_SNAPSHOT' : 'DRAFT' } });
    }
    for (const s of value.slots) {
      const old = previous?.slots.find(v => v.id === s.id); if (old && old.recordVersion === s.recordVersion) continue;
      const data = { contractId: c.id, code: s.code, name: s.name, unit: s.unit, quantityUnit: s.quantityUnit, priceBasis: s.priceBasis, unitPrice: s.unitPrice, totalQty: s.totalQty, signedAmount: s.signedAmount,
        effectiveTotalQty:s.effectiveTotalQty??null,costType: s.costType, businessType: s.businessType, channel: s.channel, specificChannel: s.specificChannel, marketCode: s.marketCode, description: s.description,
        materialRequirement: s.materialRequirement, previewUrl: s.previewUrl, managerEmail: s.managerEmail, startDate: date(s.startDate), endDate: date(s.endDate), status: s.status,
        capacityMode: s.capacityMode, capacity: s.capacity, source: json(s.source), quality: json(s.quality), recordVersion: s.recordVersion };
      await this.db.supplySlot.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data });
      await this.db.supplySlotBooker.deleteMany({ where: { slotId: s.id } });
      if (s.bookers.length) await this.db.supplySlotBooker.createMany({ data: s.bookers.map(b => ({ slotId: s.id, email: b.email, personnelCode: b.personnelCode })) });
    }
    for (const a of value.allocations) {
      const old = previous?.allocations.find(v => v.id === a.id); if (old && old.recordVersion === a.recordVersion) continue;
      const data = { contractId: c.id, planId: a.planId, slotId: a.slotId, periodId: a.periodId, sourceKey: a.sourceKey, beneficiaryUnitCode: a.beneficiaryUnitCode,
        beneficiaryLabel: a.beneficiaryLabel, scopeKind: a.scopeKind, limitMode: a.limitMode, baselineQty: a.baselineQty, baselineAmount: a.baselineAmount, unitPrice: a.unitPrice,
        inputBasis: a.inputBasis, percent: a.percent, denominator: a.denominator, taxRate: a.taxRate, vatEstimated: a.vatEstimated, sourceMonthCount: a.sourceMonthCount,
        status: a.status, sourceVersion: a.sourceVersion, source: json(a.source), quality: json(a.quality), recordVersion: a.recordVersion,
        approvedByActorId: a.approvedByActorId, approvedAt: date(a.approvedAt), supersededAt: date(a.supersededAt ?? null), splitFromId: a.splitFromId ?? null };
      await this.db.supplyAllocation.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
    }
    for(const t of value.itemTerms??[]){if(previous?.itemTerms?.some(o=>o.id===t.id&&o.recordVersion===t.recordVersion))continue;
      const data={contractId:c.id,slotId:t.slotId,periodId:t.periodId,baseline:t.baseline?json(t.baseline):Prisma.DbNull,effective:json(t.effective),recordVersion:t.recordVersion};await this.db.supplyItemTerm.upsert({where:{id:t.id},create:{id:t.id,...data},update:data});
      for(const a of value.allocations.filter(a=>a.slotId===t.slotId&&a.periodId===t.periodId&&!a.supersededAt&&a.scopeKind==='ENTITLEMENT')){
        const old=await this.db.bookingAllocationAccess.findUnique({where:{allocationId:a.id}});const assignees={leaderActorIds:c.leaderActorId?[c.leaderActorId]:[],operatorActorIds:t.effective.operatorActorId?[t.effective.operatorActorId]:old?.operatorActorIds??[],vendorActorIds:(t.effective.vendorActorId??c.vendorActorId)?[t.effective.vendorActorId??c.vendorActorId!]:[],beneficiaryActorIds:old?.beneficiaryActorIds??[]};
        await this.db.bookingAllocationAccess.upsert({where:{allocationId:a.id},create:{allocationId:a.id,...assignees},update:{...assignees,recordVersion:{increment:1}}});
      }
    }
    for(const planId of new Set(value.allocations.map(a=>a.planId))){
      const rows=value.allocations.filter(a=>a.planId===planId);
      if(previous && rows.length === previous.allocations.filter(a=>a.planId===planId).length && rows.every(a=>previous.allocations.some(old=>old.id===a.id&&old.recordVersion===a.recordVersion)))continue;
      const statuses=[...new Set(rows.map(a=>a.status))];
      await this.db.supplyAllocationPlan.update({where:{id:planId},data:{status:statuses.length===1?statuses[0]!: 'MIXED'}});
    }
    for (const g of value.adjustments) {
      const old = previous?.adjustments.find(v => v.id === g.id); if (old && old.recordVersion === g.recordVersion) continue;
      const data = { contractId: c.id, kind: g.kind, name: g.name, reason: g.reason, evidence: g.evidence, status: g.status, effectiveDate: date(g.effectiveDate), source: json(g.source), recordVersion: g.recordVersion,
        approvedByActorId: g.approvedByActorId, approvedAt: date(g.approvedAt), reversesId: g.reversesId };
      await this.db.supplyAdjustmentGroup.upsert({ where: { id: g.id }, create: { id: g.id, ...data, createdByActorId: actor.id }, update: data });
      if (old?.status === 'DRAFT' || old?.status === 'REJECTED') await this.db.supplyAdjustmentLine.deleteMany({ where: { groupId: g.id } });
      if (!old || old.status === 'DRAFT' || old.status === 'REJECTED') await this.db.supplyAdjustmentLine.createMany({ data: g.lines.map(l => ({ groupId: g.id, allocationId: l.allocationId, deltaQty: l.deltaQty, deltaAmount: l.deltaAmount, expectedAllocationVersion: l.expectedAllocationVersion })) });
    }
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action, entityType: 'contract', entityId: c.id,
      payload: json({ version: c.recordVersion, before: previous, after: value }) } });
  }
  async references(id: string) {
    const [aliases, financialLines, financialMaps, audit, legalRevisions] = await Promise.all([
      this.db.supplyContractAlias.findMany({ where: { contractId: id } }), this.db.supplyFinancialLine.findMany({ where: { contractId: id } }),
      this.db.supplySlotFinancialMap.findMany({ where: { slot: { contractId: id } } }),
      this.db.auditEvent.findMany({ where: { entityType: 'contract', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, action: true, actorId: true, createdAt: true, payload: true } }),
      this.db.supplyLegalRevision.findMany({ where: { contractId: id }, orderBy: { version: 'desc' } }),
    ]); return wire<Awaited<ReturnType<ContractsRepository['references']>>>({ aliases, financialLines, financialMaps, audit, legalRevisions });
  }
  async preview(record: { id: string; actorId: string; snapshot: SupplySourceSnapshot; preview: SupplyImportPreview }) {
    // Preserve the exact numeric lexemes through Prisma/JSONB. The relational operational fields remain numeric.
    await this.db.supplyImport.create({ data: { id: record.id, actorId: record.actorId, sourceId: record.snapshot.spreadsheetId, digest: record.preview.digest, snapshot: { serializedSnapshot: JSON.stringify(record.snapshot) }, preview: json(record.preview),
      contractId: record.preview.contractId, expectedVersion: record.preview.expectedVersion, readAt: new Date(record.snapshot.readAt) } });
  }
  async getPreview(id: string) {
    const record=wire<SupplyImportRecord | null>(await this.db.supplyImport.findUnique({ where: { id } }));
    const stored=record?.snapshot as unknown as {serializedSnapshot?:string}|undefined;
    if(record&&typeof stored?.serializedSnapshot==='string')record.snapshot=JSON.parse(stored.serializedSnapshot) as SupplySourceSnapshot;
    return record;
  }
  async lastAppliedSourceDigest(contractId: string) {
    const record=await this.db.supplyImport.findFirst({where:{contractId,status:'APPLIED'},orderBy:{appliedAt:'desc'},select:{digest:true}});
    return record?.digest??null;
  }
  async finishImport(id: string, contractId: string, normalized: NormalizedSupplyImport, aggregate: SupplyAggregate) {
    for (const alias of normalized.aliases) await this.db.supplyContractAlias.upsert({ where: { provider_sourceId_alias: { provider: 'GOOGLE_SHEETS', sourceId: normalized.snapshot.spreadsheetId, alias } },
      create: { contractId, provider: 'GOOGLE_SHEETS', sourceId: normalized.snapshot.spreadsheetId, alias, evidence: json({ headerNumber: aggregate.contract.number, sourceReadAt: normalized.snapshot.readAt, method: 'header-slot-bravo-identity' }) }, update: {} });
    const n = (v: unknown) => parseSourceNumber(v, normalized.snapshot.locale);
    for (const row of normalized.financialLines) {
      const sourceKey = String(row.Id ?? row.ItemCode ?? row._row);
      const data = { externalId: row.Id == null ? null : String(row.Id), itemCode: row.ItemCode == null ? null : String(row.ItemCode), description: row.Description == null ? null : String(row.Description),
        unit: row.Unit == null ? null : String(row.Unit), quantity: n(row.Quantity9), unitPrice: n(row.OriginalUnitCost), amount: n(row.OriginalAmount9), source: json(row) };
      await this.db.supplyFinancialLine.upsert({ where: { contractId_sourceKey: { contractId, sourceKey } }, create: { contractId, sourceKey, ...data }, update: data });
    }
    const lines = await this.db.supplyFinancialLine.findMany({ where: { contractId } });
    for (const row of normalized.financialMaps) {
      const slot = aggregate.slots.find(s => s.code === row.slot_id); if (!slot) continue;
      const linked = lines.filter(l => row.bravo_line_id != null ? l.externalId === String(row.bravo_line_id) : l.itemCode === row.bravo_item_code);
      const sourceKey = String(row.map_id ?? row._row); const data = { lineId: linked.length === 1 ? linked[0]!.id : null, taxRate: n(row.tax_rate), periodCode: row.tax_period_code == null ? null : String(row.tax_period_code), status: String(row.mapping_status ?? 'UNRESOLVED'), source: json(row) };
      await this.db.supplySlotFinancialMap.upsert({ where: { slotId_sourceKey: { slotId: slot.id, sourceKey } }, create: { slotId: slot.id, sourceKey, ...data }, update: data });
    }
    await this.db.supplyImport.update({ where: { id }, data: { contractId, status: 'APPLIED', appliedAt: new Date() } });
  }
  async command(key: string) { return this.db.supplyCommand.findUnique({ where: { key } }); }
  async saveCommand(key: string, digest: string, result: unknown, actor: ActorContext) { await this.db.supplyCommand.create({ data: { key, digest, actorId: actor.id, result: json(result) } }); }
  async legalRevision(contractId: string, version: number, changes: unknown, reason: string, evidence: string, actor: ActorContext) {
    await this.db.supplyLegalRevision.create({ data: { contractId, version, changes: json(changes), reason, evidence, actorId: actor.id } });
  }
}
