import type {
  ActorContext,
  CampaignAdditionalInformationItem,
  CampaignChangeSource,
  CampaignFieldValues,
  CampaignLevelCode,
  CampaignLifecycleState,
  CampaignNormalizationWarning,
  CampaignObjectiveCode,
  CampaignRichTextDocument,
  CampaignSummary,
} from '@cpms/domain';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CampaignCodeConflictError, CampaignVersionConflictError,
  type CampaignFields,
  type CampaignRepository,
  type PersistCampaignInput,
} from '../application/campaign.repository';

const campaignInclude = {
  level: true,
  requestingEmployee: { select: { fullName: true } },
  primaryObjective: true,
  markets: { include: { market: true }, orderBy: { market: { displayOrder: 'asc' } } },
  provinces: { include: { province: true }, orderBy: { province: { displayOrder: 'asc' } } },
  requestingUnits: { include: { organizationUnit: true }, orderBy: { displayOrder: 'asc' } },
  driveWorkspace: true,
  qcttPlan: { select: { initializedAt: true } },
  workflow: { select: { operationalState: true, currentRevision: { select: {
    state: true,
    subjectRevision: true,
    route: true,
    steps: { select: {
      kind: true,
      state: true,
      decision: { select: { kind: true, actorId: true, actor: { select: { displayName: true } } } },
    } },
  } },
    plans: { orderBy: { number: 'desc' }, take: 1, select: { id: true, subjectRevision: true } },
    changeRequests: { where: { state: { in: ['PENDING','APPROVED'] } }, select: { kind: true, state: true, subjectRevision: true, payload: true, beforeSnapshot: true } } } },
} satisfies Prisma.CampaignInclude;

type CampaignRecord = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

function toFieldValues(value: Prisma.JsonValue): CampaignFieldValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as CampaignFieldValues;
}

function toRichText(value: Prisma.JsonValue | null): CampaignRichTextDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as CampaignRichTextDocument;
}

function toAdditionalInformation(value: Prisma.JsonValue): CampaignAdditionalInformationItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, Prisma.JsonValue>;
    return typeof candidate.id === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.value === 'string'
      && typeof candidate.order === 'number'
      ? [{ id: candidate.id, label: candidate.label, value: candidate.value, order: candidate.order }]
      : [];
  });
}

function normalizationWarnings(campaign: CampaignRecord, fieldValues: CampaignFieldValues): CampaignNormalizationWarning[] {
  const warnings: CampaignNormalizationWarning[] = [];
  if (!campaign.levelCode) warnings.push({ code: 'MISSING_LEVEL', fieldKey: 'campaign_level_code', message: 'Chiến dịch cũ chưa được phân loại cấp.' });
  if (campaign.markets.length === 0 && typeof fieldValues.market === 'string' && fieldValues.market.trim()) {
    warnings.push({ code: 'LEGACY_MARKET', fieldKey: 'market', message: 'Thị trường cũ chưa được ánh xạ vào catalog.' });
  }
  if (campaign.requestingUnits.length === 0 && campaign.requestingUnit?.trim()) {
    warnings.push({ code: 'LEGACY_REQUESTING_UNIT', fieldKey: 'requesting_unit', message: 'Đơn vị yêu cầu cũ chưa được ánh xạ vào catalog.' });
  }
  if (!campaign.requestingEmployeeCode && !campaign.manualRequesterEmail && typeof fieldValues.requesting_person === 'string' && fieldValues.requesting_person.trim()) {
    warnings.push({ code: 'LEGACY_REQUESTER', fieldKey: 'requesting_person', message: 'Nhân sự yêu cầu cũ chưa được ánh xạ vào danh bạ.' });
  }
  if (campaign.normalizationStatus === 'NEEDS_NORMALIZATION' && warnings.length === 0) {
    warnings.push({ code: 'LEGACY_FIELD_VALUE', fieldKey: 'fieldValues', message: 'Bản ghi đang dùng schema legacy và cần được rà soát.' });
  }
  return warnings;
}

