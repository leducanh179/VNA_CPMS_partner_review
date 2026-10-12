import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalPreset, CampaignRequiredApprovals } from '@cpms/domain';
import { requestJson } from './api';

export interface WorkflowPolicy { id: string; version: number; campaignId: string | null; preset: ApprovalPreset | null; enforcement: string | null;
  requiredApprovals?: CampaignRequiredApprovals;
  effectiveFrom: string; createdByActorId: string; reason: string; source?: string; campaign?: { id: string; code: string; name: string } | null; createdBy?: { id: string; displayName: string } }
export interface WorkflowOrganization { id: string; sourceName: string; kind: string; parentId: string | null }
export interface WorkflowPerson { id: string; displayName: string; employeeCode: string; email: string | null; departmentId: string; divisionId: string | null; isActive: boolean; jobTitle: string | null }
export interface WorkflowStep { id: string; kind: string; orgId: string; assignmentOrgId?: string | null; assigneeActorId: string | null; mandatory: boolean; state: string; stepVersion: number;
  createdByActorId: string; createdAt: string; completedAt: string | null; decision: { id: string; kind: string; actorId: string; reason: string; decidedAt: string } | null;
  eligibility?: { allowed: boolean; reason: string }; adminEligibility?: { allowed: boolean; reason: string } | null }
export interface WorkflowRevision { id: string; number: number; subjectRevision: number; policyVersionId: string; policySource: string; route: string | null; state: string;
  scopeRevision: number; receivingDepartmentId: string | null; receivingDivisionId: string | null; submittedByActorId: string; reason: string; createdAt: string; steps: WorkflowStep[] }
export interface WorkflowAssignment { id: string; actorId: string; orgId: string; functionalRole: string; responsibility: string; assignedByActorId: string; startsAt: string; endsAt: string | null; recordVersion: number }
export interface WorkflowCooperation { id: string; sourceOrgId: string; targetOrgId: string; targetActorId: string | null; requestedByActorId: string; state: string;
  recordVersion: number; reason: string; responseReason: string | null; requestedAt: string }
export interface WorkflowView { campaign: { id: string; code: string; name: string; recordVersion: number; businessRevision: number }; version: number; provenance: string;
  revision: WorkflowRevision | null; history: WorkflowRevision[]; assignments: WorkflowAssignment[]; cooperations: WorkflowCooperation[];
  policy: WorkflowPolicy | null; currentPolicy: WorkflowPolicy | null; organizations: WorkflowOrganization[]; people: WorkflowPerson[];
  candidates: { actorId: string; divisionId: string | null; roles: string[] }[]; tasks: WorkflowStep[];
  capabilities: { submit: boolean; assign: boolean; policy: boolean; cooperate: boolean; withdraw: boolean; reviewChanges?: boolean };
  reassignableScopes: { orgId: string; functionalRole: string }[]; cooperationSourceOrgIds: string[];
  planning: { implemented: boolean; label: string }; internalDemoNotice: string }
export interface WorkflowConfiguration { version: number; commDepartmentId: string | null; demoInitialized: boolean; policies: WorkflowPolicy[]; organizations: WorkflowOrganization[] }
export interface WorkflowPreview { operation: string; currentRevisionId: string | null; subjectRevision: number; supersedesPendingTaskIds: string[];
  proposedPolicy: WorkflowPolicy | null; proposedRouting: { route: string | null; state: string; reason: string } | null; persists: false }
