import assert from 'node:assert/strict';
import { CampaignWorkflowApplicationService } from '../src/modules/campaign-workflow/application/campaign-workflow.application-service';
import { PrismaCampaignWorkflowRepository } from '../src/modules/campaign-workflow/infrastructure/prisma-campaign-workflow.repository';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import { PrismaAccessRepository } from '../src/modules/access/infrastructure/prisma-access.repository';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';
import { AccessAdministrationApplicationService } from '../src/modules/access/application/access-administration.application-service';
import { PrismaAccessAdministrationRepository } from '../src/modules/access/infrastructure/prisma-access-administration.repository';
import { PrismaCatalogRepository } from '../src/modules/catalog/infrastructure/prisma-catalog.repository';
import { CatalogApplicationService } from '../src/modules/catalog/application/catalog.application-service';
import { ScopedCampaignApplicationService } from '../src/modules/campaign/application/scoped-campaign.application-service';
import { PrismaCampaignRepository } from '../src/modules/campaign/infrastructure/prisma-campaign.repository';
import { ScopedCampaignSpreadsheetApplicationService } from '../src/modules/campaign/application/scoped-campaign-spreadsheet.application-service';
import { ExcelJsSpreadsheetAdapter } from '../src/modules/campaign/infrastructure/exceljs-spreadsheet.adapter';
import type { TabularWorkbookData } from '@cpms/integrations';
import { PrismaCampaignCollaborationRepository } from '../src/modules/campaign-collaboration/infrastructure/prisma-campaign-collaboration.repository';
import { ScopedCampaignCommentApplicationService } from '../src/modules/campaign-collaboration/application/scoped-campaign-comment.application-service';
import { ScopedCampaignJournalApplicationService } from '../src/modules/campaign-collaboration/application/scoped-campaign-journal.application-service';
import { ScopedCollaborationAuthorizationService } from '../src/modules/campaign-collaboration/application/scoped-collaboration-authorization.service';
import { exerciseScopedSecondary } from './scoped-secondary.integration';
import { exerciseScopedHttp } from './scoped-http.integration';

