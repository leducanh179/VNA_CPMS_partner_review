import { describe, expect, it } from 'vitest';
import { evaluateAccess, validateAccessRule, type AccessIdentity, type AccessRequest, type AccessResource, type AccessRule } from './access-policy';

const identity: AccessIdentity = {
  effectiveActorId: 'synthetic-user', originalActorId: 'synthetic-user', sessionValid: true,
  effectiveActive: true, originalActive: true, profileComplete: true, mode: 'DIRECT', effectiveSuperadmin: false, orgIds: ['division-a'],
};
const resource: AccessResource = { type: 'CAMPAIGN', id: 'campaign-a', exists: true, deleted: false, createdByActorId: 'synthetic-other', state: 'DRAFT', orgIds: ['division-a'], assignedActorIds: ['synthetic-user'] };
const request: AccessRequest = { identity, resource, permission: 'campaign.update', now: 1000 };
const rule = (id: string, changes: Partial<AccessRule> = {}): AccessRule => ({
  id, actorId: identity.effectiveActorId, permission: 'campaign.update', effect: 'ALLOW',
  scope: { tier: 'MODULE', module: 'campaign' }, relation: 'ALL', source: 'ROLE_BINDING', ...changes,
});
const read = rule('read', { permission: 'campaign.read' });
const record = { tier: 'RECORD', module: 'campaign', resourceType: 'CAMPAIGN', resourceId: resource.id } as const;
const field = { ...record, tier: 'FIELD', fieldKey: 'campaign_name' } as const;

