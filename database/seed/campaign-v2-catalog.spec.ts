import { describe, expect, it } from 'vitest';
import { CONTENT_PILLAR_ROWS } from './campaign-v2-catalog.data';

describe('2026 communication pillar catalog', () => {
  it('offers the umbrella message with distinct, selectable child topics', () => {
    const parent = CONTENT_PILLAR_ROWS.find((item) => item.code === 'MTH2026_00');
    expect(parent).toMatchObject({ label: 'Bay cao cùng khát vọng Việt Nam', level: 1, parentCode: null });
    const children = CONTENT_PILLAR_ROWS.filter((item) => item.parentCode === parent?.code);
    expect(children.map((item) => item.label)).toEqual([
      'Dấu mốc đất nước', 'Kết nối Việt Nam và thế giới', 'Dấu mốc phát triển Vietnam Airlines',
    ]);
    expect(new Set(CONTENT_PILLAR_ROWS.map((item) => item.code)).size).toBe(CONTENT_PILLAR_ROWS.length);
  });
});
