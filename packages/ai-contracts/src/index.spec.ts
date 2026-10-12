import { describe, expect, it } from 'vitest';
import { MockAiProvider } from './index';

describe('MockAiProvider', () => {
  it('returns a deterministic confirmation-required preview', async () => {
    const provider = new MockAiProvider();
    const result = await provider.previewCampaignIntake({
      sourceText: 'Ban TTBSP đề nghị mở chiến dịch mùa hè',
      allowedRequestingUnits: ['Ban TTBSP'],
    });

    expect(result.requestingUnit).toBe('Ban TTBSP');
    expect(result.requiresHumanConfirmation).toBe(true);
    expect(result.warnings[0]).toContain('no network call');
  });
});
