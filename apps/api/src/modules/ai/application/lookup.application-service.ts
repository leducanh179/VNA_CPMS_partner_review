import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canonicalCampaignFieldKey, type ActorContext } from '@cpms/domain';
import type { AiArtifacts, AiLibraryResult, LookupContext, LookupContextPreview, LookupRecordKind, LookupToolName } from '@cpms/ai-contracts';
import type { LookupAnswer, LookupConversation, LookupConversationDetail, LookupConversations, LookupEvidence, LookupMessage, LookupMode, LookupSource, LookupStatus } from '@cpms/ai-contracts';
import { z } from 'zod';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { LookupRepository, type ConversationRecord, type LookupRun } from './lookup.repository';
import { LookupDataApplicationService } from './lookup-data.application-service';
import { addUsage, billingPeriod, costVnd, digest, EMPTY_USAGE, LOOKUP_LIMIT_VND, LOOKUP_MODEL, LOOKUP_TIMEOUT_MS, TURN_RESERVATION_VND } from '../domain/lookup-policy';
import { LookupProviderError } from '../domain/lookup-provider-error';
import { LookupProviderFactory } from './lookup-provider.factory';
import { boundedContext, lookupContextSchema } from '../domain/lookup-context';
import { AiWorkspaceApplicationService } from './workspace.application-service';
import { policyInstructions } from '../domain/workspace-policy';
import { proposalField } from '../domain/campaign-proposal';
import { libraryModelItems } from '../domain/library-index';

const requestSchema = z.object({ id: z.string().uuid(), question: z.string().trim().min(1).max(1600),
  conversationId: z.string().uuid().nullable().default(null), previousId: z.string().uuid().nullable(), context: lookupContextSchema.optional() }).strict();