function approvalStatus(campaign: CampaignRecord) {
  const revision = campaign.workflow?.currentRevision;
  if (!revision) return 'Chưa trình';
  if (revision.route === 'NONE' || revision.state === 'NO_APPROVAL') return 'Không yêu cầu duyệt';
  if (['PENDING', 'NEEDS_ASSIGNEE', 'NEEDS_ROUTING'].includes(revision.state)) return 'Chờ duyệt';
  if (revision.state === 'APPROVED') return 'Đã duyệt';
  if (revision.state === 'RETURNED') return 'Trả lại để sửa';
  if (revision.state === 'REJECTED') return 'Từ chối';
  if (revision.state === 'SUPERSEDED') return 'Đã thay thế';
  if (revision.state === 'CANCELLED') return 'Đã hủy';
  return 'Chưa trình';
}

function approvalPeople(campaign: CampaignRecord, stepKind: string) {
  const people = campaign.workflow?.currentRevision?.steps
    .filter((step) => step.kind === stepKind && step.decision?.kind === 'APPROVED_BY_LEADER')
    .flatMap((step) => step.decision ? [{ actorId: step.decision.actorId, displayName: step.decision.actor.displayName }] : []) ?? [];
  return [...new Map(people.map((person) => [person.actorId, person])).values()];
}

function approvalStepStatus(campaign: CampaignRecord, stepKind: string) {
  const steps = campaign.workflow?.currentRevision?.steps.filter((step) => step.kind === stepKind) ?? [];
  if (!steps.length) return 'Không yêu cầu';
  if (steps.some((step) => step.decision?.kind === 'REJECTED')) return 'Từ chối';
  if (steps.some((step) => step.decision?.kind === 'RETURNED')) return 'Trả lại để sửa';
  if (steps.some((step) => step.state === 'PENDING')) return 'Chờ duyệt';
  if (steps.every((step) => ['COMPLETED', 'SKIPPED_BY_ADMIN'].includes(step.state))) return 'Đã duyệt';
  return 'Chưa trình';
}

