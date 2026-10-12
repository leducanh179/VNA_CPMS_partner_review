import { hasPermission, type ActorContext } from '@cpms/domain';
import { ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class CampaignDriveAuthorizationService {
  canView(actor: ActorContext) { return hasPermission(actor.roles, 'campaign.read'); }
  canManage(actor: ActorContext) { return hasPermission(actor.roles, 'campaign.update'); }
  canManageLifecycle(actor: ActorContext) { return hasPermission(actor.roles, 'campaign.delete') || hasPermission(actor.roles, 'campaign.restore'); }

  requireView(actor: ActorContext) {
    if (!this.canView(actor)) throw new ForbiddenException('Bạn không có quyền xem tài liệu Google Drive của chiến dịch này.');
  }

  requireManage(actor: ActorContext) {
    if (!this.canManage(actor)) throw new ForbiddenException('Bạn không có quyền thay đổi tài liệu Google Drive của chiến dịch này.');
  }
}