const uuid = (value: string) => { if (!z.uuid().safeParse(value).success) throw new BadRequestException('Mã hội thoại không hợp lệ.'); return value; };
@Injectable()
export class LookupApplicationService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(LookupRepository) private readonly repository: LookupRepository,
    @Inject(LookupProviderFactory) private readonly providers: LookupProviderFactory,
    @Inject(LookupDataApplicationService) private readonly data: LookupDataApplicationService,
    @Inject(AiWorkspaceApplicationService) private readonly workspace: AiWorkspaceApplicationService) {}

  private mode(): LookupMode { return this.config.get('AI_MODE', { infer: true }); }
  /** Local operator setup only. No HTTP route exposes this method or accepts email-based authorization. */
  async resolvePilotId(email: string) {
    const id = await this.repository.accountId(email.trim().toLowerCase());
    if (!id) throw new BadRequestException('Không tìm thấy đúng tài khoản đang hoạt động. Chưa tạo cấu hình AI.');
    return id;
  }
  private async directSession(actor: ActorContext): Promise<boolean> {
    return this.access.run(actor, async () => {
      const identity = this.access.snapshot().identity;
      return Boolean(actor.session && !actor.session.mustChangePassword &&
        identity.mode === 'DIRECT' && identity.originalActorId === actor.id && identity.effectiveActorId === actor.id &&
        identity.sessionValid && identity.originalActive && identity.effectiveActive && identity.profileComplete && !identity.readOnlyDemo);
    });
  }
  private async eligible(actor: ActorContext) {
    return await this.directSession(actor) && actor.id === this.config.get('AI_PILOT_ACTOR_ID', { infer: true });
  }
  private async requireConversationActor(actor: ActorContext) {
    if (!await this.directSession(actor)) throw new ForbiddenException('Hãy đăng nhập trực tiếp để mở hội thoại riêng của bạn.');
  }
  private async requirePilot(actor: ActorContext) {
    if (!await this.eligible(actor)) throw new ForbiddenException('AI đang thử nghiệm với tài khoản được chỉ định. Bạn chưa được cấp quyền sử dụng.');
  }
  async status(actor: ActorContext): Promise<LookupStatus> {
    const allowed = await this.eligible(actor), mode = this.mode(), period = billingPeriod();
    const ready = mode === 'MOCK' || mode === 'OPENAI' && Boolean(this.config.get('OPENAI_API_KEY_FILE', { infer: true }));
    const totals = allowed ? await this.repository.totals(period) : { chargedVnd: 0, reservedVnd: 0 };
    return { allowed, mode, ready, model: LOOKUP_MODEL, period, limitVnd: LOOKUP_LIMIT_VND, ...totals,
      warning: totals.chargedVnd + totals.reservedVnd >= 80_000,
      reason: !allowed ? 'AI đang thử nghiệm với tài khoản được chỉ định.' : !ready ? 'Trợ lý chưa được bật trên máy chủ.' : null };
  }
  private async valid(actor: ActorContext, run: LookupRun) {
    if (run.state !== 'COMPLETE' || !Array.isArray(run.evidence) || !Array.isArray(run.sources)) return false;
    if (!run.evidence.length) return run.sources.length === 0;
    try {
      for (const item of run.evidence) {
        if (item.requirements) await this.data.checkRequirements(actor, item.requirements);
        if (digest(await this.data.execute(actor, item.tool, item.arguments)) !== item.digest) return false;
      }
      return true;
    } catch { return false; }
  }
  private async readableHistory(actor: ActorContext, run: LookupRun) {
    if (run.state !== 'COMPLETE' || !Array.isArray(run.evidence) || !Array.isArray(run.sources)) return false;
    if (!run.evidence.length) return run.sources.length === 0;
    try {
      for (const item of run.evidence) {
        if (item.requirements) await this.data.checkRequirements(actor, item.requirements);
        if ((!item.requirements || item.tool === 'search_library') && digest(await this.data.execute(actor, item.tool, item.arguments)) !== item.digest) return false;
      }
      return true;
    } catch { return false; }
  }
  private view(run: LookupRun, visible: boolean): LookupAnswer {
    return { id: run.id, conversationId: run.conversationId!, artifacts: visible ? run.artifacts ?? {} : {}, question: visible || run.state !== 'COMPLETE' ? run.question : 'Lượt hỏi trước',
      answer: visible ? run.answer : run.state === 'RUNNING' ? 'Lượt hỏi đang xử lý.' :
        run.state === 'COMPLETE' ? 'Bạn không còn quyền xem một phần nguồn của câu trả lời này. Nội dung được ẩn; bạn vẫn có thể tiếp tục hỏi trong hội thoại.' :
          'Lượt hỏi chưa hoàn tất. Chi phí đã phát sinh hoặc phần dự trù chưa đối soát vẫn được ghi nhận.',
      sources: visible ? run.sources : [], state: !visible && run.state === 'COMPLETE' ? 'REDACTED' : run.state, mode: run.mode, estimatedCostVnd: run.chargedVnd, createdAt: run.createdAt.toISOString() };
  }
  private conversationView(row: ConversationRecord): LookupConversation {
    return { id: row.id, title: row.title, version: row.version, updatedAt: row.updatedAt.toISOString() };
  }
  async conversations(actor: ActorContext, cursor?: string): Promise<LookupConversations> {
    return this.access.run(actor, async () => {
      await this.requireConversationActor(actor);
      const result = await this.repository.conversations(actor.id, cursor ? uuid(cursor) : undefined);
      return { ...result, items: result.items.map(row => this.conversationView(row)) };
    });
  }
  async conversation(actor: ActorContext, id: string, before?: string): Promise<LookupConversationDetail> {
    return this.access.run(actor, async () => {
      await this.requireConversationActor(actor);
      const conversation = await this.repository.conversation(uuid(id), actor.id);
      if (!conversation) throw new NotFoundException('Không tìm thấy hội thoại.');
      const result = await this.repository.turns(id, actor.id, before ? uuid(before) : undefined), output = [];
      for (const row of result.items) output.push(this.view(row, await this.readableHistory(actor, row)));
      return { conversation: this.conversationView(conversation), items: output.reverse(), nextCursor: result.nextCursor };
    });
  }
  async rename(actor: ActorContext, id: string, input: unknown) {
    const parsed = z.object({ title: z.string().trim().min(1).max(100), version: z.number().int().positive() }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Tên hội thoại cần từ 1–100 ký tự.');
    return this.access.run(actor, async () => {
      await this.requireConversationActor(actor);
      return this.conversationView(await this.repository.rename(uuid(id), actor.id, parsed.data.title, parsed.data.version));
    });
  }
  async deleteConversation(actor: ActorContext, id: string) {
    return this.access.run(actor, async () => {
      await this.requireConversationActor(actor); await this.repository.deleteConversation(uuid(id), actor.id);
      return { deleted: true };
    });
  }
  private async readContext(actor: ActorContext, context: LookupContext, bytes = 3200) {
    const evidence: LookupEvidence[] = [];
    let sources: LookupSource[] = [], title = context.type === 'CELL' ? context.label : '', text = context.type === 'CELL' ? context.text : '';
    if (context.record) {
      const names: Record<LookupRecordKind, LookupToolName> = { CAMPAIGN: 'get_campaign', MATERIAL: 'get_material', CONTRACT: 'get_contract', BOOKING: 'get_booking' };
      const tool = names[context.record.kind], args = { id: context.record.id };
      const result = await this.data.execute(actor, tool, args);
      const resultDigest = digest(result);
      if (context.type === 'CELL' && context.record.kind === 'CAMPAIGN') {
        if (!context.fieldKey) throw new BadRequestException('Thiếu trường Chiến dịch đang chọn.');
        const requirement = { ...context.record, fields: [canonicalCampaignFieldKey(context.fieldKey)] };
        await this.data.checkRequirements(actor, [requirement]); result.requirements.push(requirement);
      }
      evidence.push({ tool, arguments: args, digest: resultDigest, requirements: result.requirements });
      sources = result.sources;
      if (context.type === 'RECORD') { title = sources[0]?.title ?? 'Hồ sơ'; text = JSON.stringify(result.content, null, 2); }
    }
    const bounded = boundedContext(text, bytes);
    if (context.type === 'CELL' && bounded.truncated) throw new BadRequestException('Đoạn được chọn quá dài. Hãy chọn đoạn ngắn hơn hoặc rút gọn câu hỏi.');
    const preview: LookupContextPreview = { title, ...bounded, sources };
    return { preview, evidence };
  }
  async previewContext(actor: ActorContext, input: unknown): Promise<LookupContextPreview> {
    await this.requirePilot(actor);
    const context = lookupContextSchema.safeParse(input);
    if (!context.success) throw new BadRequestException('Ngữ cảnh không hợp lệ.');
    return (await this.readContext(actor, context.data)).preview;
  }
  async ask(actor: ActorContext, input: unknown, disconnected?: AbortSignal): Promise<LookupAnswer> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Câu hỏi cần từ 1–1.600 ký tự và mã yêu cầu hợp lệ.');
    await this.requirePilot(actor);
    const mode = this.mode();
    if (mode === 'OFF') throw new ServiceUnavailableException('Trợ lý chưa được bật trên máy chủ.');
    const previous: LookupMessage[] = [], evidence: LookupEvidence[] = [];
    const activePolicy = await this.workspace.activePolicy();
    const artifacts: AiArtifacts = { policyVersion: activePolicy.version, answerFormat: activePolicy.policy.answerFormat };
    let priorClarifications = 0;
    const sourceMap = new Map<string, LookupSource>();
    let question = parsed.data.question;
    if (parsed.data.context) {
      const bytes = Math.min(3200, 4800 - Buffer.byteLength(question));
      if (bytes < 400) throw new BadRequestException('Hãy rút gọn câu hỏi để dành chỗ cho ngữ cảnh hồ sơ.');
      const context = await this.readContext(actor, parsed.data.context, bytes);
      evidence.push(...context.evidence);
      for (const source of context.preview.sources) sourceMap.set(`${source.kind}:${source.id}`, source);
      question += `\n\n[Ngữ cảnh ${parsed.data.context.type === 'RECORD' ? 'hồ sơ đã lưu' : 'văn bản ô đang chọn, có thể chưa lưu'}: ${context.preview.title}]\n${context.preview.text}`;
      if (context.preview.truncated) question += '\n[Đã rút gọn ngữ cảnh do giới hạn dung lượng; không coi đây là toàn bộ hồ sơ.]';
    }
    if (parsed.data.conversationId && !await this.repository.conversation(parsed.data.conversationId, actor.id)) throw new NotFoundException('Không tìm thấy hội thoại.');
    if (parsed.data.previousId) {
      const row = await this.repository.get(parsed.data.previousId, actor.id);
      if (!row || row.conversationId !== parsed.data.conversationId) throw new BadRequestException('Ngữ cảnh không thuộc hội thoại này.');
      priorClarifications = row.artifacts?.questions?.length ? row.artifacts.clarificationCount ?? row.artifacts.questions.length : 0;
      const older = await this.repository.turns(row.conversationId!, actor.id, row.id);
      const candidates = [row, ...older.items].filter(turn => turn.state === 'COMPLETE').slice(0, 6);
      const contextEvidence = new Map<string, LookupEvidence>();
      for (const turn of candidates.reverse()) {
        if (!await this.valid(actor, turn)) continue;
        const merged = new Map(contextEvidence);
        for (const item of turn.evidence) merged.set(digest(item), item);
        if (merged.size > 24) continue;
        previous.push({ role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer });
        for (const [key, item] of merged) contextEvidence.set(key, item);
        for (const source of turn.sources) sourceMap.set(`${source.kind}:${source.id}`, source);
      }
      evidence.push(...contextEvidence.values());
    }
    // Resolve secrets before reserving money; no credential leaves this server-side adapter.
    const provider = await this.providers.create(mode);
    const run = await this.repository.reserve({ id: parsed.data.id, actorId: actor.id, question,
      mode, period: billingPeriod(), reserveVnd: mode === 'MOCK' ? 0 : TURN_RESERVATION_VND, conversationId: parsed.data.conversationId });
    const usage = EMPTY_USAGE();
    const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    const signal = disconnected ? AbortSignal.any([timeout, disconnected]) : timeout;
    try {
      const result = await provider.answer({ question, previous, signal,
        instructions: policyInstructions(activePolicy.policy,activePolicy.version,Math.max(0,activePolicy.policy.maxQuestions-priorClarifications)),
        onUsage: billed => { addUsage(usage, billed); },
        execute: async (tool, args) => {
          signal.throwIfAborted(); await this.requirePilot(actor);
          if (tool === 'ask_library_questions') {
            const input = z.object({ questions: z.array(z.object({ question: z.string().trim().min(1).max(200), options: z.array(z.string().trim().min(1).max(80)).max(4) }).strict()).min(1).max(2) }).strict().parse(args);
            if (priorClarifications + (artifacts.questions?.length ?? 0) + input.questions.length > activePolicy.policy.maxQuestions)
              throw new BadRequestException('Đã đủ số câu hỏi làm rõ. Hãy đề xuất dựa trên thông tin hiện có.');
            artifacts.questions = [...artifacts.questions ?? [], ...input.questions];
            artifacts.clarificationCount = priorClarifications + artifacts.questions.length;
            return { content: { questions: input.questions, note: 'Giao diện đã hiển thị câu hỏi; đợi người dùng trả lời hoặc chọn đề xuất trước.' }, sources: [] };
          }
          if (tool === 'prepare_campaign_update') {
            if (artifacts.proposalId) throw new BadRequestException('Chỉ một đề xuất cho mỗi lượt hỏi.');
            const selected = parsed.data.context?.record;
            if (selected && (selected.kind !== 'CAMPAIGN' || selected.id !== args.id)) throw new BadRequestException('Đề xuất phải thuộc hồ sơ Chiến dịch đang chọn.');
            if (!evidence.some(e => e.tool === 'get_campaign' && e.arguments.id === args.id)) throw new BadRequestException('Cần đọc hồ sơ hiện hành trước khi đề xuất.');
            const proposal = await this.workspace.prepare(actor,run.id,args);
            artifacts.proposalId = proposal.id;
            const entry = evidence.find(e => e.tool === 'get_campaign' && e.arguments.id === args.id)!;
            entry.requirements = [...entry.requirements ?? [], { kind: 'CAMPAIGN', id: proposal.campaignId, fields: proposal.changes.map(c => proposalField(c.field).accessKey) }];
            return { content: { proposalId: proposal.id, changes: proposal.changes.map(c => ({ field: c.label, proposed: c.after })), requiresHumanConfirmation: true, persisted: false }, sources: [] };
          }
          const result = await this.data.execute(actor, tool, args);
          if (tool === 'search_library') {
            artifacts.library = result.content.items as AiLibraryResult[];
            artifacts.librarySyncedAt = String(result.content.indexedAt);
          }
          evidence.push({ tool, arguments: args, digest: digest(result), requirements: result.requirements });
          for (const source of result.sources) sourceMap.set(`${source.kind}:${source.id}`, source);
          if (tool === 'search_library') return { content: { items: libraryModelItems(artifacts.library!),
            indexedAt: artifacts.librarySyncedAt, contentRead: false, note: 'Chỉ metadata, chưa xem ảnh/file. ACTIVE không phải giấy phép sử dụng.' }, sources: [] };
          return { content: result.content, sources: result.sources };
        } });
      if (!result.answer.trim()) throw new LookupProviderError(false);
      return await this.access.run(actor, async () => {
        await this.requirePilot(actor);
        if ((await this.workspace.activePolicy()).version !== activePolicy.version) throw new ForbiddenException('Cấu hình AI đã thay đổi. Hãy gửi lại yêu cầu.');
        if (!await this.repository.conversation(run.conversationId!, actor.id)) throw new NotFoundException('Hội thoại đã bị xóa.');
        for (const item of evidence) {
          if (item.requirements) await this.data.checkRequirements(actor, item.requirements);
          if (digest(await this.data.execute(actor, item.tool, item.arguments)) !== item.digest)
            throw new ForbiddenException('Dữ liệu hoặc quyền vừa thay đổi. Hãy tra cứu lại.');
        }
        const sources = [...sourceMap.values()];
        await this.repository.finish(run.id, { state: 'COMPLETE', answer: result.answer, sources, evidence, usage, chargedVnd: costVnd(usage), artifacts });
        return this.view({ ...run, state: 'COMPLETE', answer: result.answer, sources, chargedVnd: costVnd(usage), artifacts }, true);
      });
    } catch (error) {
      // Operational diagnostics contain neither prompts, provider bodies nor credentials.
      if (error instanceof LookupProviderError) console.warn(JSON.stringify({ component: 'ai-lookup', runId: run.id, reason: error.reason, uncertain: error.uncertain }));
      const uncertain = error instanceof LookupProviderError && error.uncertain;
      await this.repository.finish(run.id, { state: uncertain ? 'UNCERTAIN' : 'FAILED', answer: '', sources: [], evidence: [], usage,
        chargedVnd: uncertain ? run.reservedVnd : costVnd(usage) });
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException('Chưa hoàn tất lượt hỏi. Hãy xem lịch sử và ngân sách trước khi thử lại.');
    }
  }
}
