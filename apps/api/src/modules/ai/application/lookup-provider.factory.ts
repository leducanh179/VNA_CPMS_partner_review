import type { LookupMode, LookupProvider } from '@cpms/ai-contracts';

/** A local provider implements the same port; permissions, tools and budget remain in CPMS. */
export abstract class LookupProviderFactory {
  abstract create(mode: Exclude<LookupMode, 'OFF'>): Promise<LookupProvider>;
}
