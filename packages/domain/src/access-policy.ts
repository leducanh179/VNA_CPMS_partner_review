/** Pure policy kernel. Callers must supply server-resolved, current facts.
 * This does not replace transactional enforcement or query visibility adapters. */
export const ACCESS_PERMISSIONS = [
  'catalog.manage', 'catalog.purge',
  'booking.read', 'booking.create', 'booking.update', 'booking.delete', 'booking.restore', 'booking.purge', 'booking.report', 'booking.manage',
  'booking.submit', 'booking.approve', 'booking.confirm', 'booking.report.approve', 'booking.policy.manage',
  'contract.read', 'contract.create', 'contract.update', 'contract.allocate', 'contract.approve', 'contract.import', 'contract.export',
  'contract.delete', 'contract.restore', 'contract.purge', 'contract.policy.manage',
  'campaign.read', 'campaign.create', 'campaign.update', 'campaign.delete',
  'campaign.trash.read', 'campaign.restore', 'campaign.purge', 'campaign.export', 'campaign.import',
  'campaign.comment', 'campaign.comment.moderate', 'campaign.journal.read',
  'campaign.submit', 'campaign.approve', 'campaign.assign', 'campaign.cooperate',
  'campaign.policy.manage', 'campaign.access.manage',
  'campaign.drive.read', 'campaign.drive.ensure', 'campaign.drive.upload',
  'campaign.drive.rename', 'campaign.drive.trash', 'campaign.drive.restore',
  'campaign.sheets.read', 'campaign.sheets.write',
  'material.read', 'material.create', 'material.update', 'material.approve',
  'material.publish', 'material.delete', 'material.restore', 'material.manage',
  'access.manage', 'credential.manage', 'system.manage', 'google.connect', 'google.revoke',
] as const;
export type AccessPermission = typeof ACCESS_PERMISSIONS[number];
export type AccessModule = 'campaign' | 'material' | 'contract' | 'booking' | 'access' | 'credential' | 'system' | 'google' | 'catalog';
export type AccessRelation = 'ALL' | 'OWN' | 'OWN_DRAFT' | 'ASSIGNED' | 'UNIT';
export type AccessScope =
  | { tier: 'SYSTEM' }
  | { tier: 'MODULE'; module: AccessModule }
  | { tier: 'MODULE_ORG'; module: AccessModule; orgId: string }
  | { tier: 'RECORD'; module: 'campaign'; resourceType: 'CAMPAIGN'; resourceId: string }
  | { tier: 'FIELD'; module: 'campaign'; resourceType: 'CAMPAIGN'; resourceId: string; fieldKey: string };

export interface AccessRule {
  id: string;
  actorId: string;
  permission: AccessPermission;
  effect: 'ALLOW' | 'DENY';
  scope: AccessScope;
  relation: AccessRelation;
  /** Required for UNIT; scopes are resolved IDs, not labels. */
  relationOrgId?: string;
  validFrom?: number;
  validUntil?: number;
  source: 'ROLE_BINDING' | 'ACCOUNT_OVERRIDE';
}

export interface AccessIdentity {
  effectiveActorId: string;
  originalActorId: string;
  sessionValid: boolean;
  effectiveActive: boolean;
  originalActive: boolean;
  profileComplete: boolean;
  mode: 'DIRECT' | 'DEMO_IMPERSONATION' | 'ADMIN_ASSIST';
  effectiveSuperadmin: boolean;
  orgIds: readonly string[];
}

export interface AccessResource {
  type: 'CAMPAIGN' | 'CONTRACT' | 'BOOKING';
  id: string;
  exists: boolean;
  deleted: boolean;
  /** Server-only fact: an explicit pending purge review allows scoped read/approve, never edit/restore/purge. */
  pendingPurgeReview?: boolean;
  /** Server-derived pending Booking restore: allows scoped read/approve, never other writes to Trash. */
  pendingBookingRestoreReview?: boolean;
  createdByActorId: string;
  state: string;
  /** Only explicit receiving/participating employment orgs, never arbitrary parent relations. */
  orgIds: readonly string[];
  assignedActorIds: readonly string[];
  /** Contract-scoped functional assignments, resolved by the server; never supplied by clients. */
  contractEditors?: readonly string[];
  contractApprovers?: readonly string[];
  /** Exact allocation operators, excluding its leaders; never supplied by clients. */
  bookingOperators?: readonly string[];
  /** Earliest expiry of the server-resolved participation facts. Callers must refresh after this deadline. */
  factsValidUntil?: number;
  /** A workflow subject can only be edited after an explicit withdrawal/new revision. */
  workflowEditLocked?: boolean;
}

export interface AccessRequest {
  identity: AccessIdentity;
  permission: AccessPermission;
  resource?: AccessResource;
  fieldKey?: string;
  now: number;
}

