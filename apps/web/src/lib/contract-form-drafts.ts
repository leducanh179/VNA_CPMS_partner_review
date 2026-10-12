export type ContractFormDraftKind = 'PAID' | 'OWNED_NEW' | 'OWNED_ACTIVITY';

export interface ContractFormDraftValue {
  kind: ContractFormDraftKind;
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
}

export interface ContractFormDraftSummary {
  id: string;
  kind: ContractFormDraftKind;
  title: string;
  activityCode: string | null;
  recordVersion: number;
  updatedAt: string;
}

export interface ContractFormDraft extends ContractFormDraftSummary {
  formData: ContractFormDraftValue;
}