describe('scoped policy truth table (kernel, not HTTP enforcement)', () => {
  it('permits operator creation only for the assigned allocation and keeps explicit denials', () => {
    const scoped:AccessResource={...resource,type:'BOOKING',bookingOperators:['synthetic-user']};
    expect(evaluateAccess({...request,resource:scoped,permission:'booking.create'},[]).allowed).toBe(true);
    expect(evaluateAccess({...request,resource:{...scoped,bookingOperators:[]},permission:'booking.create'},[]).allowed).toBe(false);
    const deny=rule('deny-create',{permission:'booking.create',effect:'DENY',scope:{tier:'MODULE',module:'booking'}});
    expect(evaluateAccess({...request,resource:scoped,permission:'booking.create'},[deny]).allowed).toBe(false);
    expect(evaluateAccess({...request,resource:scoped,permission:'booking.approve'},[]).allowed).toBe(false);
    expect(evaluateAccess({...request,resource:scoped,permission:'booking.purge'},[]).allowed).toBe(false);
  });
  it('permits only scoped Booking restore review in Trash and retains explicit denies', () => {
    const r:AccessResource={...resource,type:'BOOKING',deleted:true,pendingBookingRestoreReview:true};
    const allow=(permission:AccessRule['permission'],effect:AccessRule['effect']='ALLOW')=>rule(permission,{permission,effect,scope:{tier:'MODULE',module:'booking'},relation:'ASSIGNED'});
    const rules=[allow('booking.read'),allow('booking.approve'),allow('booking.update')];
    expect(evaluateAccess({...request,resource:r,permission:'booking.approve'},rules).allowed).toBe(true);
    expect(evaluateAccess({...request,resource:{...r,pendingBookingRestoreReview:false},permission:'booking.approve'},rules).reason).toBe('TRASHED');
    expect(evaluateAccess({...request,resource:r,permission:'booking.update'},rules).reason).toBe('TRASHED');
    expect(evaluateAccess({...request,resource:r,permission:'booking.approve'},[...rules,allow('booking.approve','DENY')]).allowed).toBe(false);
    expect(evaluateAccess({...request,resource:{...r,assignedActorIds:[]},permission:'booking.approve'},rules).allowed).toBe(false);
  });
  it('refuses expired participation facts even with a direct admin identity', () => {
    const expired = { ...resource, factsValidUntil: 1000 };
    expect(evaluateAccess({ ...request, resource: expired }, [read, rule('assigned', { relation: 'ASSIGNED' })]).allowed).toBe(false);
    expect(evaluateAccess({ ...request, resource: expired, identity: { ...identity, effectiveSuperadmin: true } }, []).allowed).toBe(false);
    expect(evaluateAccess({ ...request, resource: expired, now: 999 }, [read, rule('assigned', { relation: 'ASSIGNED' })]).allowed).toBe(true);
  });
  it.each([
    ['broad allow / record deny', [rule('broad'), rule('record', { scope: record, effect: 'DENY' })], false],
    ['record allow without broad update', [rule('record', { scope: record })], true],
    ['same record tier deny wins', [rule('allow', { scope: record }), rule('deny', { scope: record, effect: 'DENY' })], false],
    ['record allow / field deny', [rule('record', { scope: record }), rule('field', { scope: field, effect: 'DENY' })], false],
    ['record deny / field allow', [rule('record', { scope: record, effect: 'DENY' }), rule('field', { scope: field })], true],
    ['same field tier deny wins', [rule('allow', { scope: field }), rule('deny', { scope: field, effect: 'DENY' })], false],
    ['inherit is absence', [], false],
  ] as const)('%s independent of query order', (_label, rules, allowed) => {
    const input = { ...request, fieldKey: field.fieldKey };
    const forward = evaluateAccess(input, [read, ...rules]);
    const reverse = evaluateAccess(input, [read, ...rules].reverse());
    expect(forward.allowed).toBe(allowed);
    expect(forward).toEqual(reverse);
  });

  it('requires read even when one field is granted', () => {
    expect(evaluateAccess({ ...request, fieldKey: field.fieldKey }, [rule('field', { scope: field })]).reason).toBe('READ_REQUIRED');
  });
  it('field allow grants neither whole-record update nor a different field/record', () => {
    const rules = [read, rule('field', { scope: field })];
    expect(evaluateAccess(request, rules).allowed).toBe(false);
    expect(evaluateAccess({ ...request, fieldKey: 'kpi_primary' }, rules).allowed).toBe(false);
    expect(evaluateAccess({ ...request, resource: { ...resource, id: 'campaign-b' }, fieldKey: field.fieldKey }, rules).allowed).toBe(false);
  });
  it.each(['OWN', 'OWN_DRAFT', 'ASSIGNED', 'UNIT'] as const)('matches %s only using explicit facts', (relation) => {
    const rules = [read, rule('relationship', { relation, relationOrgId: 'division-a' })];
    const own = { ...request, resource: { ...resource, createdByActorId: identity.effectiveActorId } };
    expect(evaluateAccess(own, rules).allowed).toBe(true);
    const unrelated = { ...resource, orgIds: ['division-b'], assignedActorIds: [], createdByActorId: 'unrelated' };
    expect(evaluateAccess({ ...request, resource: unrelated }, rules).allowed).toBe(false);
    if (relation === 'OWN_DRAFT') expect(evaluateAccess({ ...own, resource: { ...own.resource, state: 'RUNNING' } }, rules).allowed).toBe(false);
  });
  it('ranks an organization module above a module but below an exact record', () => {
    const rules = [read, rule('module'), rule('org', { effect: 'DENY', scope: { tier: 'MODULE_ORG', module: 'campaign', orgId: 'division-a' } })];
    expect(evaluateAccess(request, rules).allowed).toBe(false);
    expect(evaluateAccess(request, [...rules, rule('record', { scope: record })]).allowed).toBe(true);
  });
  it('enforces validity bounds and effective identity on every evaluation', () => {
    const rules = [read, rule('timed', { validFrom: 1000, validUntil: 2000 })];
    expect(evaluateAccess({ ...request, now: 999 }, rules).allowed).toBe(false);
    expect(evaluateAccess(request, rules).allowed).toBe(true);
    expect(evaluateAccess({ ...request, now: 2000 }, rules).allowed).toBe(false);
    expect(evaluateAccess(request, [read, rule('other', { actorId: 'different-user' })]).allowed).toBe(false);
  });
  it('requires both read and trash read before restore', () => {
    const input = { ...request, resource: { ...resource, deleted: true }, permission: 'campaign.restore' as const };
    const restore = rule('restore', { permission: 'campaign.restore' });
    expect(evaluateAccess(input, [read, restore]).reason).toBe('TRASH_READ_REQUIRED');
    expect(evaluateAccess(input, [read, restore, rule('trash', { permission: 'campaign.trash.read' })]).allowed).toBe(true);
  });
  it('allows only scoped read/review of a pending purge, not unrelated trash mutations', () => {
    const input = { ...request, resource: { ...resource, deleted: true, pendingPurgeReview: true } };
    const approve = rule('approve', { permission: 'campaign.approve', relation: 'UNIT', relationOrgId: 'division-a' });
    expect(evaluateAccess({ ...input, permission: 'campaign.approve' }, [read, approve]).allowed).toBe(true);
    expect(evaluateAccess({ ...input, permission: 'campaign.approve', resource: { ...input.resource, orgIds: ['other-division'] } }, [read, approve]).allowed).toBe(false);
    expect(evaluateAccess(input, [read, rule('edit')]).reason).toBe('TRASHED');
    expect(evaluateAccess({ ...input, permission: 'campaign.restore' }, [read, rule('restore', { permission: 'campaign.restore' })]).reason).toBe('TRASH_READ_REQUIRED');
    expect(evaluateAccess({ ...input, permission: 'campaign.purge' }, [read, rule('purge', { permission: 'campaign.purge' })]).reason).toBe('DIRECT_ADMIN_REQUIRED');
    expect(evaluateAccess({ ...input, permission: 'campaign.approve', resource: { ...input.resource, pendingPurgeReview: false } }, [read, approve]).reason).toBe('TRASHED');
  });
  it('never overrides immutable gates with wildcard or a field grant', () => {
    const admin = { ...identity, effectiveSuperadmin: true };
    expect(evaluateAccess({ ...request, identity: { ...admin, sessionValid: false } }, []).reason).toBe('SESSION_REQUIRED');
    expect(evaluateAccess({ ...request, identity: { ...admin, effectiveActive: false } }, []).reason).toBe('ACCOUNT_UNAVAILABLE');
    expect(evaluateAccess({ ...request, identity: admin, resource: { ...resource, exists: false } }, []).reason).toBe('NOT_FOUND');
    expect(evaluateAccess({ ...request, identity: admin, resource: { ...resource, deleted: true } }, []).reason).toBe('TRASHED');
    expect(evaluateAccess({ ...request, identity: admin }, []).allowed).toBe(true);
  });
  it('impersonation never inherits original wildcard and blocks external writes', () => {
    const demo: AccessIdentity = { ...identity, mode: 'DEMO_IMPERSONATION', originalActorId: 'synthetic-admin', effectiveSuperadmin: true };
    expect(evaluateAccess({ ...request, identity: demo }, [read]).allowed).toBe(false);
    expect(evaluateAccess({ ...request, identity: demo }, [read, rule('target')]).allowed).toBe(true);
    expect(evaluateAccess({ ...request, identity: demo, permission: 'campaign.drive.upload' }, []).reason).toBe('IMPERSONATION_RESTRICTED');
    expect(evaluateAccess({ ...request, identity: demo, permission: 'credential.manage' }, []).reason).toBe('IMPERSONATION_RESTRICTED');
    const assist: AccessIdentity = { ...demo, mode: 'ADMIN_ASSIST' };
    expect(evaluateAccess({ ...request, identity: assist }, [read]).allowed).toBe(false);
    expect(evaluateAccess({ ...request, identity: assist }, [read, rule('target')]).allowed).toBe(true);
    expect(evaluateAccess({ ...request, identity: assist, permission: 'google.connect' }, []).reason).toBe('IMPERSONATION_RESTRICTED');
    expect(evaluateAccess({ ...request, identity: assist, permission: 'access.manage' }, []).reason).toBe('IMPERSONATION_RESTRICTED');
  });
  it('rejects malformed scopes rather than silently dropping a deny', () => {
    const malformed = rule('bad', { scope: { ...field, resourceId: '' }, effect: 'DENY' });
    expect(validateAccessRule(malformed)).toContain('RESOURCE_REQUIRED');
    expect(evaluateAccess(request, [read, rule('allow'), malformed]).reason).toBe('INVALID_POLICY');
  });
  it('requires direct admin for purge even with an ordinary grant', () => {
    expect(evaluateAccess({ ...request, permission: 'campaign.purge' }, [read, rule('purge', { permission: 'campaign.purge' })]).reason).toBe('DIRECT_ADMIN_REQUIRED');
  });
});
