import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { LookupReadRequirement, LookupSource } from '@cpms/ai-contracts';
import { ContractsApplicationService } from '../../contracts/application/contracts.application-service';
import { BookingApplicationService } from '../../booking/application/booking.application-service';

/** Explicit read projections: never send audit, imported raw source, credentials or linked records. */
function fields(row: object, names: string[]) {
  const result: Record<string, unknown> = {};
  for (const key of names) {
    const value = (row as Record<string, unknown>)[key];
    if (value !== undefined) result[key] = typeof value === 'string' ? value.slice(0, 900) : value;
  }
  return result;
}
@Injectable()
export class LookupRecordApplicationService {
  constructor(@Inject(ContractsApplicationService) private readonly contracts: ContractsApplicationService,
    @Inject(BookingApplicationService) private readonly bookings: BookingApplicationService) {}

  async read(actor: ActorContext, kind: 'CONTRACT' | 'BOOKING', id: string) {
    let item: Record<string, unknown>, source: LookupSource;
    if (kind === 'CONTRACT') {
      const row = (await this.contracts.detail(id, actor)).contract;
      if (row.deletedAt) throw new NotFoundException('Không tìm thấy hồ sơ.');
      item = fields(row, ['id', 'code', 'number', 'name', 'vendor', 'serviceRecipient', 'supplyType', 'ownerUnitCode', 'ownerDepartment',
        'marketScope', 'marketCodes', 'leaderName', 'managerName', 'startDate', 'endDate', 'currency', 'signedAmount', 'signedVat', 'signedGross', 'status', 'recordVersion']);
      source = { kind, id, title: row.name, href: `/contracts/${encodeURIComponent(id)}`, version: row.recordVersion };
    } else {
      const row = (await this.bookings.detail(id, actor)).booking;
      if (row.deletedAt) throw new NotFoundException('Không tìm thấy hồ sơ.');
      item = fields(row, ['id', 'contractName', 'slotName', 'periodName', 'beneficiaryLabel', 'campaignLabel', 'startDate', 'endDate',
        'overallStartDate', 'overallEndDate', 'quantity', 'unit', 'unitPrice', 'priceBasis', 'taxRate', 'amount', 'vat', 'gross', 'state',
        'vendorConfirmedQty', 'sourceApprovedQty', 'acceptedQty', 'reportState', 'note', 'recordVersion']);
      source = { kind, id, title: `${row.campaignLabel} · ${row.slotName}`, href: `/bookings?bookingId=${encodeURIComponent(id)}`, version: row.recordVersion };
    }
    const requirement: LookupReadRequirement = { kind, id, fields: Object.keys(item) };
    return { content: { item, scope: 'Thông tin chính của hồ sơ đã lưu; không bao gồm toàn bộ dòng chi tiết, lịch sử hoặc nội dung file.' }, sources: [source], requirements: [requirement] };
  }
}
