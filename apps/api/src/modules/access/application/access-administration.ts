import { BadRequestException } from '@nestjs/common';
import { CAMPAIGN_ACCESS_FIELD_ALIASES, CAMPAIGN_FIELD_BY_KEY, ROLE_CODES, canonicalCampaignFieldKey, isProtectedCampaignField } from '@cpms/domain';

export interface ManagedScope { scopeType: 'SYSTEM' | 'MODULE' | 'MODULE_ORG' | 'RECORD' | 'FIELD'; module: string | null; orgId: string | null; campaignId: string | null; fieldKey: string | null; scopeKey: string }
export interface ManagedPreset { permissionCode: string; effect: 'ALLOW' | 'DENY'; relation: string; defaultScope: string }
export type ManagedAccessChange =
  | { kind: 'ROLE_PRESET'; roleCode: string; permissions: ManagedPreset[] }
  | { kind: 'ROLE_BINDING'; actorId: string; roleCode: string; scope: ManagedScope; relation: string; expiresAt: string | null; state: 'BOUND' | 'INHERIT' }
  | { kind: 'OVERRIDE'; actorId: string; permissionCode: string; scope: ManagedScope; relation: string; relationOrgId: string | null; validFrom: string | null; validUntil: string | null; state: 'ALLOW' | 'DENY' | 'INHERIT' };
export interface ManagedAccessCommand { expectedVersion: number; reason: string; changes: ManagedAccessChange[] }

