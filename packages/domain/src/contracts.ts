import type { SupplierView, ContractResponsibilitySnapshot } from './directory';
import type { SupplyItemTermView } from './contract-items';
/** V1 wire contract. Numeric operational values are decimal strings, never JSON floats. */
export type SupplyDecimal = string | null;
export type SupplyStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'HELD';
export type SupplyQuality = { code: string; message: string; severity: 'WARNING' | 'BLOCK'; row?: number; sheet?: string };
export type SupplySource = Record<string, unknown>;
export interface SupplyContractView {
  supplierId?: string | null; supplierSnapshot?: SupplierView | null;
  responsibilitySnapshot?: ContractResponsibilitySnapshot | null;
  vendorCode?: string | null; codeLocked?: boolean; leaderActorId?: string | null;
  vendorActorId?: string | null; currentRevisionId?: string | null; deletedAt?: string | null;
  assignedActorIds?: string[]; leaderName?: string | null; managerName?: string | null; vendorContactEmail?: string | null;
  id: string; code: string; number: string | null; name: string; vendor: string | null;
  serviceRecipient?: string | null; marketScope?: 'UNSPECIFIED' | 'ALL' | 'SELECTED'; marketCodes?: string[];
  supplyType: string; ownerUnitCode: string | null; ownerDepartment: string | null;
  managerActorId: string | null; managerEmail: string | null; startDate: string | null; endDate: string | null;
  currency: string; signedAmount: SupplyDecimal; signedVat: SupplyDecimal; signedGross: SupplyDecimal;
  status: string; dossierUrl: string | null; source: SupplySource; quality: SupplyQuality[];
  recordVersion: number; localRevision: number; createdByActorId: string;
}
export interface SupplySlotView {
  supplyType?: string;
  effectiveTotalQty?: SupplyDecimal;
  id: string; contractId: string; code: string; name: string; unit: string | null; quantityUnit: string | null;
  priceBasis: SupplyDecimal; unitPrice: SupplyDecimal; totalQty: SupplyDecimal; signedAmount: SupplyDecimal;
  costType: string; businessType: string; channel: string | null; specificChannel: string | null;
  marketCode: string | null; description: string | null; materialRequirement: string | null; previewUrl: string | null;
  managerEmail: string | null; startDate: string | null; endDate: string | null; status: string;
  capacityMode: 'UNKNOWN' | 'UNRESTRICTED' | 'EXCLUSIVE' | 'SHARED_CAPACITY'; capacity: number | null;
  source: SupplySource; quality: SupplyQuality[]; recordVersion: number;
  bookers: Array<{ email: string; personnelCode: string | null }>;
}
export interface SupplyPeriodView { id: string; code: string; name: string; kind: string; startDate: string; endDate: string }
export interface SupplyAllocationView {
  supersededAt?: string | null; splitFromId?: string | null;
  id: string; contractId: string; planId: string; slotId: string | null; periodId: string;
  sourceKey: string | null; beneficiaryUnitCode: string | null; beneficiaryLabel: string;
  scopeKind: 'ENTITLEMENT' | 'CAP'; limitMode: 'HARD_LIMIT' | 'WARNING' | 'REFERENCE';
  baselineQty: SupplyDecimal; baselineAmount: SupplyDecimal; unitPrice: SupplyDecimal;
  inputBasis: string; percent: SupplyDecimal; denominator: SupplyDecimal; taxRate: SupplyDecimal;
  vatEstimated: boolean; sourceMonthCount: number | null; status: SupplyStatus;
  sourceVersion: string | null; source: SupplySource; quality: SupplyQuality[]; recordVersion: number;
  approvedByActorId: string | null; approvedAt: string | null;
}
export interface SupplyAdjustmentView {
  id: string; contractId: string; kind: string; name: string; reason: string; evidence: string | null;
  status: string; effectiveDate: string | null; source: SupplySource; recordVersion: number;
  approvedByActorId: string | null; approvedAt: string | null; reversesId: string | null;
  lines: Array<{ allocationId: string; deltaQty: SupplyDecimal; deltaAmount: SupplyDecimal; expectedAllocationVersion: number }>;
}
export interface SupplyAggregate {
  itemTerms?: SupplyItemTermView[];
  contract: SupplyContractView; slots: SupplySlotView[]; periods: SupplyPeriodView[];
  allocations: SupplyAllocationView[]; adjustments: SupplyAdjustmentView[];
}
export interface SupplyPair { qty: SupplyDecimal; amount: SupplyDecimal }
export interface SupplyInventoryRow {
  allocationId: string; slotId: string | null; periodId: string; beneficiaryLabel: string; unit: string | null;
  scopeKind: string; baseline: SupplyPair; adjustment: SupplyPair; effective: SupplyPair; proposed: SupplyPair;
  usage: Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', SupplyPair>;
  remaining: Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', SupplyPair>;
  avgBaseline: SupplyPair; avgEffective: SupplyPair; avgRemaining: SupplyPair;
  usedPercent: SupplyPair; monthCount: number; remainingMonths: number;
  baselineShare: SupplyPair; effectiveShare: SupplyPair;
  usagePercent: Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', SupplyPair>;
  remainingPercent: Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', SupplyPair>;
  avgRemainingByStage: Record<'booked' | 'vendorConfirmed' | 'approved' | 'accepted' | 'committed', SupplyPair>;
  eligible: boolean; reasons: string[]; applied: boolean;
}
export interface SupplyInventory {
  rows: SupplyInventoryRow[]; amountTotals: { baseline: SupplyDecimal; effective: SupplyDecimal; remaining: SupplyDecimal; used: SupplyDecimal };
  quantityTotals: Array<{ unit: string; baseline: SupplyDecimal; effective: SupplyDecimal; remaining: SupplyDecimal }>;
  asOf: string; mode: string; source: string; notice: string;
}
export interface SupplyDetail extends SupplyAggregate {
  inventory: SupplyInventory; capabilities: Record<string, boolean>; pollIntervalMs: number;
  financialLines: Array<Record<string, unknown>>; financialMaps: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>; audit: Array<Record<string, unknown>>; legalRevisions: Array<Record<string, unknown>>;
}
export type SupplyUsageStage = 'booked' | 'vendorConfirmed' | 'approved' | 'accepted';
export type SupplyInformationPhase = 'BASELINE' | 'EFFECTIVE';
export interface SupplySlotStatusRow {
  id: string; code: string; name: string; unit: string | null; periodNames: string[];
  total: SupplyDecimal; used: Record<SupplyUsageStage, SupplyDecimal>; remaining: Record<SupplyUsageStage, SupplyDecimal>;
  reasons: string[];
}
export interface SupplyInformationRow {
  id: string; slotId: string; code: string; name: string; unit: string | null;
  unitPrice: SupplyDecimal; priceBasis: SupplyDecimal; qty: SupplyDecimal; amount: SupplyDecimal;
  vat: SupplyDecimal; gross: SupplyDecimal; status: SupplyStatus; periodNames: string[]; beneficiaries: string[];
  freeOfCharge: boolean;
}
export interface SupplyAllocationInformationRow extends SupplyInformationRow {
  periodId: string; periodName: string; beneficiaryUnitCode: string | null; beneficiaryLabel: string;
  baselineQty: SupplyDecimal; adjustmentQty: SupplyDecimal; taxRate: SupplyDecimal; vatEstimated: boolean;
}
export interface SupplyTaxGroup {
  id: string; taxRate: SupplyDecimal; taxPercent: SupplyDecimal; estimated: boolean;
  periods: SupplyPeriodView[]; rows: SupplyInformationRow[];
  amount: SupplyDecimal; vat: SupplyDecimal; gross: SupplyDecimal;
}
export interface SupplyContractWorkspace {
  contract: SupplyContractView; periods: SupplyPeriodView[]; currentPeriodIds: string[]; selectedPeriodIds: string[];
  period: string; phase: SupplyInformationPhase; statusRows: SupplySlotStatusRow[]; informationGroups: SupplyTaxGroup[];
  slots: SupplySlotView[]; allocationRows: SupplyAllocationInformationRow[]; asOf: string; date: string; notice: string; mode: string; pollIntervalMs: number;
}
export interface SupplySnapshotCell { value: string | number | boolean | null; raw?: Record<string, unknown> | null; formatted?: string | null; note?: string | null }
export interface SupplySourceSnapshot {
  spreadsheetId: string; locale: string; timeZone: string; readAt: string; ranges?: string[];
  sheets: Array<{ name: string; sheetId?: number; rows: SupplySnapshotCell[][] }>;
}
export interface SupplyImportPreview {
  id: string; digest: string; contractId: string | null; expectedVersion: number | null;
  mode: 'CREATE' | 'NOOP' | 'UPDATE' | 'CONFLICT'; warnings: SupplyQuality[]; blocking: SupplyQuality[];
  counts: { contracts: number; slots: number; allocations: number; held: number; adjustments: number };
  diff: Array<{ entity: string; key: string; change: string; fields?: Array<{field:string;before:unknown;after:unknown}> }>; requiresWarningAcknowledgement: boolean;
}
