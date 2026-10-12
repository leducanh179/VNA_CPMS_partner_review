import type { CampaignAccessCapabilities } from '@cpms/domain';
export interface CampaignChangeRequest {
  id: string; kind: 'EDIT' | 'PAUSE' | 'CANCEL' | 'PLAN' | 'RESUME' | 'RESTORE' | 'PURGE'; state: string; subjectRevision: number; recordVersion: number;
  payload: Record<string, unknown>; beforeSnapshot: Record<string, unknown>; reason: string; requestedByActorId: string; requestedAt: string;
  decidedByActorId: string | null; decisionReason: string | null; decidedAt: string | null;
  canWithdraw: boolean;
}
export interface CampaignPlanView { id: string; number: number; subjectRevision: number; title: string; objective: string; tasks: { title: string; startDate: string; endDate: string }[]; createdByActorId: string; createdAt: string }
export interface CampaignOperationsView {
  campaignId: string; version: number; subjectRevision: number; operationalState: string; leadActorId: string | null;
  requests: CampaignChangeRequest[]; plans: CampaignPlanView[];
  approvalRequired?: Record<string, boolean>;
  capabilities: { requestChange: boolean; decide: boolean; plan: boolean; resume: boolean; restore: boolean; purge?: boolean; purgeApproved?: boolean }; proposalAccess: CampaignAccessCapabilities | null;
}
export const changeLabels = { EDIT: 'Sửa đổi chiến dịch', PAUSE: 'Tạm dừng chiến dịch', CANCEL: 'Xóa chiến dịch', PLAN: 'Phê duyệt kế hoạch', RESUME: 'Nối lại triển khai', RESTORE: 'Khôi phục chiến dịch', PURGE: 'Xóa vĩnh viễn chiến dịch' };
