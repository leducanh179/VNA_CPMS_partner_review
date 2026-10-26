import type { ActorContext, MaterialFields, MaterialSummary, MaterialSharing } from '@cpms/domain';

export const MATERIAL_REPOSITORY = Symbol('MATERIAL_REPOSITORY');

export interface PersistMaterialRecord {
  sharing?: MaterialSharing;
  creationClientKey?: string;
  materialId: string;
  fields: MaterialFields;
  recordVersion: number;
  isDeleted: boolean;
  createdBy: string;
  updatedBy: string;
}

export interface MaterialReferenceRow {
  type: string;
  key: string;
  data: Record<string, string>;
}

export interface MaterialRepository {
  findCreationReceipts?(clientKeys: readonly string[], actor: ActorContext): Promise<Array<{ clientKey: string; material: MaterialSummary; unavailable?: boolean }>>;
  list(includeDeleted: boolean): Promise<MaterialSummary[]>;
  findByMaterialIds(materialIds: readonly string[]): Promise<MaterialSummary[]>;
  saveBatch(records: readonly PersistMaterialRecord[], actor: ActorContext, auditAction: string): Promise<Array<MaterialSummary & { creationClientKey?: string; replayed?: boolean }>>;
  purge(materialId: string, expectedVersion: number, actor: ActorContext): Promise<void>;
  listReferences(types: readonly string[]): Promise<MaterialReferenceRow[]>;
}
