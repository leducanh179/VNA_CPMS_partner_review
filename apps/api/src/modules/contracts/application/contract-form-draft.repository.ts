import type { ActorContext } from '@cpms/domain';

export type ContractFormDraftValue = {
  kind: 'PAID' | 'OWNED_NEW' | 'OWNED_ACTIVITY';
  activityCode?: string;
  fields: Record<string, string>;
  marketCodes?: string[];
  supplierId: string;
  supplierSelected: boolean;
  code: string;
  vendorCode: string;
  ownedLayer: string;
  ownedChannel: string;
  reason: string;
  evidence: string;
};

export interface ContractFormDraftData {
  id: string;
  kind: string;
  title: string;
  activityCode: string | null;
  formData: ContractFormDraftValue;
  recordVersion: number;
  updatedAt: Date;
}

export abstract class ContractFormDraftRepository {
  abstract list(ownerActorId: string): Promise<Omit<ContractFormDraftData, 'formData'>[]>;
  abstract get(id: string, ownerActorId: string): Promise<ContractFormDraftData | null>;
  abstract save(id: string, value: ContractFormDraftValue, expectedVersion: number, actor: ActorContext): Promise<ContractFormDraftData>;
  abstract remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean>;
}
