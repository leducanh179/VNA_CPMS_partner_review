import type { CampaignRichTextDocument } from './campaign';

export interface DirectoryPerson {
  employeeCode: string; fullName: string; organizationName: string; departmentName: string | null;
  jobTitle: string | null; email: string | null; phoneText: string | null; isActive: boolean;
  sourceProvider: string; sourceReference: string | null; actorId: string | null; recordVersion: number;
  externalIdentities: Array<{ provider: string; externalId: string; syncedAt: string; sourceUpdatedAt: string | null }>;
}
export interface SupplierProfile {
  shortName: string; address: string; phone: string; fax: string; email: string; website: string;
  representativeName: string; representativeTitle: string; authorization: string;
  accountNumber: string; accountHolder: string; bankName: string; bankBranch: string;
  note: string; sourceUrl: string; warnings: string[];
  contacts: Array<{ name: string; email: string; phone: string; title: string; actorId: string | null }>;
}
export interface SupplierView {
  id: string; code: string; name: string; taxId: string | null; profile: SupplierProfile;
  isActive: boolean; recordVersion: number; updatedAt: string;
}
export interface ContractResponsibilitySnapshot {
  leaderActorId: string; employeeCode: string; leaderName: string; email: string | null;
  departmentName: string | null; organizationName: string; directoryVersion: number; capturedAt: string;
}
export type NoteColor = 'YELLOW' | 'GREEN' | 'BLUE' | 'RED';
export interface PersonalNoteView {
  id: string; title: string; document: CampaignRichTextDocument; color: NoteColor; pinned: boolean;
  recordVersion: number; createdAt: string; updatedAt: string;
}
export function normalizeSupplierName(value: string) { return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi-VN'); }
export function normalizeTaxId(value: string | null | undefined) { return value?.trim().replace(/[\s.-]/g, '').toUpperCase() || null; }
export function directorySearch(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim(); }
