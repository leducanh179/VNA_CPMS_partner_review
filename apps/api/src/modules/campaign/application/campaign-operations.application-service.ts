import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { requiresCampaignApproval, type ActorContext, type CreateCampaignCommand, type UpdateCampaignCommand } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';
import { CampaignOperationsRepository } from './campaign-operations.repository';
import { ScopedCampaignApplicationService } from './scoped-campaign.application-service';

const uuid = z.string().uuid();
const reason = z.string().trim().min(1).max(1000);
const optionalReason = z.string().trim().max(1000).default('');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value; });
const planSchema = z.object({ title: z.string().trim().min(1).max(240), objective: z.string().trim().min(1).max(4000),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(500), startDate: day, endDate: day }).strict().refine((task) => task.endDate >= task.startDate)).min(1).max(50) }).strict();
const base = { expectedVersion: z.number().int().positive(), expectedSubjectRevision: z.number().int().positive(), idempotencyKey: uuid };
const schema = z.discriminatedUnion('operation', [
  z.object({ ...base, operation: z.enum(['REQUEST_PAUSE','REQUEST_CANCEL','REQUEST_RESUME','REQUEST_RESTORE','REQUEST_PURGE']), reason: optionalReason }).strict(),
  z.object({ ...base, operation: z.enum(['PAUSE','CANCEL']), reason }).strict(),
  z.object({ ...base, operation: z.literal('CREATE_PLAN'), plan: planSchema }).strict(),
  z.object({ ...base, operation: z.literal('DECIDE'), requestId: uuid, expectedRequestVersion: z.number().int().positive(), approve: z.boolean(), reason: optionalReason }).strict(),
  z.object({ ...base, operation: z.literal('WITHDRAW_REQUEST'), requestId: uuid, expectedRequestVersion: z.number().int().positive(), reason: optionalReason }).strict(),
]);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class CampaignOperationsApplicationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(ScopedCampaignApplicationService) private readonly campaigns: ScopedCampaignApplicationService,
    @Inject(CampaignWorkflowApplicationService) private readonly workflow: CampaignWorkflowApplicationService,
    @Inject(CampaignOperationsRepository) private readonly repository: CampaignOperationsRepository) {}

  private async context(actor: ActorContext, id: string) {
    if (!uuid.safeParse(id).success) throw new BadRequestException('Mã chiến dịch không hợp lệ.');
    const resource = await this.access.campaign(id); const campaign = await this.campaigns.get(id);
    const workflow = await this.workflow.read(actor, id); const operations = await this.repository.read(id);
    return { resource, campaign, workflow, operations };
  }
  private async requireRequester(actor: ActorContext, id: string, context: Awaited<ReturnType<CampaignOperationsApplicationService['context']>>, restoring = false) {
    this.access.require('campaign.submit', context.resource);
    if (context.resource.createdByActorId !== actor.id && context.workflow.revision?.submittedByActorId !== actor.id) throw new ForbiddenException('Chỉ người đề nghị chiến dịch được gửi yêu cầu thay đổi.');
    if (!['NO_APPROVAL','APPROVED'].includes(context.workflow.revision?.state ?? '') || (!restoring && context.operations?.operationalState === 'CANCELLED')) throw new ConflictException('Chiến dịch không ở trạng thái được gửi yêu cầu thay đổi.');
  }
  read(actor: ActorContext, id: string) {
    return this.access.run(actor, async () => {
      const context = await this.context(actor, id); const { resource, workflow, operations } = context;
      const active = workflow.assignments.filter((a) => !a.endsAt);
      const lead = active.find((a) => a.functionalRole === 'DIVISION_LEADER' && a.responsibility === 'LEAD');
      let canDecide = false; let canPlan = false;
      if (['APPROVED','NO_APPROVAL'].includes(workflow.revision?.state ?? '')) {
        const identity = this.access.snapshot().identity;
        if (lead?.actorId === actor.id || !lead || (identity.mode === 'DIRECT' && identity.effectiveSuperadmin)) { try { await this.workflow.requireLeadDivisionLeader(actor, id); canDecide = true; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; } }
        if (active.some((a) => a.actorId === actor.id && a.functionalRole === 'CAMPAIGN_MANAGER' && a.responsibility === 'LEAD' && a.orgId === lead?.orgId)) { try { await this.workflow.requireLeadCampaignManager(actor, id); canPlan = operations?.operationalState === 'ACTIVE'; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; } }
      }
      const isRequester = ['NO_APPROVAL','APPROVED'].includes(workflow.revision?.state ?? '') &&
        (resource.createdByActorId === actor.id || workflow.revision?.submittedByActorId === actor.id) && this.access.check('campaign.submit', resource).allowed;
      const canRequest = isRequester && operations?.operationalState !== 'CANCELLED';
      const requests = (operations?.requests ?? []).map((request) => ({ ...request,
        canWithdraw: request.state === 'PENDING' && ['EDIT','PAUSE','CANCEL'].includes(request.kind) && request.requestedByActorId === actor.id }));
      return { campaignId: id, version: workflow.version, subjectRevision: workflow.campaign.businessRevision, requests, plans: operations?.plans ?? [],
        operationalState: operations?.operationalState ?? 'ACTIVE', leadActorId: lead?.actorId ?? null,
        approvalRequired: Object.fromEntries(['EDIT','PAUSE','CANCEL','RESUME','RESTORE','PURGE'].map(action => [action, requiresCampaignApproval(workflow.policy, context.campaign.levelCode, action)])),
        capabilities: { requestChange: canRequest && !context.campaign.isDeleted, decide: canDecide, plan: canPlan && !context.campaign.isDeleted,
          resume: isRequester && !context.campaign.isDeleted && operations?.operationalState === 'PAUSED', restore: isRequester && !context.campaign.isDeleted && operations?.operationalState === 'CANCELLED',
          purge: Boolean(workflow.revision && ['APPROVED','NO_APPROVAL'].includes(workflow.revision.state) && this.access.check('campaign.purge', resource).allowed),
          purgeApproved: Boolean(operations?.requests.some(r => r.kind === 'PURGE' && r.state === 'APPROVED' && r.decidedByActorId !== r.requestedByActorId && r.campaignRecordVersion === context.campaign.recordVersion && r.subjectRevision === workflow.campaign.businessRevision)) },
        proposalAccess: canRequest ? this.access.capabilities({ ...resource, workflowEditLocked: false }) : null };
    });
  }
  createAndSubmit(actor: ActorContext, command: CreateCampaignCommand, key: string) {
    return this.access.run(actor, async () => {
      const id = await this.workflow.createAndSubmitOnce(actor, key, command, () => this.campaigns.create(command, actor));
      return this.campaigns.get(id);
    });
  }
  requestEdit(actor: ActorContext, id: string, command: UpdateCampaignCommand, note: string, key: string) {
    return this.access.run(actor, async () => {
      if (!uuid.safeParse(key).success || !optionalReason.safeParse(note).success) throw new BadRequestException('Mã yêu cầu hoặc nội dung lý do không hợp lệ.');
      const context = await this.context(actor, id); await this.requireRequester(actor, id, context);
      if (context.campaign.isDeleted) throw new ConflictException('Không sửa Chiến dịch trong Thùng rác.');
      const mode = requiresCampaignApproval(context.workflow.policy, context.campaign.levelCode, 'EDIT') ? 'HARD' : 'NONE';
      if (mode === 'HARD' && !reason.safeParse(note).success) throw new BadRequestException('Cần nhập lý do sửa đổi trước khi gửi phê duyệt.');
      const requestReason = note.trim() || 'Sửa trực tiếp theo chính sách không cần phê duyệt.';
      const payloadHash = hash({ id, command, note, originalActorId: actor.session?.originalActorId ?? actor.id });
      const cached = await this.repository.receipt(actor.id, key);
      if (cached) { if (cached.payloadHash !== payloadHash) throw new ConflictException('Mã yêu cầu đã được dùng cho nội dung khác.'); return cached; }
      const prepared = await this.campaigns.prepareChangeProposal(id, command);
      if (context.operations!.requests.some((r) => r.kind === 'EDIT' && r.state === 'PENDING')) throw new ConflictException('Đã có đề nghị sửa đổi đang chờ duyệt.');
      let requestContext = context;
      if (mode === 'NONE') {
        await this.campaigns.applyPolicyManagedChange(id, prepared.command, actor);
        await this.workflow.afterContentChanged(id);
        requestContext = await this.context(actor, id);
      }
      const request = await this.repository.createRequest({ workflowId: requestContext.operations!.workflowId, kind: 'EDIT', subjectRevision: requestContext.workflow.campaign.businessRevision,
        campaignRecordVersion: requestContext.campaign.recordVersion, payload: prepared.command, beforeSnapshot: prepared.before, reason: requestReason,
        requestedByActorId: actor.id, idempotencyKey: key, payloadHash });
      if (mode === 'NONE') await this.repository.decide(request.id, actor.id, true, 'Áp dụng trực tiếp theo chính sách không cần phê duyệt.');
      await this.repository.touch(requestContext.operations!.workflowId);
      await this.repository.audit(actor, id, 'workflow.request_edit', { requestId: request.id, reason: request.reason, changedFields: Object.keys(prepared.patch) });
      return request;
    });
  }
  command(actor: ActorContext, id: string, raw: unknown) {
    return this.access.run(actor, async () => {
      const parsed = schema.safeParse(raw); if (!parsed.success) throw new BadRequestException('Thao tác thiếu thông tin hoặc có trường không hợp lệ.');
      const input = parsed.data; const context = await this.context(actor, id); const { workflow, campaign, operations } = context;
      // A successful direct command may have changed the state (e.g. CANCEL); retry its receipt before source-state validation.
      if (input.operation.startsWith('REQUEST_')) {
        const receipt = await this.repository.receipt(actor.id, input.idempotencyKey);
        if (receipt) {
          this.access.require(input.operation === 'REQUEST_PURGE' ? 'campaign.purge' : 'campaign.submit', context.resource);
          if (receipt.payloadHash !== hash({ id, input, originalActorId: actor.session?.originalActorId ?? actor.id })) throw new ConflictException('Mã yêu cầu đã được sử dụng.');
          return receipt;
        }
      }
      const noApproval = workflow.revision?.state === 'NO_APPROVAL';
      if (campaign.isDeleted && !['REQUEST_RESTORE','REQUEST_PURGE'].includes(input.operation) && !(input.operation === 'DECIDE' && operations?.requests.some(r => r.id === input.requestId && ['RESTORE','PURGE'].includes(r.kind)))) throw new ConflictException('Chiến dịch đang ở Thùng rác; chỉ được xử lý yêu cầu Khôi phục hoặc Xóa vĩnh viễn.');
      if (!operations || (workflow.revision?.state !== 'APPROVED' && !noApproval)) throw new ConflictException('Chiến dịch chưa hoàn tất phê duyệt.');
      if (input.operation === 'WITHDRAW_REQUEST') {
        const request = operations.requests.find((candidate) => candidate.id === input.requestId);
        if (!request || !['EDIT','PAUSE','CANCEL'].includes(request.kind)) throw new ConflictException('Không có yêu cầu được phép lấy lại trong chiến dịch này.');
        const withdrawalReason = input.reason || 'Người gửi đã lấy lại yêu cầu.';
        if (request.state !== 'PENDING') {
          if (request.state === 'SUPERSEDED' && request.decidedByActorId === actor.id && request.decisionReason === withdrawalReason && request.recordVersion === input.expectedRequestVersion + 1) return { requestId: request.id, state: request.state };
          throw new ConflictException('Yêu cầu đã được xử lý.');
        }
        await this.requireRequester(actor, id, context, request.kind === 'CANCEL' || request.kind === 'RESTORE');
        if (request.requestedByActorId !== actor.id) throw new ForbiddenException('Chỉ người gửi yêu cầu được lấy lại yêu cầu này.');
        if (workflow.version !== input.expectedVersion || workflow.campaign.businessRevision !== input.expectedSubjectRevision || request.recordVersion !== input.expectedRequestVersion) throw new ConflictException('Chiến dịch hoặc yêu cầu đã thay đổi. Hãy tải lại.');
        await this.repository.withdraw(request.id, actor.id, withdrawalReason);
        await this.repository.touch(operations.workflowId);
        await this.repository.audit(actor, id, 'workflow.withdraw_request', { requestId: request.id, kind: request.kind, reason: withdrawalReason, idempotencyKey: input.idempotencyKey });
        return { requestId: request.id, state: 'SUPERSEDED' };
      }
      if (input.operation === 'DECIDE') {
        await this.workflow.requireLeadDivisionLeader(actor, id);
        const request = operations.requests.find((r) => r.id === input.requestId);
        if (!request) throw new ConflictException('Không có đề nghị trong chiến dịch này.');
        if (request.state !== 'PENDING') {
          if (request.decidedByActorId === actor.id && request.state === (input.approve ? 'APPROVED' : 'REJECTED') && request.decisionReason === input.reason && request.recordVersion === input.expectedRequestVersion + 1) return { requestId: request.id, state: request.state };
          throw new ConflictException('Đề nghị đã được xử lý.');
        }
        if (operations.operationalState === 'CANCELLED' && !['RESTORE','PURGE'].includes(request.kind)) throw new ConflictException('Chiến dịch đã hủy bỏ.');
        if (workflow.version !== input.expectedVersion || workflow.campaign.businessRevision !== input.expectedSubjectRevision || request.recordVersion !== input.expectedRequestVersion) throw new ConflictException('Chiến dịch hoặc đề nghị đã thay đổi. Hãy tải lại.');
        if (input.approve) {
          if (workflow.campaign.businessRevision !== request.subjectRevision || campaign.recordVersion !== request.campaignRecordVersion) throw new ConflictException('Nội dung đã thay đổi từ khi gửi đề nghị.');
          if (!await this.repository.actorActive(request.requestedByActorId)) throw new ForbiddenException('Người gửi đề nghị không còn hoạt động.');
          if (request.kind === 'RESUME' || request.kind === 'RESTORE') {
            const requiredState = request.kind === 'RESUME' ? 'PAUSED' : 'CANCELLED';
            if (operations.operationalState !== requiredState) throw new ConflictException('Trạng thái chiến dịch đã thay đổi từ khi gửi đề nghị.');
            if (request.kind === 'RESUME') await this.repository.setOperationalState(operations.workflowId, 'ACTIVE');
            else {
              await this.campaigns.applyReviewedRestoration(id, actor);
              await this.repository.setOperationalState(operations.workflowId, 'ACTIVE');
            }
          }
          if (request.kind === 'EDIT') await this.campaigns.applyReviewedChange(id, request.payload as UpdateCampaignCommand, actor, input.reason || request.reason, request.requestedByActorId);
          if (request.kind === 'PAUSE') await this.repository.setOperationalState(operations.workflowId, 'PAUSED');
          if (request.kind === 'CANCEL') {
            await this.workflow.closeCancelledWork(actor, id, input.reason || request.reason);
            await this.campaigns.applyReviewedCancellation(id, actor);
          }
          if (request.kind === 'PLAN') {
            const plan = operations.plans.find((p) => p.id === (request.payload as { planId?: string }).planId);
            if (!plan || plan.id !== operations.plans[0]?.id || plan.subjectRevision !== workflow.campaign.businessRevision || operations.operationalState !== 'ACTIVE') throw new ConflictException('Kế hoạch không còn ở phiên bản được phép phê duyệt.');
            const leadDivision = workflow.assignments.find((assignment) => !assignment.endsAt && assignment.functionalRole === 'DIVISION_LEADER' && assignment.responsibility === 'LEAD');
            if (!workflow.assignments.some((assignment) => !assignment.endsAt && assignment.actorId === plan.createdByActorId && assignment.functionalRole === 'CAMPAIGN_MANAGER' && assignment.responsibility === 'LEAD' && assignment.orgId === leadDivision?.orgId)) throw new ConflictException('Campaign Manager chủ trì đã thay đổi. Cần lập kế hoạch mới.');
          }
        }
        await this.repository.decide(request.id, actor.id, input.approve, input.reason);
        if (input.approve && ['EDIT','CANCEL'].includes(request.kind)) {
          const supersededIds = await this.repository.supersedePending(operations.workflowId, request.id, actor.id, request.kind === 'EDIT' ? 'Nội dung chiến dịch đã được thay thế.' : 'Chiến dịch đã hủy bỏ.');
          if (supersededIds.length) await this.repository.audit(actor, id, 'workflow.supersede_requests', { requestIds: supersededIds, causeRequestId: request.id });
        }
        await this.repository.touch(operations.workflowId);
        await this.repository.audit(actor, id, input.approve ? 'workflow.approve_request' : 'workflow.reject_request', { requestId: request.id, kind: request.kind, reason: input.reason });
        return { requestId: request.id, state: input.approve ? 'APPROVED' : 'REJECTED' };
      }
      if (input.operation === 'REQUEST_PURGE') this.access.require('campaign.purge', context.resource);
      else if (input.operation.startsWith('REQUEST_')) await this.requireRequester(actor, id, context, input.operation === 'REQUEST_RESTORE');
      else if (input.operation === 'CREATE_PLAN') await this.workflow.requireLeadCampaignManager(actor, id);
      else await this.workflow.requireLeadDivisionLeader(actor, id);
      const payloadHash = hash({ id, input, originalActorId: actor.session?.originalActorId ?? actor.id });
      const cached = await this.repository.receipt(actor.id, input.idempotencyKey);
      if (cached) { if (cached.payloadHash !== payloadHash) throw new ConflictException('Mã yêu cầu đã được sử dụng.'); return cached; }
      if (operations.operationalState === 'CANCELLED' && !['REQUEST_RESTORE','REQUEST_PURGE'].includes(input.operation)) throw new ConflictException('Chiến dịch đã hủy bỏ.');
      if (workflow.version !== input.expectedVersion || workflow.campaign.businessRevision !== input.expectedSubjectRevision) throw new ConflictException('Chiến dịch đã thay đổi. Hãy tải lại.');
      const kind = input.operation === 'CREATE_PLAN' ? 'PLAN' : input.operation.replace('REQUEST_', '');
      if (operations.requests.some((r) => r.kind === kind && r.state === 'PENDING')) throw new ConflictException('Đã có đề nghị cùng loại đang chờ duyệt.');
      if ((kind === 'RESUME' && operations.operationalState !== 'PAUSED') || (kind === 'RESTORE' && operations.operationalState !== 'CANCELLED')) throw new ConflictException('Trạng thái chiến dịch không phù hợp với đề nghị.');
      if ((kind === 'PAUSE' || kind === 'PLAN') && operations.operationalState !== 'ACTIVE') throw new ConflictException('Chiến dịch không ở trạng thái đang hoạt động.');
      let payload: unknown = {};
      if (input.operation === 'CREATE_PLAN') {
        if (await this.repository.hasQcttPlan(id)) throw new ConflictException('Chiến dịch đã dùng Kế hoạch QCTT. Mở tab Kế hoạch để cập nhật các hoạt động.');
        const plan = await this.repository.createPlan({ workflowId: operations.workflowId, number: (operations.plans[0]?.number ?? 0) + 1,
          subjectRevision: workflow.campaign.businessRevision, ...input.plan, createdByActorId: actor.id });
        payload = { planId: plan.id };
      }
      const requestReason = input.operation === 'CREATE_PLAN' ? 'Trình phê duyệt kế hoạch' : input.reason || ({ PAUSE: 'Đề nghị tạm dừng chiến dịch.', CANCEL: 'Đề nghị xóa chiến dịch.', RESUME: 'Đề nghị nối lại chiến dịch.', RESTORE: 'Đề nghị khôi phục chiến dịch.' } as Record<string, string>)[kind] || 'Đề nghị thay đổi chiến dịch.';
      const reviewMode = requiresCampaignApproval(workflow.policy, campaign.levelCode, kind) ? 'HARD' : 'NONE';
      const appliesImmediately = reviewMode === 'NONE';
      if (appliesImmediately && input.operation !== 'CREATE_PLAN') {
        if (kind === 'PAUSE') await this.repository.setOperationalState(operations.workflowId, 'PAUSED');
        if (kind === 'CANCEL') await this.campaigns.applyPolicyCancellation(id, actor);
        if (kind === 'RESUME') await this.repository.setOperationalState(operations.workflowId, 'ACTIVE');
        if (kind === 'RESTORE') {
          await this.campaigns.applyPolicyRestoration(id, actor);
          await this.repository.setOperationalState(operations.workflowId, 'ACTIVE');
        }
      }
      const request = await this.repository.createRequest({ workflowId: operations.workflowId, kind, subjectRevision: workflow.campaign.businessRevision,
        campaignRecordVersion: campaign.recordVersion, payload, beforeSnapshot: { operationalState: operations.operationalState, policyVersionId: workflow.policy?.id, approvalRequired: !appliesImmediately },
        reason: requestReason, requestedByActorId: actor.id, idempotencyKey: input.idempotencyKey, payloadHash });
      if (appliesImmediately && input.operation !== 'CREATE_PLAN') {
        if (reviewMode === 'NONE') await this.repository.decide(request.id, actor.id, true, 'Áp dụng trực tiếp theo chính sách không cần phê duyệt.');
        await this.repository.audit(actor, id, `workflow.${input.operation.toLowerCase()}`, { requestId: request.id, kind, reason: requestReason, reviewMode });
        await this.repository.touch(operations.workflowId);
        return await this.repository.receipt(actor.id, input.idempotencyKey);
      }
      if (input.operation === 'PAUSE' || input.operation === 'CANCEL') {
        await this.repository.setOperationalState(operations.workflowId, input.operation === 'PAUSE' ? 'PAUSED' : 'CANCELLED');
        await this.repository.decide(request.id, actor.id, true, input.reason);
        if (input.operation === 'CANCEL') {
          await this.workflow.closeCancelledWork(actor, id, input.reason);
          const supersededIds = await this.repository.supersedePending(operations.workflowId, request.id, actor.id, 'Chiến dịch đã hủy bỏ.');
          if (supersededIds.length) await this.repository.audit(actor, id, 'workflow.supersede_requests', { requestIds: supersededIds, causeRequestId: request.id });
        }
      }
      await this.repository.touch(operations.workflowId);
      await this.repository.audit(actor, id, `workflow.${input.operation.toLowerCase()}`, { requestId: request.id, kind, reason: request.reason });
      return request;
    });
  }
}
