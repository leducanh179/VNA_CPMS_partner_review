import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ActorContext } from '@cpms/domain';
import type { AiCampaignProposal, AiPolicyView } from '@cpms/ai-contracts';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { ScopedCampaignApplicationService } from '../../campaign/application/scoped-campaign.application-service';
import { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';
import { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';
import { WorkspaceRepository, type ProposalRecord } from './workspace.repository';
import { policyOrDefault, workspacePolicySchema } from '../domain/workspace-policy';
import { parseLibraryIndex, searchLibrary } from '../domain/library-index';
import { agentProposalSchema, buildCampaignProposal, proposalField } from '../domain/campaign-proposal';
import { digest } from '../domain/lookup-policy';

const searchSchema = z.object({ query: z.string().trim().max(120), mediaType: z.enum(['PHOTO','VIDEO','FOLDER','ANY']) }).strict();
@Injectable()
export class AiWorkspaceApplicationService {
  constructor(@Inject(WorkspaceRepository) private readonly repository: WorkspaceRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment,true>,
    @Inject(ScopedCampaignApplicationService) private readonly campaigns: ScopedCampaignApplicationService,
    @Inject(CampaignWorkflowApplicationService) private readonly workflow: CampaignWorkflowApplicationService,
    @Inject(GoogleIntegrationApplicationService) private readonly google: GoogleIntegrationApplicationService) {}

  private direct() {
    const { identity, actor } = this.access.snapshot();
    if (!actor.session || actor.session.mustChangePassword || identity.mode !== 'DIRECT' || !identity.sessionValid ||
      !identity.originalActive || !identity.effectiveActive || !identity.profileComplete || identity.readOnlyDemo || identity.originalActorId !== actor.id || identity.effectiveActorId !== actor.id)
      throw new ForbiddenException('Cần đăng nhập trực tiếp để dùng tính năng AI.');
  }
  private admin() { this.direct(); this.access.require('system.manage'); if (!this.access.snapshot().identity.effectiveSuperadmin) throw new ForbiddenException('Cần quản trị viên trực tiếp.'); }
  private pilot(actor: ActorContext) { this.direct(); if (actor.id !== this.config.get('AI_PILOT_ACTOR_ID',{infer:true})) throw new ForbiddenException('Chưa được cấp quyền thử nghiệm AI.'); }
  async activePolicy() { const state = await this.repository.state(); return { version: state.version, policy: policyOrDefault(state.published) }; }
  async settings(actor: ActorContext): Promise<AiPolicyView> {
    return this.access.run(actor, async () => {
      this.admin(); const state = await this.repository.state();
      return { version: state.version, draftVersion: state.draftVersion, published: policyOrDefault(state.published), draft: policyOrDefault(state.draft),
        versions: (await this.repository.versions()).map(v => ({ ...v, createdAt: v.createdAt.toISOString() })),
        library: { version: state.libraryVersion, syncedAt: state.librarySyncedAt?.toISOString() ?? null, spreadsheetId: state.librarySpreadsheetId, count: (await this.repository.library()).length } };
    });
  }
  async saveDraft(actor: ActorContext, raw: unknown) {
    const input = z.object({ expectedVersion: z.number().int().nonnegative(), policy: workspacePolicySchema }).strict().safeParse(raw);
    if (!input.success) throw new BadRequestException('Cấu hình không hợp lệ. Tối đa 2 câu hỏi, 5 kết quả; đọc ảnh nâng cao chưa được bật.');
    return this.access.run(actor, async () => { this.admin(); await this.repository.saveDraft(input.data.policy,input.data.expectedVersion,actor); return this.settings(actor); });
  }
  async publish(actor: ActorContext, raw: unknown) {
    const input = z.object({ expectedVersion: z.number().int().nonnegative(), rollbackVersion: z.number().int().positive().optional() }).strict().safeParse(raw);
    if (!input.success) throw new BadRequestException('Thiếu phiên bản cấu hình.');
    return this.access.run(actor, async () => {
      this.admin(); const state = await this.repository.state();
      workspacePolicySchema.parse(input.data.rollbackVersion ? await this.repository.version(input.data.rollbackVersion) : state.draft);
      await this.repository.publish(input.data.expectedVersion,actor,input.data.rollbackVersion); return this.settings(actor);
    });
  }
  async sync(actor: ActorContext) {
    const active = await this.access.run(actor, async () => { this.admin(); return this.activePolicy(); });
    if (!active.policy.libraryEnabled || !active.version) throw new BadRequestException('Cần phát hành cấu hình nguồn thư viện trước.');
    const sheet = await this.google.readAiLibrary(actor,active.policy.spreadsheetId);
    const rows = parseLibraryIndex(sheet,active.policy.spreadsheetId);
    return this.access.run(actor, async () => { this.admin(); await this.repository.replaceLibrary(rows,active.policy.spreadsheetId,active.version,actor); return this.settings(actor); });
  }
  async testLibrary(actor: ActorContext, raw: unknown) {
    const parsed = searchSchema.safeParse(raw); if (!parsed.success) throw new BadRequestException('Từ khóa không hợp lệ.');
    return this.access.run(actor, async () => {
      this.admin(); const state = await this.repository.state(), policy = policyOrDefault(state.draft);
      if (state.librarySpreadsheetId !== policy.spreadsheetId) throw new BadRequestException('Chỉ mục hiện tại không thuộc nguồn của bản nháp. Phát hành và đồng bộ nguồn mới để thử.');
      return { items: searchLibrary(await this.repository.library(),parsed.data.query,parsed.data.mediaType,policy),
        instructionsPreview: policy.instructions, selectionRules: policy.selectionRules,
        note: 'Thử bộ lọc trên chỉ mục hiện có; không gọi mô hình AI và không tính phí. Hướng dẫn văn bản được áp dụng khi chat sau phát hành.' };
    });
  }
  async search(actor: ActorContext, raw: unknown) {
    const parsed = searchSchema.safeParse(raw); if (!parsed.success) throw new BadRequestException('Từ khóa thư viện không hợp lệ.');
    return this.access.run(actor, async () => {
      this.pilot(actor); const state = await this.repository.state(), policy = policyOrDefault(state.published);
      if (!policy.libraryEnabled || policy.spreadsheetId !== state.librarySpreadsheetId || !state.librarySyncedAt) throw new BadRequestException('Thư viện chưa được bật/đồng bộ với nguồn hiện hành.');
      const items = searchLibrary(await this.repository.library(),parsed.data.query,parsed.data.mediaType,policy);
      return { content: { items, indexedAt: state.librarySyncedAt.toISOString(), source: 'DriveIndex', contentRead: false, policyVersion: state.version, libraryVersion: state.libraryVersion,
        note: 'Chỉ mục có thể cũ hơn file thực tế. ACTIVE không phải giấy phép sử dụng. Google Drive quản lý quyền mở link.' },
        sources: items.map(item => ({ kind: 'LIBRARY' as const, id: item.id, title: item.name, href: item.href, version: state.libraryVersion })), requirements: [] };
    });
  }
  private async checkProposalAccess(row: ProposalRecord) {
    const resource = await this.access.campaign(row.campaignId);
    for (const change of row.changes) this.access.require('campaign.read',resource,proposalField(change.field).accessKey);
  }
  private async submission(actor: ActorContext, id: string, level?: string | null) {
    try { const route = await this.workflow.previewAiSubmission(actor,id,level); return { allowed: true, label: route.label, fingerprint: digest(route) }; }
    catch (error) { return { allowed: false, label: error instanceof Error ? error.message : 'Chưa đủ điều kiện gửi duyệt.', fingerprint: '' }; }
  }
  private async view(actor: ActorContext, row: ProposalRecord): Promise<AiCampaignProposal> {
    await this.checkProposalAccess(row); const current = await this.campaigns.get(row.campaignId);
    const level = row.changes.find(c => c.field === 'levelCode')?.after;
    const route = row.state === 'PREPARED' ? await this.submission(actor,row.campaignId,level) : { allowed: false, label: String(row.result.message ?? '') };
    return { id: row.id, campaignId: row.campaignId, title: current.name, expectedVersion: row.expectedVersion, changes: row.changes, reason: row.reason,
      state: row.state as AiCampaignProposal['state'], createdAt: row.createdAt.toISOString(), canSubmit: route.allowed, submission: route.label, result: row.state === 'PREPARED' ? null : row.result };
  }
  async prepare(actor: ActorContext, runId: string, raw: unknown) {
    const parsed = agentProposalSchema.safeParse(raw); if (!parsed.success) throw new BadRequestException('Đề xuất trường dữ liệu không hợp lệ.');
    return this.access.run(actor, async () => {
      this.pilot(actor); const active = await this.activePolicy(); if (!active.policy.agentEnabled) throw new ForbiddenException('Nhập liệu AI đang tắt.');
      const current = await this.campaigns.get(parsed.data.id), resource = await this.access.campaign(current.id);
      const built = buildCampaignProposal(current,parsed.data.changes);
      for (const change of built.changes) this.access.require('campaign.read',resource,proposalField(change.field).accessKey);
      const prepared = await this.campaigns.prepareChangeProposal(current.id,built.patch);
      await this.workflow.requireEditable(current.id,true);
      const route = await this.submission(actor,current.id,prepared.command.levelCode);
      const row = await this.repository.createProposal({ id: randomUUID(), runId, actorId: actor.id, campaignId: current.id, expectedVersion: current.recordVersion,
        changes: built.changes, reason: parsed.data.reason, state: 'PREPARED', result: { routeFingerprint: route.fingerprint, policyVersion: active.version } },actor);
      return this.view(actor,row);
    });
  }
  async proposal(actor: ActorContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    return this.access.run(actor, async () => {
      this.pilot(actor); const row = await this.repository.proposal(id,actor.id);
      if (!row || row.state === 'SUPERSEDED') throw new NotFoundException('Đề xuất đã được thay thế. Hãy mở lại hội thoại để xem bản mới.'); return this.view(actor,row);
    });
  }
  async revise(actor: ActorContext, id: string, raw: unknown) {
    return this.access.run(actor, async () => {
      this.pilot(actor); const row = await this.repository.proposal(id,actor.id);
      if (!row || row.state !== 'PREPARED') throw new NotFoundException('Đề xuất không còn ở trạng thái sửa.');
      await this.checkProposalAccess(row);
      const input = agentProposalSchema.safeParse({ id: row.campaignId, reason: row.reason, changes: raw });
      if (!input.success) throw new BadRequestException('Các trường đề xuất không hợp lệ.');
      const current = await this.campaigns.get(row.campaignId);
      if (current.recordVersion !== row.expectedVersion) throw new ConflictException('Hồ sơ đã đổi. Hãy yêu cầu AI tạo lại đề xuất.');
      // Produce a new immutable proposal. The old card can never confirm a silently modified payload.
      const next = await this.prepare(actor,row.runId,input.data);
      await this.repository.replaceProposal(row,next.id,actor);
      return next;
    });
  }
  async confirm(actor: ActorContext, id: string, raw: unknown) {
    const parsed = z.object({ action: z.enum(['SAVE','SAVE_AND_SUBMIT']), confirmed: z.literal(true) }).strict().safeParse(raw);
    if (!parsed.success || !z.uuid().safeParse(id).success) throw new BadRequestException('Cần xác nhận bản đề xuất và thao tác cụ thể.');
    // Record, workflow, receipt and audit commit together; a submit failure rolls the save back.
    return this.access.run(actor, async () => {
      this.pilot(actor); const active = await this.activePolicy();
      if (!active.policy.agentEnabled || this.config.get('AI_MODE',{infer:true}) === 'OFF') throw new ForbiddenException('Nhập liệu AI đang tắt.');
      const row = await this.repository.proposal(id,actor.id); if (!row) throw new NotFoundException('Không tìm thấy đề xuất.');
      await this.checkProposalAccess(row);
      if (row.state === 'SUPERSEDED') throw new ConflictException('Đề xuất đã được thay thế; không thể xác nhận bản cũ.');
      if (row.state !== 'PREPARED') {
        if (row.result.action !== parsed.data.action) throw new ConflictException('Đề xuất đã được thực hiện bằng thao tác khác. Hãy tạo đề xuất mới.');
        return this.view(actor,row);
      }
      if (row.createdAt.valueOf() < Date.now()-86_400_000 || row.result.policyVersion !== active.version) throw new ConflictException('Đề xuất đã hết hạn hoặc cấu hình đã đổi. Hãy tạo lại.');
      const current = await this.campaigns.get(row.campaignId);
      if (current.recordVersion !== row.expectedVersion) throw new ConflictException('Hồ sơ đã thay đổi. Chưa lưu gì; hãy yêu cầu AI tạo lại đề xuất.');
      const built = buildCampaignProposal(current,row.changes.map(c => ({ field: c.field, value: c.after })));
      const prepared = await this.campaigns.prepareChangeProposal(row.campaignId,built.patch);
      const route = await this.submission(actor,row.campaignId,prepared.command.levelCode);
      if (parsed.data.action === 'SAVE_AND_SUBMIT' && (!route.allowed || route.fingerprint !== row.result.routeFingerprint)) throw new ConflictException('Tuyến duyệt đã đổi hoặc chưa đủ điều kiện. Chưa lưu gì; hãy tạo lại đề xuất.');
      const updated = await this.campaigns.update(row.campaignId,built.patch,actor,'API');
      let workflowResult: unknown = null;
      if (parsed.data.action === 'SAVE_AND_SUBMIT') {
        const wf = await this.workflow.read(actor,row.campaignId);
        workflowResult = await this.workflow.command(actor,row.campaignId,{ operation: 'SUBMIT', idempotencyKey: row.id, expectedVersion: wf.version,
          expectedSubjectRevision: wf.campaign.businessRevision, receivingDivisionId: null, reason: row.reason });
      }
      const state = parsed.data.action === 'SAVE_AND_SUBMIT' ? 'SUBMITTED' : 'SAVED';
      const result = { action: parsed.data.action, recordVersion: updated.recordVersion, workflowResult, message: state === 'SAVED' ? 'Đã lưu thay đổi vào hồ sơ.' : `Đã lưu và gửi theo quy trình. ${route.label}` };
      await this.repository.finishProposal(row.id,state,result,actor);
      return this.view(actor,{ ...row, state, result });
    });
  }
}
