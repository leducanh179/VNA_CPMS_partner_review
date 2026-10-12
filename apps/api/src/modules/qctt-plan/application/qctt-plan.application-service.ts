import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { bookingEffective, DEFAULT_QCTT_PLAN_COLUMNS, QCTT_PLAN_FIELDS, emptyQcttPlanFields, matchingPlanItems, projectPlanBookings,
  type ActorContext, type BookingContext, type BookingView, type QcttPlanFields, type QcttPlanItem, type QcttPlanView, type QcttPlanTarget } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractsRepository } from '../../contracts/application/contracts.repository';
import { QcttPlanRepository } from './qctt-plan.repository';
import { qcttPlanCommand } from './qctt-plan.commands';

@Injectable()
export class QcttPlanApplicationService {
  constructor(@Inject(QcttPlanRepository) private readonly repository: QcttPlanRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(ContractsRepository) private readonly contracts: ContractsRepository) {}
  private id(id: string) { if (!z.string().uuid().safeParse(id).success) throw new BadRequestException('Mã chiến dịch không hợp lệ.'); }
  private activeAccount() {
    const identity = this.access.snapshot().identity;
    if (!identity.sessionValid || !identity.effectiveActive || !identity.originalActive) throw new ForbiddenException('Tài khoản cần đang hoạt động để lập kế hoạch QCTT.');
  }
  private async campaign(campaignId: string) {
    this.activeAccount();
    const campaigns = await this.repository.campaigns();
    if (!campaigns.some(c => c.id === campaignId)) throw new NotFoundException('Không tìm thấy chiến dịch còn hiệu lực.');
    return campaigns;
  }
  list(actor?: ActorContext) { return this.access.run(actor, async () => { this.activeAccount(); return this.repository.campaigns(); }); }
  read(campaignId: string, actor?: ActorContext): Promise<QcttPlanView> {
    return this.access.run(actor, async () => {
      this.id(campaignId); const campaigns = await this.campaign(campaignId);
      const [state, items, bookings, catalog, legacyPlans, departments] = await Promise.all([this.repository.state(campaignId), this.repository.items(campaignId), this.repository.bookings(campaignId), this.contracts.channelMap(), this.repository.legacy(campaignId), this.repository.departments()]);
      return { schemaVersion: 1, state: state ? { ...state, columns: state.columns?.length ? state.columns : DEFAULT_QCTT_PLAN_COLUMNS } : { campaignId, recordVersion: 0, initializedAt: null, initializedByActorId: null, columns: DEFAULT_QCTT_PLAN_COLUMNS }, items,
        bookings: projectPlanBookings(bookings, campaignId, items), catalog, legacyPlans, departments, campaigns,
        capabilities: { edit: true, initialize: false, acceptingBookings: Boolean(state) }, defaultDepartmentId: null };
    });
  }
  history(campaignId: string, itemId: string, actor?: ActorContext) {
    return this.access.run(actor, async () => {
      this.id(campaignId); await this.campaign(campaignId);
      if (!(await this.repository.items(campaignId)).some(i => i.id === itemId)) throw new NotFoundException('Không tìm thấy dòng kế hoạch.');
      return this.repository.history(itemId);
    });
  }
  private async requireEdit(campaignId: string) { await this.campaign(campaignId); return this.repository.departments(); }
  command(campaignId: string, raw: unknown, actor?: ActorContext) {
    return this.access.run(actor, async () => {
      this.id(campaignId); const parsed = qcttPlanCommand.safeParse(raw);
      if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
      const input = parsed.data, who = this.access.snapshot().actor;
      const departments = await this.requireEdit(campaignId);
      this.access.requireAtCommit(async () => { await this.requireEdit(campaignId); });
      const digest = createHash('sha256').update(JSON.stringify({ campaignId, input })).digest('hex');
      const receipt = await this.repository.receipt(who.id, input.idempotencyKey);
      if (receipt) { if (receipt.digest !== digest) throw new ConflictException('Mã thao tác đã dùng cho nội dung khác.'); return receipt.result; }
      const state = await this.repository.state(campaignId), items = await this.repository.items(campaignId);
      if (input.action === 'COLUMNS') {
        if ((state?.recordVersion ?? 0) !== input.expectedVersion) throw new ConflictException('Bố cục kế hoạch đã thay đổi. Tải lại trước khi lưu.');
        const keys = input.columns.map(c => c.key);
        if (new Set(keys).size !== keys.length || input.columns.some(c => !QCTT_PLAN_FIELDS.includes(c.key as typeof QCTT_PLAN_FIELDS[number]) && !(c.key.startsWith('custom:') && z.string().uuid().safeParse(c.key.slice(7)).success))) throw new BadRequestException('Cột kế hoạch không hợp lệ hoặc bị trùng.');
        await this.repository.ensure(campaignId, who);
        await this.repository.setColumns(campaignId, state?.recordVersion ?? 1, input.columns as typeof DEFAULT_QCTT_PLAN_COLUMNS, who);
      } else {
        const ids = input.items.flatMap(i => i.id ? [i.id] : []);
        if (new Set(ids).size !== ids.length) throw new BadRequestException('Một dòng chỉ xuất hiện một lần trong mỗi thao tác.');
        const bookings = await this.repository.bookings(campaignId), catalog = await this.contracts.channelMap();
        await this.repository.ensure(campaignId, who);
        let sortOrder = Math.max(0, ...items.map(i => i.sortOrder));
        for (const entry of input.items) {
          const before = entry.id ? items.find(i => i.id === entry.id) : null;
          if (entry.id && !before) throw new NotFoundException('Dòng kế hoạch không thuộc chiến dịch này.');
          if (before && before.recordVersion !== entry.expectedVersion) throw new ConflictException('Dòng kế hoạch đã thay đổi. Tải lại trước khi lưu.');
          const timestamp = new Date().toISOString();
          let next: QcttPlanItem;
          const linked = before ? bookings.filter(b => b.planItemId === before.id || bookingEffective(b)?.planItemId === before.id) : [];
          if (input.action === 'SAVE' && 'fields' in entry) {
            if (before?.deletedAt) throw new BadRequestException('Phục hồi dòng trước khi sửa.');
            const fields: QcttPlanFields = { ...entry.fields, customValues: {} };
            const customValues: NonNullable<QcttPlanFields['customValues']> = {};
            for (const [key, value] of Object.entries(entry.fields.customValues)) {
              if (!key.startsWith('custom:') || !value.trim()) continue;
              if (!state?.columns?.some(column => column.key === key)) throw new BadRequestException('Trường Tự nhập không thuộc các cột của kế hoạch.');
              customValues[key] = value.trim();
            }
            // Keep historical free-text classifications unchanged, but new entries must use the catalog.
            for (const key of ['professionLayer','channelCode','departmentId','activityLabel'] as const) {
              const previous = before?.customValues?.[key];
              if (previous && entry.fields.customValues[key] === previous) customValues[key] = previous;
            }
            fields.customValues = customValues;
            if (fields.departmentId && !departments.some(d => d.id === fields.departmentId) && fields.departmentId !== before?.departmentId) throw new BadRequestException('Chọn CQ, ĐV phụ trách cấp ban.');
            const changed = !before || ['professionLayer','channelCode','activityCode'].some(k => fields[k as keyof QcttPlanFields] !== before[k as keyof QcttPlanItem]) || ['professionLayer','channelCode'].some(k => fields.customValues?.[k as keyof typeof customValues] !== before.customValues?.[k as keyof typeof customValues]);
            let classification = before?.classification ?? null;
            if (changed) {
              const map = catalog.data;
              if (fields.professionLayer && !map?.layers.some(l => l.code === fields.professionLayer) || fields.channelCode && !map?.channels.some(c => c.code === fields.channelCode)) throw new BadRequestException('Nghiệp vụ hoặc Kênh không thuộc danh mục hiện hành.');
              const activity = map?.activities.find(a => a.code === fields.activityCode && a.professionLayer === fields.professionLayer && a.channelCode === fields.channelCode);
              if (fields.activityCode && !activity) throw new BadRequestException('Hoạt động không khớp Nghiệp vụ và Kênh.');
              if (!fields.activityCode && fields.activityLabel && fields.activityLabel !== before?.activityLabel) throw new BadRequestException('Chọn Phương tiện QCTT trong Danh mục.');
              if (activity && (!before || fields.activityCode !== before.activityCode || fields.activityLabel !== before.activityLabel)) fields.activityLabel = activity.name;
              classification = activity && map ? { professionLayer: activity.professionLayer, professionLayerName: map.layers.find(l => l.code === activity.professionLayer)!.name, channelCode: activity.channelCode, channelName: map.channels.find(c => c.code === activity.channelCode)!.name, activityCode: activity.code, activityName: activity.name, catalogVersion: catalog.recordVersion } : null;
            }
            if (linked.length && before && (changed || fields.departmentId !== before.departmentId || fields.customValues?.departmentId !== before.customValues?.departmentId)) throw new BadRequestException('Dòng đã có booking: chuyển các booking sang dòng phù hợp trước khi đổi phân loại hoặc phòng.');
            if (fields.progress === 'STOPPED' && linked.some(b => !b.deletedAt && !['CANCELLED','FINISHED'].includes(b.execution ?? ''))) throw new BadRequestException('Dòng còn booking đang thực hiện hoặc đề nghị. Xử lý booking trước khi ngừng hoạt động.');
            next = { ...fields, id: before?.id ?? randomUUID(), campaignId, classification, recordVersion: (before?.recordVersion ?? 0) + 1,
              sortOrder: before?.sortOrder ?? ++sortOrder, origin: before?.origin ?? 'MANUAL', deletedAt: null,
              createdByActorId: before?.createdByActorId ?? who.id, createdAt: before?.createdAt ?? timestamp, updatedAt: timestamp };
          } else {
            if (!before) throw new NotFoundException('Không tìm thấy dòng kế hoạch.');
            if (input.action === 'DELETE' && linked.some(b => !b.deletedAt && !['CANCELLED','FINISHED'].includes(b.execution ?? ''))) throw new BadRequestException('Dòng còn booking. Xử lý/ngừng hoặc chuyển booking trong phân hệ Đặt chỗ trước khi đưa dòng vào Thùng rác.');
            if ((input.action === 'RESTORE') !== Boolean(before.deletedAt)) throw new BadRequestException('Trạng thái dòng không phù hợp với thao tác.');
            next = { ...before, deletedAt: input.action === 'DELETE' ? timestamp : null, recordVersion: before.recordVersion + 1, updatedAt: timestamp };
          }
          await this.repository.save(next, before ?? null, who, `plan.item.${input.action.toLowerCase()}`);
        }
      }
      const result = { campaignId, state: await this.repository.state(campaignId) };
      await this.repository.finish(who, input.idempotencyKey, digest, result);
      return result;
    });
  }
  /** Called only inside an authorized Booking command; the caller checks the exact allocation permission. */
  async bookingCatalog() {
    this.access.snapshot();
    const campaigns = await this.repository.initializedCampaigns(), targets: Record<string, QcttPlanTarget[]> = {};
    for (const campaign of campaigns) targets[campaign.id] = (await this.repository.items(campaign.id)).filter(i => !i.deletedAt && i.progress !== 'STOPPED').map(({ id, activityCode, professionLayer, channelCode, activityLabel, departmentId, startDate, endDate }) => ({ id, activityCode, professionLayer, channelCode, activityLabel, departmentId, startDate, endDate }));
    return { campaigns, targets };
  }
  async resolveBooking(row: BookingView, before: BookingView | null, ctx: BookingContext, persist: boolean): Promise<string | null> {
    const who = this.access.snapshot().actor;
    if (!row.campaignId) { if (row.planItemId) throw new BadRequestException('Chọn chiến dịch trước khi liên kết hoạt động.'); return null; }
    const state = await this.repository.state(row.campaignId);
    if (!state) {
      if (before?.campaignId === row.campaignId && !row.planItemId) return null;
      throw new BadRequestException('Chiến dịch chưa khởi tạo kế hoạch QCTT.');
    }
    if (!(await this.repository.initializedCampaigns()).some(c => c.id === row.campaignId)) throw new BadRequestException('Chiến dịch không còn mở nhận booking.');
    const items = await this.repository.items(row.campaignId), classification = row.contractSnapshot?.slotClassification ?? null;
    const assignment = ctx.access.find(a => a.allocationId === row.allocationId);
    const departmentId = await this.repository.responsibleDepartment(assignment?.ownerDepartmentId ?? null,
      assignment?.leaderActorIds.length ? assignment.leaderActorIds : ctx.contract.leaderActorId ? [ctx.contract.leaderActorId] : ctx.contract.managerActorId ? [ctx.contract.managerActorId] : []);
    if (row.planItemId) {
      const item = items.find(i => i.id === row.planItemId && !i.deletedAt);
      if (!item || item.progress === 'STOPPED') throw new BadRequestException('Dòng kế hoạch không còn nhận booking.');
      const retained = before?.planItemId === item.id && before.campaignId === row.campaignId && before.allocationId === row.allocationId;
      if (!retained && (departmentId && item.departmentId !== departmentId || classification && (item.professionLayer !== classification.professionLayer || item.channelCode !== classification.channelCode || item.activityCode && item.activityCode !== classification.activityCode))) throw new BadRequestException('Dòng kế hoạch không khớp phân loại hoặc phòng phụ trách của slot.');
      return item.id;
    }
    const exact = matchingPlanItems(items, classification, departmentId);
    // The Activity is the primary grouping key. Older plans may use a division while
    // current rows use a Ban-level unit; a unique Activity still receives its booking.
    const matches = exact.length || !classification ? exact : items.filter(item => !item.deletedAt && item.progress !== 'STOPPED' && item.activityCode === classification.activityCode && item.professionLayer === classification.professionLayer && item.channelCode === classification.channelCode);
    if (matches.length > 1) throw new BadRequestException('Có nhiều dòng cùng hoạt động. Chọn dòng kế hoạch nhận booking.');
    if (matches.length === 1) return matches[0]!.id;
    if (!persist) return null;
    const timestamp = new Date().toISOString();
    const item: QcttPlanItem = { ...emptyQcttPlanFields(), id: randomUUID(), campaignId: row.campaignId, recordVersion: 1,
      activityLabel: classification?.activityName ?? row.contractSnapshot?.slotName ?? ctx.slots.find(s => s.id === row.slotId)?.name ?? 'Hoạt động chưa phân loại',
      professionLayer: classification?.professionLayer ?? null, channelCode: classification?.channelCode ?? null, activityCode: classification?.activityCode ?? null,
      startDate: row.startDate, endDate: row.endDate, departmentId, classification, origin: 'BOOKING', sortOrder: Math.max(0,...items.map(i => i.sortOrder)) + 1,
      deletedAt: null, createdByActorId: who.id, createdAt: timestamp, updatedAt: timestamp };
    await this.repository.save(item, null, who, 'plan.item.from_booking');
    return item.id;
  }
}
