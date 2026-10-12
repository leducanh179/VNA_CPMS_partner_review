import type { ActorContext, SupplyAggregate, SupplyContractView, SupplyImportPreview, SupplySourceSnapshot } from '@cpms/domain';
import type { NormalizedSupplyImport, SupplyCatalogs } from '../domain/source-import';
import type { SupplyPivotView } from '@cpms/domain';
import type { ContractChangeRequest, ContractManagementPolicy, ContractRevision } from '@cpms/domain';
import type { ChannelMapCatalog, SupplyChannelMap } from '@cpms/domain';

export interface SupplyImportRecord { id: string; actorId: string; status: string; snapshot: SupplySourceSnapshot; preview: SupplyImportPreview; contractId: string | null; digest: string; expectedVersion: number | null }
export abstract class ContractsRepository {
  abstract channelMap(): Promise<ChannelMapCatalog>;
  abstract saveChannelMap(data: SupplyChannelMap, digest: string, expectedVersion: number, actor: ActorContext): Promise<ChannelMapCatalog>;
  abstract revisions(contractId: string): Promise<ContractRevision[]>;
  abstract revision(id: string): Promise<ContractRevision | null>;
  abstract createRevision(revision: ContractRevision): Promise<void>;
  abstract requests(contractId?: string): Promise<ContractChangeRequest[]>;
  abstract saveRequest(request: ContractChangeRequest, previous: ContractChangeRequest | null, actor: ActorContext): Promise<void>;
  abstract managementPolicy(): Promise<ContractManagementPolicy>;
  abstract saveManagementPolicy(required: boolean, expectedVersion: number, reason: string, actor: ActorContext): Promise<ContractManagementPolicy>;
  abstract managementPeople(): Promise<Array<{ id: string; name: string; email: string | null }>>;
  abstract managementAudit(actor: ActorContext, contractId: string, action: string, data: unknown): Promise<void>;
  abstract initializeManagementPermissions(actor: ActorContext): Promise<void>;
  abstract preserveCodeAlias(contractId: string, code: string): Promise<void>;
  abstract codeExists(code: string): Promise<boolean>;
  abstract purgeBlocker(contractId: string): Promise<string | null>;
  abstract purgeEmptyContract(contractId: string, actor: ActorContext, reason: string): Promise<void>;
  abstract pivotViews(contractId: string, actorId: string): Promise<SupplyPivotView[]>;
  abstract savePivotView(view: SupplyPivotView, previous: SupplyPivotView | null, actor: ActorContext): Promise<void>;
  abstract deletePivotView(view: SupplyPivotView, actor: ActorContext): Promise<void>;
  abstract list(): Promise<SupplyContractView[]>;
  abstract get(id: string): Promise<SupplyAggregate | null>;
  abstract catalogs(): Promise<SupplyCatalogs>;
  abstract save(value: SupplyAggregate, previous: SupplyAggregate | null, actor: ActorContext, action: string): Promise<void>;
  abstract references(id: string): Promise<{ aliases: Array<Record<string, unknown>>; financialLines: Array<Record<string, unknown>>; financialMaps: Array<Record<string, unknown>>; audit: Array<Record<string, unknown>>; legalRevisions: Array<Record<string, unknown>> }>;
  abstract findSource(sourceId: string): Promise<SupplyAggregate | null>;
  abstract preview(record: { id: string; actorId: string; snapshot: SupplySourceSnapshot; preview: SupplyImportPreview }): Promise<void>;
  abstract getPreview(id: string): Promise<SupplyImportRecord | null>;
  abstract lastAppliedSourceDigest(contractId: string): Promise<string | null>;
  abstract finishImport(id: string, contractId: string, normalized: NormalizedSupplyImport, aggregate: SupplyAggregate): Promise<void>;
  abstract command(key: string): Promise<{ actorId: string; digest: string; result: unknown } | null>;
  abstract saveCommand(key: string, digest: string, result: unknown, actor: ActorContext): Promise<void>;
  abstract legalRevision(contractId: string, version: number, changes: unknown, reason: string, evidence: string, actor: ActorContext): Promise<void>;
}
