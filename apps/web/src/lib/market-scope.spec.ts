import { describe, expect, it } from 'vitest';
import { marketScopeMatches, setVisibleMarketScopeSelection } from './market-scope';

describe('market scope mini-search and select all', () => {
  it('finds Vietnamese names without requiring accents', () => {
    expect(marketScopeMatches({ code: '01', label: 'Thành phố Hà Nội' }, 'ha noi')).toBe(true);
    expect(marketScopeMatches({ code: 'JP', label: 'Nhật Bản · Đông Bắc Á' }, 'dong bac a')).toBe(true);
  });

  it('selects and clears only visible options while preserving the other selections', () => {
    expect(setVisibleMarketScopeSelection(['VN', 'JP'], ['FR', 'DE'], true)).toEqual(['VN', 'JP', 'FR', 'DE']);
    expect(setVisibleMarketScopeSelection(['VN', 'JP', 'FR'], ['JP', 'FR'], false)).toEqual(['VN']);
  });
});
