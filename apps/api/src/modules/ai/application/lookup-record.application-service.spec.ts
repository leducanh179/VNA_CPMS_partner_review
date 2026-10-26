import { describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '@cpms/domain';
import type { ContractsApplicationService } from '../../contracts/application/contracts.application-service';
import type { BookingApplicationService } from '../../booking/application/booking.application-service';
import { LookupRecordApplicationService } from './lookup-record.application-service';
const actor = { id: 'actor' } as ActorContext;
describe('AI record context projections', () => {
  it('uses the existing services and exact actor, excluding imported/audit/private linked data', async () => {
    const contractDetail = vi.fn(async () => ({ contract: { id: 'c', name: 'Hợp đồng mẫu', code: 'C1', recordVersion: 1, source: { secret: 'RAW' }, supplierSnapshot: { private: 'HIDDEN' } }, audit: ['AUDIT'] }));
    const bookingDetail = vi.fn(async () => ({ booking: { id: 'b', campaignLabel: 'Tết', slotName: 'Banner', recordVersion: 2, quantity: '10', source: { secret: 'RAW' }, contractSnapshot: { secret: 'HIDDEN' } }, history: ['AUDIT'] }));
    const service = new LookupRecordApplicationService({ detail: contractDetail } as unknown as ContractsApplicationService, { detail: bookingDetail } as unknown as BookingApplicationService);
    const contract = await service.read(actor, 'CONTRACT', 'c'), booking = await service.read(actor, 'BOOKING', 'b');
    expect(contractDetail).toHaveBeenCalledWith('c', actor); expect(bookingDetail).toHaveBeenCalledWith('b', actor);
    expect(contract.sources[0]?.kind).toBe('CONTRACT'); expect(booking.sources[0]?.href).toContain('bookingId=b');
    expect(booking.content.item.quantity).toBe('10');
    expect(JSON.stringify([contract, booking])).not.toMatch(/RAW|HIDDEN|AUDIT/);
  });
  it('propagates access denial and rejects deleted records for both modules', async () => {
    const service = new LookupRecordApplicationService({ detail: async () => { throw new Error('Denied'); } } as unknown as ContractsApplicationService,
      { detail: async () => ({ booking: { deletedAt: '2026-01-01' } }) } as unknown as BookingApplicationService);
    await expect(service.read(actor, 'CONTRACT', 'c')).rejects.toThrow('Denied');
    await expect(service.read(actor, 'BOOKING', 'b')).rejects.toThrow('Không tìm thấy');
  });
});