/** Synthetic fixtures only. No resetting, dropping, provider calls or actual personnel identifiers. */
export async function exerciseScopedAccess(db: PrismaService) {
  assert(/^\/cpms_access_test_\d+_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname));
  process.env.LOCAL_DEMO_CREDENTIALS = 'true';
  const identities = new PrismaIdentityRepository(db);
  const identity = new IdentityApplicationService(identities);
  const access = new AccessApplicationService(new PrismaAccessRepository(db));
  const fixtureSession = async (email: string) => {
    const account = (await identities.accountByEmail(email))!;
    assert(account.credential && account.isActive);
    return identities.createSession({ tokenHash: newOpaqueSecret().hash, csrfHash: newOpaqueSecret().hash,
      originalActorId: account.id, effectiveActorId: account.id, mode: 'DIRECT', credentialVersion: account.credential.credentialVersion, expiresAt: new Date(Date.now() + 600_000) });
  };
  let adminSession = await fixtureSession('admin@example.test');
  const userSession = await fixtureSession('other@example.test');
  let admin = identity.actor(adminSession); const user = identity.actor(userSession);
  const people = await new PrismaCatalogRepository(db).listPersonnel('');
  assert(people.length > 0 && people.every((person) => !['phoneText','gender','birthYear','sourceProvider','sourceReference'].some((key) => key in person)));
  assert(!people.some((person) => person.employeeCode === 'SYN-STAFF')); // Locked account is not offered by the business picker.
  const first = await access.initializeCatalog(admin);
  assert(first.definitions > 0 && first.initializedRoles > 0);
  const presetCount = await db.rolePermission.count(); const auditCount = await db.auditEvent.count();
  assert.deepEqual(await access.initializeCatalog(admin), { initializedRoles: 0, definitions: 0, promotedDefinitions: 0 });
  assert.equal(await db.rolePermission.count(), presetCount); assert.equal(await db.auditEvent.count(), auditCount);
  assert.equal(await db.rolePermission.count({ where: { roleCode: 'COMM_CAMPAIGN_MANAGER', permissionCode: 'campaign.approve' } }), 0);
  await assert.rejects(access.initializeCatalog(user));
  await assert.rejects(access.run(admin, async () => access.require('campaign.approve'))); // Workflow remains reserved even for superadmin.
  // Promote only this synthetic adapter's exercised permissions, never the live catalogue.
  await db.permissionDefinition.updateMany({ where: { code: { in: ['campaign.read','campaign.update','campaign.export','campaign.trash.read'] } }, data: { implementationStatus: 'IMPLEMENTED' } });
  const ownId = randomUUID(); const foreignId = randomUUID(); const trashId = randomUUID();
  await db.campaign.createMany({ data: [
    { id: ownId, code: 'QA-SCOPE-OWN', name: 'Synthetic own campaign', createdByActorId: user.id, fieldValues: { unknown: 'preserve  spaces' } },
    { id: foreignId, code: 'QA-SCOPE-FOREIGN', name: 'Synthetic hidden campaign', createdByActorId: admin.id },
    { id: trashId, code: 'QA-SCOPE-TRASH', name: 'Synthetic own trash', createdByActorId: user.id, deletedAt: new Date() },
  ] });
  await access.run(user, async () => {
    assert.deepEqual(await access.visibleCampaignIds(), [ownId]);
    assert.deepEqual(await access.visibleCampaignIds(true), []);
    await assert.rejects(access.campaign(foreignId)); await assert.rejects(access.campaignByCode('QA-SCOPE-FOREIGN'));
    assert((await access.campaign(ownId)).createdByActorId === user.id);
  });
  await assert.rejects(access.run({ ...user, id: admin.id, roles: ['ADMIN'] }, async () => access.require('access.manage')));
  await assert.rejects(access.run({ id: admin.id, key: admin.key, displayName: admin.displayName, roles: ['ADMIN'] }, async () => access.require('access.manage')));
  const override = async (permissionCode: string, effect: string, fieldKey: string | null = null) => db.accountPermissionOverride.create({ data: {
    actorId: user.id, permissionCode, effect, scopeType: fieldKey ? 'FIELD' : 'RECORD', module: 'CAMPAIGN', campaignId: foreignId, fieldKey,
    scopeKey: JSON.stringify([fieldKey ? 'FIELD' : 'RECORD','CAMPAIGN',null,foreignId,fieldKey]),
  } });
  const fieldAllow = await override('campaign.update','ALLOW','campaign_name');
  await access.run(user, async () => { await assert.rejects(access.campaign(foreignId)); });
  const readAllow = await override('campaign.read','ALLOW');
  await override('campaign.update','DENY');
  await access.run(user, async () => {
    const resource = await access.campaign(foreignId);
    const capabilities = access.capabilities(resource);
    assert.equal(capabilities.permissions['campaign.update'], false); assert.equal(capabilities.canEditAnyField, true);
    assert.deepEqual(capabilities.editableFields, ['campaign_name']);
    const before = { campaign_name: 'Synthetic hidden campaign', kpi_primary: 'unchanged', unknown: 'preserve  spaces' };
    access.requireChangedFields(resource, before, { fieldValues: { campaign_name: 'Synthetic changed by permitted alias' } });
    assert.throws(() => access.requireChangedFields(resource, before, { name: 'Changed', kpiText: 'forbidden' }));
    assert.throws(() => access.requireChangedFields(resource, before, { lifecycleState: 'APPROVED' }));
    assert.throws(() => access.requireChangedFields(resource, before, { fieldValues: { unknown: 'changed' } }));
    access.requireChangedFields(resource, before, { fieldValues: { unknown: 'preserve  spaces' } });
  });
  // A rule revocation already holding the commit fence wins against a queued command with a previously valid session.
  let ready!: () => void; let release!: () => void;
  const readyPromise = new Promise<void>((resolve) => { ready = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const revoke = db.withSecurityLock(async (tx) => {
    await tx.accountPermissionOverride.update({ where: { id: readAllow.id }, data: { effect: 'DENY', recordVersion: { increment: 1 } } });
    ready(); await releasePromise;
  });
  await readyPromise;
  const queued = access.run(user, async () => {
    const resource = await access.campaign(foreignId);
    access.requireChangedFields(resource, { campaign_name: 'Synthetic hidden campaign' }, { name: 'Must never persist' });
    return db.database.campaign.update({ where: { id: foreignId }, data: { name: 'Must never persist' } });
  });
  const rejected = assert.rejects(queued);
  release(); await revoke; await rejected;
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: foreignId } })).name, 'Synthetic hidden campaign');
  await db.accountPermissionOverride.update({ where: { id: readAllow.id }, data: { effect: 'ALLOW' } });
  // A failure after a permitted business write rolls back that write and its audit together.
  const beforeAudit = await db.auditEvent.count();
  await assert.rejects(access.run(user, async () => {
    const resource = await access.campaign(foreignId); access.requireChangedFields(resource, { campaign_name: 'Synthetic hidden campaign' }, { name: 'Rollback example' });
    await db.inTransaction(async (tx) => {
      await tx.campaign.update({ where: { id: foreignId }, data: { name: 'Rollback example' } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'QA_ROLLBACK', entityType: 'campaign', entityId: foreignId, payload: {} } });
    });
    throw new Error('Synthetic downstream validation failure');
  }));
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: foreignId } })).name, 'Synthetic hidden campaign');
  assert.equal(await db.auditEvent.count(), beforeAudit);
  await db.accountPermissionOverride.update({ where: { id: fieldAllow.id }, data: { validUntil: new Date(Date.now() + 500) } });
  let wroteBeforeExpiry = false;
  await assert.rejects(access.run(user, async () => {
    const resource = await access.campaign(foreignId);
    access.requireChangedFields(resource, { campaign_name: 'Synthetic hidden campaign' }, { name: 'Expired before commit' });
    await db.database.campaign.update({ where: { id: foreignId }, data: { name: 'Expired before commit' } });
    wroteBeforeExpiry = true;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }));
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: foreignId } })).name, 'Synthetic hidden campaign');
  assert(wroteBeforeExpiry);
  // Expired field exceptions do not persist access through the still-open login session.
  await db.accountPermissionOverride.update({ where: { id: fieldAllow.id }, data: { validUntil: new Date(Date.now() - 1_000) } });
  await access.run(user, async () => assert.equal(access.capabilities(await access.campaign(foreignId)).canEditAnyField, false));
  const management = new AccessAdministrationApplicationService(access, new PrismaAccessAdministrationRepository(db));
  await assert.rejects(management.read(user));
  const policyVersion = (await management.read(admin)).version;
  const managed = (permissionCode: string, state: string) => ({ expectedVersion: policyVersion, reason: 'Synthetic reviewed exception', changes: [{ kind: 'OVERRIDE', actorId: user.id,
    permissionCode, state, relation: 'ALL', scope: { scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: foreignId }, validFrom: null, validUntil: null }] });
  assert.equal((await management.preview(admin, managed('campaign.read','DENY'))).changes.length, 1);
  const beforeManagementAudit = await db.auditEvent.count();
  const competing = await Promise.allSettled([management.save(admin, managed('campaign.read','DENY')), management.save(admin, managed('campaign.delete','ALLOW'))]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await db.auditEvent.count(), beforeManagementAudit + 1);
  const currentVersion = (await management.read(admin)).version;
  assert.equal(currentVersion, policyVersion + 1);
  await assert.rejects(management.save(admin, { ...managed('invented.permission','ALLOW'), expectedVersion: currentVersion }));
  await assert.rejects(management.save(admin, { ...managed('campaign.read','ALLOW'), expectedVersion: currentVersion, actorId: admin.id }));
  const inherit = { ...managed('campaign.read','INHERIT'), expectedVersion: currentVersion };
  await management.save(admin, inherit);
  assert.equal(await db.accountPermissionOverride.count({ where: { actorId: user.id, campaignId: foreignId, permissionCode: 'campaign.read' } }), 0);
  await access.run(user, async () => { await assert.rejects(access.campaign(foreignId)); });
  // Grant removal stays removed on the second catalogue bootstrap; it does not reseed admin edits.
  const afterRemoveVersion = (await management.read(admin)).version;
  await access.initializeCatalog(admin);
  assert.equal((await management.read(admin)).version, afterRemoveVersion);
  await db.permissionDefinition.update({ where: { code: 'campaign.delete' }, data: { implementationStatus: 'IMPLEMENTED' } });
  await db.accountPermissionOverride.create({ data: { actorId: user.id, permissionCode: 'campaign.delete', effect: 'ALLOW', scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: ownId,
    scopeKey: JSON.stringify(['RECORD','CAMPAIGN',null,ownId,null]) } });
  await access.run(user, async () => {
    const resource = await access.campaign(ownId); access.require('campaign.delete', resource);
    await db.database.campaign.update({ where: { id: ownId }, data: { deletedAt: new Date() } });
  });
  assert((await db.campaign.findUniqueOrThrow({ where: { id: ownId } })).deletedAt);
  // Exercise the actual Campaign operations/repository through the pending scoped DI adapter.
  await db.permissionDefinition.update({ where: { code: 'campaign.create' }, data: { implementationStatus: 'IMPLEMENTED' } });
  await db.campaignLevel.create({ data: { code: 'CLV_01', label: 'Synthetic division level', ruleDescription: 'Synthetic fixture', displayOrder: 1 } });
  const campaigns = new ScopedCampaignApplicationService(new PrismaCampaignRepository(db), new CatalogApplicationService(new PrismaCatalogRepository(db)), access,
    new CampaignWorkflowApplicationService(new PrismaCampaignWorkflowRepository(db), access));
  const created = await campaigns.create({ name: 'QA Scoped application command', levelCode: 'CLV_01', code: 'QA-SCOPED-APPLICATION' }, user);
  assert(created.access.canEditAnyField);
  assert((await db.campaign.findUniqueOrThrow({ where: { id: created.id } })).requestingDepartmentId === userSession.effective.employment!.departmentId);
  const updated = await campaigns.update(created.id, { expectedVersion: created.recordVersion, fieldValues: { campaign_name: 'QA Changed through legacy alias' } }, user);
  assert.equal(updated.name, 'QA Changed through legacy alias'); assert.equal(updated.fieldValues.campaign_name, updated.name);
  const nameDeny = await db.accountPermissionOverride.create({ data: { actorId: user.id, permissionCode: 'campaign.update', effect: 'DENY', scopeType: 'FIELD', module: 'CAMPAIGN', campaignId: created.id, fieldKey: 'campaign_name',
    scopeKey: JSON.stringify(['FIELD','CAMPAIGN',null,created.id,'campaign_name']) } });
  await assert.rejects(campaigns.update(created.id, { expectedVersion: updated.recordVersion, name: 'Blocked', kpiText: 'Must rollback whole record' }, user));
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: created.id } })).kpiText, null);
  const kept = await campaigns.update(created.id, { expectedVersion: updated.recordVersion, name: updated.name, kpiText: 'Allowed KPI' }, user);
  assert.equal(kept.kpiText, 'Allowed KPI');
  const batch = await campaigns.batchSave([{ clientKey: 'denied', id: created.id, name: 'Blocked again', expectedVersion: kept.recordVersion },
    { clientKey: 'allowed', id: created.id, kpiText: 'Second allowed KPI', expectedVersion: kept.recordVersion }], user);
  assert.equal(batch.succeeded, 1, JSON.stringify(batch.items)); assert.equal(batch.failed, 1);
  await assert.rejects(campaigns.bulkTransition([created.id], 'RUNNING', admin));
  const listed = await access.withRequestActor(user, () => campaigns.list());
  assert(listed.some((row) => row.id === created.id) && listed.every((row) => row.id !== foreignId));
  const similar = await access.withRequestActor(user, () => campaigns.findSimilar('Synthetic'));
  assert(!similar.some((row) => row.id === foreignId));
  const lastBusinessAudit = await db.auditEvent.findFirstOrThrow({ where: { entityId: created.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(lastBusinessAudit.actorId, user.id); assert.equal(lastBusinessAudit.originalActorId, user.id); assert.equal(lastBusinessAudit.contextMode, 'DIRECT');
  const spreadsheets = new ScopedCampaignSpreadsheetApplicationService(new ExcelJsSpreadsheetAdapter(), new PrismaCampaignRepository(db), campaigns, new CatalogApplicationService(new PrismaCatalogRepository(db)), access);
  const workbook: TabularWorkbookData = { sheets: [{ name: 'Rows', rows: [
    ['Code','Name','KPI'], ['campaign_code','campaign_name','kpi_text'],
    [created.code, updated.name, 'Synthetic imported KPI'], ['QA-SCOPE-FOREIGN','User-provided label','Never read hidden CPMS'],
  ] }] };
  const preview = await access.withRequestActor(user, () => spreadsheets.previewWorkbook(workbook, { sheetName: 'Rows' }));
  assert.equal(preview.rows[1]!.status, 'INVALID'); assert.equal(preview.rows[1]!.campaignId, null); assert.deepEqual(preview.rows[1]!.diffs, []);
  const decision = { rowNumber: 3, action: 'UPDATE' as const, expectedVersion: preview.rows[0]!.expectedVersion!, selectedFieldKeys: ['campaign_name','kpi_text'] as const };
  const importInput = { sheetName: 'Rows', decisions: [{ ...decision, selectedFieldKeys: [...decision.selectedFieldKeys] }] };
  assert.equal((await spreadsheets.importWorkbook(workbook, importInput, user)).failed, 1);
  await db.permissionDefinition.update({ where: { code: 'campaign.import' }, data: { implementationStatus: 'IMPLEMENTED' } });
  await db.accountPermissionOverride.create({ data: { actorId: user.id, permissionCode: 'campaign.import', effect: 'ALLOW', scopeType: 'RECORD', module: 'CAMPAIGN', campaignId: created.id,
    scopeKey: JSON.stringify(['RECORD','CAMPAIGN',null,created.id,null]) } });
  const imported = await spreadsheets.importWorkbook(workbook, importInput, user);
  assert.equal(imported.succeeded, 1, JSON.stringify(imported.items));
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: created.id } })).kpiText, 'Synthetic imported KPI');
  const exported = await access.withRequestActor(user, () => spreadsheets.exportWorkbook({ mode: 'DATA', recordScope: 'ALL_CURRENT', fieldScope: 'CUSTOM', fieldKeys: ['campaign_code','campaign_name'] }));
  assert.equal(exported.rowCount, 1); assert(!JSON.stringify(exported.workbook).includes('Synthetic hidden campaign'));
  await assert.rejects(access.withRequestActor(user, () => spreadsheets.exportWorkbook({ mode: 'DATA', recordScope: 'SELECTED', campaignIds: [foreignId], fieldScope: 'ACTIVE_V2' })));
  await db.accountPermissionOverride.delete({ where: { id: nameDeny.id } });
  // Actual comment/journal queries filter rows, counts and actor facets before pagination.
  await db.permissionDefinition.updateMany({ where: { code: { in: ['campaign.comment','campaign.journal.read'] } }, data: { implementationStatus: 'IMPLEMENTED' } });
  const collaborationRepository = new PrismaCampaignCollaborationRepository(db);
  const collaborationAuthorization = new ScopedCollaborationAuthorizationService(access);
  const comments = new ScopedCampaignCommentApplicationService(collaborationRepository, campaigns, collaborationAuthorization, access);
  const journal = new ScopedCampaignJournalApplicationService(collaborationRepository, campaigns, collaborationAuthorization, access);
  const hiddenComment = await comments.create(foreignId, { body: 'Synthetic hidden comment' }, admin);
  const ownComment = await comments.create(created.id, { body: 'Synthetic visible comment' }, user);
  const commentPage = await comments.list({ pageSize: 1 }, user);
  assert.equal(commentPage.total, 1); assert.equal(commentPage.items[0]!.id, ownComment.id);
  await assert.rejects(comments.list({ campaignId: foreignId }, user));
  await assert.rejects(comments.create(created.id, { body: 'Wrong reply target', replyToCommentId: hiddenComment.id }, user));
  await assert.rejects(comments.setReaction(created.id, hiddenComment.id, 'LIKE', user));
  await assert.rejects(comments.update(created.id, ownComment.id, { body: 'Admin is not this author', expectedVersion: 1 }, admin));
  assert.equal((await comments.setReaction(created.id, ownComment.id, 'LIKE', user)).likeCount, 1);
  assert.equal((await comments.removeReaction(created.id, ownComment.id, user)).likeCount, 0);
  await db.auditEvent.create({ data: { actorId: admin.id, entityType: 'campaign', entityId: foreignId, action: 'campaign.updated', payload: { source: 'API', changes: [] } } });
  const journalPage = await journal.list({ pageSize: 1 }, user);
  assert(journalPage.total > 1 && journalPage.items.every((row) => row.campaign.id === created.id));
  assert(journalPage.actors.every((actor) => actor.id === user.id));
  await assert.rejects(journal.list({ campaignId: foreignId }, user));
  const demo = await identity.switchDemo(adminSession, user.id);
  const demoActor = identity.actor(demo.session);
  const demonstrated = await comments.create(created.id, { body: 'Synthetic demonstrated comment' }, demoActor);
  assert.equal(demonstrated.author.id, user.id); assert.equal(demonstrated.demonstration?.originalActor?.id, admin.id);
  const demoAudit = await db.auditEvent.findFirstOrThrow({ where: { entityId: demonstrated.id } });
  assert.equal(demoAudit.actorId, user.id); assert.equal(demoAudit.originalActorId, admin.id); assert.equal(demoAudit.contextMode, 'DEMO_IMPERSONATION');
  assert(!JSON.stringify(demoAudit.payload).includes('Synthetic demonstrated comment'));
  assert.equal((await comments.list({}, user)).items.find((row) => row.id === demonstrated.id)?.demonstration?.originalActor?.id, admin.id);
  await assert.rejects(comments.create(foreignId, { body: 'No inherited admin visibility' }, demoActor));
  const returned = await identity.switchDemo(demo.session, null);
  adminSession = returned.session; admin = identity.actor(adminSession);
  await exerciseScopedSecondary(db, access, campaigns, spreadsheets, admin, user, created.id, foreignId);
  await exerciseScopedHttp(db, created.id, foreignId);
  // Expiring a scoped ADMIN binding removes actual admin authority although ActorRole history remains unchanged.
  await db.scopedRoleBinding.updateMany({ where: { actorId: admin.id, roleCode: 'ADMIN' }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  assert((await db.actorRole.count({ where: { actorId: admin.id, roleCode: 'ADMIN' } })) === 1);
  assert(!(await identities.accountById(admin.id))!.roles.includes('ADMIN'));
  await assert.rejects(identity.accounts(adminSession));
  await assert.rejects(access.run(admin, async () => access.require('access.manage')));
  return { catalogIdempotence: true, noInheritedAdmin: true, ownVisibility: true, fieldAliases: true, readGate: true, revocationFence: true, atomicRollback: true, expiry: true, managementVersionRace: true, inheritRemovesException: true };
}
