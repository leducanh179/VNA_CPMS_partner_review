import type { ActorContext } from '@cpms/domain';
import { CLOUD_DRIVE_PORT, type CloudDrivePort } from '@cpms/integrations';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';
import { ProviderOperationAccessService } from '../../google-integration/application/provider-operation-access.service';
import { CampaignDriveGoogleAccessService } from './campaign-drive-google-access.service';
import { CAMPAIGN_DRIVE_REPOSITORY, type CampaignDriveRepository } from './campaign-drive.repository';
import { CampaignDriveRelinkRepository, type CampaignDriveRelinkRecord } from './campaign-drive-relink.repository';
import { driveFolderIdFromUrl, driveFolderLink, folderChainToRoot } from './campaign-drive-folder-scope';

const EXPIRED_PREFIX = '[Hết hiệu lực] ';

@Injectable()
export class CampaignDriveRelinkApplicationService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(ScopedCampaignApplicationService) private readonly campaigns: ScopedCampaignApplicationService,
    @Inject(CampaignWorkflowApplicationService) private readonly workflow: CampaignWorkflowApplicationService,
    @Inject(CampaignDriveGoogleAccessService) private readonly google: CampaignDriveGoogleAccessService,
    @Inject(CLOUD_DRIVE_PORT) private readonly drive: CloudDrivePort,
    @Inject(CAMPAIGN_DRIVE_REPOSITORY) private readonly workspaces: CampaignDriveRepository,
    @Inject(CampaignDriveRelinkRepository) private readonly requests: CampaignDriveRelinkRepository,
    @Inject(ProviderOperationAccessService) private readonly provider: ProviderOperationAccessService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
  ) {}

  private configuration() {
    const sharedDriveId = this.config.get('GOOGLE_DRIVE_SHARED_DRIVE_ID', { infer: true });
    const parentFolderId = this.config.get('GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID', { infer: true });
    if (!sharedDriveId || !parentFolderId) throw new ConflictException('Google Drive Chiến dịch chưa được cấu hình.');
    return { sharedDriveId, parentFolderId };
  }

  private async eligibleTarget(accessToken: string, campaignId: string, targetId: string, sourceId: string) {
    const { sharedDriveId, parentFolderId } = this.configuration();
    const chain = await folderChainToRoot(this.drive, accessToken, targetId, parentFolderId, sharedDriveId, false);
    for (const folder of chain.slice(0, -1)) {
      if (folder.id === sourceId) throw new ConflictException('Không thể chọn thư mục nằm bên trong thư mục hiện tại.');
      const assigned = await this.workspaces.findByFolderId(folder.id);
      if (assigned && assigned.campaignId !== campaignId) throw new ConflictException('Thư mục này nằm trong Chiến dịch khác.');
      if (await this.requests.findOtherCampaignHistory(folder.id, campaignId)) throw new ConflictException('Thư mục này từng thuộc Chiến dịch khác.');
    }
    // Do not make the old campaign root an expired subfolder of the newly selected root.
    const sourceChain = await folderChainToRoot(this.drive, accessToken, sourceId, parentFolderId, sharedDriveId, false);
    if (sourceChain.some((folder) => folder.id === targetId)) throw new ConflictException('Không thể chọn thư mục bao ngoài thư mục hiện tại.');
    const target = chain[0]!;
    if (!target.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google dùng chung không có quyền đổi tên thư mục mới.');
    return target;
  }

  @AccessBoundary(2)
  async preview(campaignId: string, folderUrl: string, actor: ActorContext) {
    const resource = await this.access.campaign(campaignId);
    this.access.require('campaign.drive.ensure', resource);
    const campaign = await this.campaigns.get(campaignId);
    if (campaign.isDeleted) throw new ConflictException('Hãy khôi phục Chiến dịch trước khi đổi thư mục.');
    const workspace = await this.workspaces.get(campaignId);
    if (!workspace?.campaignFolderId || !workspace.campaignFolderLink) throw new ConflictException('Chiến dịch chưa có thư mục Google Drive hiện tại.');
    const targetId = driveFolderIdFromUrl(folderUrl);
    if (targetId === workspace.campaignFolderId) throw new ConflictException('Đây đã là thư mục Google Drive của Chiến dịch.');
    const target = await this.provider.execute('campaign.drive.read', resource,
      () => this.google.withAccessToken(actor, (token) => this.eligibleTarget(token, campaignId, targetId, workspace.campaignFolderId!)));
    return { folderId: target.id, folderUrl: driveFolderLink(target.id), currentName: target.name,
      expectedName: `${campaign.code} ${campaign.name.trim()}`, replacingFolderId: workspace.campaignFolderId,
      replacingFolderLink: workspace.campaignFolderLink, replacingFolderName: workspace.lastKnownFolderName };
  }

  @AccessBoundary(2)
  async request(campaignId: string, input: { folderUrl: string; expectedCurrentName: string; expectedPreviousFolderId: string; reason: string; confirmRename: boolean }, actor: ActorContext) {
    if (!input.confirmRename) throw new BadRequestException('Cần chấp nhận việc CPMS đổi tên thư mục mới theo mã và tên Chiến dịch.');
    const reason = input.reason.trim();
    if (!reason || reason.length > 2000) throw new BadRequestException('Hãy nhập lý do đổi thư mục (tối đa 2.000 ký tự).');
    const preview = await this.preview(campaignId, input.folderUrl, actor);
    if (preview.currentName !== input.expectedCurrentName || preview.replacingFolderId !== input.expectedPreviousFolderId) {
      throw new ConflictException('Thư mục mới hoặc liên kết hiện tại đã thay đổi. Hãy kiểm tra lại.');
    }
    const source = await this.provider.execute('campaign.drive.read', await this.access.campaign(campaignId),
      () => this.google.withAccessToken(actor, (token) => this.drive.getItem(token, preview.replacingFolderId)));
    const created = await this.requests.create({ campaignId, sourceFolderId: preview.replacingFolderId,
      sourceFolderLink: preview.replacingFolderLink, sourceFolderName: source.name,
      targetFolderId: preview.folderId, targetFolderLink: preview.folderUrl, targetFolderName: preview.currentName,
      expectedFolderName: preview.expectedName, reason, requestedByActorId: actor.id });
    await this.workspaces.recordAudit(actor, campaignId, 'campaign.drive_relink_requested', {
      requestId: created.id, oldFolderId: created.sourceFolderId, newFolderId: created.targetFolderId, reason });
    return created;
  }

  private async mayDecide(campaignId: string, actor: ActorContext) {
    const identity = this.access.snapshot().identity;
    if (identity.mode === 'DIRECT' && identity.effectiveSuperadmin && identity.originalActorId === identity.effectiveActorId) {
      this.access.require('access.manage');
      return true;
    }
    await this.workflow.requireLeadDivisionLeader(actor, campaignId);
    return true;
  }

  @AccessBoundary(1)
  async read(campaignId: string, actor: ActorContext) {
    const resource = await this.access.campaign(campaignId);
    this.access.require('campaign.drive.read', resource);
    let canDecide = false;
    try { canDecide = await this.mayDecide(campaignId, actor); } catch (error) { if (!(error instanceof ForbiddenException || error instanceof ConflictException)) throw error; }
    const rows = await this.requests.list(campaignId);
    return { requests: rows, canRequest: this.access.check('campaign.drive.ensure', resource).allowed,
      canDecide, actorId: actor.id };
  }

  @AccessBoundary(0)
  async inbox(actor: ActorContext) {
    const ids = await this.access.visibleCampaignIds();
    const pending = await this.requests.listPending(ids);
    const items = [];
    for (const request of pending) {
      try {
        await this.mayDecide(request.campaignId, actor);
        const campaign = await this.campaigns.get(request.campaignId);
        if (campaign.isDeleted) continue;
        items.push({ campaignId: request.campaignId, campaignCode: campaign.code, campaignName: campaign.name,
          requestId: request.id, reason: request.reason, requestedAt: request.requestedAt });
      } catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof ConflictException)) throw error;
      }
    }
    return { items };
  }

  @AccessBoundary(3)
  async decide(campaignId: string, requestId: string, input: { approve: boolean; reason: string; expectedVersion: number }, actor: ActorContext) {
    await this.mayDecide(campaignId, actor);
    const request = await this.requests.get(requestId);
    if (!request || request.campaignId !== campaignId) throw new NotFoundException('Không có yêu cầu đổi thư mục này.');
    if (request.status !== 'PENDING' || request.recordVersion !== input.expectedVersion) throw new ConflictException('Yêu cầu đã thay đổi. Hãy tải lại.');
    if (request.requestedByActorId === actor.id && !this.access.snapshot().identity.effectiveSuperadmin) {
      throw new ForbiddenException('Người gửi không tự phê duyệt yêu cầu đổi thư mục.');
    }
    const reason = input.reason.trim();
    if (!input.approve && !reason) throw new BadRequestException('Hãy nhập lý do từ chối.');
    const status = input.approve ? 'APPLYING' : 'REJECTED';
    if (!await this.requests.transition(request.id, 'PENDING', request.recordVersion, status,
      { decidedByActorId: actor.id, decisionReason: reason, decidedAt: new Date() })) {
      throw new ConflictException('Yêu cầu vừa được người khác xử lý.');
    }
    await this.workspaces.recordAudit(actor, campaignId, input.approve ? 'campaign.drive_relink_approved' : 'campaign.drive_relink_rejected',
      { requestId, reason, oldFolderId: request.sourceFolderId, newFolderId: request.targetFolderId });
    if (input.approve) return this.apply((await this.requests.get(request.id))!, actor);
    return this.requests.get(request.id);
  }

  @AccessBoundary(2)
  async retry(campaignId: string, requestId: string, actor: ActorContext) {
    await this.mayDecide(campaignId, actor);
    const request = await this.requests.get(requestId);
    if (!request || request.campaignId !== campaignId) throw new NotFoundException('Không có yêu cầu đổi thư mục này.');
    const staleApplying = request.status === 'APPLYING' && request.decidedAt && Date.now() - request.decidedAt.getTime() > 15 * 60_000;
    if (!(request.status === 'FAILED' || staleApplying) || !request.decidedByActorId) {
      throw new ConflictException('Yêu cầu đang được xử lý hoặc không ở trạng thái có thể thử lại.');
    }
    if (!await this.requests.transition(request.id, request.status, request.recordVersion, 'APPLYING', { lastError: null, decidedAt: new Date() })) {
      throw new ConflictException('Yêu cầu vừa được xử lý.');
    }
    return this.apply((await this.requests.get(request.id))!, actor);
  }

  @AccessBoundary(2)
  async withdraw(campaignId: string, requestId: string, actor: ActorContext) {
    const request = await this.requests.get(requestId);
    if (!request || request.campaignId !== campaignId) throw new NotFoundException('Không có yêu cầu đổi thư mục này.');
    if (request.requestedByActorId !== actor.id) throw new ForbiddenException('Chỉ người gửi được rút yêu cầu.');
    if (request.status !== 'PENDING' && request.status !== 'FAILED') throw new ConflictException('Yêu cầu đã được xử lý.');
    if (!await this.requests.transition(request.id, request.status, request.recordVersion, 'WITHDRAWN', {})) {
      throw new ConflictException('Yêu cầu vừa được xử lý.');
    }
    await this.workspaces.recordAudit(actor, campaignId, 'campaign.drive_relink_withdrawn', { requestId });
    return this.requests.get(request.id);
  }

  private async apply(request: CampaignDriveRelinkRecord, actor: ActorContext) {
    try {
      const resource = await this.access.campaign(request.campaignId);
      await this.mayDecide(request.campaignId, actor);
      const campaign = await this.campaigns.get(request.campaignId);
      const workspace = await this.workspaces.get(request.campaignId);
      if (!workspace || workspace.campaignFolderId !== request.sourceFolderId || campaign.isDeleted) {
        throw new ConflictException('Chiến dịch hoặc liên kết hiện tại đã thay đổi.');
      }
      if (`${campaign.code} ${campaign.name.trim()}` !== request.expectedFolderName) {
        throw new ConflictException('Tên Chiến dịch đã thay đổi; cần gửi yêu cầu mới.');
      }
      await this.provider.execute('campaign.approve', resource, () => this.google.withAccessToken(actor, async (token) => {
        const target = await this.eligibleTarget(token, request.campaignId, request.targetFolderId, request.sourceFolderId);
        const source = await this.drive.getItem(token, request.sourceFolderId);
        const { sharedDriveId, parentFolderId } = this.configuration();
        await folderChainToRoot(this.drive, token, source.id, parentFolderId, sharedDriveId, false);
        if (!source.capabilities.canEdit) throw new ForbiddenException('Tài khoản Google dùng chung không có quyền đổi tên thư mục cũ.');
        if (![request.targetFolderName, request.expectedFolderName].includes(target.name)) {
          throw new ConflictException('Tên thư mục mới đã thay đổi từ khi gửi yêu cầu.');
        }
        if (![request.sourceFolderName, `${EXPIRED_PREFIX}${request.sourceFolderName}`].includes(source.name)) {
          throw new ConflictException('Tên thư mục cũ đã thay đổi từ khi gửi yêu cầu.');
        }
        if (target.name !== request.expectedFolderName) {
          const updated = await this.drive.renameItem({ accessToken: token, fileId: target.id, name: request.expectedFolderName });
          if (updated.id !== target.id || updated.name !== request.expectedFolderName) throw new ConflictException('Google Drive chưa xác nhận tên thư mục mới.');
        }
        const expiredName = `${EXPIRED_PREFIX}${request.sourceFolderName}`;
        if (source.name !== expiredName) {
          const updated = await this.drive.renameItem({ accessToken: token, fileId: source.id, name: expiredName });
          if (updated.id !== source.id || updated.name !== expiredName) throw new ConflictException('Google Drive chưa xác nhận tên thư mục cũ.');
        }
      }));
      if (!await this.requests.finish(request, actor)) throw new ConflictException('Liên kết hiện tại đã đổi trong lúc áp dụng; cần đối soát trạng thái Drive.');
      return this.requests.get(request.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Không thể hoàn tất thao tác Google Drive.';
      await this.requests.transition(request.id, 'APPLYING', request.recordVersion, 'FAILED', { lastError: message });
      await this.workspaces.recordAudit(actor, request.campaignId, 'campaign.drive_relink_apply_failed', {
        requestId: request.id, oldFolderId: request.sourceFolderId, newFolderId: request.targetFolderId, error: message });
      throw error;
    }
  }
}
