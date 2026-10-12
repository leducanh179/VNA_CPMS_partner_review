import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BookingApplicationService } from '../application/booking.application-service';
import { BookingDelegationApplicationService } from '../application/booking-delegation.application-service';
import { HistoricalBookingImportApplicationService } from '../application/historical-booking-import.application-service';
@ApiTags('bookings-v1')
@Controller('bookings')
export class BookingController {
  constructor(@Inject(BookingApplicationService) private readonly service:BookingApplicationService,@Inject(BookingDelegationApplicationService) private readonly delegations:BookingDelegationApplicationService,@Inject(HistoricalBookingImportApplicationService) private readonly historical:HistoricalBookingImportApplicationService){}
  @Get('delegations') delegationList(){return this.delegations.list();}
  @Post('delegations/:contractId') delegationSave(@Param('contractId') id:string,@Body() body:unknown){return this.delegations.save(id,body);}
  @Get() list(@Query() query:{trash?:string;contractId?:string;campaignId?:string}){return this.service.list(query);}
  @Get('bootstrap') bootstrap(){return this.service.bootstrap();}
  @Get('inbox') inbox(){return this.service.inbox();}
  @Get('policy') policy(){return this.service.policy();}
  @Post('policy') configurePolicy(@Body() body:unknown){return this.service.configurePolicy(body);}
  @Post('workflow') workflow(@Body() body:unknown){return this.service.workflow(body);}
  @Post('check') check(@Body() body:unknown){return this.service.check(body);}
  @Post('impact') impact(@Body() body:unknown){return this.service.impact(body);}
  @Post('batch-save') save(@Body() body:unknown){return this.service.save(body);}
  @Post('historical-import/preview') historicalPreview(@Body() body:unknown){return this.historical.preview(body);}
  @Post('historical-import/apply') historicalApply(@Body() body:unknown){return this.historical.apply(body);}
  @Post('actions') actions(@Body() body:unknown){return this.service.lifecycle(body);}
  @Post('reports') reports(@Body() body:unknown){return this.service.reports(body);}
  @Post('allocations/access') assignment(@Body() body:Parameters<BookingApplicationService['configureAllocation']>[0]){return this.service.configureAllocation(body);}
  @Post('templates') template(@Body() body:Parameters<BookingApplicationService['configureTemplate']>[0]){return this.service.configureTemplate(body);}
  @Get(':id') detail(@Param('id') id:string){return this.service.detail(id);}
}
