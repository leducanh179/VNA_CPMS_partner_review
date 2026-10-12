import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignCollaborationAuthorizationService } from './campaign-collaboration-authorization.service';

/** The scoped application adapters check each resource/action; this legacy helper retains ownership invariants. */
@Injectable()
export class ScopedCollaborationAuthorizationService extends CampaignCollaborationAuthorizationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService) { super(); }
  private requireContext(actor: ActorContext) {
    if (this.access.snapshot().actor.id !== actor.id) throw new ForbiddenException('Ngữ cảnh người thực hiện không khớp.');
  }
  override requireView(actor: ActorContext) { this.requireContext(actor); }
  override requireComment(actor: ActorContext) { this.requireContext(actor); }
  override requireJournal(actor: ActorContext) { this.requireContext(actor); }
}