export interface AccessDecision {
  allowed: boolean;
  reason: 'ALLOW' | 'EXPLICIT_DENY' | 'DEFAULT_DENY' | 'SESSION_REQUIRED' | 'ACCOUNT_UNAVAILABLE'
    | 'NOT_FOUND' | 'TRASHED' | 'READ_REQUIRED' | 'TRASH_READ_REQUIRED' | 'DIRECT_ADMIN_REQUIRED'
    | 'IMPERSONATION_RESTRICTED' | 'INVALID_POLICY' | 'UNKNOWN_PERMISSION' | 'SUPERADMIN';
  tier: AccessScope['tier'] | null;
  ruleIds: string[];
}

const tiers = { SYSTEM: 1, MODULE: 2, MODULE_ORG: 3, RECORD: 4, FIELD: 5 } as const;
const adminOnly = new Set<AccessPermission>([
  'catalog.purge',
  'access.manage', 'credential.manage', 'system.manage', 'campaign.purge',
  'campaign.policy.manage', 'campaign.access.manage', 'campaign.comment.moderate',
  'contract.purge', 'contract.policy.manage',
]);
const impersonationBlocked = new Set<AccessPermission>([
  ...adminOnly, 'google.connect', 'google.revoke', 'campaign.sheets.write',
  'campaign.drive.ensure', 'campaign.drive.upload', 'campaign.drive.rename',
  'campaign.drive.trash', 'campaign.drive.restore',
]);
const trashActions = new Set<AccessPermission>([
  'booking.read', 'booking.restore', 'booking.purge',
  'campaign.read', 'campaign.trash.read', 'campaign.restore', 'campaign.purge',
  'contract.read', 'contract.approve', 'contract.restore', 'contract.purge',
]);

/** Structural validation only. Persistence adapters must additionally verify registry keys and org/resource foreign identities. */
export function validateAccessRule(rule: AccessRule): string[] {
  const errors: string[] = [];
  if (!rule.id || !rule.actorId) errors.push('RULE_IDENTITY_REQUIRED');
  if (!(ACCESS_PERMISSIONS as readonly string[]).includes(rule.permission)) errors.push('UNKNOWN_PERMISSION');
  if (!['ALLOW', 'DENY'].includes(rule.effect)) errors.push('INVALID_EFFECT');
  if (!['ALL', 'OWN', 'OWN_DRAFT', 'ASSIGNED', 'UNIT'].includes(rule.relation)) errors.push('INVALID_RELATION');
  if (rule.relation === 'UNIT' && !rule.relationOrgId) errors.push('UNIT_REQUIRED');
  const scope = rule.scope;
  if (!(scope.tier in tiers)) errors.push('INVALID_SCOPE');
  if (scope.tier !== 'SYSTEM' && scope.module !== rule.permission.split('.')[0]) errors.push('MODULE_MISMATCH');
  if (scope.tier === 'MODULE_ORG' && !scope.orgId) errors.push('ORG_REQUIRED');
  if (scope.tier === 'RECORD' || scope.tier === 'FIELD') {
    if (!scope.resourceId || scope.resourceType !== 'CAMPAIGN' || scope.module !== 'campaign') errors.push('RESOURCE_REQUIRED');
  }
  if (scope.tier === 'FIELD' && (!scope.fieldKey || rule.permission !== 'campaign.update')) errors.push('INVALID_FIELD_SCOPE');
  for (const value of [rule.validFrom, rule.validUntil]) {
    if (value !== undefined && !Number.isFinite(value)) errors.push('INVALID_TIME');
  }
  if (rule.validFrom !== undefined && rule.validUntil !== undefined && rule.validUntil <= rule.validFrom) errors.push('INVALID_TIME_RANGE');
  return errors;
}

function matches(rule: AccessRule, request: AccessRequest): boolean {
  if (rule.actorId !== request.identity.effectiveActorId || rule.permission !== request.permission) return false;
  if (rule.validFrom !== undefined && request.now < rule.validFrom) return false;
  if (rule.validUntil !== undefined && request.now >= rule.validUntil) return false;
  const { scope, relation } = rule;
  const resource = request.resource;
  if (scope.tier !== 'SYSTEM' && scope.module !== request.permission.split('.')[0]) return false;
  if (scope.tier === 'MODULE_ORG' && !resource?.orgIds.includes(scope.orgId)) return false;
  if ((scope.tier === 'RECORD' || scope.tier === 'FIELD') &&
      (!resource || scope.resourceType !== resource.type || scope.resourceId !== resource.id)) return false;
  if (scope.tier === 'FIELD' && scope.fieldKey !== request.fieldKey) return false;
  switch (relation) {
    case 'ALL': return true;
    case 'OWN': return resource?.createdByActorId === request.identity.effectiveActorId;
    case 'OWN_DRAFT': return resource?.createdByActorId === request.identity.effectiveActorId && ['DRAFT', 'RETURNED'].includes(resource.state);
    case 'ASSIGNED': return resource?.assignedActorIds.includes(request.identity.effectiveActorId) ?? false;
    case 'UNIT': return Boolean(rule.relationOrgId && request.identity.orgIds.includes(rule.relationOrgId) && resource?.orgIds.includes(rule.relationOrgId));
  }
}

