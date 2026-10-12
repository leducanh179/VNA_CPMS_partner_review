import type { ActorContext } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';

/** Drive uses the company integration identity; Sheets retains per-user OAuth. */
@Injectable()
export class CampaignDriveGoogleAccessService {
  constructor(@Inject(GoogleIntegrationApplicationService) private readonly google: GoogleIntegrationApplicationService) {}
  status(_actor: ActorContext) { return this.google.driveStatus(); }
  withAccessToken<T>(actor: ActorContext, operation: (accessToken: string) => Promise<T>) {
    return this.google.withDriveAccessToken(actor, operation);
  }
}
