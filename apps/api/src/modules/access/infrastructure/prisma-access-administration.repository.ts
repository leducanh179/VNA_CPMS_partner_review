import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AccessAdministrationRepository, type AccessChangePreview } from '../application/access-administration.repository';
import type { ManagedAccessChange, ManagedAccessCommand, ManagedPreset } from '../application/access-administration';
import { persistedAccessRules, type RuleBinding, type RuleOverride, type RulePreset } from './prisma-access.repository';

const iso = (date: Date | null) => date?.toISOString() ?? null;
const presets = (rows: ManagedPreset[]) => [...rows].map(({ permissionCode, effect, relation, defaultScope }) => ({ permissionCode, effect, relation, defaultScope })).sort((a,b) => `${a.permissionCode}:${a.relation}`.localeCompare(`${b.permissionCode}:${b.relation}`));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class PrismaAccessAdministrationRepository extends AccessAdministrationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  async read(filters: { actorId?: string; campaignId?: string }) {
    const tx = this.prisma.database;
    const [state, definitions, roles, bindings, overrides, accounts, organizations, history, pendingContacts] = await Promise.all([
      tx.accessPolicyState.findUnique({ where: { key: 'access' } }),
      tx.permissionDefinition.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] }),
      tx.role.findMany({ include: { permissionPresets: true }, orderBy: { code: 'asc' } }),
      tx.scopedRoleBinding.findMany({ where: filters, orderBy: { createdAt: 'asc' } }),
      tx.accountPermissionOverride.findMany({ where: filters, orderBy: { id: 'asc' } }),
      tx.actor.findMany({ where: { accountKind: 'PERSONNEL' }, select: { id: true, displayName: true, loginEmail: true, personnelEmployeeCode: true, isActive: true, authzVersion: true,
        personnel: { select: { organizationName: true, departmentName: true, jobTitle: true } }, employment: { select: { departmentId: true, divisionId: true } } }, orderBy: { displayName: 'asc' } }),
      tx.employmentOrgUnit.findMany({ select: { id: true, parentId: true, kind: true, sourceName: true, catalogOrganizationCode: true }, orderBy: [{ kind: 'asc' }, { sourceName: 'asc' }] }),
      tx.auditEvent.findMany({ where: { entityType: 'AccessPolicy' }, select: { id: true, action: true, actorId: true, originalActorId: true, contextMode: true, createdAt: true, payload: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      tx.pendingDirectoryContact.findMany({ select: { email: true, sourceSheet: true, sourceRow: true }, orderBy: { email: 'asc' } }),
    ]);
    return { version: state?.recordVersion ?? 0, definitions, roles, bindings, overrides, accounts, organizations, history, pendingContacts };
  }

  private async prepare(command: ManagedAccessCommand): Promise<{ command: ManagedAccessChange; diff: AccessChangePreview }[]> {
    const tx = this.prisma.database;
    const state = await tx.accessPolicyState.findUnique({ where: { key: 'access' } });
    if (!state || state.recordVersion !== command.expectedVersion) throw new ConflictException('Cấu hình quyền đã thay đổi. Hãy tải lại.');
    const definitions = new Map((await tx.permissionDefinition.findMany()).map((item) => [item.code, item]));
    const output: { command: ManagedAccessChange; diff: AccessChangePreview }[] = [];
    for (const change of command.changes) {
      let before: unknown; let after: unknown; let key: string;
      if (change.kind === 'ROLE_PRESET') {
        if (!await tx.role.findUnique({ where: { code: change.roleCode } })) throw new NotFoundException('Role không tồn tại.');
        for (const permission of change.permissions) {
          const definition = definitions.get(permission.permissionCode);
          if (!definition || !definition.supportedScopes.includes(permission.defaultScope)) throw new BadRequestException('Permission hoặc scope mặc định chưa được định nghĩa.');
          if (permission.relation === 'UNIT' && await tx.scopedRoleBinding.count({ where: { roleCode: change.roleCode, relation: 'PRESET', orgId: null } })) throw new BadRequestException('Preset UNIT cần sửa các binding thiếu đơn vị trước.');
        }
        before = presets((await tx.rolePermission.findMany({ where: { roleCode: change.roleCode } })).map((row) => ({ ...row, effect: row.effect as 'ALLOW' | 'DENY' })));
        after = presets(change.permissions); key = `preset:${change.roleCode}`;
      } else {
        const target = await tx.actor.findUnique({ where: { id: change.actorId }, select: { accountKind: true, employment: { select: { departmentId: true, divisionId: true } } } });
        if (!target || target.accountKind !== 'PERSONNEL' || !target.employment) throw new BadRequestException('Cần hồ sơ account đầy đủ, không dùng contact chờ bổ sung.');
        if (change.scope.campaignId && !await tx.campaign.findUnique({ where: { id: change.scope.campaignId }, select: { id: true } })) throw new NotFoundException('Campaign không tồn tại.');
        if (change.scope.orgId && !await tx.employmentOrgUnit.findUnique({ where: { id: change.scope.orgId }, select: { id: true } })) throw new BadRequestException('Đơn vị không tồn tại.');
        if (change.kind === 'ROLE_BINDING') {
          const role = await tx.role.findUnique({ where: { code: change.roleCode }, include: { permissionPresets: true } });
          if (!role) throw new BadRequestException('Role không tồn tại.');
          if (change.relation === 'PRESET' && role.permissionPresets.some((permission) => permission.relation === 'UNIT') && !change.scope.orgId) throw new BadRequestException('Role này cần scope đơn vị cụ thể.');
          if ((change.roleCode === 'DIVISION_LEADER' || change.roleCode === 'DEPARTMENT_LEADER') &&
            (change.scope.scopeType !== 'MODULE_ORG' || change.scope.module !== 'CAMPAIGN' || change.scope.orgId !== (change.roleCode === 'DIVISION_LEADER' ? target.employment.divisionId : target.employment.departmentId))) throw new BadRequestException('Role lãnh đạo phải gắn đúng Ban/Phòng hiện hành của hồ sơ.');
          const current = await tx.scopedRoleBinding.findUnique({ where: { actorId_roleCode_scopeKey: { actorId: change.actorId, roleCode: change.roleCode, scopeKey: change.scope.scopeKey } } });
          before = current ? { state: 'BOUND', relation: current.relation, expiresAt: iso(current.expiresAt) } : null;
          after = change.state === 'INHERIT' ? null : { state: 'BOUND', relation: change.relation, expiresAt: change.expiresAt };
          key = `binding:${change.actorId}:${change.roleCode}:${change.scope.scopeKey}`;
        } else {
          const definition = definitions.get(change.permissionCode);
          if (!definition || !definition.supportedScopes.includes(change.scope.scopeType)) throw new BadRequestException('Permission hoặc loại scope chưa được định nghĩa.');
          if (change.relationOrgId && ![target.employment.departmentId,target.employment.divisionId].includes(change.relationOrgId)) throw new BadRequestException('Quan hệ UNIT phải khớp membership hiện hành.');
          const current = await tx.accountPermissionOverride.findUnique({ where: { actorId_permissionCode_scopeKey: { actorId: change.actorId, permissionCode: change.permissionCode, scopeKey: change.scope.scopeKey } } });
          before = current ? { state: current.effect, relation: current.relation, relationOrgId: current.relationOrgId, validFrom: iso(current.validFrom), validUntil: iso(current.validUntil) } : null;
          after = change.state === 'INHERIT' ? null : { state: change.state, relation: change.relation, relationOrgId: change.relationOrgId, validFrom: change.validFrom, validUntil: change.validUntil };
          key = `override:${change.actorId}:${change.permissionCode}:${change.scope.scopeKey}`;
        }
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) output.push({ command: change, diff: { kind: change.kind, key, actorId: change.kind === 'ROLE_PRESET' ? null : change.actorId, before, after } });
    }
    return output;
  }

  async preview(command: ManagedAccessCommand) { return (await this.prepare(command)).map((item) => item.diff); }
  async projectRules(command: ManagedAccessCommand) {
    const tx = this.prisma.database; const now = Date.now();
    const roleCodes = command.changes.flatMap((change) => change.kind === 'ROLE_PRESET' ? [change.roleCode] : []);
    const affected = new Set(command.changes.flatMap((change) => change.kind === 'ROLE_PRESET' ? [] : [change.actorId]));
    for (const binding of await tx.scopedRoleBinding.findMany({ where: { roleCode: { in: roleCodes } }, select: { actorId: true } })) affected.add(binding.actorId);
    const [oldBindings, oldOverrides, oldPresets] = await Promise.all([
      tx.scopedRoleBinding.findMany({ where: { actorId: { in: [...affected] } } }),
      tx.accountPermissionOverride.findMany({ where: { actorId: { in: [...affected] } } }), tx.rolePermission.findMany(),
    ]);
    let bindings: RuleBinding[] = oldBindings; let overrides: RuleOverride[] = oldOverrides; let projectedPresets: RulePreset[] = oldPresets;
    const sameScope = (row: RuleBinding | RuleOverride, change: Exclude<ManagedAccessChange, { kind: 'ROLE_PRESET' }>) =>
      row.scopeType === change.scope.scopeType && row.module === change.scope.module && row.orgId === change.scope.orgId && row.campaignId === change.scope.campaignId && (row.fieldKey ?? null) === change.scope.fieldKey;
    for (const [index, change] of command.changes.entries()) {
      const id = `proposed:${index}`;
      if (change.kind === 'ROLE_PRESET') projectedPresets = [...projectedPresets.filter((row) => row.roleCode !== change.roleCode), ...change.permissions.map((row, n) => ({ ...row, roleCode: change.roleCode, id: `${id}:${n}` }))];
      else if (change.kind === 'ROLE_BINDING') {
        bindings = bindings.filter((row) => !(row.actorId === change.actorId && row.roleCode === change.roleCode && sameScope(row, change)));
        if (change.state !== 'INHERIT') bindings.push({ ...change.scope, id, actorId: change.actorId, roleCode: change.roleCode, relation: change.relation, expiresAt: change.expiresAt ? new Date(change.expiresAt) : null });
      } else {
        overrides = overrides.filter((row) => !(row.actorId === change.actorId && row.permissionCode === change.permissionCode && sameScope(row, change)));
        if (change.state !== 'INHERIT') overrides.push({ ...change.scope, id, actorId: change.actorId, permissionCode: change.permissionCode, effect: change.state, relation: change.relation, relationOrgId: change.relationOrgId,
          validFrom: change.validFrom ? new Date(change.validFrom) : null, validUntil: change.validUntil ? new Date(change.validUntil) : null });
      }
    }
    return [...affected].map((actorId) => ({ actorId, before: persistedAccessRules(actorId, now, oldBindings, oldPresets, oldOverrides), after: persistedAccessRules(actorId, now, bindings, projectedPresets, overrides) }));
  }
  async save(command: ManagedAccessCommand, actor: ActorContext) {
    const planned = await this.prepare(command); const tx = this.prisma.database;
    if (!planned.length) return { version: command.expectedVersion, changes: [] };
    const version = await tx.accessPolicyState.updateMany({ where: { key: 'access', recordVersion: command.expectedVersion }, data: { recordVersion: { increment: 1 } } });
    if (version.count !== 1) throw new ConflictException('Quyền vừa thay đổi. Hãy tải lại trước khi lưu.');
    const affected = new Set<string>();
    for (const { command: change } of planned) {
      if (change.kind === 'ROLE_PRESET') {
        for (const binding of await tx.scopedRoleBinding.findMany({ where: { roleCode: change.roleCode }, select: { actorId: true } })) affected.add(binding.actorId);
        await tx.rolePermission.deleteMany({ where: { roleCode: change.roleCode } });
        if (change.permissions.length) await tx.rolePermission.createMany({ data: change.permissions.map((permission) => ({ roleCode: change.roleCode, ...permission })) });
        await tx.role.update({ where: { code: change.roleCode }, data: { presetInitialized: true, recordVersion: { increment: 1 } } });
      } else if (change.kind === 'ROLE_BINDING') {
        affected.add(change.actorId);
        const key = { actorId: change.actorId, roleCode: change.roleCode, scopeKey: change.scope.scopeKey };
        if (change.state === 'INHERIT') await tx.scopedRoleBinding.deleteMany({ where: key });
        else {
          const data = { relation: change.relation, expiresAt: change.expiresAt ? new Date(change.expiresAt) : null };
          await tx.scopedRoleBinding.upsert({ where: { actorId_roleCode_scopeKey: key }, create: { ...key, scopeType: change.scope.scopeType, module: change.scope.module, orgId: change.scope.orgId, campaignId: change.scope.campaignId, ...data }, update: { ...data, recordVersion: { increment: 1 } } });
        }
      } else {
        affected.add(change.actorId);
        const key = { actorId: change.actorId, permissionCode: change.permissionCode, scopeKey: change.scope.scopeKey };
        if (change.state === 'INHERIT') await tx.accountPermissionOverride.deleteMany({ where: key });
        else {
          const data = { effect: change.state, relation: change.relation, relationOrgId: change.relationOrgId, validFrom: change.validFrom ? new Date(change.validFrom) : null, validUntil: change.validUntil ? new Date(change.validUntil) : null };
          await tx.accountPermissionOverride.upsert({ where: { actorId_permissionCode_scopeKey: key }, create: { ...key, scopeType: change.scope.scopeType, module: change.scope.module, orgId: change.scope.orgId, campaignId: change.scope.campaignId, fieldKey: change.scope.fieldKey, ...data }, update: { ...data, recordVersion: { increment: 1 } } });
        }
      }
    }
    await tx.actor.updateMany({ where: { id: { in: [...affected] } }, data: { authzVersion: { increment: 1 } } });
    const changes = planned.map((item) => item.diff);
    await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT',
      entityType: 'AccessPolicy', entityId: 'access', action: 'ACCESS_POLICY_CHANGED', payload: json({ reason: command.reason, expectedVersion: command.expectedVersion, version: command.expectedVersion + 1, changes }) } });
    return { version: command.expectedVersion + 1, changes };
  }
}
