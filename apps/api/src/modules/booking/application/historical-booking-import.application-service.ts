import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { BookingView, SupplyAggregate } from '@cpms/domain';
import { automaticBookingDistribution, bookingSnapshot, contractBookingSnapshot } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ContractsRepository } from '../../contracts/application/contracts.repository';
import { decimal } from '../../contracts/domain/supply-engine';
import { checkBookingLimits, priceBooking } from '../domain/booking-engine';
import { BookingRepository } from './booking.repository';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.string().regex(/^\d+(\.\d{1,10})?$/);
const itemSchema = z.object({
  sourceKey:z.string().startsWith('admicro:booking_').max(250),sourceSheet:z.enum(['booking_2025','booking_2026']),sourceRow:z.number().int().min(2),
  sourceBookingId:z.string().startsWith('BKG-').max(150),sourceContractId:z.enum(['QC0670725','CON-202507-14830733c1']),
  sourceSlotId:z.string().regex(/^SLO-(?:202507-14830733c1|QC0670725)-\d{4}$/),sourceAllocationId:z.string().startsWith('alloc_14830733c1_'),
  allocationSourceKey:z.string().startsWith('alloc_14830733c1_'),campaignId:z.string().uuid().nullable(),campaignLabel:z.string().trim().min(1).max(500),
  startDate:day,endDate:day,quantity:qty,acceptedQty:qty,historicalStatus:z.enum(['APPROVED','ACCEPTED']),
  sourceUnitPrice:qty.nullable(),materialUrl:z.string().url().nullable(),note:z.string().min(1).max(10000),
  metrics:z.record(z.string(),z.string()),source:z.object({spreadsheetUrl:z.string().url(),sheet:z.string(),rowNumber:z.number().int(),raw:z.record(z.string(),z.unknown())}),
}).strict();
const commandSchema=z.object({version:z.literal(1),sourceUrl:z.literal('https://docs.google.com/spreadsheets/d/14QT8wrEWCKXMhqpXGT6Osh7XIfadH2DxaTuZD36_PKc/edit'),items:z.array(itemSchema).min(1).max(150)}).strict();
type HistoricalCommand=z.infer<typeof commandSchema>;

/** Audited, source-keyed migration of one reconciled Admicro snapshot. No historical decisions are invented. */
@Injectable()
export class HistoricalBookingImportApplicationService {
  constructor(@Inject(BookingRepository) private readonly bookings:BookingRepository,
    @Inject(ContractsRepository) private readonly contracts:ContractsRepository,
    @Inject(AccessApplicationService) private readonly access:AccessApplicationService){}

