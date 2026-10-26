import type { ActorContext } from '@cpms/domain';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CampaignDriveRelinkRepository, type CampaignDriveRelinkRecord, type CampaignDriveRelinkStatus, type CreateCampaignDriveRelink } from '../application/campaign-drive-relink.repository';

@Injectable()
export class PrismaCampaignDriveRelinkRepository extends CampaignDriveRelinkRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  async listPending(campaignIds: string[]) {
    if (!campaignIds.length) return [];
    return this.prisma.database.campaignDriveRelinkRequest.findMany({ where: { campaignId: { in: campaignIds }, status: 'PENDING' }, orderBy: { requestedAt: 'desc' } }) as Promise<CampaignDriveRelinkRecord[]>;
  }

  async list(campaignId: string) {
    return this.prisma.database.campaignDriveRelinkRequest.findMany({ where: { campaignId }, orderBy: { requestedAt: 'desc' } }) as Promise<CampaignDriveRelinkRecord[]>;
  }

  async get(id: string) {
    return this.prisma.database.campaignDriveRelinkRequest.findUnique({ where: { id } }) as Promise<CampaignDriveRelinkRecord | null>;
  }

  async create(input: CreateCampaignDriveRelink) {
    try {
      return await this.prisma.database.campaignDriveRelinkRequest.create({ data: input }) as CampaignDriveRelinkRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Đã có yêu cầu thay đổi thư mục Google Drive đang chờ xử lý.');
      }
      throw error;
    }
  }

  async transition(id: string, from: CampaignDriveRelinkStatus, expectedVersion: number, to: CampaignDriveRelinkStatus,
    update: { decidedByActorId?: string; decisionReason?: string; decidedAt?: Date; lastError?: string | null }) {
    const result = await this.prisma.database.campaignDriveRelinkRequest.updateMany({
      where: { id, status: from, recordVersion: expectedVersion },
      data: { status: to, recordVersion: { increment: 1 }, ...update },
    });
    return result.count === 1;
  }

  async finish(request: CampaignDriveRelinkRecord, actor: ActorContext) {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.campaignDriveRelinkRequest.findUnique({ where: { id: request.id } });
      if (!current || current.status !== 'APPLYING' || current.recordVersion !== request.recordVersion) return false;
      const changed = await tx.campaignDriveWorkspace.updateMany({
        where: { campaignId: request.campaignId, campaignFolderId: request.sourceFolderId },
        data: {
          campaignFolderId: request.targetFolderId,
          campaignFolderLink: request.targetFolderLink,
          lastKnownFolderName: request.expectedFolderName,
          baseDocumentsFolderId: null,
          mediaAssetsFolderId: null,
          otherDocumentsFolderId: null,
          templateVersion: 2,
          syncStatus: 'READY',
          lifecycleStatus: 'ACTIVE',
          lastCheckedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (changed.count !== 1) return false;
      await tx.campaignDriveRelinkRequest.update({ where: { id: request.id }, data: { status: 'APPLIED', appliedAt: new Date(), lastError: null, recordVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
        contextMode: actor.session?.mode ?? 'DIRECT', action: 'campaign.drive_relink_applied',
        entityType: 'campaign_drive_workspace', entityId: request.campaignId,
        payload: { requestId: request.id, oldFolderId: request.sourceFolderId, newFolderId: request.targetFolderId,
          oldFolderLink: request.sourceFolderLink, newFolderLink: request.targetFolderLink, result: 'SUCCESS' },
      } });
      return true;
    });
  }

  async findOtherCampaignHistory(folderId: string, campaignId: string) {
    const found = await this.prisma.database.campaignDriveRelinkRequest.findFirst({ where: {
      campaignId: { not: campaignId },
      OR: [{ sourceFolderId: folderId }, { targetFolderId: folderId }],
    }, select: { id: true } });
    return Boolean(found);
  }
}
