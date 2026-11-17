import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicGuestApplicationService } from '../application/public-guest.application-service';
import { CampaignSharingApplicationService } from '../application/campaign-sharing.application-service';

@ApiTags('public-guest')
@Controller('public/guest')
export class PublicGuestController {
  constructor(@Inject(PublicGuestApplicationService) private readonly guest: PublicGuestApplicationService,
    @Inject(CampaignSharingApplicationService) private readonly sharing: CampaignSharingApplicationService) {}
  @Get('campaigns') @ApiOperation({ summary: 'Public read-only real Campaign projections' }) campaigns() { return this.guest.campaigns(); }
  @Get('campaigns/:id') @ApiOperation({ summary: 'Read Campaign tabs explicitly shared with the public' }) campaign(@Param('id', ParseUUIDPipe) id: string) { return this.sharing.publicView(id); }
  @Get('contracts') @ApiOperation({ summary: 'Public Contract main table without financial or quantity fields' }) contracts() { return this.guest.contracts(); }
  @Get('bookings') @ApiOperation({ summary: 'Public Booking main table without financial or quantity fields' }) bookings() { return this.guest.bookings(); }
  @Get('materials') @ApiOperation({ summary: 'Public Material main table projection' }) materials() { return this.guest.materials(); }
  @Get('plans') @ApiOperation({ summary: 'Public QCTT plan main table projection' }) plans() { return this.guest.plans(); }
}