  private async prepare(command:HistoricalCommand){
    this.access.require('booking.manage');
    const sourceKeys=command.items.map(i=>i.sourceKey);
    if(new Set(sourceKeys).size!==sourceKeys.length)throw new BadRequestException('Mã dòng nguồn lặp trong lô nhập.');
    const split=command.items.filter(i=>i.sourceBookingId==='BKG-202512-LEGACY-BILL-AGG');
    if(split.length!==2||!split.some(i=>i.sourceKey.endsWith(':2025_h2')&&i.quantity==='4081')||
      !split.some(i=>i.sourceKey.endsWith(':2026_y')&&i.quantity==='8'))
      throw new BadRequestException('Phần vượt Billboard 8 CPM phải tách đúng hai kỳ đã đối soát.');
    const contracts=await this.contracts.list();
    const contract=contracts.find(c=>c.name.includes('Admicro')&&c.startDate?.slice(0,10)==='2025-07-25'&&c.endDate?.slice(0,10)==='2027-06-30');
    if(!contract)throw new BadRequestException('Không tìm thấy đúng hợp đồng Admicro 07/2025–06/2027 đang hoạt động.');
    const ctx=await this.contracts.get(contract.id);
    if(!ctx||ctx.contract.status!=='ACTIVE')throw new BadRequestException('Hợp đồng Admicro chưa có hiệu lực.');
    const catalog=await this.bookings.catalog();
    const existing=await this.bookings.all();
    const existingKeys=new Set(existing.map(r=>r.sourceKey).filter(Boolean));
    const revision=ctx.contract.currentRevisionId?await this.contracts.revision(ctx.contract.currentRevisionId):null;
    const policy=await this.bookings.policy();
    if(ctx.contract.currentRevisionId&&!revision)throw new BadRequestException('Phiên bản hợp đồng hiện tại không còn khả dụng.');
    const periodById=new Map(ctx.periods.map(p=>[p.id,p]));
    const slotById=new Map(ctx.slots.map(s=>[s.id,s]));
    const rows:BookingView[]=[];
    const now=new Date().toISOString();
    for(const item of command.items){
      if(existingKeys.has(item.sourceKey))throw new ConflictException(`Dòng nguồn ${item.sourceKey} đã được nhập; dừng để đối chiếu, không nhân đôi.`);
      if(item.source.sheet!==item.sourceSheet||item.source.rowNumber!==item.sourceRow||item.source.raw.booking_id!==item.sourceBookingId||
        item.source.raw.contract_id!==item.sourceContractId||item.source.raw.slot_id!==item.sourceSlotId||item.source.raw.allocation_id!==item.sourceAllocationId)
        throw new BadRequestException(`Nguồn dòng ${item.sourceRow} không khớp thông tin khai báo.`);
      if(item.source.spreadsheetUrl!==command.sourceUrl)throw new BadRequestException('Link nguồn không khớp workbook đã đối soát.');
      const raw=item.source.raw;
      if(raw.booking_end_date!==item.endDate||raw.campaign_name!==item.campaignLabel||
        raw.booking_start_date&&raw.booking_start_date!==item.startDate)
        throw new BadRequestException(`Ngày hoặc tên chiến dịch khác nguồn: ${item.sourceBookingId}.`);
      if(!raw.booking_start_date&&!(item.sourceSheet==='booking_2026'&&raw.planned_month_key==='2026-08'&&item.startDate==='2026-08-01'&&item.note.includes('suy định')))
        throw new BadRequestException(`Ngày bắt đầu thiếu nhưng chưa ghi rõ ngày suy định: ${item.sourceBookingId}.`);
      if(item.sourceBookingId!=='BKG-202512-LEGACY-BILL-AGG'&&item.quantity!==String(raw.qty_approved)||
        item.historicalStatus==='ACCEPTED'&&item.acceptedQty!==item.quantity)
        throw new BadRequestException(`Lượng đã duyệt/nghiệm thu khác nguồn: ${item.sourceBookingId}.`);
      if(item.sourceSheet==='booking_2025'&&item.sourceContractId!=='QC0670725'||item.sourceSheet==='booking_2026'&&item.sourceContractId!=='CON-202507-14830733c1')
        throw new BadRequestException('Dòng thuộc hợp đồng khác, không được gán vào hợp đồng Admicro hiện hành.');
      const allocation=ctx.allocations.find(a=>a.sourceKey===item.allocationSourceKey&&a.scopeKind==='ENTITLEMENT'&&!a.supersededAt);
      const slot=allocation?.slotId?slotById.get(allocation.slotId):null;
      const period=allocation?periodById.get(allocation.periodId):null;
      const canonicalSlotCode=item.sourceSlotId.replace('SLO-QC0670725-','SLO-202507-14830733c1-');
      if(!allocation||!slot||!period||slot.code!==canonicalSlotCode||allocation.status!=='APPROVED')
        throw new BadRequestException(`Không khớp slot/kỳ phân bổ đã duyệt: ${item.sourceBookingId}.`);
      const reassigned=item.sourceAllocationId!==item.allocationSourceKey;
      const permittedMove=item.sourceBookingId==='BKG-202508-LEGACY-AUS-PMB'||
        item.sourceBookingId==='BKG-202512-LEGACY-BILL-AGG'&&item.sourceKey.endsWith(':2026_y');
      if(reassigned&&(!permittedMove||!item.sourceAllocationId.endsWith('_2025_h2')||!item.allocationSourceKey.endsWith('_2026_y')||!item.note.includes('hậu kiểm')))
        throw new BadRequestException(`Chuyển kỳ không thuộc hai phần vượt đã duyệt: ${item.sourceBookingId}.`);
      const outsidePeriod=item.startDate<period.startDate||item.endDate>period.endDate;
      const billingJanuaryRunDecember=item.sourceBookingId.startsWith('BKG-202601-001-')||item.sourceBookingId.startsWith('BKG-202601-002-')||item.sourceBookingId.startsWith('BKG-202601-003-');
      if(outsidePeriod&&!reassigned&&!(billingJanuaryRunDecember&&raw.planned_month_key==='2026-01'&&item.startDate.startsWith('2025-12')&&item.endDate.startsWith('2025-12')&&item.note.includes('hậu kiểm')))
        throw new BadRequestException(`Ngày chạy ngoài kỳ và không có ngoại lệ đối soát: ${item.sourceBookingId}.`);
      if(item.startDate>item.endDate)throw new BadRequestException(`Ngày bắt đầu sau ngày kết thúc: ${item.sourceBookingId}.`);
      if(item.startDate<ctx.contract.startDate!.slice(0,10)||item.endDate>ctx.contract.endDate!.slice(0,10))
        throw new BadRequestException(`Ngày chạy ngoài thời hạn hợp đồng: ${item.sourceBookingId}.`);
      if(item.historicalStatus==='ACCEPTED'&&decimal(item.acceptedQty).eq(0)||item.historicalStatus==='APPROVED'&&!decimal(item.acceptedQty).eq(0)||decimal(item.acceptedQty).gt(item.quantity))
        throw new BadRequestException(`Trạng thái hoặc lượng nghiệm thu không hợp lệ: ${item.sourceBookingId}.`);
      const expectedStatus=item.sourceSheet==='booking_2025'||!item.sourceBookingId.startsWith('BKG-202609-')?'ACCEPTED':'APPROVED';
      if(item.historicalStatus!==expectedStatus)throw new BadRequestException(`Trạng thái không theo quy tắc chốt: ${item.sourceBookingId}.`);
      if(item.campaignId){const campaign=catalog.campaigns.find(c=>c.id===item.campaignId);
        if(!campaign||!campaign.name.includes('Mở bán vé Tết')||!item.sourceBookingId.startsWith('BKG-202609-'))
          throw new BadRequestException('Liên kết chiến dịch chính thức không khớp dòng vé Tết 2027.');
      }
      const fields={allocationId:allocation.id,campaignId:item.campaignId,campaignLabel:item.campaignId?catalog.campaigns.find(c=>c.id===item.campaignId)!.name:item.campaignLabel,
        startDate:item.startDate,endDate:item.endDate,quantity:item.quantity,materialId:null,materialUrl:item.materialUrl,note:item.note,
        planItemId:null,overallStartDate:null,overallEndDate:null,campaignDatesAuto:false,timeDistribution:automaticBookingDistribution()};
      // Quote by the source-designated billing period; the original run dates remain intact for audit.
      const quoteDate=[period.startDate,ctx.contract.startDate??period.startDate,slot.startDate??period.startDate].sort().at(-1)!;
      const quote=priceBooking({...fields,startDate:quoteDate,endDate:quoteDate},revision?revision.snapshot as SupplyAggregate:ctx);
      if(item.sourceUnitPrice&& !decimal(item.sourceUnitPrice).eq(quote.unitPrice))
        throw new BadRequestException(`Đơn giá nguồn khác đơn giá kỳ đã chốt: ${item.sourceBookingId}.`);
      const row:BookingView={id:randomUUID(),...fields,...quote,contractRevisionId:revision?.id??null,
        contractSnapshot:revision?contractBookingSnapshot(revision,allocation.id):null,
        state:'ACTIVE',deletedAt:null,execution:item.historicalStatus==='ACCEPTED'?'FINISHED':'NOT_STARTED',
        vendorConfirmedQty:String(item.source.raw.vendor_confirm_status)==='confirmed'?item.quantity:null,sourceApprovedQty:item.quantity,
        acceptedQty:item.acceptedQty,reportState:item.historicalStatus==='ACCEPTED'?'ACCEPTED':'EMPTY',reportTemplateId:null,reportData:item.metrics,
        reportPeriods:[],lifecycleRequest:null,sourceKey:item.sourceKey,
        source:{...item.source,sourceBookingId:item.sourceBookingId,sourceContractId:item.sourceContractId,sourceSlotId:item.sourceSlotId,
          sourceAllocationId:item.sourceAllocationId,assignedAllocationSourceKey:item.allocationSourceKey,historicalStatus:item.historicalStatus,
          statusBasis:'Nguồn và chỉ đạo người dùng ngày 04/10/2026; không tái tạo quyết định hoặc thời điểm phê duyệt cũ'},
        recordVersion:1,createdByActorId:this.access.snapshot().actor.id,createdAt:now,updatedAt:now};
      row.workflow={version:1,status:'APPROVED',route:'LEGACY',origin:'HISTORICAL',policyVersion:policy.version,
        required:false,requestVersion:0,submittedBy:null,submittedAt:null,reason:'Nhập lịch sử có đối soát nguồn; không tái tạo phê duyệt cũ',
        effective:bookingSnapshot(row),decisions:[]};
      rows.push(row);
    }
    const issues=checkBookingLimits(ctx,existing.filter(r=>r.contractId===ctx.contract.id),rows,now);
    const blocks=issues.filter(i=>i.severity==='BLOCK');
    if(blocks.length)throw new BadRequestException({message:'Dữ liệu vượt ràng buộc hợp đồng sau đối soát.',issues:blocks.map(i=>({sourceKey:command.items[i.index]?.sourceKey,message:i.message}))});
    return {ctx,rows,issues};
  }