function result(reason: AccessDecision['reason'], allowed = false, tier: AccessDecision['tier'] = null, ruleIds: string[] = []): AccessDecision {
  return { allowed, reason, tier, ruleIds };
}

function evaluateRuleTier(request: AccessRequest, rules: readonly AccessRule[]): AccessDecision {
  const matched = rules.filter((rule) => matches(rule, request));
  const r = request.resource, id = request.identity.effectiveActorId, p = request.permission;
  // Assignment supplies only a lowest-tier default. Explicit denies at this or higher tiers remain effective.
  if (r?.type === 'BOOKING' && r.bookingOperators?.includes(id) && ['booking.read','booking.create','booking.update','booking.submit','booking.delete','booking.restore'].includes(p)) {
    matched.push({ id: `booking-operator:${r.id}:${p}`, actorId: id, permission: p, effect: 'ALLOW', scope: { tier: 'SYSTEM' }, relation: 'ASSIGNED', source: 'ROLE_BINDING' });
  }
  if (r?.type === 'CONTRACT' && r.assignedActorIds.includes(id) &&
      (['contract.read', 'contract.export'].includes(p) || ['contract.update', 'contract.delete', 'contract.restore'].includes(p) && r.contractEditors?.includes(id) || p === 'contract.approve' && r.contractApprovers?.includes(id))) {
    matched.push({ id: `contract-assignment:${r.id}:${p}`, actorId: id, permission: p, effect: 'ALLOW', scope: { tier: 'SYSTEM' }, relation: 'ASSIGNED', source: 'ROLE_BINDING' });
  }
  // During the Material specialist-workflow pilot, every active signed-in account
  // can view, create and correct Material records. Explicit policy denies still win.
  if (!matched.length && ['material.read', 'material.create', 'material.update'].includes(p)) return result('ALLOW', true, 'SYSTEM');
  if (!matched.length) return result('DEFAULT_DENY');
  const rank = Math.max(...matched.map((rule) => tiers[rule.scope.tier]));
  const selected = matched.filter((rule) => tiers[rule.scope.tier] === rank);
  const denied = selected.some((rule) => rule.effect === 'DENY');
  return result(denied ? 'EXPLICIT_DENY' : 'ALLOW', !denied, selected[0]!.scope.tier, selected.map((rule) => rule.id).sort());
}

export function evaluateAccess(request: AccessRequest, rules: readonly AccessRule[]): AccessDecision {
  const { identity, resource, permission } = request;
  if (!identity.sessionValid || !identity.effectiveActorId || !identity.originalActorId ||
      (identity.mode === 'DIRECT' && identity.originalActorId !== identity.effectiveActorId)) return result('SESSION_REQUIRED');
  if (!identity.effectiveActive || !identity.originalActive || !identity.profileComplete) return result('ACCOUNT_UNAVAILABLE');
  if (!(ACCESS_PERMISSIONS as readonly string[]).includes(permission)) return result('UNKNOWN_PERMISSION');
  if (resource && !resource.exists) return result('NOT_FOUND');
  if (resource?.factsValidUntil !== undefined && (!Number.isFinite(resource.factsValidUntil) || request.now >= resource.factsValidUntil)) return result('INVALID_POLICY');
  const purgeReview = resource?.pendingPurgeReview === true && ['campaign.read','campaign.approve'].includes(permission)
    || resource?.type === 'BOOKING' && resource.pendingBookingRestoreReview === true && ['booking.read','booking.approve'].includes(permission);
  if (resource?.deleted && !trashActions.has(permission) && !purgeReview) return result('TRASHED');
  if (identity.mode !== 'DIRECT' && impersonationBlocked.has(permission)) return result('IMPERSONATION_RESTRICTED');
  if (identity.effectiveSuperadmin && identity.mode === 'DIRECT') return result('SUPERADMIN', true);
  if (resource?.type === 'CONTRACT' && !resource.assignedActorIds.includes(identity.effectiveActorId)) return result('DEFAULT_DENY');
  if (adminOnly.has(permission)) return result('DIRECT_ADMIN_REQUIRED');
  if (!Number.isFinite(request.now) || rules.some((rule) => validateAccessRule(rule).length > 0)) return result('INVALID_POLICY');
  const readPermission = resource?.type === 'BOOKING' ? 'booking.read' : resource?.type === 'CONTRACT' ? 'contract.read' : 'campaign.read';
  if (resource && permission !== readPermission) {
    const read = evaluateRuleTier({ identity, resource, now: request.now, permission: readPermission }, rules);
    if (!read.allowed) return result('READ_REQUIRED');
  }
  if (resource?.deleted && permission !== 'campaign.trash.read' && !purgeReview) {
    const trash = evaluateRuleTier({ identity, resource, now: request.now, permission: resource.type === 'BOOKING' ? 'booking.read' : resource.type === 'CONTRACT' ? 'contract.read' : 'campaign.trash.read' }, rules);
    if (!trash.allowed) return result('TRASH_READ_REQUIRED');
  }
  return evaluateRuleTier(request, rules);
}
