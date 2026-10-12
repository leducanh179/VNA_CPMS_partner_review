import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AccessPermission, AccessResource, ActorContext, SupplyAggregate, SupplyAllocationView, SupplyContractView, SupplyDetail, SupplyImportPreview, SupplySlotView, SupplySourceSnapshot } from '@cpms/domain';
import { INVENTORY_CONSUMPTION_PROVIDER, type InventoryConsumptionProvider } from '@cpms/integrations';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractsRepository } from './contracts.repository';
import { normalizeSupplySource } from '../domain/source-import';
import { buildInventory, convertAllocation, decimal, effectivePair, isoDate, numeric, sum, validateSupplyLimits } from '../domain/supply-engine';
import { adjustmentSave, allocationSave, contractSave, freeAllocationSplitCommand, importApplyCommand, listQuery, slotSave, transitionCommand } from './contracts.commands';
import { buildSupplyWorkspace } from '../domain/supply-workspace';
import { splitFreeAllocation } from '../domain/split-free-allocation';
import { BookingRepository } from '../../booking/application/booking.repository';
import { buildSupplyAnalytics } from '../domain/supply-analytics';
import { buildSupplyFinance } from '../domain/supply-finance';
import { supplyAnalyticsQuery } from './supply-analytics.query';
import { buildSupplyPivot } from '../domain/supply-pivot';
import { deleteSupplyPivotView, saveSupplyPivotView, supplyPivotDefinition } from './supply-pivot.commands';
import type { SupplyPivotView } from '@cpms/domain';
import { contractAccessResource, contractValidity } from '@cpms/domain';

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; '), issues: result.error.issues });
  return result.data;
};
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();

