import { createHash } from 'node:crypto';
import type { LookupUsage } from '@cpms/ai-contracts';

export const LOOKUP_MODEL = 'gpt-6-astra';
// Standard, short-context pricing checked against the official model page, 2026-10-20.
export const LOOKUP_PRICE_VERSION = 'gpt-6-astra-standard-20261020';
export const LOOKUP_LIMIT_VND = 100_000;
export const MAX_RESPONSE_BYTES = 120_000;
export const MAX_REQUEST_BYTES = 24_000;
export const MAX_OUTPUT_TOKENS = 1_200;
// Search -> read -> prepare a proposal -> answer, or up to three library refinements.
export const MAX_MODEL_CALLS = 4;
export const MAX_TOOLS = 6;
export const LOOKUP_TIMEOUT_MS = 90_000;
// Planning rate, not a live FX quote: 27,000 VND/USD plus 10% provision.
export const VND_PER_USD_WITH_PROVISION = 29_700;
export function billingPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
export function costVnd(usage: LookupUsage) {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  return Math.ceil(((usage.inputTokens - cached) * 12.5 + cached + usage.outputTokens * 50) / 1_000_000 * VND_PER_USD_WITH_PROVISION);
}
// UTF-8 bytes bound text tokens conservatively; additional allowance covers protocol overhead.
// Use the larger input cache-write price for reservation, with no expected cache discount.
export const TURN_RESERVATION_VND = Math.ceil(
  MAX_MODEL_CALLS * ((MAX_REQUEST_BYTES + 4096) * 12.5 + MAX_OUTPUT_TOKENS * 50) / 1_000_000 * VND_PER_USD_WITH_PROVISION,
);
export function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function normalizeSearch(value: string) { return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').trim(); }
export const EMPTY_USAGE = (): LookupUsage => ({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 });
export function addUsage(a: LookupUsage, b: LookupUsage): LookupUsage {
  return Object.assign(a, { inputTokens: a.inputTokens + b.inputTokens, cachedTokens: a.cachedTokens + b.cachedTokens, outputTokens: a.outputTokens + b.outputTokens });
}
