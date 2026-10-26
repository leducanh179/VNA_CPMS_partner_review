/** Version 3: provider-neutral proposals, library results and managed instructions. */
export interface AiWorkspacePolicy {
  agentEnabled: boolean;
  libraryEnabled: boolean;
  spreadsheetId: string;
  allowedRootIds: string[];
  maxQuestions: number;
  maxResults: number;
  includeUnknownRights: boolean;
  answerFormat: 'CARDS' | 'TABLE';
  instructions: string;
  selectionRules: string;
  vision: { enabled: false; maxImagesPerRequest: number; monthlyLimitVnd: number };
}
export interface AiPolicyView {
  version: number; draftVersion: number; published: AiWorkspacePolicy; draft: AiWorkspacePolicy;
  versions: { version: number; createdAt: string; actorId: string }[];
  library: { version: number; syncedAt: string | null; count: number; spreadsheetId: string };
}
export interface AiLibraryResult {
  id: string; itemId: string; name: string; href: string; path: string; format: string; rootId: string;
  description: string; rights: string; rightsNote: string; sourceUpdatedAt: string;
  matchedTerms: string[]; contentRead: false;
}
export interface AiClarification { question: string; options: string[] }
export interface AiArtifacts {
  policyVersion?: number; proposalId?: string; questions?: AiClarification[];
  clarificationCount?: number; library?: AiLibraryResult[]; librarySyncedAt?: string;
  answerFormat?: 'CARDS' | 'TABLE';
}
export interface AiFieldChange { field: string; label: string; before: string | null; after: string | null }
export interface AiCampaignProposal {
  id: string; campaignId: string; title: string; expectedVersion: number; changes: AiFieldChange[];
  reason: string; state: 'PREPARED' | 'SAVED' | 'SUBMITTED'; createdAt: string;
  canSubmit: boolean; submission: string; result: Record<string, unknown> | null;
}
/** A future worker must enumerate approved roots, enforce budget and report partial coverage. */
export interface AiVisualInspectionRequest {
  version: 1; rootId: string; fileIds: string[]; forceRefresh: boolean; maxImages: number;
}
export interface AiVisualInspectionProgress {
  jobId: string; state: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'CANCELLED';
  discovered: number; examined: number; inaccessible: number; nextCursor: string | null;
  cacheKey: { fileId: string; modifiedAt: string; model: string; instructionVersion: number };
}
