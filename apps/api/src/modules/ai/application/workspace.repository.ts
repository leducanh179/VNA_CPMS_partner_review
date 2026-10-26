import type { ActorContext } from '@cpms/domain';
import type { AiFieldChange, AiWorkspacePolicy } from '@cpms/ai-contracts';
import type { LibraryEntry } from '../domain/library-index';
export interface WorkspaceState {
  version: number; draftVersion: number; draft: unknown; published: unknown;
  libraryVersion: number; librarySpreadsheetId: string; librarySyncedAt: Date | null;
}
export interface ProposalRecord {
  id: string; runId: string; actorId: string; campaignId: string; expectedVersion: number;
  changes: AiFieldChange[]; reason: string; state: string; result: Record<string, unknown>; createdAt: Date;
}
export abstract class WorkspaceRepository {
  abstract state(): Promise<WorkspaceState>;
  abstract versions(): Promise<{ version: number; actorId: string; createdAt: Date }[]>;
  abstract version(version: number): Promise<unknown>;
  abstract saveDraft(policy: AiWorkspacePolicy, expected: number, actor: ActorContext): Promise<void>;
  abstract publish(expected: number, actor: ActorContext, rollbackVersion?: number): Promise<void>;
  abstract library(): Promise<LibraryEntry[]>;
  abstract replaceLibrary(rows: LibraryEntry[], spreadsheetId: string, expectedVersion: number, actor: ActorContext): Promise<void>;
  abstract createProposal(input: Omit<ProposalRecord,'createdAt'>, actor: ActorContext): Promise<ProposalRecord>;
  abstract proposal(id: string, actorId: string): Promise<ProposalRecord | null>;
  abstract finishProposal(id: string, state: string, result: Record<string, unknown>, actor: ActorContext): Promise<void>;
  abstract replaceProposal(previous: ProposalRecord, nextId: string, actor: ActorContext): Promise<void>;
}
