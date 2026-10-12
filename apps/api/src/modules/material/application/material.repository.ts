import type { ActorContext, MaterialFields, MaterialSummary } from '@cpms/domain';

export const MATERIAL_REPOSITORY = Symbol('MATERIAL_REPOSITORY');

export interface PersistMaterialRecord {
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
  list(includeDeleted: boolean): Promise<MaterialSummary[]>;
  findByMaterialIds(materialIds: readonly string[]): Promise<MaterialSummary[]>;
  saveBatch(records: readonly PersistMaterialRecord[], actor: ActorContext, auditAction: string): Promise<MaterialSummary[]>;
  purge(materialId: string, expectedVersion: number, actor: ActorContext): Promise<void>;
  listReferences(types: readonly string[]): Promise<MaterialReferenceRow[]>;
}
