import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ACCESS_PERMISSIONS, ROLE_CODES, type AccessIdentity, type AccessModule, type AccessRelation, type AccessResource, type AccessRule, type AccessScope, type ActorContext, type RoleCode } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { requireCurrentSession } from '../../identity/infrastructure/prisma-identity.repository';
import { AccessRepository, type AccessSnapshot } from '../application/access.repository';
import { ACCESS_CATALOG, DEFAULT_ROLE_PRESETS } from '../application/access-catalog';

export type PersistedScope = { scopeType: string; module: string | null; orgId: string | null; campaignId: string | null; fieldKey?: string | null };
export function accessScope(row: PersistedScope): AccessScope {
  const module = row.module?.toLowerCase() as AccessModule;
  if (row.scopeType === 'SYSTEM') return { tier: 'SYSTEM' };
  if (row.scopeType === 'MODULE') return { tier: 'MODULE', module };
  if (row.scopeType === 'MODULE_ORG' && row.orgId) return { tier: 'MODULE_ORG', module, orgId: row.orgId };
  if (row.scopeType === 'RECORD' && row.campaignId) return { tier: 'RECORD', module: 'campaign', resourceType: 'CAMPAIGN', resourceId: row.campaignId };
  if (row.scopeType === 'FIELD' && row.campaignId && row.fieldKey) return { tier: 'FIELD', module: 'campaign', resourceType: 'CAMPAIGN', resourceId: row.campaignId, fieldKey: row.fieldKey };
  throw new UnauthorizedException('Cấu hình phạm vi không hợp lệ.');
}

export interface RuleBinding extends PersistedScope { id: string; actorId: string; roleCode: string; relation: string; expiresAt: Date | null }
export interface RulePreset { id: string; roleCode: string; permissionCode: string; effect: string; relation: string }
export interface RuleOverride extends PersistedScope { id: string; actorId: string; permissionCode: string; effect: string; relation: string; relationOrgId: string | null; validFrom: Date | null; validUntil: Date | null }
/** The persisted and proposed-policy views use exactly the same rule translation. No preview writes or session substitution. */
export function persistedAccessRules(actorId: string, now: number, bindings: readonly RuleBinding[], presets: readonly RulePreset[], overrides: readonly RuleOverride[]): AccessRule[] {
  const known = (code: string) => (ACCESS_PERMISSIONS as readonly string[]).includes(code);
  return [
    ...bindings.filter((binding) => binding.actorId === actorId && (!binding.expiresAt || binding.expiresAt.getTime() > now)).flatMap((binding) => presets
      .filter((preset) => preset.roleCode === binding.roleCode && known(preset.permissionCode) && (!binding.module || binding.module.toLowerCase() === preset.permissionCode.split('.')[0]))
      .map((preset): AccessRule => ({ id: `${binding.id}:${preset.id}`, actorId, permission: preset.permissionCode as AccessRule['permission'], effect: preset.effect as AccessRule['effect'],
        scope: accessScope(binding), relation: (binding.relation === 'PRESET' ? preset.relation : binding.relation) as AccessRelation,
        ...(binding.orgId ? { relationOrgId: binding.orgId } : {}), ...(binding.expiresAt ? { validUntil: binding.expiresAt.getTime() } : {}), source: 'ROLE_BINDING' }))),
    ...overrides.filter((row) => row.actorId === actorId && known(row.permissionCode)).map((row): AccessRule => ({ id: row.id, actorId, permission: row.permissionCode as AccessRule['permission'], effect: row.effect as AccessRule['effect'],
      scope: accessScope(row), relation: row.relation as AccessRelation, ...(row.relationOrgId ? { relationOrgId: row.relationOrgId } : {}),
      ...(row.validFrom ? { validFrom: row.validFrom.getTime() } : {}), ...(row.validUntil ? { validUntil: row.validUntil.getTime() } : {}), source: 'ACCOUNT_OVERRIDE' })),
  ];
}

