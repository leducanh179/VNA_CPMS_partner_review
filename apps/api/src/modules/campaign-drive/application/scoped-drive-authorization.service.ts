import type { ActorContext } from '@cpms/domain';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignDriveAuthorizationService } from './campaign-drive-authorization.service';

/** The scoped application method supplies each record/action check; legacy role checks cannot veto record allows. */
@Injectable()
export class ScopedDriveAuthorizationService extends CampaignDriveAuthorizationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService) { super(); }
  override canView(actor: ActorContext) { return this.access.snapshot().actor.id === actor.id; }
  override canManage(actor: ActorContext) { return this.canView(actor); }
  override canManageLifecycle(actor: ActorContext) { return this.canView(actor); }
  override requireView(actor: ActorContext) { if (!this.canView(actor)) throw new ForbiddenException('Người thực hiện không khớp phiên.'); }
  override requireManage(actor: ActorContext) { this.requireView(actor); }
}
