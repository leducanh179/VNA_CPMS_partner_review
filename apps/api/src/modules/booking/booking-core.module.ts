import { Module } from '@nestjs/common';
import { BookingRepository } from './application/booking.repository';
import { PrismaBookingRepository } from './infrastructure/prisma-booking.repository';
import { BookingConsumptionProvider } from './infrastructure/booking-consumption.provider';
@Module({providers:[{provide:BookingRepository,useClass:PrismaBookingRepository},BookingConsumptionProvider],exports:[BookingRepository,BookingConsumptionProvider]})
export class BookingCoreModule {}
