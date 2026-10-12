import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CampaignSummary } from '@cpms/domain';
import { campaignRecordValue, toUpdateCommand } from '../../web/src/lib/campaign-v2-form';
import { NestFactory } from '@nestjs/core';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { generateLocalCredential, newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { exerciseCampaignWorkflow } from './campaign-workflow.integration';

/** Actual AppModule/DI/middleware/transport tests. The outbound guard forbids every non-test HTTP target. */
export async function exerciseScopedHttp(db: PrismaService, ownId: string, foreignId: string) {
  assert(/^\/cpms_access_test_\d+_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const credentialFile = path.resolve('private-local/access-demo/synthetic-http-credential.json');
  await writeFile(credentialFile, JSON.stringify({ password: generateLocalCredential().slice(0, 8) }));
  process.env.LOCAL_DEMO_CREDENTIAL_FILE = credentialFile; process.env.GOOGLE_PROVIDER_WRITES = 'BLOCKED';
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  const endpoint = await app.getUrl(); const originalFetch = globalThis.fetch; let unexpectedProviderCalls = 0;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== endpoint) { unexpectedProviderCalls += 1; throw new Error('External provider calls are forbidden by the synthetic HTTP harness'); }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const identities = new PrismaIdentityRepository(db);
    const sessionHeaders = async (email: string) => {
      const account = (await identities.accountByEmail(email))!; const token = newOpaqueSecret(); const csrf = newOpaqueSecret();
      await identities.createSession({ tokenHash: token.hash, csrfHash: csrf.hash, originalActorId: account.id, effectiveActorId: account.id,
        credentialVersion: account.credential!.credentialVersion, mode: 'DIRECT', expiresAt: new Date(Date.now() + 600_000) });
      return { Cookie: `cpms_session=${token.token}`, Origin: process.env.WEB_ORIGIN!, 'x-cpms-csrf': csrf.token, 'Content-Type': 'application/json' };
    };
    const admin = await sessionHeaders('admin@example.test'); const user = await sessionHeaders('other@example.test'); const outsider = await sessionHeaders('leader@example.test');
    const send = (route: string, headers?: Record<string, string>, method = 'GET', body?: unknown) => fetch(`${endpoint}/api${route}`, { method, ...(headers ? { headers } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const route of ['/campaigns','/campaigns/similar?query=QA','/catalogs/personnel','/campaign-comments','/campaign-journal','/materials','/system/status','/access','/integrations/google/status','/docs','/unknown']) {
      assert.equal((await send(route)).status, 401, route);
    }
    const listed = await send('/campaigns', user); assert.equal(listed.status, 200);
    const rows = await listed.json() as { id: string }[]; assert(rows.some((row) => row.id === ownId) && !rows.some((row) => row.id === foreignId));
    assert.equal((await send(`/campaigns/${foreignId}`, { ...user, 'x-actor-id': (await identities.accountByEmail('admin@example.test'))!.id, 'x-roles': 'ADMIN' })).status, 404);
    for (const route of ['/access','/system/status','/materials','/materials/bootstrap']) assert.equal((await send(route, outsider)).status, 403, route);
    assert.equal((await send('/catalogs/personnel?query=Synthetic', outsider)).status, 200);
    assert.equal((await send('/system/status', admin)).status, 200);
    assert.equal((await send(`/campaigns/${ownId}/drive-workspace`, user)).status, 200);
    for (const route of [`/campaigns/${foreignId}/comments`,`/campaigns/${foreignId}/drive-workspace`]) {
      const response = await send(route, user, route.endsWith('comments') ? 'POST' : 'GET', route.endsWith('comments') ? { body: 'Denied' } : undefined);
      assert.equal(response.status, 404, route);
    }
    assert.equal((await send('/campaigns/bulk-transition', admin, 'POST', { ids: [ownId], lifecycleState: 'RUNNING' })).status, 403);
    const withoutCsrf = { ...user }; delete (withoutCsrf as Record<string,string>)['x-cpms-csrf'];
    assert.equal((await send(`/campaigns/${ownId}/comments`, withoutCsrf, 'POST', { body: 'No CSRF' })).status, 403);
    assert.equal((await send(`/campaigns/${ownId}/comments`, user, 'POST', { body: 'Synthetic HTTP comment' })).status, 201);
    for (const route of ['/integrations/google/connect','/integrations/google/disconnect']) assert.equal((await send(route, admin, 'POST', {})).status, 403);
    for (const headers of [admin, outsider]) {
      const statusResponse = await send('/integrations/google/status', headers);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.providerWritesEnabled, false);
      assert.equal(status.canConnectGoogle, false);
      assert.equal(status.canDisconnectGoogle, false);
      assert.equal(status.canWriteSheets, false);
      assert.equal(typeof status.canReadSheets, 'boolean');
    }
    const before = await (await send('/access', admin)).json() as { version: number };
    const actorId = (await identities.accountByEmail('other@example.test'))!.id;
    const scope = { scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: foreignId };
    const command = { expectedVersion: before.version, reason: 'Synthetic HTTP reviewed field exception', changes: [
      { kind: 'OVERRIDE', actorId, permissionCode: 'campaign.read', state: 'ALLOW', relation: 'ALL', scope, validFrom: null, validUntil: null },
      { kind: 'OVERRIDE', actorId, permissionCode: 'campaign.update', state: 'DENY', relation: 'ALL', scope, validFrom: null, validUntil: null },
      { kind: 'OVERRIDE', actorId, permissionCode: 'campaign.update', state: 'ALLOW', relation: 'ALL', scope: { ...scope, scopeType: 'FIELD', fieldKey: 'campaign_name' }, validFrom: null, validUntil: null },
      // This synthetic actor already has a broad delete grant from the earlier rollback test.
      // Granting read would activate it; explicitly deny delete for the field-only scenario.
      { kind: 'OVERRIDE', actorId, permissionCode: 'campaign.delete', state: 'DENY', relation: 'ALL', scope, validFrom: null, validUntil: null },
    ] };
    assert.equal((await send('/access/save', user, 'POST', command)).status, 403);
    const previewResponse = await send('/access/preview', admin, 'POST', command); assert.equal(previewResponse.status, 201);
    const preview = await previewResponse.json() as { impacts: { actorId: string; campaignId: string; editableFieldsAfter: string[]; decisions: { permission: string; before: { allowed: boolean }; after: { allowed: boolean } }[] }[] };
    const impact = preview.impacts.find((item) => item.actorId === actorId && item.campaignId === foreignId)!;
    assert(impact); assert(impact.editableFieldsAfter.includes('campaign_name'));
    assert.equal(impact.decisions.find((decision) => decision.permission === 'campaign.read')!.before.allowed, false);
    assert.equal(impact.decisions.find((decision) => decision.permission === 'campaign.read')!.after.allowed, true);
    assert.equal(impact.decisions.find((decision) => decision.permission === 'campaign.update')!.after.allowed, false);
    assert.equal(impact.decisions.find((decision) => decision.permission === 'campaign.delete')!.after.allowed, false);
    assert.equal((await send(`/campaigns/${foreignId}`, user)).status, 404, 'Preview must never grant access or persist policy');
    const saved = await send('/access/save', admin, 'POST', command); assert.equal(saved.status, 201);
    const after = await saved.json() as { version: number };
    const readable = await send(`/campaigns/${foreignId}`, user); assert.equal(readable.status, 200);
    const row = await readable.json() as CampaignSummary;
    assert(row.access?.canEditAnyField && row.access.editableFields.includes('campaign_name'));
    assert.equal((await send(`/access/explain?actorId=${actorId}&campaignId=${foreignId}`, user)).status, 403);
    const explanationResponse = await send(`/access/explain?actorId=${actorId}&campaignId=${foreignId}`, admin);
    assert.equal(explanationResponse.status, 200);
    const explanation = await explanationResponse.json() as { fieldReadMasking: boolean; workflowAssignmentEvaluated: boolean; fields: { fieldKey: string; allowed: boolean }[]; decisions: { permission: string; allowed: boolean }[] };
    assert.equal(explanation.fieldReadMasking, false); assert.equal(explanation.workflowAssignmentEvaluated, false);
    assert(explanation.fields.find((field) => field.fieldKey === 'campaign_name')?.allowed);
    assert.equal(explanation.decisions.find((decision) => decision.permission === 'campaign.update')?.allowed, false);
    for (const proposed of impact.decisions) assert.equal(explanation.decisions.find((decision) => decision.permission === proposed.permission)?.allowed, proposed.after.allowed, `Preview matches saved policy: ${proposed.permission}`);
    const formPatch = toUpdateCommand({ ...campaignRecordValue(row), name: 'Synthetic HTTP field allow' }, row.recordVersion);
    assert.equal((await send(`/campaigns/${foreignId}`, user, 'PATCH', formPatch)).status, 200, 'The actual detail form must preserve unrelated absent/legacy fields');
    assert.equal((await send(`/campaigns/${foreignId}`, user, 'PATCH', { expectedVersion: row.recordVersion + 1, kpiText: 'Must not persist' })).status, 403);
    assert.equal((await send('/campaigns/spreadsheet/export', user, 'POST', { mode: 'DATA', recordScope: 'SELECTED', campaignIds: [foreignId], fieldScope: 'ACTIVE_V2' })).status, 403);
    assert.equal((await send('/access/save', admin, 'POST', { ...command, expectedVersion: after.version, changes: [{ ...command.changes[0], state: 'INHERIT' }] })).status, 201);
    assert.equal((await send(`/campaigns/${foreignId}`, user)).status, 404);
    const current = await (await send('/access', admin)).json() as { version: number };
    const presetAndBinding = { expectedVersion: current.version, reason: 'Synthetic combined preset and scoped binding projection', changes: [
      { kind: 'ROLE_PRESET', roleCode: 'COMM_CAMPAIGN_MANAGER', permissions: [{ permissionCode: 'campaign.read', effect: 'ALLOW', relation: 'ALL', defaultScope: 'MODULE' }] },
      { kind: 'ROLE_BINDING', actorId, roleCode: 'COMM_CAMPAIGN_MANAGER', scope, relation: 'PRESET', expiresAt: null, state: 'BOUND' },
    ] };
    const combinedPreviewResponse = await send('/access/preview', admin, 'POST', presetAndBinding); assert.equal(combinedPreviewResponse.status, 201);
    const combinedPreview = await combinedPreviewResponse.json() as typeof preview;
    assert.equal(combinedPreview.impacts.find((item) => item.actorId === actorId && item.campaignId === foreignId)?.decisions.find((item) => item.permission === 'campaign.read')?.after.allowed, true);
    assert.equal((await send(`/campaigns/${foreignId}`, user)).status, 404);
    assert.equal((await send('/access/save', admin, 'POST', presetAndBinding)).status, 201);
    assert.equal((await send(`/campaigns/${foreignId}`, user)).status, 200);
    assert.equal((await send('/access/capabilities')).status, 401);
    const capabilityResponse = await send('/access/capabilities', user); assert.equal(capabilityResponse.status, 200);
    const capability = await capabilityResponse.json() as { permissions: Record<string, boolean> };
    assert.equal(capability.permissions['access.manage'], false); assert.equal(capability.permissions['campaign.read'], true);
    await exerciseCampaignWorkflow(db, send, admin, sessionHeaders);
    assert.equal(unexpectedProviderCalls, 0);
  } finally { globalThis.fetch = originalFetch; await app.close(); }
}
