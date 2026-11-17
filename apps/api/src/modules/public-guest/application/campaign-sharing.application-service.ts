import {
  CAMPAIGN_SHARE_MODES, CAMPAIGN_SHARE_TABS, campaignShareAudience,
  type ActorContext, type CampaignShareSettings, type CampaignSummary, type SharedCampaign,
} from '@cpms/domain';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';
import { publicMaterialProjection } from '../../material/application/public-material.application-service';
import { MaterialSharingApplicationService } from '../../material/application/material-sharing.application-service';
import { PublicGuestRepository } from './public-guest.repository';
import { CampaignSharingRepository } from './campaign-sharing.repository';

const tabs = z.array(z.enum(CAMPAIGN_SHARE_TABS)).max(CAMPAIGN_SHARE_TABS.length)
  .refine(values => new Set(values).size === values.length);
const command = z.object({
  mode: z.enum(CAMPAIGN_SHARE_MODES),
  tabs: z.object({ RESTRICTED: tabs, ACCOUNTS: tabs, PUBLIC: tabs }).strict(),
  version: z.number().int().nonnegative(),
}).strict();

function unavailable() {
  return new NotFoundException('Bạn chưa có quyền xem chiến dịch qua liên kết này hoặc liên kết đã hết hiệu lực.');
}

export function campaignShareText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(campaignShareText).filter(Boolean).join(' ');
  if (!value || typeof value !== 'object') return '';
  const node = value as { text?: unknown; content?: unknown };
  return typeof node.text === 'string' ? node.text : campaignShareText(node.content);
}

function information(row: CampaignSummary) {
  const range = (start: string | null | undefined, end: string | null | undefined) => [start, end].filter(Boolean).join(' – ');
  const entries = [
    ['Tình trạng chiến dịch', row.qcttStatus], ['Đơn vị yêu cầu', row.requestingUnit], ['Cấp chiến dịch', row.levelLabel],
    ['Thời gian QCTT', range(row.startDate, row.endDate)],
    ['Thời gian hiệu lực chương trình/xuất vé', range(row.effectiveStartDate, row.effectiveEndDate)],
    ['Thời gian hiệu lực khởi hành', range(row.departureStartDate, row.departureEndDate)],
    ['Mục tiêu', row.primaryObjectiveLabel ?? row.primaryObjectiveOther], ['Chỉ tiêu', row.kpiText],
    ['Thị trường', row.markets.map(market => market.marketName).join(', ')],
    ['Tỉnh, thành phố', row.provinces.map(province => province.provinceName).join(', ')],
    ['Đơn vị phối hợp', row.requestingUnits.map(unit => unit.displayName).join(', ')],
    ['Mô tả', campaignShareText(row.descriptionRichText)],
    ...row.additionalInformation.map(item => [item.label, item.value]),
  ];
  return entries.flatMap(([label, value]) => label && value ? [{ label, value }] : []);
}

@Injectable()
export class CampaignSharingApplicationService {
  constructor(
    @Inject(CampaignSharingRepository) private readonly repository: CampaignSharingRepository,
    @Inject(PublicGuestRepository) private readonly campaigns: PublicGuestRepository,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService,
    @Inject(CampaignWorkflowApplicationService) private readonly workflow: CampaignWorkflowApplicationService,
    @Inject(MaterialSharingApplicationService) private readonly materials: MaterialSharingApplicationService,
  ) {}

  private async editable(id: string) {
    const resource = await this.access.campaign(id);
    if (!this.access.canManageCampaignLink(resource)) {
      throw new ForbiddenException('Chỉ người tạo chiến dịch hoặc quản trị viên hệ thống được quản lý chia sẻ.');
    }
    const subject = await this.repository.subject(id);
    if (!subject) throw unavailable();
    return subject.settings;
  }

  @AccessBoundary()
  settings(id: string) { return this.editable(id); }

  @AccessBoundary(2)
  async change(id: string, input: unknown, actor: ActorContext) {
    const before = await this.editable(id);
    const parsed = command.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Cấu hình chia sẻ không hợp lệ.');
    const value = parsed.data;
    if (before.version !== value.version) throw new ConflictException('Quyền chia sẻ đã thay đổi. Hãy mở lại bảng chia sẻ để cập nhật.');
    const after: CampaignShareSettings = { ...value, version: before.version + 1 };
    await this.repository.save(id, before, after, actor);
    return after;
  }

  @AccessBoundary(1)
  async signedIn(id: string, actor: ActorContext) {
    const subject = await this.repository.subject(id);
    if (!subject) throw unavailable();
    const identity = this.access.snapshot().identity;
    const ownerOrAdmin = identity.effectiveActorId === subject.ownerId || (identity.mode === 'DIRECT' && identity.effectiveSuperadmin);
    let restricted = false;
    let drive = false;
    try {
      const resource = await this.access.campaign(id);
      restricted = ownerOrAdmin;
      if (!restricted && this.access.check('campaign.approve', resource).allowed) {
        const workflow = await this.workflow.read(actor, id);
        restricted = workflow.tasks.some(task => task.eligibility.allowed || task.assigneeActorId === actor.id || task.decision?.actorId === actor.id)
          || Boolean(workflow.capabilities.reviewChanges)
          || workflow.assignments.some(item => !item.endsAt && item.actorId === actor.id && ['DEPARTMENT_LEADER', 'DIVISION_LEADER'].includes(item.functionalRole));
      }
      drive = this.access.check('campaign.drive.read', resource).allowed;
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const audience = campaignShareAudience(subject.settings.mode, restricted, Boolean(actor.session));
    if (!audience) throw unavailable();
    return this.view(id, subject.settings, audience, drive);
  }

  async publicView(id: string) {
    const subject = await this.repository.subject(id);
    if (!subject || subject.settings.mode !== 'PUBLIC') throw unavailable();
    const view = await this.view(id, subject.settings, 'PUBLIC', false);
    // Recheck after reading content in case the link was revoked during the request.
    const latest = await this.repository.subject(id);
    if (latest?.settings.version !== subject.settings.version) throw unavailable();
    return view;
  }

  private async view(id: string, settings: CampaignShareSettings, audience: SharedCampaign['audience'], drive: boolean) {
    const row = await this.campaigns.campaign(id);
    if (!row || row.isDeleted) throw unavailable();
    const allowed = settings.tabs[audience];
    const response: SharedCampaign = { id, code: row.code, name: row.name, audience, tabs: allowed };
    if (allowed.includes('information')) response.information = information(row);
    if (allowed.includes('approval')) {
      const workflow = await this.campaigns.approval(id);
      const revision = workflow?.revisions.find(item => item.id === workflow.workflow?.currentRevisionId);
      response.approval = {
        status: row.approvalStatus ?? 'Chưa trình',
        tasks: revision?.steps.map(item => ({ kind: item.kind, state: item.state, completedAt: item.completedAt?.toISOString() ?? null })) ?? [],
        history: workflow?.revisions.map(item => ({ number: item.number, state: item.state, createdAt: item.createdAt.toISOString() })) ?? [],
      };
    }
    if (allowed.includes('documents')) {
      const rows = await this.repository.materials(id, row.code, row.name, audience === 'PUBLIC');
      const visible = audience === 'PUBLIC' ? rows : await this.materials.visible(rows);
      response.documents = {
        driveUrl: drive ? await this.repository.driveUrl(id) : null,
        materials: visible.map(publicMaterialProjection).map(item => ({ id: item.materialId, title: item.title, type: item.type, url: item.url })),
      };
    }
    if (allowed.includes('planning')) response.planning = await this.repository.planning(id);
    return response;
  }
}
