import { hasPermission, type ActorContext } from '@cpms/domain';
import { ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class CampaignCollaborationAuthorizationService {
  requireView(actor: ActorContext) {
    if (!hasPermission(actor.roles, 'campaign.read')) {
      throw new ForbiddenException('Bạn không có quyền xem trao đổi của chiến dịch.');
    }
  }

  requireComment(actor: ActorContext) {
    if (!hasPermission(actor.roles, 'campaign.comment')) {
      throw new ForbiddenException('Bạn không có quyền bình luận về chiến dịch.');
    }
  }

  requireJournal(actor: ActorContext) {
    if (!hasPermission(actor.roles, 'campaign.journal.read')) {
      throw new ForbiddenException('Bạn không có quyền xem nhật ký chiến dịch.');
    }
  }

  requireOwner(actor: ActorContext, authorActorId: string) {
    if (actor.id !== authorActorId) {
      throw new ForbiddenException('Chỉ tác giả mới được sửa hoặc xóa bình luận này.');
    }
  }
}
