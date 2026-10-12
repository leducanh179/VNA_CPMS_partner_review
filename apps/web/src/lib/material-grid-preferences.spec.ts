import { describe, expect, it } from 'vitest';
import { materialGridPreferenceKeys } from './material-grid-preferences';

describe('materialGridPreferenceKeys', () => {
  it('preserves the existing Portal layout keys', () => {
    expect(materialGridPreferenceKeys()).toEqual({
      columns: 'cpms-material-visible-columns-v3',
      pinned: 'cpms-material-pinned-columns-v2',
      widths: 'cpms-material-column-widths-v1',
    });
  });

  it('isolates every Campaign tab layout by effective account and Campaign ID', () => {
    const portal = materialGridPreferenceKeys();
    const first = materialGridPreferenceKeys({ actorId: 'actor-a', campaignId: 'campaign-a' });
    expect(first).toEqual(materialGridPreferenceKeys({ actorId: 'actor-a', campaignId: 'campaign-a' }));
    expect(Object.values(first)).not.toContain(portal.columns);
    expect(Object.values(first)).not.toContain(portal.pinned);
    expect(Object.values(first)).not.toContain(portal.widths);
    expect(first).not.toEqual(materialGridPreferenceKeys({ actorId: 'actor-a', campaignId: 'campaign-b' }));
    expect(first).not.toEqual(materialGridPreferenceKeys({ actorId: 'actor-b', campaignId: 'campaign-a' }));
  });
});
