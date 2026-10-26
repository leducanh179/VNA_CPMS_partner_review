import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { LookupProvider } from '@cpms/ai-contracts';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { hashLocalPassword, newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import { MaterialApplicationService } from '../src/modules/material/application/material.application-service';
import { MaterialSharingApplicationService } from '../src/modules/material/application/material-sharing.application-service';
import { LookupApplicationService } from '../src/modules/ai/application/lookup.application-service';
import { LookupDataApplicationService } from '../src/modules/ai/application/lookup-data.application-service';
import { LookupRepository } from '../src/modules/ai/application/lookup.repository';
import { LookupProviderFactory } from '../src/modules/ai/application/lookup-provider.factory';
import { billingPeriod, EMPTY_USAGE, TURN_RESERVATION_VND } from '../src/modules/ai/domain/lookup-policy';
import { checkAiWorkspace } from './ai-workspace.checks';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(target.hostname));
  const binding = execFileSync('docker', ['port', 'cpms-postgres', '5432/tcp'], { encoding: 'utf8' }).trim();
  assert.equal(binding, `127.0.0.1:${target.port || '5432'}`);
  const original = target.href;
  target.hostname = '127.0.0.1';
  const name = `cpms_ai_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
  assert(/^cpms_ai_test_\d+_[a-f0-9]{8}$/.test(name));
  const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.href });
  const restoreName = name + '_restore';
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); await admin.$executeRawUnsafe(`CREATE DATABASE "${restoreName}"`); }
  finally { await admin.$disconnect(); }
  target.pathname = '/' + name; assert.notEqual(target.href, original);
  Object.assign(process.env, { DATABASE_URL: target.href, NODE_ENV: 'test', AUTH_MODE: 'LOCAL_SESSION',
    ALLOW_OPEN_DEMO: 'false', LOCAL_DEMO_CREDENTIALS: 'false', LOCAL_DEMO_IMPERSONATION: 'false', WEB_ORIGIN: 'http://localhost:5187',
    AI_MODE: 'MOCK', GOOGLE_PROVIDER_WRITES: 'BLOCKED', GOOGLE_DRIVE_WRITES: 'BLOCKED' });
  const migrations = (await readdir('database/migrations')).filter(n => /^\d/.test(n)).sort();
  const cutoff = migrations.indexOf('20261021090000_ai_conversations'); assert(cutoff > 0);
  const sql = async (names: string[]) => (await Promise.all(names.map(n => readFile(`database/migrations/${n}/migration.sql`, 'utf8')))).join('\n');
  const prismaCli = require.resolve('prisma/build/index.js');
  const execute = (input: string) => execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--schema', 'database/schema.prisma', '--stdin'], { input, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  execute(await sql(migrations.slice(0, cutoff)));
  const db = new PrismaService(); await db.$connect();
  const legacy = randomUUID(), legacyActor = randomUUID();
  await db.$executeRaw`INSERT INTO "AiLookupRun" ("id","actorId","period","mode","state","question","answer","chargedVnd","priceVersion","updatedAt")
    VALUES (${legacy}::uuid,${legacyActor}::uuid,'2090-01','MOCK','COMPLETE','Synthetic retained question','Synthetic retained answer',321,'synthetic',now())`;
  const before = await db.$queryRaw`SELECT md5(to_jsonb(r)::text) AS hash FROM "AiLookupRun" r WHERE id=${legacy}::uuid`;
  const dump = execFileSync('docker', ['exec', 'cpms-postgres', 'pg_dump', '-U', decodeURIComponent(target.username), '-Fc', name], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('docker', ['exec', '-i', 'cpms-postgres', 'pg_restore', '-U', decodeURIComponent(target.username), '--dbname', restoreName, '--exit-on-error'], { input: dump });
  const restoreUrl = new URL(target); restoreUrl.pathname = '/' + restoreName;
  const restored = new PrismaClient({ datasourceUrl: restoreUrl.href });
  try { assert.deepEqual(await restored.$queryRaw`SELECT md5(to_jsonb(r)::text) AS hash FROM "AiLookupRun" r WHERE id=${legacy}::uuid`, before); }
  finally { await restored.$disconnect(); }
  execute(await sql(migrations.slice(cutoff)));
  assert.deepEqual(await db.$queryRaw`SELECT md5((to_jsonb(r)-'conversationId'-'artifacts')::text) AS hash FROM "AiLookupRun" r WHERE id=${legacy}::uuid`, before);
  assert.equal((await db.aiConversation.findUniqueOrThrow({ where: { id: legacy } })).title, 'Synthetic retained question');
  console.log('PASS Additive conversation migration preserves existing question, answer and spend; synthetic backup restored and hash verified');
  const password = randomBytes(24).toString('hex'), passwordHash = await hashLocalPassword(password);
  await db.role.upsert({ where: { code: 'ADMIN' }, create: { code: 'ADMIN', displayName: 'Admin', description: 'Synthetic' }, update: {} });
  const department = await db.employmentOrgUnit.create({ data: { identityKey: 'ai-qa-unit', sourceName: 'Synthetic unit', kind: 'DEPARTMENT', sourceProvider: 'SYNTHETIC' } });
  const identities = new PrismaIdentityRepository(db), identity = new IdentityApplicationService(identities);
  const account = async (key: string, administrator = false) => {
    if (!administrator) await db.personnelDirectoryEntry.create({ data: { employeeCode: key, fullName: key, email: `${key}@example.test`, organizationName: 'Synthetic unit', sourceProvider: 'SYNTHETIC' } });
    const row = await db.actor.create({ data: { key, displayName: key, loginEmail: `${key}@example.test`, accountKind: administrator ? 'PILOT_ADMIN' : 'PERSONNEL',
      ...(administrator ? {} : { personnelEmployeeCode: key, employment: { create: { departmentId: department.id } } }),
      credential: { create: { passwordHash, mustChangePassword: false } },
      ...(administrator ? { scopedBindings: { create: { roleCode: 'ADMIN', scopeType: 'SYSTEM', scopeKey: JSON.stringify(['SYSTEM', null, null, null]) } } } : {}) } });
    const token = newOpaqueSecret(), csrf = newOpaqueSecret();
    const session = await identities.createSession({ tokenHash: token.hash, csrfHash: csrf.hash, originalActorId: row.id, effectiveActorId: row.id,
      mode: 'DIRECT', credentialVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) });
    return { actor: identity.actor(session), token: token.token, csrf: csrf.token, email: row.loginEmail! };
  };
  const owner = await account('ai-owner', true), pilot = await account('ai-pilot'), other = await account('ai-other');
  process.env.AI_PILOT_ACTOR_ID = pilot.actor.id;
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api');
  await app.listen(process.env.CPMS_AI_QA_SERVE === 'true' ? 3017 : 0, '127.0.0.1');
  const base = await app.getUrl(), config = app.get(ConfigService), access = app.get(AccessApplicationService);
  const lookup = app.get(LookupApplicationService), tools = app.get(LookupDataApplicationService), ledger = app.get<LookupRepository>(LookupRepository);
  const materials = app.get(MaterialApplicationService), sharing = app.get(MaterialSharingApplicationService);
  const checks: string[] = [], pass = (label: string) => { checks.push(label); console.log('PASS ' + label); };
  const ask = (question = 'Tìm tư liệu') => ({ id: randomUUID(), question, previousId: null });
  try {
    await access.initializeCatalog(owner.actor);
    const created = await materials.batchSave([{ clientKey: 'qa-shared', fields: { material_name: 'Video mẫu CPMS', material_type: 'TVC quảng cáo', material_group: 'Video', material_link: 'https://example.test/video' } }], owner.actor);
    assert.equal(created.succeeded, 1, JSON.stringify(created)); let material = created.items[0]!.material!;
    const secret = await materials.batchSave([{ clientKey: 'qa-secret', fields: { material_name: 'Hidden sentinel 7f10', material_type: 'Key Visual', material_link: 'https://example.test/secret' },
      sharing: { mode: 'RESTRICTED', campaignIds: [], grants: [] } }], owner.actor);
    assert.equal(secret.succeeded, 1, JSON.stringify(secret));
    assert.equal((await lookup.status(pilot.actor)).allowed, true);
    assert.equal((await lookup.status(other.actor)).allowed, false);
    await assert.rejects(lookup.ask(other.actor, ask()));
    await assert.rejects(lookup.ask(owner.actor, ask())); // admin is not an implicit pilot
    const first = await lookup.ask(pilot.actor, ask());
    assert(first.answer.includes('Video mẫu')); assert(!JSON.stringify(first).includes('Hidden sentinel'));
    assert.equal(first.sources.length, 1); assert.equal(first.estimatedCostVnd, 0);
    pass('Exact actor allowlist; administrator cannot bypass; public material read without campaign permission');
    const headers = { cookie: `cpms_session=${pilot.token}`, origin: 'http://localhost:5187', 'x-cpms-csrf': pilot.csrf, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/ai/lookup/status')).status, 401);
    assert.equal((await fetch(base + '/api/ai/lookup/ask', { method: 'POST', headers: { ...headers, 'x-cpms-csrf': '' }, body: JSON.stringify(ask()) })).status, 403);
    const http = await fetch(base + '/api/ai/lookup/ask', { method: 'POST', headers, body: JSON.stringify(ask()) });
    assert.equal(http.status, 201); assert(((await http.json()) as { answer: string }).answer.includes('Video mẫu'));
    pass('Authenticated HTTP flow and CSRF; anonymous callers rejected');
    material = await sharing.change(material.materialId, { mode: 'RESTRICTED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
    const history = await lookup.conversation(pilot.actor, first.conversationId);
    assert(!JSON.stringify(history).includes('Video mẫu'));
    const afterRevoke = await lookup.ask(pilot.actor, { ...ask(), conversationId: first.conversationId, previousId: first.id });
    assert(!JSON.stringify(afterRevoke).includes('Video mẫu'));
    await assert.rejects(tools.execute(pilot.actor, 'get_material', { id: material.materialId }));
    pass('Revocation hides prior answers and sources; old context and guessed IDs cannot disclose data');
    material = await sharing.change(material.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
    const factory = app.get<LookupProviderFactory>(LookupProviderFactory), originalCreate = factory.create.bind(factory);
    factory.create = async () => ({ answer: async input => {
      await input.execute('get_material', { id: material.materialId });
      material = await sharing.change(material.materialId, { mode: 'RESTRICTED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
      return { answer: 'This answer must never be returned or persisted.', usage: EMPTY_USAGE() };
    } });
    try { await assert.rejects(lookup.ask(pilot.actor, ask())); }
    finally { factory.create = originalCreate; }
    assert.equal((await ledger.recent(pilot.actor.id))[0]!.answer, '');
    material = await sharing.change(material.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
    await assert.rejects(lookup.ask({ ...pilot.actor, session: { ...pilot.actor.session!, mode: 'ADMIN_ASSIST' } }, ask()));
    pass('Revocation during provider execution suppresses final answer; impersonated context rejected');
    // Pasted text is a valid source for drafting: no CPMS tool/evidence is required.
    const draftSource = 'Nội dung mẫu riêng: Buổi đọc sách Sao Xanh diễn ra sáng Chủ nhật, vào cửa miễn phí.';
    const draftInputs: Array<Parameters<LookupProvider['answer']>[0]> = [];
    factory.create = async () => ({ answer: async input => {
      draftInputs.push(input);
      return { answer: 'Bản biên tập mẫu: Mời bạn đến buổi đọc sách Sao Xanh vào sáng Chủ nhật. Vào cửa miễn phí.', usage: EMPTY_USAGE() };
    } });
    try {
      const draft = await lookup.ask(pilot.actor, ask(draftSource));
      assert.equal(draft.state, 'COMPLETE'); assert.deepEqual(draft.sources, []);
      const followup = await lookup.ask(pilot.actor, { ...ask('Viết lại thành lời mời'), conversationId: draft.conversationId, previousId: draft.id });
      const third = await lookup.ask(pilot.actor, { ...ask('Cứ làm đi'), conversationId: draft.conversationId, previousId: followup.id });
      assert(draftInputs[2]!.previous.some(message => message.role === 'user' && message.content === draftSource));
      assert(draftInputs[2]!.previous.some(message => message.content === 'Viết lại thành lời mời'));
      assert.equal(draftInputs[2]!.previous.length, 4);
      const reopened = await lookup.conversation(pilot.actor, draft.conversationId);
      assert.equal(reopened.items.length, 3); assert(reopened.items.every(turn => turn.state === 'COMPLETE' && !turn.sources.length));
      await assert.rejects(lookup.conversation(other.actor, draft.conversationId));
      await assert.rejects(lookup.ask(other.actor, { ...ask(), conversationId: draft.conversationId, previousId: third.id }));
      await lookup.rename(pilot.actor, draft.conversationId, { title: 'Bản biên tập riêng', version: reopened.conversation.version });
      assert.equal((await lookup.conversation(pilot.actor, draft.conversationId)).conversation.title, 'Bản biên tập riêng');
      const total = await ledger.totals(billingPeriod());
      await lookup.deleteConversation(pilot.actor, draft.conversationId);
      await assert.rejects(lookup.conversation(pilot.actor, draft.conversationId));
      assert.deepEqual(await ledger.totals(billingPeriod()), total);
    } finally { factory.create = originalCreate; }
    pass('Direct drafting needs no campaign; original pasted text survives follow-ups, reload/rename/delete and owner isolation');
    const mixed = await lookup.ask(pilot.actor, ask());
    factory.create = async () => ({ answer: async input => {
      assert(input.previous.some(message => message.content.includes('Video mẫu')));
      return { answer: 'Viết lại thông tin tư liệu từ lượt trước.', usage: EMPTY_USAGE() };
    } });
    try {
      const rewritten = await lookup.ask(pilot.actor, { ...ask('Viết ngắn lại'), conversationId: mixed.conversationId, previousId: mixed.id });
      assert(rewritten.sources.length > 0);
      material = await sharing.change(material.materialId, { mode: 'RESTRICTED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
      const redacted = await lookup.conversation(pilot.actor, mixed.conversationId);
      assert(redacted.items.every(turn => turn.state === 'REDACTED'));
      factory.create = async () => ({ answer: async input => {
        assert.equal(input.previous.length, 0);
        return { answer: 'Nội dung độc lập do người dùng cung cấp.', usage: EMPTY_USAGE() };
      } });
      await lookup.ask(pilot.actor, { ...ask('Biên tập câu mới: Xin chào'), conversationId: mixed.conversationId, previousId: rewritten.id });
    } finally {
      factory.create = originalCreate;
      material = await sharing.change(material.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
    }
    pass('No-tool rewrites inherit CPMS source permissions; revocation also removes earlier context');
    const recordContext = { type: 'RECORD', record: { kind: 'MATERIAL', id: material.materialId } };
    const preview = await lookup.previewContext(pilot.actor, recordContext);
    assert(preview.text.includes('Video mẫu')); assert.equal(preview.sources[0]!.id, material.materialId);
    await assert.rejects(lookup.previewContext(other.actor, recordContext));
    await assert.rejects(lookup.previewContext(pilot.actor, { ...recordContext, record: { kind: 'MATERIAL', id: secret.items[0]!.material!.materialId } }));
    factory.create = async () => ({ answer: async input => {
      assert(input.question.includes('[Ngữ cảnh hồ sơ đã lưu:')); assert(input.question.includes('Video mẫu'));
      return { answer: 'Thông tin từ đúng hồ sơ được đính kèm.', usage: EMPTY_USAGE() };
    } });
    try {
      const attached = await lookup.ask(pilot.actor, { ...ask('Tóm tắt hồ sơ này'), context: recordContext });
      assert(attached.sources.some(source => source.id === material.materialId));
      material = await sharing.change(material.materialId, { mode: 'RESTRICTED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor);
      assert.equal((await lookup.conversation(pilot.actor, attached.conversationId)).items[0]!.state, 'REDACTED');
      await assert.rejects(lookup.ask(pilot.actor, { ...ask('Tóm tắt tiếp'), context: recordContext }));
    } finally { factory.create = originalCreate; material = await sharing.change(material.materialId, { mode: 'SHARED', campaignIds: [], grants: [], expectedVersion: material.recordVersion }, owner.actor); }
    pass('Selected record preview and ask resolve server-side, preserve sources, reject guessed/private IDs and hide history after revocation');
    const campaign = await db.campaign.create({ data: { code: 'QA-VISIBLE', name: 'Chiến dịch mẫu', createdByActorId: owner.actor.id } });
    await db.campaign.create({ data: { code: 'QA-HIDDEN', name: 'Hidden campaign sentinel', createdByActorId: owner.actor.id } });
    await db.accountPermissionOverride.create({ data: { actorId: pilot.actor.id, permissionCode: 'campaign.read', effect: 'ALLOW', scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: campaign.id,
      scopeKey: JSON.stringify(['RECORD', 'CAMPAIGN', null, campaign.id, null]) } });
    const summary = await tools.execute(pilot.actor, 'summarize_campaigns', { query: '', campaignId: null });
    assert.equal(summary.content.total, 1);
    const found = await tools.execute(pilot.actor, 'search_campaigns', { query: '', campaignId: null });
    assert(!JSON.stringify(found).includes('Hidden campaign sentinel'));
    pass('Campaign results and complete aggregate respect record permissions');
    checks.push(...await checkAiWorkspace(app,owner.actor,pilot.actor,other.actor,campaign.id,department.id));
    const saved = await lookup.conversation(pilot.actor, first.conversationId);
    assert(saved.items.some(item => item.id === first.id && item.answer.includes('Video mẫu')));
    const renamed = await lookup.rename(pilot.actor, first.conversationId, { title: 'Tư liệu của tôi', version: saved.conversation.version });
    await assert.rejects(lookup.rename(pilot.actor, first.conversationId, { title: 'Stale overwrite', version: saved.conversation.version }));
    for (const action of [
      () => lookup.conversation(other.actor, first.conversationId),
      () => lookup.rename(other.actor, first.conversationId, { title: 'Attack', version: renamed.version }),
      () => lookup.deleteConversation(other.actor, first.conversationId),
    ]) await assert.rejects(action());
    assert.equal((await lookup.conversations(other.actor)).items.length, 0);
    await db.aiLookupRun.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 60 * 86_400_000) } });
    assert((await lookup.conversation(pilot.actor, first.conversationId)).items.some(item => item.id === first.id && item.answer.includes('Video mẫu')));
    const continued = await lookup.ask(pilot.actor, { ...ask('Tiếp tục tìm tư liệu'), conversationId: first.conversationId, previousId: first.id });
    assert.equal(continued.conversationId, first.conversationId);
    assert.equal((await lookup.conversation(pilot.actor, first.conversationId)).conversation.title, 'Tư liệu của tôi');
    pass('Conversations persist beyond 30 days, reopen, continue and rename; cross-account reads/rename/delete and stale edits rejected');
    const extra = await lookup.ask(pilot.actor, ask('Hội thoại để kiểm tra xóa'));
    await db.aiLookupRun.update({ where: { id: extra.id }, data: { chargedVnd: 73 } }); // Synthetic billed receipt.
    const amountBeforeDelete = await ledger.totals(billingPeriod());
    await lookup.deleteConversation(pilot.actor, extra.conversationId);
    await assert.rejects(lookup.conversation(pilot.actor, extra.conversationId));
    await assert.rejects(lookup.ask(pilot.actor, { ...ask(), conversationId: extra.conversationId }));
    assert.deepEqual(await ledger.totals(billingPeriod()), amountBeforeDelete);
    const erased = await ledger.get(extra.id, pilot.actor.id);
    assert.equal(erased!.question, ''); assert.equal(erased!.answer, ''); assert.deepEqual(erased!.sources, []);
    pass('Deleting a conversation erases its content, blocks reopening and retains the usage ledger');
    const template = await db.aiLookupRun.findUniqueOrThrow({ where: { id: continued.id } });
    await db.aiLookupRun.createMany({ data: Array.from({ length: 22 }, (_, index) => ({ ...template,
      sources: template.sources as Prisma.InputJsonValue, evidence: template.evidence as Prisma.InputJsonValue, usage: template.usage as Prisma.InputJsonValue, artifacts: template.artifacts as Prisma.InputJsonValue, id: randomUUID(),
      question: `Synthetic older message ${index}`, createdAt: new Date(Date.now() + index) })) });
    const newest = await lookup.conversation(pilot.actor, first.conversationId);
    assert.equal(newest.items.length, 20); assert(newest.nextCursor);
    const older = await lookup.conversation(pilot.actor, first.conversationId, newest.nextCursor);
    assert(older.items.some(item => item.id === first.id));
    assert(!older.items.some(item => newest.items.some(other => other.id === item.id)));
    const duringDelete = await lookup.ask(pilot.actor, ask('Delete while generating'));
    factory.create = async () => ({ answer: async input => {
      await input.execute('get_material', { id: material.materialId });
      await lookup.deleteConversation(pilot.actor, duringDelete.conversationId);
      return { answer: 'Deleted answer must not return', usage: EMPTY_USAGE() };
    } });
    try { await assert.rejects(lookup.ask(pilot.actor, { ...ask(), conversationId: duringDelete.conversationId })); }
    finally { factory.create = originalCreate; }
    assert((await db.aiLookupRun.findMany({ where: { conversationId: duringDelete.conversationId } })).every(row => !row.answer && !row.question));
    pass('Older messages paginate without loss; concurrent deletion cannot resurrect a generated answer');
    const reservation = () => ({ id: randomUUID(), actorId: pilot.actor.id, question: 'Synthetic budget test', mode: 'OPENAI', period: '2099-01', reserveVnd: TURN_RESERVATION_VND });
    const concurrent = await Promise.allSettled([ledger.reserve(reservation()), ledger.reserve(reservation())]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const reserved = concurrent.find(result => result.status === 'fulfilled')!; assert.equal(reserved.status, 'fulfilled');
    await assert.rejects(ledger.reserve({ ...reservation(), id: reserved.value.id }));
    await ledger.finish(reserved.value.id, { state: 'FAILED', answer: '', sources: [], evidence: [], usage: EMPTY_USAGE(), chargedVnd: 99_000 });
    await assert.rejects(ledger.reserve(reservation()));
    const crashed = await db.aiLookupRun.create({ data: { id: randomUUID(), actorId: pilot.actor.id, question: 'Synthetic crash test', mode: 'OPENAI', period: '2099-02', reservedVnd: 1_000, state: 'RUNNING',
      priceVersion: 'synthetic', createdAt: new Date(Date.now() - 600_000) } });
    const afterCrash = await ledger.reserve({ ...reservation(), period: '2099-03' });
    assert.equal((await db.aiLookupRun.findUniqueOrThrow({ where: { id: crashed.id } })).chargedVnd, 1000);
    await ledger.finish(afterCrash.id, { state: 'FAILED', answer: '', sources: [], evidence: [], usage: EMPTY_USAGE(), chargedVnd: 0 });
    pass('PostgreSQL reservation serializes parallel requests; duplicate, budget exhaustion and crash recovery');
    let browser: unknown = null;
    if (process.env.CPMS_QA_PLAYWRIGHT_PATH) {
      const helper = pathToFileURL(resolve('scripts/qa/ai-lookup-browser.mjs')).href;
      const { checkAiLookupBrowser } = await import(helper);
      browser = await checkAiLookupBrowser({ apiBase: base, playwrightPath: process.env.CPMS_QA_PLAYWRIGHT_PATH, pilot, other,
        configureOrigin: (origin: string) => config.set('WEB_ORIGIN', origin) });
      config.set('WEB_ORIGIN', 'http://localhost:5187');
      pass('Browser home, navigation, chat, source, history, mobile and non-pilot checks');
    }
    let live: unknown = null;
    if (process.env.CPMS_AI_LIVE_SMOKE === 'true') {
      const marker = 'private-local/ai-pilot/live-smoke.json';
      try { await readFile(marker); throw new Error('Live smoke already recorded; do not spend twice.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      config.set('AI_MODE', 'OPENAI');
      assert(process.env.CPMS_AI_SMOKE_KEY_FILE, 'Live smoke requires an explicitly supplied private key file');
      config.set('OPENAI_API_KEY_FILE', process.env.CPMS_AI_SMOKE_KEY_FILE);
      try {
        const result = await lookup.ask(pilot.actor, ask('Có tư liệu nào? Trả lời một câu ngắn.'));
        assert(result.answer && result.sources.length > 0);
        live = { id: result.id, state: result.state, chargedVnd: result.estimatedCostVnd, sources: result.sources.length };
      } catch {
        const recent = (await ledger.recent(pilot.actor.id))[0];
        live = { id: recent?.id, state: recent?.state, chargedVnd: recent?.chargedVnd, error: 'Provider call did not complete; no automatic retry.' };
      }
      await mkdir('private-local/ai-pilot', { recursive: true });
      await writeFile(marker, JSON.stringify({ database: name, period: billingPeriod(), result: live }, null, 2));
      console.log('LIVE_SMOKE ' + JSON.stringify(live));
      config.set('AI_MODE', 'MOCK');
    }
    await mkdir('private-local/ai-pilot', { recursive: true });
    await writeFile('private-local/ai-pilot/integration-result.json', JSON.stringify({ database: name, restoreDatabase: restoreName,
      migrationPreserved: true, syntheticRestoreVerified: true, checks, live, browser, productionTouched: false }, null, 2));
    if (process.env.CPMS_AI_QA_SERVE === 'true') {
      // Session material is only in an ignored local file for browser QA, never stdout or tracked source.
      await writeFile('private-local/ai-pilot/browser-session.json', JSON.stringify({ base, pilot, other, password, database: name, databaseUrl: target.href }));
      console.log('QA_READY http://127.0.0.1:3017 (synthetic data, MOCK only)');
      await new Promise<void>(() => {});
    }
  } finally { await app.close(); await db.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL redacted]') : 'Integration failed'); process.exitCode = 1; });
