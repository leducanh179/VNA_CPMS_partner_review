import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCampaignViewMode, saveCampaignViewMode } from './campaign-view-mode';

afterEach(() => vi.unstubAllGlobals());

describe('Campaign view preference', () => {
  it('opens Timeline for each account despite the previous automatic Table preference', () => {
    const values = new Map([['cpms.campaign.view-mode.v1', 'table']]);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null } });
    expect(readCampaignViewMode('guest')).toBe('timeline');
    expect(readCampaignViewMode('manager')).toBe('timeline');
  });

  it('remembers an explicit Table choice only for the account that made it', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } });
    saveCampaignViewMode('table', 'manager');
    expect(readCampaignViewMode('manager')).toBe('table');
    expect(readCampaignViewMode('guest')).toBe('timeline');
  });
});
