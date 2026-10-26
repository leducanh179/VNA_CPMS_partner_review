import { describe, expect, it } from 'vitest';
import type { AccessDecision, AccessIdentity } from './access-policy';
import { legacyMaterialSharing, materialSharingCapabilities, type MaterialSharing } from './material-sharing';

const allow: AccessDecision = { allowed: true, reason: 'ALLOW', tier: 'MODULE', ruleIds: [] };
const absent: AccessDecision = { allowed: false, reason: 'DEFAULT_DENY', tier: null, ruleIds: [] };
const deny: AccessDecision = { ...absent, reason: 'EXPLICIT_DENY' };
const identity: AccessIdentity = { effectiveActorId: 'reader', originalActorId: 'reader', sessionValid: true, effectiveActive: true, originalActive: true, profileComplete: true, mode: 'DIRECT', effectiveSuperadmin: false, orgIds: [] };
const sharing: MaterialSharing = { mode: 'SHARED', ownerActorId: 'author', campaignIds: [], grants: [] };
function input() { return { sharing: { ...sharing }, deleted: false, identity: { ...identity },
  decisions: { read: absent, update: allow, manage: absent, publish: allow, delete: allow, restore: allow, systemManage: absent },
  readableCampaignIds: new Set<string>(), editableCampaignIds: new Set<string>() }; }

describe('Material sharing policy', () => {
  it('M01/M02/M18: SHARED view needs no module read or campaign grant, preserves existing specialist edit policy', () => {
    expect(materialSharingCapabilities(input())).toMatchObject({ view: true, edit: true, manageSharing: false });
  });
  it('M06/M07: campaign audiences are a live union, never an intersection', () => {
    const value = input(); value.sharing = { ...sharing, mode: 'CAMPAIGN', campaignIds: ['a', 'b'] };
    expect(materialSharingCapabilities(value).view).toBe(false);
    value.readableCampaignIds.add('b');
    expect(materialSharingCapabilities(value)).toMatchObject({ view: true, edit: false });
    value.readableCampaignIds.clear();
    expect(materialSharingCapabilities(value).view).toBe(false);
  });
  it('M08: business campaign refs cannot participate in the sharing policy', () => {
    expect(materialSharingCapabilities({ ...input(), sharing: { ...sharing, mode: 'CAMPAIGN', campaignIds: ['separate'] }, readableCampaignIds: new Set(['business-only']) }).view).toBe(false);
  });
  it('M09/M10: VIEW grants cannot inherit broad pilot edit presets; EDIT and MANAGE_SHARING are separate', () => {
    const value = input(); value.sharing = { ...sharing, mode: 'RESTRICTED', grants: [{ kind: 'ACCOUNT', id: 'reader', permission: 'VIEW' }] };
    expect(materialSharingCapabilities(value)).toMatchObject({ view: true, edit: false, manageSharing: false, delete: false });
    value.sharing.grants[0]!.permission = 'EDIT';
    expect(materialSharingCapabilities(value)).toMatchObject({ edit: true, manageSharing: false });
    value.sharing.grants[0]!.permission = 'MANAGE_SHARING';
    expect(materialSharingCapabilities(value)).toMatchObject({ edit: false, manageSharing: true });
  });
  it('M09/M12: membership or grant revocation affects the next evaluation', () => {
    const value = input(); value.sharing = { ...sharing, mode: 'RESTRICTED', grants: [{ kind: 'ORG', id: 'team', permission: 'EDIT' }] };
    value.identity.orgIds = ['team']; expect(materialSharingCapabilities(value).edit).toBe(true);
    value.identity.orgIds = []; expect(materialSharingCapabilities(value).view).toBe(false);
    value.identity.orgIds = ['team']; value.sharing.grants = []; expect(materialSharingCapabilities(value).view).toBe(false);
  });
  it('M11: account ceilings and explicit denies survive ownership, grants and broad presets', () => {
    const value = input(); value.sharing.ownerActorId = 'reader';
    value.identity.readOnlyDemo = true; expect(materialSharingCapabilities(value)).toMatchObject({ view: true, edit: false, manageSharing: false, publish: false });
    value.identity.readOnlyDemo = false; value.decisions.read = deny; expect(materialSharingCapabilities(value).view).toBe(false);
    value.decisions.read = allow; value.decisions.update = deny; expect(materialSharingCapabilities(value).edit).toBe(false);
  });
  it('M14: trash hides SHARED even from its author unless authorized for management', () => {
    const value = input(); value.deleted = true; value.sharing.ownerActorId = 'reader';
    expect(materialSharingCapabilities(value).view).toBe(false);
    value.decisions.manage = allow; expect(materialSharingCapabilities(value)).toMatchObject({ view: true, edit: false, restore: true });
  });
  it('M17: legacy keeps the old module scope and unknown owner is never inferred', () => {
    const value = input(); value.sharing = legacyMaterialSharing();
    expect(materialSharingCapabilities(value).view).toBe(false);
    value.decisions.read = allow; expect(materialSharingCapabilities(value)).toMatchObject({ view: true, edit: true, manageSharing: false });
  });
  it('M09: empty RESTRICTED grants leave author and authorized manager only', () => {
    const value = input(); value.sharing = { ...sharing, mode: 'RESTRICTED' };
    expect(materialSharingCapabilities(value).view).toBe(false);
    value.sharing.ownerActorId = 'reader'; expect(materialSharingCapabilities(value).manageSharing).toBe(true);
  });
});