function invalid(message: string): never { throw new BadRequestException(message); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid('Dữ liệu cấu hình có trường không hợp lệ.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200): string { if (typeof value !== 'string' || !value.trim() || value.length > max) invalid('Giá trị chuỗi không hợp lệ.'); return value.trim(); }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { if (typeof value !== 'string' || !choices.includes(value as T)) invalid('Giá trị lựa chọn không hợp lệ.'); return value as T; }
function uuid(value: unknown): string { const id = text(value, 36); if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) invalid('ID không hợp lệ.'); return id.toLowerCase(); }
function optionalId(value: unknown) { return value == null || value === '' ? null : uuid(value); }
function date(value: unknown) { if (value == null || value === '') return null; const str = text(value, 40); if (!/^\d{4}-\d\d-\d\dT/.test(str) || !Number.isFinite(Date.parse(str))) invalid('Thời điểm hiệu lực không hợp lệ.'); return new Date(str).toISOString(); }
const relations = ['ALL','OWN','OWN_DRAFT','ASSIGNED','UNIT'] as const;
function scope(value: unknown, fieldAllowed: boolean): ManagedScope {
  const raw = object(value, ['scopeType','module','orgId','campaignId','fieldKey']);
  const scopeType = choice(raw.scopeType, fieldAllowed ? ['SYSTEM','MODULE','MODULE_ORG','RECORD','FIELD'] as const : ['SYSTEM','MODULE','MODULE_ORG','RECORD'] as const);
  const module = raw.module == null ? null : choice(raw.module, ['CAMPAIGN','MATERIAL','ACCESS','CREDENTIAL','SYSTEM','GOOGLE','PLAN','CONTRACT','CHANNEL','SLOT','BOOKING','CATALOG']);
  const orgId = optionalId(raw.orgId); const campaignId = optionalId(raw.campaignId);
  const fieldKey = raw.fieldKey == null || raw.fieldKey === '' ? null : canonicalCampaignFieldKey(text(raw.fieldKey));
  const valid = scopeType === 'SYSTEM' ? !module && !orgId && !campaignId && !fieldKey
    : scopeType === 'MODULE' ? Boolean(module && !orgId && !campaignId && !fieldKey)
    : scopeType === 'MODULE_ORG' ? Boolean(module && orgId && !campaignId && !fieldKey)
    : scopeType === 'RECORD' ? module === 'CAMPAIGN' && !orgId && Boolean(campaignId) && !fieldKey
    : module === 'CAMPAIGN' && !orgId && Boolean(campaignId && fieldKey);
  if (!valid) invalid('Phạm vi thiếu ID hoặc có trường không thuộc loại phạm vi.');
  if (fieldKey && (isProtectedCampaignField(fieldKey) || (!CAMPAIGN_FIELD_BY_KEY[fieldKey] && !Object.values(CAMPAIGN_ACCESS_FIELD_ALIASES).includes(fieldKey)))) invalid('Chỉ cấu hình field sửa đã được registry nhận diện.');
  return { scopeType, module, orgId, campaignId, fieldKey, scopeKey: JSON.stringify(fieldAllowed ? [scopeType,module,orgId,campaignId,fieldKey] : [scopeType,module,orgId,campaignId]) };
}

/** Explicit whitelist parser: transport/CLI bodies never become unrestricted Prisma data. */
export function parseManagedAccessCommand(value: unknown): ManagedAccessCommand {
  const input = object(value, ['expectedVersion','reason','changes']);
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) invalid('Cần expectedVersion hợp lệ.');
  const reason = text(input.reason, 1000);
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100) invalid('Mỗi lần lưu cần 1–100 thay đổi.');
  const changes = input.changes.map((value): ManagedAccessChange => {
    const kind = object(value, ['kind','roleCode','permissions','actorId','scope','relation','expiresAt','state','permissionCode','relationOrgId','validFrom','validUntil']).kind;
    if (kind === 'ROLE_PRESET') {
      const row = object(value, ['kind','roleCode','permissions']); const roleCode = choice(row.roleCode, ROLE_CODES);
      if (roleCode === 'ADMIN') invalid('Đặc quyền superadmin không được thay bằng preset nghiệp vụ.');
      if (!Array.isArray(row.permissions) || row.permissions.length > 100) invalid('Danh sách permission không hợp lệ.');
      const permissions = row.permissions.map((value): ManagedPreset => {
        const item = object(value, ['permissionCode','effect','relation','defaultScope']);
        return { permissionCode: text(item.permissionCode), effect: choice(item.effect, ['ALLOW','DENY']), relation: choice(item.relation, relations),
          defaultScope: choice(item.defaultScope, ['SYSTEM','MODULE','MODULE_ORG','RECORD']) };
      });
      if (new Set(permissions.map((permission) => `${permission.permissionCode}:${permission.relation}`)).size !== permissions.length) invalid('Permission trùng trong preset.');
      return { kind, roleCode, permissions };
    }
    if (kind === 'ROLE_BINDING') {
      const row = object(value, ['kind','actorId','roleCode','scope','relation','expiresAt','state']);
      const roleCode = choice(row.roleCode, ROLE_CODES);
      if (roleCode === 'ADMIN') invalid('Demo giữ một superadmin đã xác minh; không cấp hoặc thu hồi ADMIN qua trình sửa nghiệp vụ.');
      const target = scope(row.scope, false); const relation = choice(row.relation, ['PRESET',...relations]);
      if (relation === 'UNIT' && !target.orgId) invalid('Quan hệ UNIT cần phạm vi đơn vị cụ thể.');
      return { kind, actorId: uuid(row.actorId), roleCode, scope: target, relation, expiresAt: date(row.expiresAt), state: choice(row.state, ['BOUND','INHERIT']) };
    }
    if (kind !== 'OVERRIDE') invalid('Loại thay đổi không hợp lệ.');
    const row = object(value, ['kind','actorId','permissionCode','scope','relation','relationOrgId','validFrom','validUntil','state']);
    const target = scope(row.scope, true); const permissionCode = text(row.permissionCode); const relation = choice(row.relation, relations);
    if (target.module && permissionCode.split('.')[0]!.toUpperCase() !== target.module) invalid('Permission không thuộc phân hệ của phạm vi.');
    if (target.scopeType === 'FIELD' && permissionCode !== 'campaign.update') invalid('Field chỉ áp dụng cho quyền sửa Campaign.');
    const relationOrgId = optionalId(row.relationOrgId);
    if ((relation === 'UNIT') !== Boolean(relationOrgId)) invalid('UNIT cần ID đơn vị quan hệ; quan hệ khác không nhận ID đó.');
    const validFrom = date(row.validFrom); const validUntil = date(row.validUntil);
    if (validFrom && validUntil && validUntil <= validFrom) invalid('Khoảng hiệu lực không hợp lệ.');
    return { kind, actorId: uuid(row.actorId), permissionCode, scope: target, relation, relationOrgId, validFrom, validUntil, state: choice(row.state, ['ALLOW','DENY','INHERIT']) };
  });
  const identities = changes.map((change) => change.kind === 'ROLE_PRESET' ? `preset:${change.roleCode}` : `${change.kind}:${change.actorId}:${change.kind === 'ROLE_BINDING' ? change.roleCode : change.permissionCode}:${change.scope.scopeKey}`);
  if (new Set(identities).size !== identities.length) invalid('Một account-action-scope không được vừa Allow vừa Deny trong cùng lần lưu.');
  return { expectedVersion: input.expectedVersion as number, reason, changes };
}