  async preview(input:unknown){const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new BadRequestException(parsed.error.message);
    return this.access.run(undefined,async()=>{const result=await this.prepare(parsed.data);
      return {valid:true,count:result.rows.length,accepted:result.rows.filter(r=>r.reportState==='ACCEPTED').length,
        approved:result.rows.filter(r=>r.reportState==='EMPTY').length,contractId:result.ctx.contract.id,
        warnings:result.issues.filter(i=>i.severity==='WARNING').map(i=>({sourceKey:parsed.data.items[i.index]?.sourceKey,message:i.message}))};});
  }
  async apply(input:unknown){const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new BadRequestException(parsed.error.message);
    return this.access.run(undefined,async()=>{
      const digest=createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
      const key=`admicro-bookings-${digest.slice(0,36)}`;
      const old=await this.bookings.command(key);if(old)return old.result;
      const result=await this.prepare(parsed.data);await this.bookings.lock([result.ctx.contract.id]);
      // Recheck under the contract lock so a concurrent booking cannot consume the same quota.
      const current=await this.bookings.all();
      const issues=checkBookingLimits(result.ctx,current.filter(r=>r.contractId===result.ctx.contract.id),result.rows,new Date().toISOString());
      if(issues.some(i=>i.severity==='BLOCK'))throw new ConflictException('Hạn mức đã đổi trong lúc nhập; chạy xem trước lại.');
      for(const row of result.rows)await this.bookings.save(row,null,this.access.snapshot().actor,'booking.import.historical');
      const response={count:result.rows.length,accepted:result.rows.filter(r=>r.reportState==='ACCEPTED').length,
        approved:result.rows.filter(r=>r.reportState==='EMPTY').length,contractId:result.ctx.contract.id,
        ids:result.rows.map(r=>r.id),sourceKeys:parsed.data.items.map(i=>i.sourceKey)};
      await this.bookings.saveCommand(key,digest,response,this.access.snapshot().actor);return response;
    });
  }
}