@Injectable()
export class PrismaAccessRepository extends AccessRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  override async moduleMetadata(): Promise<AccessResource[]> {
    const contracts=await this.prisma.database.supplyContract.findMany({select:{id:true,managerActorId:true,leaderActorId:true,vendorActorId:true,deletedAt:true,createdByActorId:true,status:true,ownerUnitCode:true,allocations:{where:{scopeKind:'ENTITLEMENT',supersededAt:null},select:{id:true,bookingAccess:true}}}});
    return contracts.flatMap(c=>{
      const allocationActors = c.allocations.flatMap(a => [a.bookingAccess?.leaderActorIds,a.bookingAccess?.operatorActorIds,a.bookingAccess?.beneficiaryActorIds,a.bookingAccess?.vendorActorIds].flatMap(ids => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []));
      const resource:AccessResource={type:'CONTRACT',id:c.id,exists:true,deleted:Boolean(c.deletedAt),createdByActorId:c.createdByActorId,state:c.status,assignedActorIds:[c.managerActorId,c.leaderActorId,c.vendorActorId,...allocationActors].filter((id):id is string=>Boolean(id)),contractEditors:[c.managerActorId,c.leaderActorId].filter((id):id is string=>Boolean(id)),contractApprovers:c.leaderActorId?[c.leaderActorId]:[],orgIds:c.ownerUnitCode?[c.ownerUnitCode]:[]};
      return [resource,...c.allocations.map(a=>{const v=a.bookingAccess;return{bookingOperators:(Array.isArray(v?.operatorActorIds)?v.operatorActorIds:[]).filter((id):id is string=>typeof id==='string'&&!(Array.isArray(v?.leaderActorIds)?v.leaderActorIds:[]).includes(id)),type:'BOOKING' as const,id:a.id,exists:true,deleted:false,createdByActorId:'',state:'ACTIVE',assignedActorIds:[c.managerActorId,...[v?.leaderActorIds,v?.operatorActorIds,v?.beneficiaryActorIds,v?.vendorActorIds].flatMap(ids=>Array.isArray(ids)?ids.filter((s):s is string=>typeof s==='string'):[])].filter((id):id is string=>Boolean(id)),orgIds:[v?.ownerDepartmentId,v?.beneficiaryDepartmentId].filter((id):id is string=>Boolean(id))};})];
    });
  }

  async execute<T>(actor: ActorContext, operation: (snapshot: AccessSnapshot) => Promise<T>): Promise<T> {
    return this.prisma.withSecurityLock(async (transaction) => {
      const now = Date.now();
      const definitions = await transaction.permissionDefinition.findMany({ select: { code: true, implementationStatus: true } });
      const policy = await transaction.accessPolicyState.findUnique({ where: { key: 'access' } });
      let identity: AccessIdentity;
      if (actor.session) {
        const session = await requireCurrentSession(transaction, actor.session.id);
        if (actor.id !== session.effective.id || actor.session.originalActorId !== session.original.id || actor.session.mode !== session.mode || session.original.credential?.mustChangePassword) throw new UnauthorizedException('Ngữ cảnh đăng nhập đã thay đổi.');
        const adminBindings = await transaction.scopedRoleBinding.findMany({ where: { actorId: { in: [session.original.id, session.effective.id] }, roleCode: 'ADMIN', scopeType: 'SYSTEM',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] }, select: { actorId: true } });
        if (session.mode !== 'DIRECT' && !adminBindings.some((binding) => binding.actorId === session.original.id)) throw new UnauthorizedException('Quyền hỗ trợ đã bị thu hồi.');
        identity = { effectiveActorId: session.effective.id, originalActorId: session.original.id, sessionValid: true,
          effectiveActive: session.effective.isActive, originalActive: session.original.isActive,
          profileComplete: session.effective.accountKind === 'PILOT_ADMIN' || Boolean(session.effective.personnelEmployeeCode && session.effective.employment), mode: session.mode,
          effectiveSuperadmin: adminBindings.some((binding) => binding.actorId === session.effective.id),
          orgIds: [session.effective.employment?.departmentId, session.effective.employment?.divisionId].filter((id): id is string => Boolean(id)) };
      } else {
        // Explicit compatibility runtime only; actor roles supplied by a caller never establish identity.
        const origin = new URL(process.env.WEB_ORIGIN ?? 'http://invalid');
        if (process.env.AUTH_MODE !== 'OPEN_DEMO' || process.env.ALLOW_OPEN_DEMO !== 'true' || process.env.NODE_ENV === 'production' ||
          !['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || actor.id !== process.env.DEMO_ACTOR_ID) throw new UnauthorizedException('Cần phiên đăng nhập hiện hành.');
        const legacy = await transaction.actor.findUnique({ where: { id: actor.id }, include: { roles: true } });
        if (!legacy?.isActive || legacy.accountKind !== 'LEGACY' || legacy.key !== 'demo-superuser' || !legacy.roles.some((role) => role.roleCode === 'ADMIN')) throw new UnauthorizedException('Không có actor demo được cấu hình.');
        identity = { effectiveActorId: legacy.id, originalActorId: legacy.id, sessionValid: true, effectiveActive: true,
          originalActive: true, profileComplete: true, mode: 'DIRECT', effectiveSuperadmin: true, orgIds: [] };
      }
      const rules = await this.rules(transaction, identity.effectiveActorId, now);
      return operation({ actor, identity, rules, now, policyVersion: policy?.recordVersion ?? 0, requiredAtCommit: [],
        implemented: new Set(definitions.filter((definition) => definition.implementationStatus === 'IMPLEMENTED').map((definition) => definition.code)) });
    });
  }

  async rules(transaction: Prisma.TransactionClient, actorId: string, now: number): Promise<AccessRule[]> {
    const bindings = await transaction.scopedRoleBinding.findMany({ where: { actorId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] }, include: { role: { include: { permissionPresets: true } } } });
    const overrides = await transaction.accountPermissionOverride.findMany({ where: { actorId } });
    return persistedAccessRules(actorId, now, bindings, [...new Map(bindings.flatMap((binding) => binding.role.permissionPresets).map((preset) => [preset.id, preset])).values()], overrides);
  }

  async describeAccount(actorId: string): Promise<{ identity: AccessIdentity; rules: AccessRule[] } | null> {
    const now = Date.now(); const tx = this.prisma.database;
    const account = await tx.actor.findUnique({ where: { id: actorId }, select: { id: true, accountKind: true, isActive: true, personnelEmployeeCode: true,
      employment: { select: { departmentId: true, divisionId: true } }, scopedBindings: { where: { roleCode: 'ADMIN', scopeType: 'SYSTEM', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] }, select: { id: true } } } });
    if (!account || !['PERSONNEL', 'PILOT_ADMIN'].includes(account.accountKind)) return null;
    // Descriptive policy facts only. This is never installed as a request/session or used to execute a command.
    return { identity: { effectiveActorId: account.id, originalActorId: account.id, sessionValid: true, effectiveActive: account.isActive, originalActive: account.isActive,
      profileComplete: account.accountKind === 'PILOT_ADMIN' || Boolean(account.personnelEmployeeCode && account.employment), mode: 'DIRECT', effectiveSuperadmin: account.scopedBindings.length > 0,
      orgIds: [account.employment?.departmentId, account.employment?.divisionId].filter((id): id is string => Boolean(id)) }, rules: await this.rules(tx, actorId, now) };
  }

  async campaignMetadata(input: { id?: string; code?: string; trash?: boolean }): Promise<AccessResource[]> {
    const now = new Date();
    const divisions = await this.prisma.database.employmentOrgUnit.findMany({ where: { kind: 'DIVISION', isActive: true }, select: { id: true, parentId: true } });
    const rows = await this.prisma.database.campaign.findMany({ where: { ...(input.id ? { id: input.id } : {}), ...(input.code ? { code: input.code } : {}),
      ...(input.trash === undefined ? {} : { deletedAt: input.trash ? { not: null } : null }) },
      select: { id: true, createdByActorId: true, lifecycleState: true, deletedAt: true,
        workflow: { select: { changeRequests: { where: { state: 'PENDING' }, select: { id: true, kind: true } }, currentRevision: { select: { state: true, route: true, receivingDepartmentId: true, receivingDivisionId: true, steps: { where: { state: 'PENDING' }, select: { orgId: true, organization: { select: { parentId: true } } } } } },
          assignments: { where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { actorId: true, orgId: true, endsAt: true, organization: { select: { parentId: true } } } } } },
        participants: { where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          select: { actorId: true, orgId: true, endsAt: true, organization: { select: { parentId: true } } } } } });
    // Only access metadata is inspected here. Full Campaign rows, names, JSON and counts are queried after visibility IDs.
    // A participating division confers a relation to its explicit parent Ban; arbitrary catalog trees do not.
    return rows.map((row) => {
      const assigned = [...row.participants, ...row.workflow?.assignments ?? []];
      const scopes = [...assigned, ...row.workflow?.currentRevision?.steps ?? []];
      const revision = row.workflow?.currentRevision;
      const reviewPool = revision?.state === 'NO_APPROVAL' && Boolean(row.workflow?.changeRequests.length) && !assigned.some(entry => entry.actorId);
      const audience = ((revision?.route === 'DIVISION' && !revision.receivingDivisionId) || reviewPool) && revision?.receivingDepartmentId && !['DRAFT','SUPERSEDED'].includes(revision.state)
        ? [revision.receivingDepartmentId, ...divisions.filter((division) => division.parentId === revision.receivingDepartmentId).map((division) => division.id)] : [];
      return { type: 'CAMPAIGN', id: row.id, exists: true, createdByActorId: row.createdByActorId,
        pendingPurgeReview: Boolean(row.workflow?.changeRequests.some(r => r.kind === 'PURGE')),
        state: row.lifecycleState, deleted: Boolean(row.deletedAt), orgIds: [...new Set([...audience, ...scopes.flatMap((entry) => [entry.orgId, entry.organization?.parentId]).filter((id): id is string => Boolean(id))])],
        assignedActorIds: [...new Set(assigned.flatMap((entry) => entry.actorId ? [entry.actorId] : []))],
        workflowEditLocked: ['PENDING','APPROVED','NEEDS_ASSIGNEE'].includes(row.workflow?.currentRevision?.state ?? ''),
        ...(assigned.some((entry) => entry.endsAt) ? { factsValidUntil: Math.min(...assigned.flatMap((entry) => entry.endsAt ? [entry.endsAt.getTime()] : [])) } : {}) };
    });
  }

  async initializeCatalog(actor: ActorContext) {
    if (!actor.session) throw new UnauthorizedException('Bootstrap quyền cần superadmin đăng nhập trực tiếp.');
    return this.prisma.withSecurityLock(async (transaction) => {
      const session = await requireCurrentSession(transaction, actor.session!.id, true);
      if (session.effective.id !== actor.id) throw new UnauthorizedException('Ngữ cảnh không khớp.');
      const definitions = await transaction.permissionDefinition.createMany({ data: ACCESS_CATALOG, skipDuplicates: true });
      const promoted = await transaction.permissionDefinition.updateMany({ where: { code: { in: ACCESS_CATALOG.filter((item) => item.implementationStatus === 'IMPLEMENTED').map((item) => item.code) }, implementationStatus: 'RESERVED' }, data: { implementationStatus: 'IMPLEMENTED' } });
      const initialized: string[] = [];
      for (const code of ROLE_CODES) {
        const role = await transaction.role.upsert({ where: { code }, create: { code, displayName: code, description: 'Preset CPMS; phạm vi theo binding tường minh.' }, update: {} });
        if (role.presetInitialized) continue;
        if (!await transaction.rolePermission.count({ where: { roleCode: code } })) {
          const presets = DEFAULT_ROLE_PRESETS[code as RoleCode] ?? [];
          if (presets.length) await transaction.rolePermission.createMany({ data: presets.map((preset) => ({ ...preset, roleCode: code })) });
        }
        await transaction.role.update({ where: { code }, data: { presetInitialized: true, recordVersion: { increment: 1 } } });
        initialized.push(code);
      }
      if (definitions.count || promoted.count || initialized.length) {
        await transaction.accessPolicyState.upsert({ where: { key: 'access' }, create: { key: 'access' }, update: { recordVersion: { increment: 1 } } });
        await transaction.actor.updateMany({ where: { accountKind: 'PERSONNEL', scopedBindings: { some: { roleCode: { in: initialized } } } }, data: { authzVersion: { increment: 1 } } });
        await transaction.auditEvent.create({ data: { actorId: session.effective.id, originalActorId: session.original.id, contextMode: session.mode,
          entityType: 'AccessPolicy', entityId: 'access', action: 'ACCESS_CATALOG_INITIALIZED', payload: { definitions: definitions.count, promotedDefinitions: promoted.count, initializedRoles: initialized, preservesExistingPresets: true } } });
      }
      return { initializedRoles: initialized.length, definitions: definitions.count, promotedDefinitions: promoted.count };
    });
  }
}
