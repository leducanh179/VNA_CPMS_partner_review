import type { ActorContext } from '@cpms/domain';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../auth/current-actor.decorator';
import { SystemApplicationService } from './system.application-service';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(@Inject(SystemApplicationService) private readonly system: SystemApplicationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check API, PostgreSQL, demo auth, and AI mode' })
  async status(@CurrentActor() actor: ActorContext) {
    return this.system.status(actor);
  }
}
