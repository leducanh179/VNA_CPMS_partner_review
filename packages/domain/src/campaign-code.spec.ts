import { describe, expect, it } from 'vitest';
import { createCampaignCodeCandidate, createCampaignCodeCandidateForPrefix, isCampaignCodeCompliant } from './campaign-code';

describe('Campaign code suffix', () => {
  it('generates alternating letters and digits with the required exclusions', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      let counter = seed;
      const draw = (limit: number) => (counter++ * 37) % limit;
      const code = createCampaignCodeCandidate(new Date('2026-10-03T00:00:00.000Z'), draw);
      expect(code).toMatch(/^CPG-202610-/);
      expect(isCampaignCodeCompliant(code)).toBe(true);
    }
  });

  it('rejects legacy suffixes, forbidden digit pairs, and a final four', () => {
    for (const code of ['CPG-202610-8188', 'CPG-202610-D32A', 'CPG-202610-A7B8', 'CPG-202610-A4B9', 'CPG-202610-A5B3', 'CPG-202610-A2B4']) {
      expect(isCampaignCodeCompliant(code)).toBe(false);
    }
    expect(isCampaignCodeCompliant('CPG-202610-7A2B')).toBe(true);
    expect(isCampaignCodeCompliant('CPG-202610-A7B2')).toBe(true);
  });

  it('preserves the original year-month prefix when correcting an existing code', () => {
    const corrected = createCampaignCodeCandidateForPrefix('CPG-202610', () => 0);
    expect(corrected).toMatch(/^CPG-202610-/);
    expect(isCampaignCodeCompliant(corrected)).toBe(true);
  });
});