export const presetLabels: Record<ApprovalPreset, string> = {
  STANDARD: 'Tiêu chuẩn', DEPARTMENT_REQUIRED: 'Bắt buộc cấp Ban', DIVISION_ONLY: 'LĐP bắt buộc · mọi cấp',
  DIVISION_LEVEL_1_ONLY: 'LĐP bắt buộc · chỉ Cấp 1', NO_APPROVAL: 'Không cần phê duyệt · mọi cấp',
  NO_APPROVAL_LEVEL_1_ONLY: 'Không cần phê duyệt · chỉ Cấp 1',
};
export const workflowLabels: Record<string, string> = { CHANGE_RESUME: 'Đề nghị nối lại triển khai', CHANGE_RESTORE: 'Đề nghị khôi phục chiến dịch', CHANGE_EDIT: 'Đề nghị sửa đổi', CHANGE_PAUSE: 'Đề nghị tạm dừng', CHANGE_CANCEL: 'Đề nghị xóa', CHANGE_PLAN: 'Phê duyệt kế hoạch', LEGACY_UNASSESSED: 'Chưa trình phê duyệt', DRAFT: 'Nháp', PENDING: 'Chờ phê duyệt', APPROVED: 'Đã phê duyệt',
  NO_APPROVAL: 'Không cần duyệt nội bộ', RETURNED: 'Trả lại để sửa', REJECTED: 'Bị từ chối', CANCELLED: 'Đã hủy', SUPERSEDED: 'Đã thay thế', NEEDS_ROUTING: 'Cần chọn nơi tiếp nhận',
  NEEDS_ASSIGNEE: 'Chưa có lãnh đạo tiếp nhận', COMPLETED: 'Đã xử lý', SKIPPED_BY_ADMIN: 'Superadmin phê duyệt và phân công', APPROVED_BY_LEADER: 'Lãnh đạo đã duyệt', ACCEPTED: 'Đã chấp nhận', DECLINED: 'Đã từ chối',
  DEPARTMENT: 'Cấp Ban', DIVISION: 'Cấp Phòng', NONE: 'Không có gate duyệt nội bộ', LEAD: 'Chủ trì', COOP: 'Phối hợp',
  DEPARTMENT_APPROVAL: 'Ban duyệt và giao phòng', DIVISION_ACCEPT_AND_ASSIGN: 'Phê duyệt & giao việc', DEPARTMENT_LEADER: 'Lãnh đạo Ban', DIVISION_LEADER: 'Lãnh đạo Phòng', CAMPAIGN_MANAGER: 'Campaign Manager',
  ELIGIBLE_TASK: 'Được xử lý bước này', WRONG_LEADER_SCOPE: 'Lãnh đạo Phòng tiếp nhận xử lý', WRONG_ASSIGNEE: 'Đã giao đích danh cho người khác', TASK_NOT_PENDING: 'Bước đã được xử lý',
  PERMISSION_REQUIRED: 'Chưa có quyền trong phạm vi', VERSION_CONFLICT: 'Cần tải lại phiên bản hiện hành', MISSING_RECEIVING_DIVISION: 'Chưa chọn phòng tiếp nhận', MISSING_COMM_DEPARTMENT: 'Chưa cấu hình Ban tiếp nhận',
  MISSING_LEVEL: 'Chưa có cấp Campaign', WRONG_RECEIVING_DEPARTMENT: 'Phòng không thuộc Ban tiếp nhận' };
export const workflowLabel = (value: string | null | undefined) => value ? workflowLabels[value] ?? value : 'Chưa có';
export const workflowTime = (value: string) => new Date(value).toLocaleString('vi-VN');
export function workflowChanged() { window.dispatchEvent(new Event('cpms:workflow-updated')); window.dispatchEvent(new Event('cpms:access-updated')); }
export function useWorkflow(campaignId: string) {
  const [view, setView] = useState<WorkflowView | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const generation = useRef(0);
  const load = useCallback(async () => {
    const token = ++generation.current; setBusy(true); setError('');
    try { const next = await requestJson<WorkflowView>(`/campaign-workflow/${encodeURIComponent(campaignId)}`); if (generation.current === token) setView(next); }
    catch (caught) { if (generation.current === token) { setView(null); setError(caught instanceof Error ? caught.message : 'Không tải được workflow.'); } }
    finally { if (generation.current === token) setBusy(false); }
  }, [campaignId]);
  useEffect(() => { setView(null); void load(); return () => { generation.current++; }; }, [load]);
  return { view, error, busy, load };
}
