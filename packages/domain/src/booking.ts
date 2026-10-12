import type { QcttPlanTarget } from './qctt-plan';
import type { SupplyAggregate, SupplyInventory } from './contracts';
import type { ContractBookingSnapshot } from './contract-management';
import type { BookingTimeDistribution } from './booking-distribution';
import type { BookingDelegation, BookingDelegationSnapshot } from './booking-delegation';
import type { BookingWorkflow, BookingExecution, BookingReportPeriod, BookingWorkflowAction, BookingPolicy, BookingLifecycleRequest } from './booking-workflow';

export const BOOKING_ACTIONS = ['PAUSE', 'RESUME', 'DELETE', 'RESTORE', 'PURGE'] as const;
export type BookingAction = typeof BOOKING_ACTIONS[number];
export const BOOKING_METRICS = [
  { key: 'impression', label: 'Impression' }, { key: 'linkClick', label: 'Link click' },
  { key: 'view', label: 'View' }, { key: 'reach', label: 'Reach' },
  { key: 'interaction', label: 'Interaction' }, { key: 'revenue', label: 'Revenue' },
  { key: 'conversion', label: 'Conversion' },
] as const;
export type BookingMetric = typeof BOOKING_METRICS[number]['key'];
export interface BookingTemplateDefinition {
  metrics: BookingMetric[];
  /** A null denominator leaves conversion rate undefined rather than inventing attribution. */
  conversionDenominator: 'linkClick' | 'interaction' | null;
  excludedSlotIds: string[];
}
export interface BookingTemplate { id: string; contractId: string; version: number; name: string; definition: BookingTemplateDefinition }
export interface BookingFields {
  planItemId?: string | null | undefined;
  allocationId: string; campaignId: string | null; campaignLabel: string;
  startDate: string; endDate: string; quantity: string; materialId: string | null; materialUrl: string | null; note: string;
  overallStartDate?: string | null | undefined; overallEndDate?: string | null | undefined; campaignDatesAuto?: boolean | undefined;
  timeDistribution?: BookingTimeDistribution | undefined;
}
export interface BookingView extends BookingFields {
  lifecycleRequest?: BookingLifecycleRequest | null;
  contractRevisionId?: string | null;
  contractSnapshot?: ContractBookingSnapshot | null;
  workflow?: BookingWorkflow | null | undefined;
  execution?: BookingExecution | undefined;
  reportPeriods?: BookingReportPeriod[] | undefined;
  id: string; contractId: string; slotId: string; unit: string; unitPrice: string; priceBasis: string; taxRate: string;
  amount: string; vat: string; gross: string; state: 'ACTIVE' | 'PAUSED'; deletedAt: string | null;
  vendorConfirmedQty: string | null; sourceApprovedQty: string | null; acceptedQty: string;
  reportState: 'EMPTY' | 'DRAFT' | 'PENDING' | 'RETURNED' | 'ACCEPTED'; reportTemplateId: string | null;
  reportData: Record<string, string | null>; sourceKey: string | null; source: Record<string, unknown>;
  recordVersion: number; createdByActorId: string; createdAt: string; updatedAt: string;
}
export interface BookingListItem extends BookingView {
  approvalDelegations?: BookingDelegationSnapshot[];
  canApproveByDelegation?: boolean;
  workflowActions?: BookingWorkflowAction[];
  contractName: string; slotName: string; periodName: string; beneficiaryLabel: string;
  capabilities: Record<'update' | 'delete' | 'restore' | 'purge' | 'report', boolean>;
}
export interface BookingAllocationAccess {
  allocationId: string; ownerDepartmentId: string | null; beneficiaryDepartmentId: string | null;
  leaderActorIds: string[]; operatorActorIds: string[]; beneficiaryActorIds: string[]; vendorActorIds: string[]; recordVersion: number;
}
export interface BookingContext extends SupplyAggregate { access: BookingAllocationAccess[]; templates: BookingTemplate[]; inventory?: SupplyInventory; approvalDelegations?: BookingDelegation[] }
export interface BookingIssue { index: number; field: string; severity: 'BLOCK' | 'WARNING'; message: string }
export interface BookingCheck { rows: BookingView[]; issues: BookingIssue[]; valid: boolean }
export interface BookingImpact extends BookingCheck {
  asOf: string;
  contracts: Array<{ contractId: string; contractName: string; before: SupplyInventory; after: SupplyInventory }>;
}
export interface BookingBatchItem { id?: string | undefined; recordVersion?: number | undefined; fields: BookingFields }
export interface BookingBootstrap {
  planTargets?: Record<string, QcttPlanTarget[]>;
  workflowPolicy?: BookingPolicy;
  creatableAllocationIds?: string[];
  contracts: BookingContext[];
  campaigns: Array<{ id: string; code: string; name: string; status: string; startDate: string | null; endDate: string | null }>;
  people: Array<{ id: string; name: string; email: string | null }>;
  departments: Array<{ id: string; name: string }>;
  materials: Array<{ id: string; name: string; url: string | null }>;
  canManage: boolean;
}
export function bookingReportSelection(rows: readonly Pick<BookingView, 'id' | 'contractId' | 'deletedAt'>[]) {
  if (!rows.length) return { allowed: false, reason: 'Chọn booking để xem hoặc nhập báo cáo nghiệm thu.' };
  if (rows.some(r => r.deletedAt)) return { allowed: false, reason: 'Phục hồi booking trước khi sửa nghiệm thu; báo cáo cũ vẫn xem trong chi tiết.' };
  if (new Set(rows.map(r => r.contractId)).size !== 1) return { allowed: false, reason: 'Chọn các booking cùng một hợp đồng để nghiệm thu.' };
  return { allowed: true, reason: '' };
}