@Injectable()
export class ContractsApplicationService {
  constructor(@Inject(ContractsRepository) private readonly repository: ContractsRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
    @Inject(INVENTORY_CONSUMPTION_PROVIDER) private readonly consumption: InventoryConsumptionProvider,
    @Inject(BookingRepository) private readonly bookings: BookingRepository) {}
  private resource(c: SupplyContractView): AccessResource {
    return contractAccessResource(c);
  }
  private require(permission: AccessPermission, c?: SupplyContractView) { this.access.require(permission, c ? this.resource(c) : undefined); }
  private editable(permission: AccessPermission, c: SupplyContractView) {
    if (c.currentRevisionId || c.codeLocked) throw new ForbiddenException('Hợp đồng đã dùng phiên bản: sửa hồ sơ qua luồng phê duyệt; chưa mở sửa slot/phân bổ.');
    this.require(permission,c);
    const identity = this.access.snapshot().identity;
    if (!(identity.effectiveSuperadmin && identity.mode === 'DIRECT') && c.managerActorId !== identity.effectiveActorId) throw new ForbiddenException('Chỉ quản lý được phân công hoặc ADMIN được sửa nguồn cung này.');
  }
  private async load(id: string): Promise<SupplyAggregate> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Không tìm thấy hợp đồng trong phạm vi được phép.');
    const value = await this.repository.get(id);
    if (!value || !this.access.check('contract.read',this.resource(value.contract)).allowed) throw new NotFoundException('Không tìm thấy hợp đồng trong phạm vi được phép.');
    this.require('contract.read',value.contract); return value;
  }
  private version(actual: number, expected: number | undefined) { if (expected !== actual) throw new ConflictException(`Dữ liệu đã đổi (phiên bản ${actual}); tải lại và đối chiếu bản nháp.`); }
  private bump(value: SupplyAggregate, imported = false) { value.contract.recordVersion++; if (!imported) value.contract.localRevision++; }
  private async assertLimits(value: SupplyAggregate, at = now()) {
    const dates=[at,...value.adjustments.filter(g=>g.status==='APPROVED'&&g.effectiveDate).map(g=>`${isoDate(g.effectiveDate!)}T12:00:00+07:00`)];
    const errors = dates.flatMap(date=>validateSupplyLimits(value,date)).filter(q => q.severity === 'BLOCK');
    if (errors.length) throw new BadRequestException({ message: errors.map(q => q.message).join('; '), issues: errors });
    for(const date of dates.filter(date=>date>=at)){
      const inventory=await buildInventory(value,this.consumption,date);
      for(const row of inventory.rows){
        const allocation=value.allocations.find(a=>a.id===row.allocationId)!;
        if(allocation.status!=='APPROVED')continue;
        if(row.effective.qty!==null&&(allocation.scopeKind==='ENTITLEMENT'||allocation.slotId)&&decimal(row.usage.booked.qty??0).gt(row.effective.qty)||row.effective.amount!==null&&decimal(row.usage.booked.amount??0).gt(row.effective.amount))throw new BadRequestException('Hạn mức sau điều chỉnh thấp hơn lượng booking đang giữ hoặc đã nghiệm thu. Điều chỉnh booking trước.');
      }
    }
  }
  async list(query: unknown, actor?: ActorContext) {
    const q = parse(listQuery,query);
    const contracts = await this.access.run(actor,async () => {
      const all = await this.repository.list();
      if (!all.length) this.require('contract.read');
      return all.filter(c => this.access.check('contract.read',this.resource(c)).allowed).map(c => { this.require('contract.read',c); return c; });
    });
    let rows = contracts.filter(c => (!q.supplyType || c.supplyType === q.supplyType) && Boolean(c.deletedAt) === (q.trash === 'true') && (!q.q || `${c.code} ${c.name} ${c.number ?? ''} ${c.vendor ?? ''}`.toLocaleLowerCase().includes(q.q.toLocaleLowerCase()))
      && (!q.status || contractValidity(c) === q.status) && (!q.vendor || c.vendor === q.vendor)
      && (!q.start || c.endDate && isoDate(c.endDate) >= q.start) && (!q.end || c.startDate && isoDate(c.startDate) <= q.end));
    rows = rows.sort((a,b) => {
      const l = a[q.sort], r = b[q.sort]; if (l == null) return r == null ? 0 : 1; if (r == null) return -1;
      const result = q.sort === 'signedAmount' ? decimal(String(l)).cmp(String(r)) : String(l).localeCompare(String(r),'vi'); return q.direction === 'asc' ? result : -result;
    });
    const total = rows.length;
    const selected = rows.slice((q.page - 1) * q.pageSize,q.page * q.pageSize);
    const items = await Promise.all(selected.map(async c => { const d = await this.detail(c.id,actor); return { ...c, pendingChange: (await this.repository.requests(c.id)).some(r=>r.state==='PENDING'), validity: contractValidity(c), effectiveAmount: d.inventory.amountTotals.effective, slots: d.slots.length,canUpdate:d.capabilities.update }; }));
    return { items, total, page: q.page, pageSize: q.pageSize, suggestions: contracts.filter(c => !c.deletedAt).slice(0,50).map(c => c.name), asOf: now() };
  }
  async catalogs(actor?: ActorContext) { return this.access.run(actor,async () => {
    if(this.access.check('contract.read').allowed)this.require('contract.read');
    else {const visible=(await this.repository.list()).find(c=>this.access.check('contract.read',this.resource(c)).allowed);if(visible)this.require('contract.read',visible);else this.require('contract.create');}
    return this.repository.catalogs();
  }); }
  async detail(id: string, actor?: ActorContext): Promise<SupplyDetail> {
    const read = await this.access.run(actor,async () => {
      const aggregate = await this.load(id);
      const capabilities = Object.fromEntries(['read','create','update','allocate','approve','import','export'].map(action => [action,this.access.check(`contract.${action}` as AccessPermission,this.resource(aggregate.contract)).allowed]));
      const identity = this.access.snapshot().identity;
      if (!(identity.effectiveSuperadmin && identity.mode === 'DIRECT') && ![aggregate.contract.managerActorId,aggregate.contract.leaderActorId].includes(identity.effectiveActorId)) { capabilities.update = false; capabilities.allocate = false; capabilities.import = false; }
      if (aggregate.contract.currentRevisionId || aggregate.contract.codeLocked) { capabilities.allocate = false; capabilities.import = false; }
      const references = await this.repository.references(id);
      if (!capabilities.update && !capabilities.approve) references.audit = references.audit.filter(event => !String(event.action).startsWith('contract.request.'));
      return { aggregate, capabilities, references };
    });
    const inventory = await this.inventoryFor(read.aggregate,now());
    return { ...read.aggregate, ...read.references, inventory, capabilities: read.capabilities, pollIntervalMs: this.pollInterval() };
  }
  private pollInterval() { const value = Number(process.env.CONTRACT_POLL_INTERVAL_MS ?? 30000); return Number.isFinite(value) ? Math.max(5000,Math.min(300000,value)) : 30000; }
  async analytics(id: string, query: unknown, actor?: ActorContext) {
    const input = parse(supplyAnalyticsQuery, query);
    return this.access.run(actor, async () => {
      await this.load(id);
      // Share the existing supply fence with Booking and Contract saves, then reread both sides.
      await this.bookings.lock([id]);
      const aggregate = await this.load(id);
      const rows = await this.bookings.all([id]);
      try { const report = buildSupplyAnalytics(aggregate, rows, input, now()); return { ...report, finance: buildSupplyFinance(aggregate, rows, report) }; }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Không thể tính số liệu theo thời gian.'); }
    });
  }
  async pivot(id: string, definition: unknown, actor?: ActorContext) {
    const input = parse(supplyPivotDefinition, definition);
    return this.access.run(actor, async () => {
      await this.load(id); await this.bookings.lock([id]);
      const aggregate = await this.load(id), rows = await this.bookings.all([id]);
      try { return buildSupplyPivot(aggregate, rows, input, now()); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Không thể tính Pivot.'); }
    });
  }
  async pivotViews(id: string, actor?: ActorContext) {
    return this.access.run(actor, async () => { await this.load(id); return this.repository.pivotViews(id, this.access.snapshot().actor.id); });
  }
  async savePivotView(id: string, command: unknown, actor?: ActorContext) {
    const input = parse(saveSupplyPivotView, command);
    return this.access.run(actor, async () => {
      const aggregate = await this.load(id), resolved = this.access.snapshot().actor;
      const views = await this.repository.pivotViews(id, resolved.id), previous = input.id ? views.find(v => v.id === input.id) : null;
      if (input.id && !previous) throw new NotFoundException('Không tìm thấy view cá nhân.');
      if (previous) this.version(previous.recordVersion, input.expectedVersion);
      if (!previous && views.length >= 50) throw new BadRequestException('Mỗi hợp đồng lưu tối đa 50 view cá nhân.');
      if (views.some(v => v.id !== previous?.id && v.name.toLocaleLowerCase('vi') === input.name.toLocaleLowerCase('vi'))) throw new ConflictException('Tên view đã tồn tại; chọn tên khác.');
      const q = input.definition.query;
      if (!['CURRENT', 'ALL'].includes(q.period) && !aggregate.periods.some(p => p.id === q.period) || q.slotIds.some(s => !aggregate.slots.some(slot => slot.id === s)) || q.beneficiary !== 'ALL' && !aggregate.allocations.some(a => (a.beneficiaryUnitCode ?? '__UNKNOWN__') === q.beneficiary)) throw new BadRequestException('Bộ lọc view không thuộc hợp đồng.');
      try { buildSupplyAnalytics(aggregate, [], q, now()); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Bộ lọc view không hợp lệ.'); }
      const view: SupplyPivotView = { id: previous?.id ?? randomUUID(), contractId: id, name: input.name, definition: input.definition, isDefault: input.isDefault, recordVersion: (previous?.recordVersion ?? 0) + 1, updatedAt: now() };
      await this.repository.savePivotView(view, previous ?? null, resolved);
      return (await this.repository.pivotViews(id, resolved.id)).find(v => v.id === view.id)!;
    });
  }
  async deletePivotView(id: string, viewId: string, command: unknown, actor?: ActorContext) {
    const input = parse(deleteSupplyPivotView, command);
    return this.access.run(actor, async () => {
      await this.load(id); const resolved = this.access.snapshot().actor;
      const view = (await this.repository.pivotViews(id, resolved.id)).find(v => v.id === viewId);
      if (!view) throw new NotFoundException('Không tìm thấy view cá nhân.');
      this.version(view.recordVersion, input.expectedVersion); await this.repository.deletePivotView(view, resolved); return { deleted: true };
    });
  }
  async workspace(id: string, query: { period?: string; phase?: string }, actor?: ActorContext) {
    if (query.phase && !['BASELINE','EFFECTIVE'].includes(query.phase)) throw new BadRequestException('Giai đoạn không hợp lệ.');
    if (query.period !== undefined && (typeof query.period !== 'string' || query.period.length > 100)) throw new BadRequestException('Kỳ phân bổ không hợp lệ.');
    const aggregate = await this.access.run(actor, () => this.load(id));
    const inventory = await this.inventoryFor(aggregate, now());
    try { return { ...buildSupplyWorkspace(aggregate, inventory, query.period ?? 'CURRENT', query.phase === 'BASELINE' ? 'BASELINE' : 'EFFECTIVE'), pollIntervalMs: this.pollInterval() }; }
    catch { throw new BadRequestException('Không tìm thấy kỳ phân bổ của hợp đồng.'); }
  }
  private async inventoryFor(aggregate: SupplyAggregate, asOf: string) {
    try { return await buildInventory(aggregate,this.consumption,asOf); }
    catch { throw new ServiceUnavailableException('Không xác định được mức sử dụng: consumption provider không khả dụng. Không thay bằng 0.'); }
  }
  async splitFreeEntitlement(contractId: string, command: unknown, actor?: ActorContext) {
    const input = parse(freeAllocationSplitCommand, command), digest = hash({ contractId, input });
    return this.access.run(actor, async () => {
      await this.bookings.lock([contractId]);
      const current = await this.load(contractId);
      this.editable('contract.allocate', current.contract); this.require('contract.approve', current.contract);
      const resolved = this.access.snapshot().actor, replay = await this.repository.command(input.idempotencyKey);
      if (replay) {
        if (replay.actorId !== resolved.id || replay.digest !== digest) throw new ConflictException('Mã thao tác đã được dùng cho nội dung khác.');
        return replay.result;
      }
      this.version(current.contract.recordVersion, input.expectedVersion);
      // Include deleted/accepted bookings: a split must never rewrite booking ownership/history.
      if ((await this.bookings.all([contractId])).some(b => b.allocationId === input.allocationId)) throw new BadRequestException('Quyền lợi đã có đặt chỗ; không thể tự tách kỳ hoặc chuyển lịch sử sử dụng.');
      let value: SupplyAggregate;
      try { value = splitFreeAllocation(current, input, resolved.id, now()); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Không thể tách kỳ quyền lợi.'); }
      this.bump(value); await this.assertLimits(value);
      await this.repository.save(value, current, resolved, 'contract.free-allocation.split');
      const children = value.allocations.filter(a => a.splitFromId === input.allocationId);
      const originalAccess = (await this.bookings.allocationAccess()).find(a => a.allocationId === input.allocationId);
      if (originalAccess) for (const child of children) await this.bookings.saveAccess({ ...originalAccess, allocationId: child.id, recordVersion: 1 }, resolved);
      const result = { contractId, allocationIds: children.map(a => a.id), recordVersion: value.contract.recordVersion };
      await this.repository.saveCommand(input.idempotencyKey, digest, result, resolved);
      return result;
    });
  }
  async inventory(id: string, filters: { periodId?: string; unit?: string; slotId?: string; asOf?: string }, actor?: ActorContext) {
    const aggregate = await this.access.run(actor,()=>this.load(id));
    const asOf = filters.asOf ?? now(); if (!Number.isFinite(Date.parse(asOf))) throw new BadRequestException('asOf không hợp lệ.');
    if(filters.asOf&&asOf.slice(0,10)<now().slice(0,10))throw new BadRequestException('Inventory Booking hiện hỗ trợ trạng thái đang lưu; chưa hỗ trợ tái dựng số dư tại ngày quá khứ.');
    const readAt = aggregate.contract.source.readAt;
    if (typeof readAt === 'string' && asOf.slice(0,10) < readAt.slice(0,10)) throw new BadRequestException('Không có lịch sử as-of trước snapshot nguồn được nhập.');
    aggregate.allocations = aggregate.allocations.filter(a => (!filters.periodId || a.periodId === filters.periodId) && (!filters.unit || a.beneficiaryUnitCode === filters.unit) && (!filters.slotId || a.slotId === filters.slotId));
    return this.inventoryFor(aggregate,asOf);
  }
  async saveContract(id: string | null, command: unknown, actor?: ActorContext) {
    const input = parse(contractSave,command);
    const result = await this.access.run(actor,async () => {
      const current = id ? await this.load(id) : null;
      if (current) { this.editable('contract.update',current.contract); this.version(current.contract.recordVersion,input.expectedVersion); }
      else this.require('contract.create');
      const resolved = this.access.snapshot().actor;
      const value: SupplyAggregate = current ? clone(current) : { contract: { id: randomUUID(), code: `CON-${new Date().getFullYear()}-${randomUUID().slice(0,8)}`, name: 'Hợp đồng mới', number: null, vendor: null, supplyType: 'PAID', ownerUnitCode: null, ownerDepartment: null, managerActorId: resolved.id, managerEmail: null, startDate: null, endDate: null,
        currency: 'VND', signedAmount: null, signedVat: null, signedGross: null, status: 'DRAFT', dossierUrl: null, source: {}, quality: [], recordVersion: 1, localRevision: 1, createdByActorId: resolved.id }, slots: [], periods: [], allocations: [], adjustments: [] };
      const changed = Object.entries(input.fields).filter(([key,v]) => !same(value.contract[key as keyof SupplyContractView],v));
      if (current && !changed.length) return current.contract.id;
      Object.assign(value.contract,input.fields);
      if(current&&current.contract.status!=='DRAFT'&&value.contract.status==='DRAFT')throw new BadRequestException('Hợp đồng đã hoạt động chỉ tạm dừng/lưu trữ; không quay về nháp để thay số pháp lý.');
      await this.validateContract(value.contract);
      const legalKeys = ['signedAmount','signedVat','signedGross','startDate','endDate','currency','number','vendor'];
      if (current && current.contract.status !== 'DRAFT' && changed.some(([key]) => legalKeys.includes(key))) {
        if (!input.legalReason?.trim() || !input.legalEvidence?.trim()) throw new BadRequestException('Sửa số ký/thời hạn cần lý do và căn cứ pháp lý riêng.');
        await this.repository.legalRevision(id!,current.contract.recordVersion + 1,{ before: current.contract, changes: input.fields },input.legalReason,input.legalEvidence,resolved);
      }
      if (value.contract.status === 'ACTIVE' && current?.contract.status !== 'ACTIVE') this.require('contract.approve',value.contract);
      if (current) this.bump(value); await this.assertLimits(value);
      await this.repository.save(value,current,resolved,current ? 'contract.update' : 'contract.create'); return value.contract.id;
    });
    return this.detail(result,actor);
  }
  private async validateContract(c: SupplyContractView) {
    const catalogs = await this.repository.catalogs();
    if (c.ownerUnitCode && !catalogs.units.some(u => u.code === c.ownerUnitCode)) throw new BadRequestException('CQĐV không có trong danh mục.');
    if (c.managerActorId && !catalogs.actors.some(a => a.id === c.managerActorId)) throw new BadRequestException('Người quản lý không còn hoạt động.');
    if (c.startDate && c.endDate && isoDate(c.startDate) > isoDate(c.endDate)) throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc.');
    if ([c.signedAmount,c.signedVat,c.signedGross].some(n => n != null && decimal(n).lt(0))) throw new BadRequestException('Giá trị ký không được âm.');
    if (c.signedAmount != null && c.signedVat != null && c.signedGross != null && !decimal(c.signedAmount).plus(c.signedVat).eq(c.signedGross)) throw new BadRequestException('Trước VAT + VAT phải bằng giá trị sau VAT.');
    if (c.status === 'ACTIVE' && (!c.startDate || !c.endDate || !c.managerActorId || !c.ownerUnitCode || c.signedAmount === null)) throw new BadRequestException('Kích hoạt cần thời hạn, quản lý, CQĐV và giá trị ký (0 là hợp lệ).');
  }
  async saveSlot(contractId: string, command: unknown, actor?: ActorContext) {
    const input = parse(slotSave,command);
    await this.access.run(actor,async () => {
      const current = await this.load(contractId); this.editable('contract.update',current.contract); this.version(current.contract.recordVersion,input.expectedVersion);
      const value = clone(current); const old = input.id ? current.slots.find(s => s.id === input.id) : undefined;
      if (input.id && !old) throw new NotFoundException('Slot không thuộc hợp đồng.');
      if (old) this.version(old.recordVersion,input.recordVersion);
      const s: SupplySlotView = old ? clone(old) : { id: randomUUID(), contractId, code: `SLO-${randomUUID().slice(0,12)}`, name: 'Slot mới', unit: null, quantityUnit: null, priceBasis: null, unitPrice: null, totalQty: null, signedAmount: null,
        costType: 'UNKNOWN', businessType: 'UNKNOWN', channel: null, specificChannel: null, marketCode: null, description: null, materialRequirement: null, previewUrl: null, managerEmail: null, startDate: null, endDate: null,
        status: 'DRAFT', capacityMode: 'UNKNOWN', capacity: null, source: {}, quality: [], recordVersion: 1, bookers: [] };
      const { bookerEmails, ...fields } = input.fields; Object.assign(s,fields);
      const catalogs = await this.repository.catalogs();
      if (bookerEmails) s.bookers = [...new Set(bookerEmails.map(e => e.trim().toLowerCase()))].map(email => ({ email, personnelCode: catalogs.people.find(p => p.email?.toLowerCase() === email)?.employeeCode ?? null }));
      const comparableSlot=(slot:SupplySlotView)=>({...slot,bookers:slot.bookers.map(b=>({email:b.email,personnelCode:b.personnelCode})).sort((a,b)=>a.email.localeCompare(b.email))});
      if (old && same(comparableSlot(old),comparableSlot(s))) return;
      if (s.marketCode && !catalogs.markets.some(m => m.code === s.marketCode)) throw new BadRequestException('Thị trường chưa có trong danh mục.');
      if (s.capacityMode === 'SHARED_CAPACITY' && !s.capacity) throw new BadRequestException('Cần capacity có căn cứ khi dùng chia sẻ.');
      if ([s.unitPrice,s.totalQty,s.signedAmount].some(n => n !== null && decimal(n).lt(0)) || s.priceBasis !== null && decimal(s.priceBasis).lte(0)) throw new BadRequestException('Giá trị slot không hợp lệ.');
      if (s.status === 'ACTIVE' && (!s.unit || !s.quantityUnit || s.totalQty === null)) throw new BadRequestException('Slot hoạt động cần đơn vị và hạn mức số lượng.');
      if (old && current.allocations.some(a => a.slotId === old.id && a.status === 'APPROVED') && ['unitPrice','priceBasis','totalQty','unit','startDate','endDate'].some(k => !same(old[k as keyof SupplySlotView],s[k as keyof SupplySlotView]))) {
        if (!input.legalReason?.trim() || !input.legalEvidence?.trim()) throw new BadRequestException('Đổi quy tắc giá/quyền lợi đã có hiệu lực cần phiên bản và căn cứ riêng.');
        await this.repository.legalRevision(contractId,current.contract.recordVersion + 1,{ slotId: s.id, before: old, after: s },input.legalReason,input.legalEvidence,this.access.snapshot().actor);
      }
      if (old) { s.recordVersion++; value.slots = value.slots.map(v => v.id === s.id ? s : v); } else value.slots.push(s);
      this.bump(value); await this.assertLimits(value); await this.repository.save(value,current,this.access.snapshot().actor,'contract.slot.save');
    }); return this.detail(contractId,actor);
  }
  async allocationPreview(contractId: string, command: unknown, actor?: ActorContext) {
    const input = parse(allocationSave,command);
    return this.access.run(actor,async () => {
      const current = await this.load(contractId); this.editable('contract.allocate',current.contract); this.version(current.contract.recordVersion,input.expectedVersion);
      const slot = input.fields.slotId ? current.slots.find(s => s.id === input.fields.slotId) : undefined;
      if (input.fields.slotId && !slot) throw new BadRequestException('Slot không thuộc hợp đồng.');
      try { return { ...convertAllocation({ basis: input.fields.basis, value: input.fields.value, denominator: input.fields.denominator ?? null, unitPrice: slot?.unitPrice ?? null, priceBasis: slot?.priceBasis ?? null }), basis: input.fields.basis, denominator: input.fields.denominator ?? null }; }
      catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Không quy đổi được.'); }
    });
  }
  async saveAllocation(contractId: string, command: unknown, actor?: ActorContext) {
    const input = parse(allocationSave,command);
    await this.access.run(actor,async () => {
      const current = await this.load(contractId); this.editable('contract.allocate',current.contract); this.version(current.contract.recordVersion,input.expectedVersion);
      const value = clone(current); const old = input.id ? current.allocations.find(a => a.id === input.id) : undefined;
      if (input.id && !old) throw new NotFoundException('Không tìm thấy phân bổ.');
      if (old) { this.version(old.recordVersion,input.recordVersion); if (!['DRAFT','REJECTED'].includes(old.status)) throw new BadRequestException('Phân bổ đã gửi/đã hiệu lực chỉ đổi bằng điều chỉnh; không sửa baseline.'); }
      const f = input.fields; const slot = f.slotId ? current.slots.find(s => s.id === f.slotId) : undefined;
      if (f.slotId && !slot || f.scopeKind === 'ENTITLEMENT' && !slot) throw new BadRequestException('Phân bổ quyền lợi cần slot thuộc hợp đồng.');
      const catalogs = await this.repository.catalogs(); const unit = catalogs.units.find(u => u.code === f.beneficiaryUnitCode);
      if (f.beneficiaryUnitCode && !unit || f.scopeKind === 'ENTITLEMENT' && !unit) throw new BadRequestException('Cần CQĐV hưởng hạn mức hợp lệ.');
      const p = f.period; if (!p.startDate || !p.endDate || p.startDate > p.endDate) throw new BadRequestException('Kỳ phân bổ không hợp lệ.');
      let period = value.periods.find(v => v.code === p.code);
      if (period && (isoDate(period.startDate) !== p.startDate || isoDate(period.endDate) !== p.endDate)) throw new BadRequestException('Mã kỳ đã có ngày khác; tạo mã kỳ mới.');
      if (!period) { period = { id: randomUUID(),code:p.code,name:p.name,kind:p.kind,startDate:p.startDate,endDate:p.endDate }; value.periods.push(period); }
      let converted;
      try { converted = convertAllocation({ basis:f.basis,value:f.value,denominator:f.denominator ?? null,unitPrice:slot?.unitPrice ?? null,priceBasis:slot?.priceBasis ?? null }); }
      catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Không quy đổi được.'); }
      const a: SupplyAllocationView = { id: old?.id ?? randomUUID(), contractId, planId: old?.planId ?? randomUUID(), slotId: f.slotId, periodId: period.id, sourceKey: old?.sourceKey ?? null,
        beneficiaryUnitCode: f.beneficiaryUnitCode, beneficiaryLabel: unit?.displayName ?? 'Toàn hợp đồng', scopeKind:f.scopeKind,limitMode:f.limitMode,
        baselineQty:converted.qty,baselineAmount:converted.amount,unitPrice:slot?.unitPrice ?? null,inputBasis:f.basis,percent:f.basis.startsWith('PERCENT_') ? f.value : null,denominator:f.denominator ?? null,
        taxRate:f.taxRate ?? null,vatEstimated:f.vatEstimated ?? false,sourceMonthCount:null,status:'DRAFT',sourceVersion:old?.sourceVersion ?? null,source:old?.source ?? {},quality:[],recordVersion:old?.recordVersion ?? 1,approvedAt:null,approvedByActorId:null };
      if (a.taxRate && (decimal(a.taxRate).lt(0) || decimal(a.taxRate).gt(1))) throw new BadRequestException('VAT phải từ 0 đến 1.');
      if (old) {
        const comparison = { ...old, ...a }; if (same(old,comparison)) return;
        a.recordVersion++; value.allocations = value.allocations.map(v => v.id === a.id ? a : v);
      } else value.allocations.push(a);
      this.bump(value); await this.repository.save(value,current,this.access.snapshot().actor,'contract.allocation.draft');
    }); return this.detail(contractId,actor);
  }
  private adjustmentCandidate(current: SupplyAggregate, input: z.infer<typeof adjustmentSave>, preview: boolean) {
    const value = clone(current); const old = input.id ? value.adjustments.find(g => g.id === input.id) : undefined;
    if (input.id && !old) throw new NotFoundException('Không tìm thấy nhóm điều chỉnh.');
    if (old) { this.version(old.recordVersion,input.recordVersion); if (!['DRAFT','REJECTED'].includes(old.status) || old.kind === 'SOURCE_CUMULATIVE') throw new BadRequestException('Nhóm đã có hiệu lực/nguồn nhập phải dùng điều chỉnh bù.'); }
    const f = clone(input.fields);
    if (new Set(f.lines.map(l=>l.allocationId)).size !== f.lines.length) throw new BadRequestException('Mỗi phân bổ chỉ có một delta trong nhóm.');
    for (const line of f.lines) {
      const a = value.allocations.find(v=>v.id === line.allocationId);
      if (!a || a.supersededAt || a.status !== 'APPROVED') throw new BadRequestException('Điều chỉnh cần phân bổ đã có hiệu lực trong cùng hợp đồng.');
      this.version(a.recordVersion,line.expectedAllocationVersion);
      if (line.deltaQty === null && line.deltaAmount === null) throw new BadRequestException('Dòng điều chỉnh cần ít nhất một delta.');
      const slot=value.slots.find(s=>s.id===a.slotId);const price=a.unitPrice;const basis=slot?.priceBasis;
      if(price!==null&&basis!=null&&decimal(basis).gt(0)){
        if(line.deltaQty!==null){const amount=numeric(decimal(line.deltaQty).mul(price).div(basis),6)!;
          if(line.deltaAmount===null)line.deltaAmount=amount;else if(decimal(line.deltaAmount).minus(amount).abs().gt('0.01'))throw new BadRequestException('Delta số lượng và tiền không khớp quy tắc giá; nhập một đại lượng để server quy đổi.');
        } else if(line.deltaAmount!==null&&decimal(price).gt(0))line.deltaQty=numeric(decimal(line.deltaAmount).mul(basis).div(price));
        else if(line.deltaAmount!==null&&!decimal(line.deltaAmount).isZero())throw new BadRequestException('Quyền lợi 0 đồng cần điều chỉnh số lượng; không quy đổi tiền sang số lượng.');
      }
      if (a.baselineQty === null && line.deltaQty !== null || a.baselineAmount === null && line.deltaAmount !== null) throw new BadRequestException('Không thể cộng delta vào hạn mức chưa xác định.');
    }
    if (!f.effectiveDate) throw new BadRequestException('Điều chỉnh mới cần ngày hiệu lực có căn cứ.');
    if (f.kind === 'TRANSFER') {
      if (f.lines.some(l => l.deltaAmount === null) || !decimal(sum(f.lines.map(l=>l.deltaAmount))!).isZero()) throw new BadRequestException('Điều chuyển thuần túy phải cân bằng tiền trong cả nhóm.');
      // Money is conserved. Different slots may have different unit prices even when their units match.
    }
    if (f.kind === 'CUT' && f.lines.some(l=>[l.deltaQty,l.deltaAmount].some(n=>n !== null && decimal(n).gt(0)))) throw new BadRequestException('Nhóm cắt không chứa delta tăng; dùng nhóm hỗn hợp.');
    if (f.kind === 'ADD' && f.lines.some(l=>[l.deltaQty,l.deltaAmount].some(n=>n !== null && decimal(n).lt(0)))) throw new BadRequestException('Nhóm bổ sung không chứa delta giảm.');
    const group = { id:old?.id ?? randomUUID(),contractId:current.contract.id,...f,status:preview ? 'APPROVED' : 'DRAFT',source:old?.source??{},recordVersion:old ? old.recordVersion+1 : 1,approvedAt:null,approvedByActorId:null,reversesId:old?.reversesId??null };
    if (old) value.adjustments = value.adjustments.map(g=>g.id===old.id?group:g); else value.adjustments.push(group);
    return { value, group };
  }
  async adjustmentPreview(contractId:string, command:unknown, actor?:ActorContext) {
    const input = parse(adjustmentSave,command);
    return this.access.run(actor,async()=>{
      const current = await this.load(contractId); this.editable('contract.allocate',current.contract); this.version(current.contract.recordVersion,input.expectedVersion);
      const { value, group } = this.adjustmentCandidate(current,input,true); const at = `${group.effectiveDate}T12:00:00+07:00`;
      return { changes:group.lines.map(l=>{const a=current.allocations.find(a=>a.id===l.allocationId)!; return { allocationId:a.id, before:effectivePair(current,a,at),delta:{qty:l.deltaQty,amount:l.deltaAmount},after:effectivePair(value,a,at) };}),issues:validateSupplyLimits(value,at),expectedVersion:current.contract.recordVersion };
    });
  }
  async saveAdjustment(contractId:string, command:unknown, actor?:ActorContext) {
    const input = parse(adjustmentSave,command);
    await this.access.run(actor,async()=>{
      const current = await this.load(contractId); this.editable('contract.allocate',current.contract); this.version(current.contract.recordVersion,input.expectedVersion);
      const old = input.id ? current.adjustments.find(g=>g.id===input.id) : undefined;
      const {value,group}=this.adjustmentCandidate(current,input,false);
      if(old?.status==='DRAFT'){const lineValues=(lines:typeof old.lines)=>lines.map(l=>({allocationId:l.allocationId,expectedAllocationVersion:l.expectedAllocationVersion,deltaQty:l.deltaQty,deltaAmount:l.deltaAmount}));
        if(['kind','name','reason','evidence','effectiveDate'].every(k=>same(old[k as keyof typeof old],group[k as keyof typeof group]))&&same(lineValues(old.lines),lineValues(group.lines)))return;}
      this.bump(value); await this.repository.save(value,current,this.access.snapshot().actor,'contract.adjustment.draft');
    }); return this.detail(contractId,actor);
  }
  async transition(contractId:string, target:'allocation'|'adjustment', id:string, command:unknown, actor?:ActorContext) {
    const input = parse(transitionCommand,command);
    await this.access.run(actor,async()=>{
      const current = await this.load(contractId); this.require(input.action==='APPROVE'||input.action==='REJECT' ? 'contract.approve':'contract.allocate',current.contract);
      if (current.contract.currentRevisionId || current.contract.codeLocked) throw new ForbiddenException('Chưa mở sửa slot/phân bổ của hợp đồng đã quản lý phiên bản.');
      if (input.action==='SUBMIT'||input.action==='REVERSE') this.editable('contract.allocate',current.contract);
      const digest=hash({contractId,target,id,input}); const key=`transition:${input.idempotencyKey}`; const prior=await this.repository.command(key); const resolved=this.access.snapshot().actor;
      if(prior){if(prior.actorId!==resolved.id||prior.digest!==digest)throw new ConflictException('Idempotency key đã dùng cho lệnh khác.');return;}
      this.version(current.contract.recordVersion,input.expectedVersion); const value=clone(current);
      const item=target==='allocation'?value.allocations.find(a=>a.id===id):value.adjustments.find(g=>g.id===id);
      if(!item)throw new NotFoundException('Không tìm thấy dòng trong hợp đồng.'); this.version(item.recordVersion,input.recordVersion);
      if (input.action==='REVERSE') {
        if(target!=='adjustment')throw new BadRequestException('Chỉ đảo nhóm điều chỉnh.');
        const group=value.adjustments.find(g=>g.id===id)!;
        if(!['APPROVED','SOURCE_APPLIED'].includes(group.status)||value.adjustments.some(g=>g.reversesId===id))throw new BadRequestException('Nhóm chưa có hiệu lực hoặc đã có bút toán đảo.');
        if(!input.reason?.trim()||!input.effectiveDate)throw new BadRequestException('Đảo bút toán cần lý do và ngày hiệu lực.');
        value.adjustments.push({...group,id:randomUUID(),kind:'MIXED',name:`Đảo: ${group.name}`,reason:input.reason,status:'DRAFT',effectiveDate:input.effectiveDate,source:{},recordVersion:1,approvedAt:null,approvedByActorId:null,reversesId:id,
          lines:group.lines.map(l=>({...l,deltaQty:l.deltaQty===null?null:decimal(l.deltaQty).neg().toFixed(),deltaAmount:l.deltaAmount===null?null:decimal(l.deltaAmount).neg().toFixed(),expectedAllocationVersion:value.allocations.find(a=>a.id===l.allocationId)!.recordVersion}))});
      } else {
        if(target==='adjustment' && value.adjustments.find(g=>g.id===id)!.kind==='SOURCE_CUMULATIVE')throw new BadRequestException('Trạng thái nguồn nhập không phải quy trình duyệt mới. Tạo điều chỉnh có căn cứ riêng.');
        const expected=input.action==='SUBMIT'?['DRAFT','REJECTED']:['PENDING'];
        if(!expected.includes(item.status))throw new ConflictException('Trạng thái không cho phép thao tác này.');
        if(input.action==='SUBMIT'){
          if(target==='allocation') this.validateActivation(value,item as SupplyAllocationView);
          else {const g=value.adjustments.find(g=>g.id===id)!;if(!g.evidence?.trim())throw new BadRequestException('Gửi duyệt cần căn cứ điều chỉnh.');}
          item.status='PENDING';
        }
        if(input.action==='REJECT')item.status='REJECTED';
        if(input.action==='APPROVE'){
          if(target==='allocation')this.validateActivation(value,item as SupplyAllocationView);
          if(target==='adjustment')for(const l of value.adjustments.find(g=>g.id===id)!.lines){const a=value.allocations.find(a=>a.id===l.allocationId)!;this.version(a.recordVersion,l.expectedAllocationVersion);if(a.status!=='APPROVED')throw new ConflictException('Phân bổ không còn hiệu lực.');}
          item.status='APPROVED';item.approvedAt=now();item.approvedByActorId=resolved.id;
          const at=target==='adjustment'?`${value.adjustments.find(g=>g.id===id)!.effectiveDate}T12:00:00+07:00`:now();
          await this.assertLimits(value,at);
          if(target==='adjustment')for(const l of value.adjustments.find(g=>g.id===id)!.lines)value.allocations.find(a=>a.id===l.allocationId)!.recordVersion++;
        }
        item.recordVersion++;
      }
      this.bump(value); await this.repository.save(value,current,resolved,`contract.${target}.${input.action.toLowerCase()}`); await this.repository.saveCommand(key,digest,{contractId,recordVersion:value.contract.recordVersion},resolved);
    }); return this.detail(contractId,actor);
  }
  private validateActivation(value:SupplyAggregate,a:SupplyAllocationView){
    if(a.supersededAt)throw new BadRequestException('Phân bổ đã được thay thế theo kỳ; chỉ giữ để đối soát.');
    if(!value.contract.startDate||!value.contract.endDate||value.contract.signedAmount===null)throw new BadRequestException('Hợp đồng chưa đủ thời hạn và trần tiền để áp dụng phân bổ.');
    if(a.scopeKind==='CAP'&&!a.slotId&&a.baselineQty!==null)throw new BadRequestException('Trần toàn hợp đồng không được cộng số lượng khác đơn vị; chọn thành tiền hoặc trần một slot.');
    if(a.quality.some(q=>q.severity==='BLOCK'))throw new BadRequestException('Còn lỗi đối soát hạn mức.');
    if(a.baselineQty===null&&a.baselineAmount===null)throw new BadRequestException('Hạn mức cần số lượng hoặc tiền xác định.');
    if(a.scopeKind==='ENTITLEMENT'&&(!a.slotId||!a.beneficiaryUnitCode))throw new BadRequestException('Phân bổ cần slot và CQĐV.');
    const slot=value.slots.find(s=>s.id===a.slotId);
    if(a.scopeKind==='ENTITLEMENT'&&(!slot?.unit||slot.totalQty===null))throw new BadRequestException('Slot chưa đủ đơn vị/hạn mức kiểm soát.');
  }
  async importPreview(snapshot:SupplySourceSnapshot,actor?:ActorContext):Promise<SupplyImportPreview>{
    // The snapshot is already read; no provider I/O occurs inside this transaction.
    return this.access.run(actor,async()=>{
      this.require('contract.import');
      let normalized;
      try{normalized=normalizeSupplySource(snapshot,await this.repository.catalogs());}catch(e){throw new BadRequestException(e instanceof Error?e.message:'Snapshot không hợp lệ.');}
      const current=await this.repository.findSource(snapshot.spreadsheetId);
      if(current)this.editable('contract.import',current.contract);
      // The applied preview fingerprint also recognizes snapshots persisted by the initial JSONB reader.
      const unchanged=current&&(current.contract.source.digest===normalized.digest||await this.repository.lastAppliedSourceDigest(current.contract.id)===normalized.digest);
      const mode=unchanged?'NOOP':current?'UPDATE':'CREATE';
      const blocking=normalized.blocking.filter(q=>!q.row||['UNRESOLVED_CONTRACT_ALIAS','MISSING_SLOT','INVALID_PERIOD','PERIOD_CONFLICT'].includes(q.code));
      const diff:SupplyImportPreview['diff']=[];
      if(mode!=='NOOP'){
        const changes=(entity:string,key:string,before:object|undefined,after:object,keys:string[])=>{const l=before as Record<string,unknown>|undefined,r=after as Record<string,unknown>;const fields=keys.filter(k=>!same(l?.[k]??null,r[k]??null)).map(field=>({field,before:l?.[field]??null,after:r[field]??null}));diff.push({entity,key,change:before?(fields.length?'UPDATE':'UNCHANGED'):'CREATE',fields});};
        changes('contract',normalized.aggregate.contract.code,current?.contract,normalized.aggregate.contract,['name','number','vendor','ownerUnitCode','ownerDepartment','managerEmail','startDate','endDate','signedAmount','signedVat','signedGross','status']);
        for(const s of normalized.aggregate.slots){const old=current?.slots.find(o=>o.code===s.code);changes('slot',s.code,old,s,['name','unit','quantityUnit','priceBasis','unitPrice','totalQty','signedAmount','description','channel','specificChannel','status','capacityMode','capacity']);
          if(old&&current?.allocations.some(a=>a.slotId===old.id&&a.status==='APPROVED')&&['unit','priceBasis','unitPrice','totalQty','startDate','endDate'].some(k=>!same(old[k as keyof SupplySlotView],s[k as keyof SupplySlotView])))blocking.push({code:'ACTIVE_SLOT_SOURCE_CHANGED',message:`Quyền lợi/giá/thời hạn slot ${s.code} đã áp dụng thay đổi; cần phiên bản pháp lý riêng.`,severity:'BLOCK'});}
        for(const a of normalized.aggregate.allocations){const old=current?.allocations.find(o=>o.sourceKey===a.sourceKey);
          const identity=(v:SupplyAllocationView,g:SupplyAggregate)=>({slot:g.slots.find(s=>s.id===v.slotId)?.code??null,period:g.periods.find(p=>p.id===v.periodId),beneficiaryUnitCode:v.beneficiaryUnitCode});
          const before=old&&current?{...old,...identity(old,current),deltaQty:old.source.deltaQty,deltaAmount:old.source.deltaAmount}:undefined;
          const after={...a,...identity(a,normalized.aggregate),deltaQty:a.source.deltaQty,deltaAmount:a.source.deltaAmount};
          changes('allocation',a.sourceKey!,before,after,['slot','beneficiaryUnitCode','baselineQty','baselineAmount','deltaQty','deltaAmount','status','limitMode','taxRate','vatEstimated']);
          const oldPeriod=old&&current?.periods.find(p=>p.id===old.periodId),newPeriod=normalized.aggregate.periods.find(p=>p.id===a.periodId);
          if(old?.status==='APPROVED'&&(old.baselineQty!==a.baselineQty||old.baselineAmount!==a.baselineAmount||old.beneficiaryUnitCode!==a.beneficiaryUnitCode||before?.slot!==after.slot||oldPeriod?.code!==newPeriod?.code||oldPeriod?.startDate!==newPeriod?.startDate||oldPeriod?.endDate!==newPeriod?.endDate))blocking.push({code:'ACTIVE_BASELINE_CHANGED',message:'Snapshot thay baseline/phạm vi kỳ/slot đã có hiệu lực; cần phiên bản kế hoạch riêng.',severity:'BLOCK'});
        }
        if(current?.contract.localRevision)blocking.push({code:'LOCAL_EDITS_PROTECTED',message:'CPMS đã có chỉnh sửa local; import không được ghi đè. Đối soát và tạo lệnh riêng.',severity:'BLOCK'});
        if(current&&current.allocations.some(a=>a.sourceKey&&!normalized.aggregate.allocations.some(n=>n.sourceKey===a.sourceKey)))blocking.push({code:'SOURCE_ROW_REMOVED',message:'Nguồn đã bỏ dòng; cần đối soát, không xóa lịch sử CPMS.',severity:'BLOCK'});
        if(current&&current.slots.some(s=>!normalized.aggregate.slots.some(n=>n.code===s.code)))blocking.push({code:'SOURCE_SLOT_REMOVED',message:'Nguồn đã bỏ slot; cần archive có audit, không bỏ ngầm quyền lợi.',severity:'BLOCK'});
        if(current&&['signedAmount','signedVat','signedGross','startDate','endDate','currency','number'].some(k=>{
          const old=current.contract[k as keyof SupplyContractView],incoming=normalized.aggregate.contract[k as keyof SupplyContractView];
          return k.endsWith('Date') && typeof old==='string' && typeof incoming==='string' ? isoDate(old)!==isoDate(incoming) : !same(old,incoming);
        }))blocking.push({code:'LEGAL_SOURCE_CHANGE',message:'Số ký/thời hạn nguồn thay đổi; cần phiên bản pháp lý có căn cứ.',severity:'BLOCK'});
      }
      const preview:SupplyImportPreview={id:randomUUID(),digest:normalized.digest,contractId:current?.contract.id??null,expectedVersion:current?.contract.recordVersion??null,mode:blocking.length?'CONFLICT':mode,warnings:[...normalized.warnings,...normalized.blocking.filter(q=>q.row)],blocking,
        counts:{contracts:1,slots:normalized.aggregate.slots.length,allocations:normalized.aggregate.allocations.length,held:normalized.aggregate.allocations.filter(a=>a.status==='HELD').length,adjustments:normalized.aggregate.adjustments.length},diff,requiresWarningAcknowledgement:normalized.warnings.length>0};
      await this.repository.preview({id:preview.id,actorId:this.access.snapshot().actor.id,snapshot,preview}); return preview;
    });
  }
  async importApply(id:string,command:unknown,actor?:ActorContext){
    const input=parse(importApplyCommand,command);
    const contractId=await this.access.run(actor,async()=>{
      this.require('contract.import');const resolved=this.access.snapshot().actor;const record=await this.repository.getPreview(id);
      if(!record||record.actorId!==resolved.id)throw new NotFoundException('Không tìm thấy preview của phiên người dùng này.');
      const digest=hash({id,input});const key=`import:${input.idempotencyKey}`;const prior=await this.repository.command(key);
      if(prior){if(prior.actorId!==resolved.id||prior.digest!==digest)throw new ConflictException('Idempotency key đã dùng cho lệnh khác.');return (prior.result as {contractId:string}).contractId;}
      if(record.status==='APPLIED')return record.contractId!;
      if(record.preview.blocking.length)throw new BadRequestException('Preview còn lỗi cần đối soát; không thể nhập.');
      if(record.preview.requiresWarningAcknowledgement&&!input.acknowledgeWarnings)throw new BadRequestException('Cần xác nhận các cảnh báo và dòng giữ lại trong preview.');
      const normalized=normalizeSupplySource(record.snapshot,await this.repository.catalogs());const current=await this.repository.findSource(record.snapshot.spreadsheetId);
      if(normalized.digest!==record.digest)throw new ConflictException('Snapshot đã thay đổi khi đọc hoặc chuẩn hóa; hãy tạo preview mới.');
      if(current)this.editable('contract.import',current.contract);
      if(current&&(current.contract.source.digest===record.digest||await this.repository.lastAppliedSourceDigest(current.contract.id)===record.digest)){await this.repository.saveCommand(key,digest,{contractId:current.contract.id},resolved);return current.contract.id;}
      if(current){this.version(current.contract.recordVersion,record.expectedVersion??undefined);if(current.contract.localRevision)throw new ConflictException('Chỉnh sửa local phát sinh sau preview.');}
      else if(record.expectedVersion!==null)throw new ConflictException('Nguồn thay đổi sau preview.');
      const imported=clone(normalized.aggregate);const newId=current?.contract.id??randomUUID();
      const slotIds=new Map(imported.slots.map(s=>[s.id,current?.slots.find(v=>v.code===s.code)?.id??randomUUID()]));
      const periodIds=new Map(imported.periods.map(p=>[p.id,current?.periods.find(v=>v.code===p.code&&isoDate(v.startDate)===isoDate(p.startDate)&&isoDate(v.endDate)===isoDate(p.endDate))?.id??randomUUID()]));
      const allocationIds=new Map(imported.allocations.map(a=>[a.id,current?.allocations.find(v=>v.sourceKey===a.sourceKey)?.id??randomUUID()]));const planId=current?.allocations[0]?.planId??randomUUID();
      imported.contract={...imported.contract,id:newId,createdByActorId:current?.contract.createdByActorId??resolved.id,recordVersion:current?current.contract.recordVersion+1:1,source:{...imported.contract.source,digest:normalized.digest}};
      imported.slots=imported.slots.map(s=>({...s,id:slotIds.get(s.id)!,contractId:newId,recordVersion:(current?.slots.find(v=>v.code===s.code)?.recordVersion??0)+1}));
      imported.periods=imported.periods.map(p=>({...p,id:periodIds.get(p.id)!}));
      imported.allocations=imported.allocations.map(a=>({...a,id:allocationIds.get(a.id)!,contractId:newId,slotId:a.slotId?slotIds.get(a.slotId)!:null,periodId:periodIds.get(a.periodId)!,planId,recordVersion:(current?.allocations.find(v=>v.sourceKey===a.sourceKey)?.recordVersion??0)+1}));
      imported.adjustments=imported.adjustments.map(g=>({...g,id:randomUUID(),contractId:newId,source:{...g.source,digest:normalized.digest},lines:g.lines.map(l=>({...l,allocationId:allocationIds.get(l.allocationId)!,expectedAllocationVersion:imported.allocations.find(a=>a.id===allocationIds.get(l.allocationId))!.recordVersion}))}));
      if(current)imported.adjustments=[...current.adjustments.map(g=>g.kind==='SOURCE_CUMULATIVE'&&['SOURCE_APPLIED','DRAFT'].includes(g.status)?{...g,status:'SUPERSEDED',recordVersion:g.recordVersion+1}:g),...imported.adjustments];
      await this.assertLimits(imported);await this.repository.save(imported,current,resolved,'contract.import');await this.repository.finishImport(id,newId,normalized,imported);await this.repository.saveCommand(key,digest,{contractId:newId},resolved);return newId;
    });return this.detail(contractId,actor);
  }
  async exportContract(id:string,actor?:ActorContext){
    await this.access.run(actor,async()=>{const value=await this.load(id);this.require('contract.export',value.contract);});
    const detail=await this.detail(id,actor);
    return { format:'CPMS_SUPPLY_V1',schemaVersion:1,exportedAt:now(),contract:detail.contract,slots:detail.slots,periods:detail.periods,allocations:detail.allocations,adjustments:detail.adjustments,financialLines:detail.financialLines,financialMaps:detail.financialMaps,aliases:detail.aliases,legalRevisions:detail.legalRevisions,audit:detail.audit,inventory:detail.inventory,readOnlyCalculated:['inventory','recordVersion','approvedByActorId','approvedAt'] };
  }
}
