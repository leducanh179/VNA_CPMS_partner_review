import type { ActorContext } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { CampaignDriveWorkspace, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CAMPAIGN_DRIVE_REPOSITORY,
  type CampaignDriveRepository,
  type CampaignDriveWorkspaceRecord,
} from '../application/campaign-drive.repository';

function toRecord(value: CampaignDriveWorkspace): CampaignDriveWorkspaceRecord {
  return value as CampaignDriveWorkspaceRecord;
}

@Injectable()
export class PrismaCampaignDriveRepository implements CampaignDriveRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(campaignId: string) {
    const value = await this.prisma.database.campaignDriveWorkspace.findUnique({ where: { campaignId } });
    return value ? toRecord(value) : null;
  }

  async findByFolderId(folderId: string) {
    const value = await this.prisma.database.campaignDriveWorkspace.findUnique({ where: { campaignFolderId: folderId } });
    return value ? toRecord(value) : null;
  }

  async save(record: Omit<CampaignDriveWorkspaceRecord, 'createdAt' | 'updatedAt'>) {
    const value = await this.prisma.database.campaignDriveWorkspace.upsert({
      where: { campaignId: record.campaignId },
      create: record,
      update: {
        sharedDriveId: record.sharedDriveId,
        parentFolderId: record.parentFolderId,
        campaignFolderId: record.campaignFolderId,
        campaignFolderLink: record.campaignFolderLink,
        lastKnownFolderName: record.lastKnownFolderName,
        baseDocumentsFolderId: record.baseDocumentsFolderId,
        mediaAssetsFolderId: record.mediaAssetsFolderId,
        otherDocumentsFolderId: record.otherDocumentsFolderId,
        templateVersion: record.templateVersion,
        accessMode: record.accessMode,
        sharingMode: record.sharingMode,
        permissionPolicyVersion: record.permissionPolicyVersion ?? 1,
        syncStatus: record.syncStatus,
        lifecycleStatus: record.lifecycleStatus,
        lastCheckedAt: record.lastCheckedAt,
        lastErrorCode: record.lastErrorCode,
        lastErrorMessage: record.lastErrorMessage,
        googlePermissionId: record.googlePermissionId,
        desiredRole: record.desiredRole,
        permissionSyncStatus: record.permissionSyncStatus,
      },
    });
    return toRecord(value);
  }

  async recordAudit(actor: ActorContext, campaignId: string, action: string, payload: Record<string, unknown>) {
    await this.prisma.database.auditEvent.create({
      data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action,
        entityType: 'campaign_drive_workspace',
        entityId: campaignId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}

export { CAMPAIGN_DRIVE_REPOSITORY };
