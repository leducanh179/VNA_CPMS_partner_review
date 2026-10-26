export type LookupMode = 'OFF' | 'MOCK' | 'OPENAI';
export type LookupRecordKind = 'CAMPAIGN' | 'MATERIAL' | 'CONTRACT' | 'BOOKING';
export interface LookupRecordRef { kind: LookupRecordKind; id: string }
/** Additive v2 request context. Record data is always resolved again on the server. */
export type LookupContext = { type: 'RECORD'; record: LookupRecordRef } |
  { type: 'CELL'; text: string; label: string; fieldKey?: string | undefined; record?: LookupRecordRef | undefined };
export interface LookupContextPreview { title: string; text: string; truncated: boolean; sources: LookupSource[] }
export type LookupToolName = 'search_campaigns' | 'get_campaign' | 'summarize_campaigns' | 'search_materials' | 'get_material' | 'get_contract' | 'get_booking' | 'search_library';
export type LookupActionToolName = 'prepare_campaign_update' | 'ask_library_questions';
export interface LookupSource { kind: LookupRecordKind | 'LIBRARY'; id: string; title: string; href: string; version: number }
export interface LookupReadRequirement { kind: LookupRecordKind; id: string; fields: string[] }
export interface LookupEvidence { tool: LookupToolName; arguments: Record<string, unknown>; digest: string; requirements?: LookupReadRequirement[] }
export interface LookupUsage { inputTokens: number; cachedTokens: number; outputTokens: number }
export interface LookupStatus {
  allowed: boolean; mode: LookupMode; ready: boolean; model: string; reason: string | null;
  period: string; limitVnd: number; chargedVnd: number; reservedVnd: number; warning: boolean;
}
export interface LookupAnswer {
  artifacts?: AiArtifacts;
  id: string; conversationId: string; question: string; answer: string; sources: LookupSource[];
  state: string; mode: string; estimatedCostVnd: number; createdAt: string;
}
export interface LookupConversation { id: string; title: string; version: number; updatedAt: string }
export interface LookupConversations { items: LookupConversation[]; nextCursor: string | null }
export interface LookupConversationDetail { conversation: LookupConversation; items: LookupAnswer[]; nextCursor: string | null }
export interface LookupMessage { role: 'user' | 'assistant'; content: string }
export interface LookupToolResult { content: Record<string, unknown>; sources: LookupSource[] }
export interface LookupProviderResult { answer: string; usage: LookupUsage }
export interface LookupProvider {
  answer(input: {
    question: string; previous: LookupMessage[]; signal: AbortSignal;
    instructions?: string;
    execute: (name: LookupToolName | LookupActionToolName, args: Record<string, unknown>) => Promise<LookupToolResult>;
    onUsage: (usage: LookupUsage) => void;
  }): Promise<LookupProviderResult>;
}
import type { AiArtifacts } from './workspace';
