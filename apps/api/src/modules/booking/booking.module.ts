import { Module } from '@nestjs/common';
import { QcttPlanModule } from '../qctt-plan/qctt-plan.module';
import { ContractsModule } from '../contracts/contracts.module';
import { BookingCoreModule } from './booking-core.module';
import { BookingApplicationService } from './application/booking.application-service';
import { BookingController } from './transport/booking.controller';
import { IdentityModule } from '../identity/identity.module';
import { BookingSetupApplicationService } from './application/booking-setup.application-service';
import { BookingSetupRepository } from './application/booking-setup.repository';
import { PrismaBookingSetupRepository } from './infrastructure/prisma-booking-setup.repository';
import { BookingDelegationApplicationService } from './application/booking-delegation.application-service';
import { HistoricalBookingImportApplicationService } from './application/historical-booking-import.application-service';
@Module({imports:[ContractsModule,BookingCoreModule,IdentityModule,QcttPlanModule],providers:[BookingApplicationService,HistoricalBookingImportApplicationService,BookingDelegationApplicationService,BookingSetupApplicationService,{provide:BookingSetupRepository,useClass:PrismaBookingSetupRepository}],controllers:[BookingController],exports:[BookingApplicationService,BookingSetupApplicationService]})
export class BookingModule {}
