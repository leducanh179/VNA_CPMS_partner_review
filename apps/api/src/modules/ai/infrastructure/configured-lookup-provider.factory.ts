import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LookupMode } from '@cpms/ai-contracts';
import type { Environment } from '../../../config/environment';
import { LookupProviderFactory } from '../application/lookup-provider.factory';
import { loadLookupKey, MockLookupAdapter, OpenAiLookupAdapter } from './openai-lookup.adapter';

@Injectable()
export class ConfiguredLookupProviderFactory extends LookupProviderFactory {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) { super(); }
  async create(mode: Exclude<LookupMode, 'OFF'>) {
    return mode === 'MOCK' ? new MockLookupAdapter() :
      new OpenAiLookupAdapter(await loadLookupKey(this.config.get('OPENAI_API_KEY_FILE', { infer: true })));
  }
}
