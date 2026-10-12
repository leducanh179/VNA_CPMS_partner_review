import { Inject, Injectable } from '@nestjs/common';
import type { InventoryConsumptionProvider, InventoryConsumptionSample, InventoryConsumptionScope } from '@cpms/integrations';
import { BookingRepository } from '../application/booking.repository';
import { decimal, numeric } from '../../contracts/domain/supply-engine';
import { bookingUsageRows } from '../domain/booking-workflow';
import type { BookingView } from '@cpms/domain';

type AllocationScope = Awaited<ReturnType<BookingRepository['allocationScopes']>>[number];
export function projectBookingConsumption(scopes:readonly InventoryConsumptionScope[], rows:BookingView[], allocations:AllocationScope[],asOf:string):InventoryConsumptionSample {
    const zero=()=>({qty:'0',amount:'0'});
    const values:InventoryConsumptionSample['values']={};
    for(const scope of scopes){
      const stages={booked:zero(),vendorConfirmed:zero(),approved:zero(),accepted:zero(),committed:zero()};
      const a=allocations.find(a=>a.allocationId===scope.allocationId);
      for(const stage of Object.keys(stages) as Array<keyof typeof stages>)for(const row of rows.flatMap(r=>bookingUsageRows(r,stage)).filter(r=>{
        if(a?.scopeKind!=='CAP')return r.allocationId===scope.allocationId;
        const leaf=allocations.find(l=>l.allocationId===r.allocationId);
        return r.contractId===scope.contractId&&leaf&&(!scope.slotId||r.slotId===scope.slotId)&&(!scope.beneficiaryUnitCode||leaf.beneficiaryUnitCode===scope.beneficiaryUnitCode)&&leaf.periodStart>=scope.periodStart&&leaf.periodEnd<=scope.periodEnd;
      })){
        const q=stage==='booked'||stage==='committed'?(row.deletedAt?row.acceptedQty:decimal(row.quantity).gt(row.acceptedQty)?row.quantity:row.acceptedQty):row.quantity;
        stages[stage].qty=decimal(stages[stage].qty).plus(q).toFixed();stages[stage].amount=numeric(decimal(stages[stage].amount).plus(decimal(q).mul(row.unitPrice).div(row.priceBasis)),6)!;
      }
      values[scope.allocationId]=stages;
    }
    return {asOf,mode:'BOOKING',source:'CPMS Booking',values};
}

@Injectable()
export class BookingConsumptionProvider implements InventoryConsumptionProvider {
  constructor(@Inject(BookingRepository) private readonly bookings:BookingRepository){}
  async read(scopes:readonly InventoryConsumptionScope[],asOf:string):Promise<InventoryConsumptionSample>{
    const rows=await this.bookings.all([...new Set(scopes.map(s=>s.contractId))]);
    const allocations=await this.bookings.allocationScopes([...new Set(scopes.map(s=>s.contractId))]);
    return projectBookingConsumption(scopes, rows, allocations, asOf);
  }
}
