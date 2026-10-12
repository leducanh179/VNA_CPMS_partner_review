import type { ItemClassificationSnapshot } from './channel-map';
import { formatSupplyPeriod } from './supply-period';
import type { SupplyAggregate, SupplyContractView } from './contracts';
import type { AccessResource } from './access-policy';
import { supplyItemSlot } from './contract-items';

export function contractAccessResource(c: SupplyContractView): AccessResource {
  return { type: 'CONTRACT', id: c.id, exists: true, deleted: Boolean(c.deletedAt), state: c.status, createdByActorId: c.createdByActorId,
    orgIds: c.ownerUnitCode ? [c.ownerUnitCode] : [],
    assignedActorIds: [...new Set([c.managerActorId, c.leaderActorId, c.vendorActorId, ...(c.assignedActorIds ?? [])].filter((id): id is string => Boolean(id)))],
    contractEditors: [c.managerActorId, c.leaderActorId].filter((id): id is string => Boolean(id)),
    contractApprovers: c.leaderActorId ? [c.leaderActorId] : [] };
}

export type ContractValidity = 'ACTIVE' | 'EXPIRED' | 'PAUSED' | 'UPCOMING' | 'DRAFT';
export const contractValidityLabels: Record<ContractValidity, string> = { ACTIVE: 'Đang hiệu lực', EXPIRED: 'Hết hiệu lực', PAUSED: 'Tạm dừng', UPCOMING: 'Chưa hiệu lực', DRAFT: 'Bản nháp' };
export function contractValidity(c: Pick<SupplyContractView, 'startDate' | 'endDate' | 'status'>, at = new Date()): ContractValidity {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  if (c.endDate && today > c.endDate.slice(0, 10)) return 'EXPIRED';
  if (c.status === 'PAUSED' || c.status === 'ARCHIVED') return 'PAUSED';
  if (c.startDate && today < c.startDate.slice(0, 10)) return 'UPCOMING';
  if (c.status === 'DRAFT' || !c.startDate || !c.endDate) return 'DRAFT';
  return 'ACTIVE';
}
export function validContractCode(code: string): boolean {
  const match = /^CON-([A-Z0-9]{2,20})-([1-9]\d{3}(?:0[1-9]|1[0-2]))-([A-Z0-9]{6})$/.exec(code);
  return Boolean(match && (match[3]!.match(/[A-Z]/g)?.length ?? 0) >= 2);
}
export interface ContractRevision {
  id: string; contractId: string; version: number; snapshot: SupplyAggregate;
  provenance: 'PUBLISHED' | 'MIGRATION_CAPTURE'; reason: string; evidence: string | null;
  createdByActorId: string; approvedByActorId: string | null; createdAt: string;
}
export type ContractChangeKind = 'EDIT' | 'PAUSE' | 'RESUME' | 'DELETE' | 'RESTORE';
export type ContractChangeState = 'DRAFT' | 'PENDING' | 'APPROVED' | 'RETURNED' | 'WITHDRAWN';
export interface ContractChangeRequest {
  id: string; contractId: string; kind: ContractChangeKind; state: ContractChangeState;
  fields: Record<string, unknown>; reason: string; evidence: string | null;
  baseVersion: number; baseRevisionId: string | null; recordVersion: number;
  requesterActorId: string; leaderActorId: string | null; policyVersion: number; approvalRequired: boolean;
  submittedAt: string | null; decidedAt: string | null; decidedByActorId: string | null; decisionReason: string | null;
  createdAt: string; updatedAt: string;
}
export interface ContractManagementPolicy { version: number; required: boolean; reason: string; actorId: string | null; createdAt: string | null }
export interface ContractManagementCapabilities { edit: boolean; approve: boolean; delete: boolean; restore: boolean; purge: boolean; purgeReason: string | null; policy: boolean }
export interface ContractManagementWorkspace {
  contract: SupplyContractView; validity: ContractValidity; policy: ContractManagementPolicy;
  requests: ContractChangeRequest[]; revisions: Array<Omit<ContractRevision, 'snapshot'>>;
  capabilities: ContractManagementCapabilities;
  people: Array<{ id: string; name: string; email: string | null }>;
}
export interface ContractBookingSnapshot {
  revisionId: string; version: number; provenance: ContractRevision['provenance']; capturedAt: string;
  contract: SupplyContractView; slotName: string; slotSupplyType?: string; periodName: string;
  slotClassification?: ItemClassificationSnapshot;
}

export function contractBookingSnapshot(revision: ContractRevision, allocationId: string): ContractBookingSnapshot {
  const a = revision.snapshot.allocations.find(a => a.id === allocationId), s = a?supplyItemSlot(revision.snapshot,a.slotId??'',a.periodId):undefined, p = revision.snapshot.periods.find(p => p.id === a?.periodId);
  const classification=revision.snapshot.itemTerms?.find(t=>t.slotId===a?.slotId&&t.periodId===a?.periodId)?.effective.classificationSnapshot;
  return { revisionId: revision.id, version: revision.version, provenance: revision.provenance, capturedAt: revision.createdAt,
    contract: { ...revision.snapshot.contract, source: {}, quality: [] }, slotName: s?.name ?? '', ...(s?.supplyType?{slotSupplyType:s.supplyType}:{}), ...(classification?{slotClassification:structuredClone(classification)}:{}), periodName: p ? formatSupplyPeriod(p) : '' };
}
