import type { AccessDecision, AccessRule } from '@cpms/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from './api';
import { useUnsavedChanges } from './unsaved-changes';

export interface ManagedScope { scopeType: 'SYSTEM' | 'MODULE' | 'MODULE_ORG' | 'RECORD' | 'FIELD'; module?: string | null; orgId?: string | null; campaignId?: string | null; fieldKey?: string | null }
export type OverrideState = 'INHERIT' | 'ALLOW' | 'DENY';
export interface ManagedPreset { permissionCode: string; effect: 'ALLOW' | 'DENY'; relation: string; defaultScope: string }
export type AccessChange =
  | { kind: 'ROLE_PRESET'; roleCode: string; permissions: ManagedPreset[] }
  | { kind: 'ROLE_BINDING'; actorId: string; roleCode: string; scope: ManagedScope; relation: string; expiresAt: string | null; state: 'BOUND' | 'INHERIT' }
  | { kind: 'OVERRIDE'; actorId: string; permissionCode: string; scope: ManagedScope; relation: string; relationOrgId: string | null; validFrom: string | null; validUntil: string | null; state: OverrideState };
export interface AccessAccount { id: string; displayName: string; loginEmail: string | null; personnelEmployeeCode: string | null; isActive: boolean; personnel: { organizationName: string; departmentName: string | null; jobTitle: string | null } | null; employment: { departmentId: string; divisionId: string | null } | null }
export interface AccessDefinition { code: string; label: string; module: string; groupLabel: string; description: string; supportedScopes: string[]; implementationStatus: 'IMPLEMENTED' | 'RESERVED' }
export interface AccessBinding extends ManagedScope { id: string; actorId: string; roleCode: string; relation: string; expiresAt: string | null }
export interface AccessOverride extends ManagedScope { id: string; actorId: string; permissionCode: string; effect: 'ALLOW' | 'DENY'; relation: string; relationOrgId: string | null; validFrom: string | null; validUntil: string | null }
export interface AccessView {
  version: number; definitions: AccessDefinition[]; roles: { code: string; displayName: string; recordVersion: number; permissionPresets: ManagedPreset[] }[];
  bindings: AccessBinding[]; overrides: AccessOverride[]; accounts: AccessAccount[];
  organizations: { id: string; parentId: string | null; kind: string; sourceName: string; catalogOrganizationCode: string | null }[];
  history: { id: string; action: string; actorId: string; originalActorId: string; createdAt: string; payload: { reason?: string; version?: number; changes?: { key: string; actorId: string | null; before: unknown; after: unknown }[] } }[];
  pendingContacts: { email: string; sourceSheet: string; sourceRow: number }[];
}
export interface AccessExplanation { actorId: string; campaignId: string | null; version: number; decisions: (AccessDecision & { permission: string; implementationStatus: string })[]; fields: (AccessDecision & { fieldKey: string })[]; sources: AccessRule[]; notes: string[] }
export interface AccessPreview {
  version: number; changes: { kind: string; key: string; actorId: string | null; before: unknown; after: unknown }[]; notes: string[];
  impacts: { actorId: string; campaignId: string | null; context: string; decisions: { permission: string; before: AccessDecision; after: AccessDecision }[];
    changedFields: { fieldKey: string; before: AccessDecision; after: AccessDecision }[]; editableFieldsAfter: string[]; workflowAssignmentEvaluated: false }[];
}
export const roleLabels: Record<string, string> = { ADMIN: 'Superadmin', GUEST: 'Khách', CAMPAIGN_REQUESTER: 'Người yêu cầu', COMM_CAMPAIGN_MANAGER: 'Chuyên viên truyền thông', DEPARTMENT_LEADER: 'Lãnh đạo Ban', DIVISION_LEADER: 'Lãnh đạo Phòng', CORPORATE_LEADER: 'Lãnh đạo tổng công ty' };
export const stateLabels: Record<OverrideState, string> = { INHERIT: 'Kế thừa', ALLOW: 'Cho phép', DENY: 'Từ chối' };
export const reasonLabels: Record<string, string> = { ALLOW: 'Quy tắc cho phép', EXPLICIT_DENY: 'Có quy tắc từ chối ở phạm vi ưu tiên', DEFAULT_DENY: 'Chưa có quy tắc cho phép phù hợp', READ_REQUIRED: 'Thiếu quyền xem chiến dịch', TRASH_READ_REQUIRED: 'Thiếu quyền xem Thùng rác', TRASHED: 'Chiến dịch trong Thùng rác', DIRECT_ADMIN_REQUIRED: 'Chỉ superadmin trực tiếp', SUPERADMIN: 'Superadmin trực tiếp', ACCOUNT_UNAVAILABLE: 'Tài khoản chưa đủ điều kiện', UNKNOWN_PERMISSION: 'Dự phòng, chưa triển khai', IMPERSONATION_RESTRICTED: 'Không dùng trong phiên trình diễn', INVALID_POLICY: 'Cấu hình hoặc quan hệ đã hết hiệu lực', NOT_FOUND: 'Không có tài nguyên', SESSION_REQUIRED: 'Cần đăng nhập' };
export const scopeOnly = (scope: ManagedScope): ManagedScope => ({ scopeType: scope.scopeType, module: scope.module ?? null, orgId: scope.orgId ?? null, campaignId: scope.campaignId ?? null, fieldKey: scope.fieldKey ?? null });
export const scopeKey = (scope: ManagedScope) => JSON.stringify([scope.scopeType, scope.module ?? null, scope.orgId ?? null, scope.campaignId ?? null, scope.fieldKey ?? null]);
export const changeKey = (change: AccessChange) => change.kind === 'ROLE_PRESET' ? `ROLE_PRESET:${change.roleCode}` : `${change.kind}:${change.actorId}:${change.kind === 'ROLE_BINDING' ? change.roleCode : change.permissionCode}:${scopeKey(change.scope)}`;
export const recordScope = (id: string, fieldKey?: string): ManagedScope => ({ scopeType: fieldKey ? 'FIELD' : 'RECORD', module: 'CAMPAIGN', campaignId: id, ...(fieldKey ? { fieldKey } : {}) });
export function overrideChange(actorId: string, permissionCode: string, scope: ManagedScope, state: OverrideState): AccessChange {
  return { kind: 'OVERRIDE', actorId, permissionCode, scope: scopeOnly(scope), state, relation: 'ALL', relationOrgId: null, validFrom: null, validUntil: null };
}
export function useAccessEditor(filters: { actorId?: string; campaignId?: string } = {}) {
  const query = new URLSearchParams(filters).toString(); const generation = useRef(0);
  const [view, setView] = useState<AccessView | null>(null); const [changes, setChanges] = useState<Record<string, AccessChange>>({});
  const [reason, updateReason] = useState(''); const [expires, updateExpires] = useState(''); const [preview, setPreview] = useState<AccessPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dirty = Object.keys(changes).length > 0; useUnsavedChanges(dirty);
  const load = useCallback(async () => {
    const token = ++generation.current; setBusy(true); setError('');
    try { const data = await requestJson<AccessView>(`/access${query ? `?${query}` : ''}`); if (generation.current !== token) return;
      setView(data); setChanges({}); setPreview(null); updateReason(''); updateExpires('');
    } catch (caught) { if (generation.current === token) setError(caught instanceof Error ? caught.message : 'Không tải được cấu hình quyền.'); }
    finally { if (generation.current === token) setBusy(false); }
  }, [query]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const stage = (change: AccessChange) => { setChanges((current) => ({ ...current, [changeKey(change)]: change })); setPreview(null); setMessage(''); };
  const setReason = (value: string) => { updateReason(value); setPreview(null); };
  const setExpires = (value: string) => { updateExpires(value); setPreview(null); };
  const command = () => ({ expectedVersion: view?.version, reason, changes: Object.values(changes).map((change) => {
    if (!expires || change.kind === 'ROLE_PRESET') return change;
    const expiry = new Date(expires).toISOString(); return change.kind === 'OVERRIDE' ? { ...change, validUntil: expiry } : { ...change, expiresAt: expiry };
  }) });
  const run = async (save: boolean) => {
    if (!dirty || !reason.trim() || (save && !preview)) return; setBusy(true); setError(''); setMessage('');
    try {
      if (save) { const result = await requestJson<{ version: number; changes: unknown[] }>('/access/save', { method: 'POST', body: JSON.stringify(command()) }); await load(); setMessage(`Đã lưu ${result.changes.length} thay đổi. Phiên bản ${result.version}.`); window.dispatchEvent(new Event('cpms:access-updated')); }
      else setPreview(await requestJson<AccessPreview>('/access/preview', { method: 'POST', body: JSON.stringify(command()) }));
    } catch (caught) { setPreview(null); setError(caught instanceof Error ? caught.message : 'Không cập nhật được quyền.'); }
    finally { setBusy(false); }
  };
  const state = (actorId: string, permissionCode: string, scope: ManagedScope): OverrideState => {
    const staged = changes[changeKey(overrideChange(actorId, permissionCode, scope, 'INHERIT'))];
    if (staged?.kind === 'OVERRIDE') return staged.state;
    return view?.overrides.find((row) => row.actorId === actorId && row.permissionCode === permissionCode && scopeKey(row) === scopeKey(scope))?.effect ?? 'INHERIT';
  };
  return { view, changes, reason, expires, preview, busy, error, message, dirty, load, stage, state, setReason, setExpires, run };
}
export type AccessEditor = ReturnType<typeof useAccessEditor>;
