import assert from 'node:assert/strict';
import type { ActorContext } from '@cpms/domain';
import type { CloudDriveItem, CloudDrivePort, CloudSpreadsheetPort, UserOAuthPort } from '@cpms/integrations';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import type { Environment } from '../src/config/environment';
import type { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import type { ScopedCampaignApplicationService } from '../src/modules/campaign/application/scoped-campaign.application-service';
import type { ScopedCampaignSpreadsheetApplicationService } from '../src/modules/campaign/application/scoped-campaign-spreadsheet.application-service';
import { ScopedMaterialApplicationService } from '../src/modules/material/application/scoped-material.application-service';
import { PrismaMaterialRepository } from '../src/modules/material/infrastructure/prisma-material.repository';
import { ScopedCatalogApplicationService } from '../src/modules/catalog/application/scoped-catalog.application-service';
import { PrismaCatalogRepository } from '../src/modules/catalog/infrastructure/prisma-catalog.repository';
import { ProviderOperationAccessService } from '../src/modules/google-integration/application/provider-operation-access.service';
import { guardedGooglePorts } from '../src/modules/google-integration/infrastructure/guarded-google-ports';
import { ScopedGoogleIntegrationApplicationService } from '../src/modules/google-integration/application/scoped-google-integration.application-service';
import { PrismaGoogleIntegrationRepository } from '../src/modules/google-integration/infrastructure/prisma-google-integration.repository';
import { ScopedCampaignDriveApplicationService } from '../src/modules/campaign-drive/application/scoped-campaign-drive.application-service';
import { ScopedDriveAuthorizationService } from '../src/modules/campaign-drive/application/scoped-drive-authorization.service';
import { PrismaCampaignDriveRepository } from '../src/modules/campaign-drive/infrastructure/prisma-campaign-drive.repository';
import { ScopedDriveOrchestrationService } from '../src/modules/campaign-drive/application/scoped-drive-orchestration.service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { PrismaIdentityRepository } from '../src/modules/identity/infrastructure/prisma-identity.repository';
import { newOpaqueSecret } from '../src/modules/identity/application/local-auth-security';

export async function exerciseScopedSecondary(db: PrismaService, access: AccessApplicationService, campaigns: ScopedCampaignApplicationService,
  spreadsheets: ScopedCampaignSpreadsheetApplicationService, admin: ActorContext, user: ActorContext, ownId: string, foreignId: string) {
  assert(/^\/cpms_access_test_\d+_[a-f0-9]{8}$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const grant = async (actorId: string, permissionCode: string, campaignId: string | null = null) => {
    const module = permissionCode.split('.')[0]!.toUpperCase(); const scopeType = campaignId ? 'RECORD' : 'MODULE';
    await db.accountPermissionOverride.create({ data: { actorId, permissionCode, effect: 'ALLOW', scopeType, module, campaignId, scopeKey: JSON.stringify([scopeType,module,null,campaignId,null]) } });
  };
  await db.permissionDefinition.updateMany({ where: { code: { in: ['material.read','material.create','material.update','material.manage','campaign.drive.read','campaign.drive.ensure','campaign.drive.upload',
    'campaign.drive.rename','campaign.drive.trash','campaign.drive.restore','campaign.sheets.read','campaign.sheets.write','google.connect','google.revoke','campaign.restore','campaign.purge'] } }, data: { implementationStatus: 'IMPLEMENTED' } });
  const materials = new ScopedMaterialApplicationService(new PrismaMaterialRepository(db), campaigns, access);
  await assert.rejects(access.withRequestActor(user, () => materials.list()));
  await assert.rejects(materials.batchSave([{ clientKey: 'no-inheritance', fields: { material_name: 'Denied' } }], user));
  await grant(user.id, 'material.read'); await grant(user.id, 'material.create');
  const material = await materials.batchSave([{ clientKey: 'explicit-module-grant', fields: { material_name: 'Synthetic material' } }], user);
  assert.equal(material.succeeded, 1);
  const materialAudit = await db.auditEvent.findFirstOrThrow({ where: { entityId: material.items[0]!.materialId } });
  assert.equal(materialAudit.originalActorId, user.id);
  await assert.rejects(access.withRequestActor(user, () => materials.list(true)));
  const materialBootstrap = await access.withRequestActor(user, () => materials.bootstrap());
  assert.deepEqual(materialBootstrap.users, []); assert(!materialBootstrap.campaigns.some((row) => row.campaign_id === foreignId));
  const catalogs = new ScopedCatalogApplicationService(new PrismaCatalogRepository(db), access);
  await assert.rejects(catalogs.listPersonnel());
  assert((await access.withRequestActor(user, () => catalogs.listPersonnel())).every((person) => !('phoneText' in person)));

  const config = new ConfigService<Environment, true>({ GOOGLE_PROVIDER_WRITES: 'BLOCKED', GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: randomBytes(16).toString('hex'),
    GOOGLE_OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3000/api/integrations/google/callback',
    GOOGLE_DRIVE_SHARED_DRIVE_ID: 'synthetic_shared_drive', GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID: 'synthetic_parent_folder', GOOGLE_DRIVE_ACCESS_MODE: 'CPMS_VISIBILITY_ONLY',
    GOOGLE_DRIVE_SHARING_MODE: 'DRIVE_ACL', GOOGLE_DRIVE_UPLOAD_MAX_BYTES: 1_000_000, GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES: 100_000 });
  const providerAccess = new ProviderOperationAccessService(access, config);
  let exchanges = 0; let writes = 0; let driveReads = 0; let subject = 'synthetic-provider-owner'; let issueRefresh = true;
  const syntheticToken = randomBytes(32).toString('base64url');
  const item: CloudDriveItem = { id: 'synthetic_file_id', name: 'Synthetic file', mimeType: 'text/plain', driveId: 'synthetic_shared_drive', parents: ['synthetic_child_folder'], trashed: false,
    size: 10, modifiedTime: null, lastModifiedBy: null, trashedTime: null, trashedBy: null, webViewLink: null, webContentLink: null,
    capabilities: { canEdit: true, canTrash: true, canUntrash: true, canMoveItemWithinDrive: true, canDownload: true, canAddChildren: true, canShare: true } };
  const unexpectedWrite = async (): Promise<never> => { writes += 1; throw new Error('Unexpected synthetic provider write'); };
  const adapter: CloudDrivePort & CloudSpreadsheetPort & UserOAuthPort = {
    authorizationUrl: ({ state }) => `https://example.test/oauth?state=${encodeURIComponent(state)}`,
    exchangeCode: async () => { exchanges += 1; return { accessToken: syntheticToken, refreshToken: issueRefresh ? syntheticToken : null, expiresAt: new Date(Date.now() + 600_000).toISOString(), grantedScopes: ['https://www.googleapis.com/auth/drive'] }; },
    identity: async () => ({ subject, email: 'synthetic-google@example.test', name: 'Synthetic provider' }), refresh: unexpectedWrite, revoke: unexpectedWrite,
    metadata: async () => ({ spreadsheetId: 'synthetic_spreadsheet', title: 'Synthetic sheet', canEdit: true, tabs: [] }), readTab: async () => ({ name: 'Synthetic', rows: [] }), createTab: unexpectedWrite,
    getItem: async () => { driveReads += 1; return structuredClone(item); }, findFolders: async () => [], listFiles: async () => { driveReads += 1; return { items: [structuredClone(item)], nextPageToken: null }; },
    listPermissions: async () => [], createFolder: unexpectedWrite, createLinkWriterPermission: unexpectedWrite, renameItem: unexpectedWrite, setTrashed: unexpectedWrite, moveItem: unexpectedWrite, upload: unexpectedWrite,
  };
  const ports = guardedGooglePorts(adapter, providerAccess);
  const google = new ScopedGoogleIntegrationApplicationService(config, ports, ports, new PrismaGoogleIntegrationRepository(db), spreadsheets, providerAccess, access);
  const drive = new ScopedCampaignDriveApplicationService(config, campaigns, google, ports, new PrismaCampaignDriveRepository(db), new ScopedDriveAuthorizationService(access), providerAccess, access);
  const orchestration = new ScopedDriveOrchestrationService(campaigns, drive, access);
  assert.equal((await google.status(admin)).connectionState, 'BLOCKED_BY_RECONNECT');
  await assert.rejects(google.beginConnection(admin)); assert.equal(exchanges, 0);
  config.set('GOOGLE_PROVIDER_WRITES', 'ENABLED'); // Only the synthetic ports above are reachable.
  const begin = await google.beginConnection(admin); const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
  const identities = new PrismaIdentityRepository(db); const identity = new IdentityApplicationService(identities);
  const account = (await identities.accountById(admin.id))!;
  const separateSession = await identities.createSession({ tokenHash: newOpaqueSecret().hash, csrfHash: newOpaqueSecret().hash, originalActorId: admin.id, effectiveActorId: admin.id,
    credentialVersion: account.credential!.credentialVersion, mode: 'DIRECT', expiresAt: new Date(Date.now() + 600_000) });
  await assert.rejects(google.completeConnection(identity.actor(separateSession), 'synthetic-code', state)); assert.equal(exchanges, 0);
  await google.completeConnection(admin, 'synthetic-code', state); assert.equal(exchanges, 1);
  await assert.rejects(google.completeConnection(admin, 'synthetic-code', state)); assert.equal(exchanges, 1);
  const stored = await db.googleOAuthConnection.findUniqueOrThrow({ where: { actorId: admin.id } });
  assert(!stored.encryptedTokens.includes(syntheticToken)); assert(!JSON.stringify(await google.status(admin)).includes(syntheticToken));
  assert.equal((await google.status(user)).connected, false);
  await grant(user.id, 'google.connect');
  const otherBegin = await google.beginConnection(user);
  await assert.rejects(google.completeConnection(user, 'synthetic-code', new URL(otherBegin.authorizationUrl).searchParams.get('state')!));
  assert.equal(await db.googleOAuthConnection.count({ where: { actorId: user.id } }), 0);
  assert.equal((await db.googleOAuthConnection.findUniqueOrThrow({ where: { actorId: admin.id } })).providerAccountId, subject);
  subject = 'synthetic-other-provider'; issueRefresh = false;
  const changedBegin = await google.beginConnection(admin);
  await assert.rejects(google.completeConnection(admin, 'synthetic-code', new URL(changedBegin.authorizationUrl).searchParams.get('state')!));
  const exchangesAfterFailure = exchanges;
  await assert.rejects(google.completeConnection(admin, 'synthetic-code', new URL(changedBegin.authorizationUrl).searchParams.get('state')!));
  assert.equal(exchanges, exchangesAfterFailure); // A failed exchange also consumes state permanently.
  assert.equal((await db.googleOAuthConnection.findUniqueOrThrow({ where: { actorId: admin.id } })).providerAccountId, 'synthetic-provider-owner');
  await assert.rejects(google.withAccessToken(admin, async () => true));
  await access.run(admin, async () => providerAccess.execute('campaign.sheets.read', undefined, () => {
    assert.throws(() => ports.createTab({ accessToken: syntheticToken, spreadsheetId: 'synthetic_spreadsheet', title: 'Forbidden', rows: [] }));
  }));
  await grant(user.id, 'campaign.drive.read', ownId);
  await assert.rejects(drive.getWorkspace(foreignId, user));
  assert.equal((await drive.getWorkspace(ownId, user)).lastErrorCode, 'BLOCKED_BY_RECONNECT');
  const demo = await identity.switchDemo(separateSession, user.id); const demoActor = identity.actor(demo.session);
  await assert.rejects(google.beginConnection(demoActor)); await assert.rejects(google.disconnect(demoActor)); await assert.rejects(drive.ensure(ownId, demoActor));
  assert.equal((await google.status(demoActor)).connected, false);
  await db.campaignDriveWorkspace.create({ data: { campaignId: ownId, sharedDriveId: 'synthetic_shared_drive', parentFolderId: 'synthetic_parent_folder', campaignFolderId: 'synthetic_campaign_folder', baseDocumentsFolderId: 'synthetic_child_folder' } });
  assert.equal((await drive.listFiles(ownId, 'BASE_DOCUMENTS', 'ACTIVE', undefined, admin)).items.length, 1);
  item.parents = ['synthetic_wrong_folder'];
  await assert.rejects(drive.listFiles(ownId, 'BASE_DOCUMENTS', 'ACTIVE', undefined, admin));
  config.set('GOOGLE_PROVIDER_WRITES', 'BLOCKED');
  const saved = await orchestration.create({ name: 'QA No provider required', levelCode: 'CLV_01', code: 'QA-NO-PROVIDER' }, user);
  assert(saved.id); assert.equal(writes, 0);
  const trashed = await orchestration.moveToTrash(saved.id, admin); assert(trashed.isDeleted && trashed.driveSynchronization?.status === 'DEFERRED');
  await assert.rejects(campaigns.deletePermanently(saved.id, admin)); // Cannot bypass the verified orchestration boundary.
  const restored = await orchestration.restore(saved.id, admin); assert(!restored.isDeleted);
  assert(driveReads >= 2); assert.equal(writes, 0);
}
