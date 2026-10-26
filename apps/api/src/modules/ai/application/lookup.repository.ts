import type { AiArtifacts, LookupEvidence, LookupSource, LookupUsage } from '@cpms/ai-contracts';
export interface ConversationRecord { id: string; actorId: string; title: string; version: number; updatedAt: Date }
export interface LookupRun {
  artifacts?: AiArtifacts;
  id: string; conversationId: string | null; actorId: string; period: string; mode: string; question: string; answer: string;
  state: string; reservedVnd: number; chargedVnd: number; createdAt: Date;
  sources: LookupSource[]; evidence: LookupEvidence[];
}
export abstract class LookupRepository {
  abstract accountId(email: string): Promise<string | null>;
  abstract totals(period: string): Promise<{ chargedVnd: number; reservedVnd: number }>;
  abstract get(id: string, actorId: string): Promise<LookupRun | null>;
  abstract recent(actorId: string): Promise<LookupRun[]>;
  abstract conversations(actorId: string, cursor?: string): Promise<{ items: ConversationRecord[]; nextCursor: string | null }>;
  abstract conversation(id: string, actorId: string): Promise<ConversationRecord | null>;
  abstract turns(id: string, actorId: string, before?: string): Promise<{ items: LookupRun[]; nextCursor: string | null }>;
  abstract rename(id: string, actorId: string, title: string, version: number): Promise<ConversationRecord>;
  abstract deleteConversation(id: string, actorId: string): Promise<void>;
  abstract reserve(input: { id: string; actorId: string; question: string; mode: string; period: string; reserveVnd: number; conversationId?: string | null }): Promise<LookupRun>;
  abstract finish(id: string, result: { state: string; answer: string; sources: LookupSource[]; evidence: LookupEvidence[]; usage: LookupUsage; chargedVnd: number; artifacts?: AiArtifacts }): Promise<void>;
}