function toSummary(campaign: CampaignRecord): CampaignSummary {
  const startDate = campaign.startDate?.toISOString().slice(0, 10) ?? null;
  const endDate = campaign.endDate?.toISOString().slice(0, 10) ?? null;
  const effectiveStartDate = campaign.effectiveStartDate?.toISOString().slice(0, 10) ?? null;
  const effectiveEndDate = campaign.effectiveEndDate?.toISOString().slice(0, 10) ?? null;
  const fieldValues = toFieldValues(campaign.fieldValues);
  const requestingUnit = campaign.requestingUnit ?? '';
  const workflow = campaign.workflow; const revision = workflow?.currentRevision;
  const plan = workflow?.plans[0];
  const currentPlan = plan?.subjectRevision === campaign.businessRevision ? plan : null;
  const approvedPlan = currentPlan && workflow?.changeRequests.some((r) => r.kind === 'PLAN' && r.state === 'APPROVED' && r.subjectRevision === campaign.businessRevision && (r.payload as { planId?: string })?.planId === currentPlan.id);
  const approvedRecovery = workflow?.changeRequests.some((r) => ['RESUME','RESTORE'].includes(r.kind) && r.state === 'APPROVED' && r.subjectRevision === campaign.businessRevision);
  const qcttStatus = campaign.deletedAt ? 'Trong Thùng rác' : !revision ? undefined : workflow?.operationalState === 'CANCELLED' ? 'Ngừng triển khai (dữ liệu cũ)' : workflow?.operationalState === 'PAUSED' ? 'Đã tạm dừng'
    : revision.state === 'REJECTED' ? 'Bị từ chối' : ['PENDING','NEEDS_ASSIGNEE'].includes(revision.state) ? 'Chờ phê duyệt'
    : revision.state === 'NO_APPROVAL' ? 'Đang triển khai' : revision.state === 'APPROVED' && revision.subjectRevision === campaign.businessRevision ? approvedPlan || approvedRecovery ? 'Đang triển khai' : currentPlan || campaign.qcttPlan?.initializedAt ? 'Đã lên kế hoạch' : 'Đã phê duyệt' : 'Nháp';
  const pendingLabels: Record<string, string> = { EDIT: 'Chờ duyệt sửa đổi', PAUSE: 'Chờ duyệt tạm dừng', CANCEL: 'Chờ duyệt xóa', PLAN: 'Chờ duyệt kế hoạch', RESUME: 'Chờ duyệt nối lại triển khai', RESTORE: 'Chờ duyệt khôi phục' };
  const pendingChangeLabel = workflow?.changeRequests.filter((request) => request.state === 'PENDING').map((request) => pendingLabels[request.kind]).filter(Boolean).join(' · ');
  const departmentApprovers = approvalPeople(campaign, 'DEPARTMENT_APPROVAL');
  const divisionApprovers = approvalPeople(campaign, 'DIVISION_ACCEPT_AND_ASSIGN');
  const currentApprovalStatus = approvalStatus(campaign);
  return {
    ...(qcttStatus ? { qcttStatus } : {}), ...(pendingChangeLabel ? { pendingChangeLabel } : {}),
    ...(workflow?.operationalState ? { operationalState: workflow.operationalState as 'ACTIVE' | 'PAUSED' | 'CANCELLED' } : {}),
    approvalStatus: currentApprovalStatus,
    departmentApprovers,
    divisionApprovers,
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    requestingUnit,
    lifecycleState: campaign.lifecycleState as CampaignLifecycleState,
    startDate,
    endDate,
    effectiveStartDate,
    effectiveEndDate,
    levelCode: campaign.levelCode as CampaignLevelCode | null,
    levelLabel: campaign.level?.label ?? null,
    levelRuleDescription: campaign.level?.ruleDescription ?? null,
    requestingEmployeeCode: campaign.requestingEmployeeCode,
    requestingEmployeeName: campaign.requestingEmployee?.fullName ?? null,
    manualRequesterEmail: campaign.manualRequesterEmail,
    primaryObjectiveCode: campaign.primaryObjectiveCode as CampaignObjectiveCode | null,
    primaryObjectiveLabel: campaign.primaryObjective?.label ?? null,
    primaryObjectiveOther: campaign.primaryObjectiveOther,
    kpiText: campaign.kpiText,
    descriptionRichText: toRichText(campaign.descriptionRichText),
    additionalInformation: toAdditionalInformation(campaign.additionalInformation),
    dataSchemaVersion: campaign.dataSchemaVersion,
    normalizationStatus: campaign.normalizationStatus,
    normalizationWarnings: normalizationWarnings(campaign, fieldValues),
    markets: campaign.markets.map((entry) => ({
      marketCode: entry.marketCode,
      marketName: entry.market.name,
      regionCode: entry.market.regionCode,
      selectionOrigin: entry.selectionOrigin,
      selectionCode: entry.selectionCode,
    })),
    provinces: campaign.provinces.map((entry) => ({ provinceCode: entry.provinceCode, provinceName: entry.province.name })),
    requestingUnits: campaign.requestingUnits.map((entry) => ({
      id: entry.id,
      unitCode: entry.organizationUnitCode,
      displayName: entry.organizationUnit?.displayName ?? entry.customName ?? '',
      customName: entry.customName,
      category: entry.organizationUnit?.category ?? 'CUSTOM',
      order: entry.displayOrder,
    })),
    fieldValues: {
      ...fieldValues,
      campaign_code: campaign.code,
      campaign_name: campaign.name,
      requesting_unit: requestingUnit || null,
      campaign_lifecycle_state: campaign.lifecycleState,
      campaign_level_code: campaign.levelCode,
      campaign_level_label: campaign.level?.label ?? null,
      campaign_comm_start_date: startDate,
      campaign_comm_end_date: endDate,
      campaign_effect_start_date: effectiveStartDate,
      campaign_effect_end_date: effectiveEndDate,
      campaign_effective_status: null,
      department_approval_state: approvalStepStatus(campaign, 'DEPARTMENT_APPROVAL'),
      department_approver_summary: departmentApprovers.map((person) => person.displayName).join('; ') || null,
      division_approval_state: approvalStepStatus(campaign, 'DIVISION_ACCEPT_AND_ASSIGN'),
      division_approver_summary: divisionApprovers.map((person) => person.displayName).join('; ') || null,
      campaign_objective: campaign.primaryObjective?.label ?? null,
      kpi_primary: campaign.kpiText,
      campaign_folder_id: campaign.driveWorkspace?.campaignFolderId ?? fieldValues.campaign_folder_id ?? null,
      campaign_folder_link: campaign.driveWorkspace?.campaignFolderLink ?? fieldValues.campaign_folder_link ?? null,
    },
    recordVersion: campaign.recordVersion,
    isDeleted: Boolean(campaign.deletedAt),
    deletedAt: campaign.deletedAt?.toISOString() ?? null,
    deletedByActorId: campaign.deletedByActorId,
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

@Injectable()
export class PrismaCampaignRepository implements CampaignRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(trash: boolean, visibleIds?: readonly string[]): Promise<CampaignSummary[]> {
    const campaigns = await this.prisma.database.campaign.findMany({
      where: { ...(trash ? { deletedAt: { not: null } } : { deletedAt: null }), ...(visibleIds ? { id: { in: [...visibleIds] } } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
      take: 500,
      include: campaignInclude,
    });
    return campaigns.map(toSummary);
  }

  async findById(id: string): Promise<CampaignSummary | null> {
    const campaign = await this.prisma.database.campaign.findUnique({ where: { id }, include: campaignInclude });
    return campaign ? toSummary(campaign) : null;
  }

  async findByCode(code: string): Promise<CampaignSummary | null> {
    const campaign = await this.prisma.database.campaign.findUnique({ where: { code }, include: campaignInclude });
    return campaign ? toSummary(campaign) : null;
  }

  async findSimilarCandidates(_query: string, excludeId?: string, visibleIds?: readonly string[]): Promise<CampaignSummary[]> {
    const campaigns = await this.prisma.database.campaign.findMany({
      where: {
        deletedAt: null,
        id: { ...(excludeId ? { not: excludeId } : {}), ...(visibleIds ? { in: [...visibleIds] } : {}) },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: campaignInclude,
    });
    return campaigns.map(toSummary);
  }

  async createWithAudit(input: PersistCampaignInput, actor: ActorContext): Promise<CampaignSummary> {
    const campaignId = randomUUID();
    const membership = await this.prisma.database.employmentMembership.findUnique({ where: { actorId: actor.id }, select: { departmentId: true, divisionId: true } });
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.database.campaign.create({
        data: {
          id: campaignId,
          code: input.code,
          name: input.name,
          requestingUnit: input.requestingUnit,
          lifecycleState: input.lifecycleState,
          startDate: input.startDate,
          endDate: input.endDate,
          effectiveStartDate: input.effectiveStartDate,
          effectiveEndDate: input.effectiveEndDate,
          levelCode: input.levelCode,
          requestingEmployeeCode: input.requestingEmployeeCode,
          manualRequesterEmail: input.manualRequesterEmail,
          primaryObjectiveCode: input.primaryObjectiveCode,
          primaryObjectiveOther: input.primaryObjectiveOther,
          kpiText: input.kpiText,
          descriptionRichText: input.descriptionRichText === null ? Prisma.JsonNull : input.descriptionRichText as unknown as Prisma.InputJsonValue,
          additionalInformation: input.additionalInformation as unknown as Prisma.InputJsonValue,
          dataSchemaVersion: input.dataSchemaVersion,
          normalizationStatus: input.normalizationStatus,
          fieldValues: input.fieldValues as Prisma.InputJsonValue,
          createdByActorId: actor.id,
          requestingDepartmentId: membership?.departmentId ?? null,
          requestingDivisionId: membership?.divisionId ?? null,
        },
      }),
      ...(input.markets?.length ? [this.prisma.database.campaignMarket.createMany({
        data: input.markets.map((market) => ({ campaignId, ...market })),
      })] : []),
      ...(input.provinces?.length ? [this.prisma.database.campaignProvince.createMany({
        data: input.provinces.map((provinceCode) => ({ campaignId, provinceCode })),
      })] : []),
      ...(input.requestingUnits?.length ? [this.prisma.database.campaignRequestingUnit.createMany({
        data: input.requestingUnits.map((unit) => ({ id: randomUUID(), campaignId, organizationUnitCode: unit.unitCode, customName: unit.customName, displayOrder: unit.displayOrder })),
      })] : []),
      this.prisma.database.auditEvent.create({
        data: {
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'campaign.created',
          entityType: 'campaign',
          entityId: campaignId,
          payload: { code: input.code, lifecycleState: input.lifecycleState, levelCode: input.levelCode, dataSchemaVersion: input.dataSchemaVersion, source: input.auditSource ?? 'API' },
        },
      }),
    ];
    await this.prisma.batchTransaction(operations);
    return this.prismaFindRequired(campaignId);
  }

  async regenerateCodeWithAudit(id: string, oldCode: string, nextCode: string, expectedVersion: number, actor: ActorContext): Promise<CampaignSummary> {
    try {
      await this.prisma.inTransaction(async (database) => {
        const current = await database.campaign.findUnique({ where: { id }, select: { code: true, recordVersion: true, fieldValues: true } });
        if (!current || current.code !== oldCode || current.recordVersion !== expectedVersion) throw new CampaignVersionConflictError();
        const workflow = await database.campaignWorkflow.findUnique({ where: { campaignId: id }, select: { id: true } });
        if (workflow && await database.campaignChangeRequest.count({ where: { workflowId: workflow.id, state: 'PENDING' } })) {
          throw new ConflictException('Chiến dịch đang có yêu cầu chờ duyệt. Hãy hoàn tất yêu cầu trước khi đổi mã.');
        }
        const workspace = await database.campaignDriveWorkspace.findUnique({ where: { campaignId: id }, select: { campaignFolderId: true } });
        if (workspace?.campaignFolderId) throw new ConflictException('Chiến dịch đã có thư mục Google Drive. Cần đồng bộ tên thư mục trước khi đổi mã.');
        const references = await database.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM material_records WHERE position(${oldCode} in data::text) > 0`;
        if (references[0]?.count) throw new ConflictException('Mã Chiến dịch đang được Tư liệu tham chiếu. Cần đối soát liên kết trước khi đổi mã.');
        await database.campaign.update({ where: { id, code: oldCode, recordVersion: expectedVersion }, data: {
          code: nextCode, fieldValues: { ...toFieldValues(current.fieldValues), campaign_code: nextCode } as Prisma.InputJsonValue,
          recordVersion: { increment: 1 },
        } });
        await database.auditEvent.create({ data: {
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'campaign.code_regenerated', entityType: 'campaign', entityId: id,
          payload: { oldCode, nextCode, expectedVersion, reason: 'Owner-requested Campaign code suffix normalization' },
        } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new CampaignCodeConflictError();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new CampaignVersionConflictError();
      throw error;
    }
    return this.prismaFindRequired(id);
  }

  async updateWithAudit(id: string, input: CampaignFields, actor: ActorContext): Promise<CampaignSummary> {
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.database.campaign.update({
        where: { id, ...(input.expectedVersion !== undefined ? { recordVersion: input.expectedVersion } : {}) },
        data: {
          name: input.name,
          requestingUnit: input.requestingUnit,
          lifecycleState: input.lifecycleState,
          startDate: input.startDate,
          endDate: input.endDate,
          effectiveStartDate: input.effectiveStartDate,
          effectiveEndDate: input.effectiveEndDate,
          levelCode: input.levelCode,
          requestingEmployeeCode: input.requestingEmployeeCode,
          manualRequesterEmail: input.manualRequesterEmail,
          primaryObjectiveCode: input.primaryObjectiveCode,
          primaryObjectiveOther: input.primaryObjectiveOther,
          kpiText: input.kpiText,
          descriptionRichText: input.descriptionRichText === null ? Prisma.JsonNull : input.descriptionRichText as unknown as Prisma.InputJsonValue,
          additionalInformation: input.additionalInformation as unknown as Prisma.InputJsonValue,
          dataSchemaVersion: input.dataSchemaVersion,
          normalizationStatus: input.normalizationStatus,
          fieldValues: input.fieldValues as Prisma.InputJsonValue,
          recordVersion: { increment: 1 },
          businessRevision: { increment: 1 },
        },
      }),
      ...(input.markets ? [
        this.prisma.database.campaignMarket.deleteMany({ where: { campaignId: id } }),
        ...(input.markets.length ? [this.prisma.database.campaignMarket.createMany({ data: input.markets.map((market) => ({ campaignId: id, ...market })) })] : []),
      ] : []),
      ...(input.provinces ? [
        this.prisma.database.campaignProvince.deleteMany({ where: { campaignId: id } }),
        ...(input.provinces.length ? [this.prisma.database.campaignProvince.createMany({ data: input.provinces.map((provinceCode) => ({ campaignId: id, provinceCode })) })] : []),
      ] : []),
      ...(input.requestingUnits ? [
        this.prisma.database.campaignRequestingUnit.deleteMany({ where: { campaignId: id } }),
        ...(input.requestingUnits.length ? [this.prisma.database.campaignRequestingUnit.createMany({
          data: input.requestingUnits.map((unit) => ({ id: randomUUID(), campaignId: id, organizationUnitCode: unit.unitCode, customName: unit.customName, displayOrder: unit.displayOrder })),
        })] : []),
      ] : []),
      this.prisma.database.auditEvent.create({
        data: {
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'campaign.updated',
          entityType: 'campaign',
          entityId: id,
          payload: { expectedVersion: input.expectedVersion ?? null, dataSchemaVersion: input.dataSchemaVersion, source: input.auditSource ?? 'API', changes: input.auditChanges ?? [] } as unknown as Prisma.InputJsonValue,
        },
      }),
    ];
    try {
      await this.prisma.batchTransaction(operations);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new CampaignVersionConflictError('Campaign version conflict.');
      }
      throw error;
    }
    return this.prismaFindRequired(id);
  }

  async moveToTrashWithAudit(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    await this.prisma.batchTransaction([
      this.prisma.database.campaign.update({ where: { id }, data: { deletedAt: new Date(), deletedByActorId: actor.id, recordVersion: { increment: 1 } } }),
      this.prisma.database.campaignWorkflow.updateMany({ where: { campaignId: id }, data: { operationalState: 'CANCELLED', recordVersion: { increment: 1 } } }),
      this.prisma.database.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'campaign.moved_to_trash', entityType: 'campaign', entityId: id, payload: { source } } }),
    ]);
    return this.prismaFindRequired(id);
  }

  async restoreWithAudit(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    await this.prisma.batchTransaction([
      this.prisma.database.campaign.update({ where: { id }, data: { deletedAt: null, deletedByActorId: null, recordVersion: { increment: 1 } } }),
      this.prisma.database.campaignWorkflow.updateMany({ where: { campaignId: id }, data: { operationalState: 'ACTIVE', recordVersion: { increment: 1 } } }),
      this.prisma.database.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'campaign.restored', entityType: 'campaign', entityId: id, payload: { source } } }),
    ]);
    return this.prismaFindRequired(id);
  }

  async deletePermanentlyWithAudit(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<{ id: string; code: string }> {
    const current = await this.prisma.database.campaign.findUniqueOrThrow({ where: { id } });
    await this.prisma.batchTransaction([
      this.prisma.database.campaign.delete({ where: { id } }),
      this.prisma.database.auditEvent.create({
        data: {
          actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
          action: 'campaign.deleted_permanently',
          entityType: 'campaign',
          entityId: id,
          payload: { code: current.code, name: current.name, deletedAt: current.deletedAt?.toISOString() ?? null, source },
        },
      }),
    ]);
    return { id, code: current.code };
  }

  private async prismaFindRequired(id: string) {
    const campaign = await this.prisma.database.campaign.findUniqueOrThrow({ where: { id }, include: campaignInclude });
    return toSummary(campaign);
  }
}
