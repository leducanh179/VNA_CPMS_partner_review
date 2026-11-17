import { Inject, Injectable } from '@nestjs/common';
import { defaultCampaignShare, parseMaterialCampaignRefs, type ActorContext, type CampaignShareSettings } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { materialRecordSummary } from '../../material/infrastructure/prisma-material.repository';
import { CampaignSharingRepository, type CampaignShareSpreadsheetRecord } from '../application/campaign-sharing.repository';
import { campaignShareText } from '../application/campaign-sharing.application-service';

const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

@Injectable()
export class PrismaCampaignSharingRepository extends CampaignSharingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  async spreadsheet(id: string) {
    const row = await this.prisma.database.campaignSharing.findUnique({
      where: { campaignId: id }, select: { spreadsheetId: true, spreadsheetExportedAt: true, spreadsheetSharingVersion: true },
    });
    return row?.spreadsheetId && row.spreadsheetExportedAt && row.spreadsheetSharingVersion !== null
      ? { id: row.spreadsheetId, exportedAt: row.spreadsheetExportedAt, sharingVersion: row.spreadsheetSharingVersion } : null;
  }

  async saveSpreadsheet(id: string, value: CampaignShareSpreadsheetRecord, actor: ActorContext, viewerEmail?: string) {
    await this.prisma.inTransaction(async db => {
      await db.campaignSharing.update({
        where: { campaignId: id, version: value.sharingVersion },
        data: { spreadsheetId: value.id, spreadsheetExportedAt: value.exportedAt, spreadsheetSharingVersion: value.sharingVersion },
      });
      await db.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action: 'campaign.public_spreadsheet_exported', entityType: 'campaign', entityId: id,
        payload: { spreadsheetId: value.id, sharingVersion: value.sharingVersion, ...(viewerEmail ? { viewerEmail } : {}) },
      } });
    });
  }

  async subject(id: string) {
    const campaign = await this.prisma.database.campaign.findFirst({
      where: { id, deletedAt: null }, select: { createdByActorId: true, sharing: true },
    });
    if (!campaign) return null;
    const row = campaign.sharing;
    const settings: CampaignShareSettings = row ? {
      mode: row.mode as CampaignShareSettings['mode'], version: row.version,
      tabs: { RESTRICTED: row.restrictedTabs, ACCOUNTS: row.accountTabs, PUBLIC: row.publicTabs } as CampaignShareSettings['tabs'],
    } : defaultCampaignShare();
    return { ownerId: campaign.createdByActorId, settings };
  }

  async save(id: string, before: CampaignShareSettings, after: CampaignShareSettings, actor: ActorContext) {
    await this.prisma.inTransaction(async db => {
      const data = { mode: after.mode, version: after.version, restrictedTabs: after.tabs.RESTRICTED,
        accountTabs: after.tabs.ACCOUNTS, publicTabs: after.tabs.PUBLIC };
      await db.campaignSharing.upsert({ where: { campaignId: id }, create: { campaignId: id, ...data }, update: data });
      await db.auditEvent.create({ data: {
        actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
        action: 'campaign.sharing_changed', entityType: 'campaign', entityId: id, payload: { before: { ...before }, after: { ...after } },
      } });
    });
  }

  async materials(id: string, code: string, name: string, publicOnly: boolean) {
    const rows = await this.prisma.database.materialRecord.findMany({
      where: { isDeleted: false, ...(publicOnly ? { sharingMode: 'SHARED' } : {}), OR: [
        { data: { path: ['campaign_refs'], string_contains: id } },
        { data: { path: ['campaign_code'], equals: code } },
        { data: { path: ['campaign_name'], equals: name } },
      ] },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(materialRecordSummary).filter(({ fields }) => {
      const references = parseMaterialCampaignRefs(fields.campaign_refs);
      return references.length ? references.some(ref => ref.kind === 'SYSTEM' && ref.id === id)
        : fields.campaign_code ? fields.campaign_code === code : fields.campaign_name === name;
    });
  }

  async driveUrl(id: string) {
    const row = await this.prisma.database.campaignDriveWorkspace.findUnique({
      where: { campaignId: id }, select: { campaignFolderLink: true, lifecycleStatus: true },
    });
    return row?.lifecycleStatus === 'ACTIVE' && row.campaignFolderLink?.startsWith('https://drive.google.com/') ? row.campaignFolderLink : null;
  }

  async planning(id: string) {
    const rows = await this.prisma.database.qcttPlanItem.findMany({
      where: { campaignId: id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, activityLabel: true, channelCode: true, startDate: true, endDate: true, content: true, progress: true },
    });
    return rows.map(row => ({ id: row.id, activity: row.activityLabel, channel: row.channelCode,
      start: day(row.startDate), end: day(row.endDate), content: campaignShareText(row.content), progress: row.progress }));
  }
}
