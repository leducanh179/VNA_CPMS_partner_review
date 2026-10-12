import { describe, expect, it } from 'vitest';
import { CAMPAIGN_FIELD_DEFINITIONS } from './campaign-fields';
import { validateCampaignRichText } from './campaign';

describe('Campaign V2 domain contracts', () => {
  it('keeps the complete 87-field compatibility registry with explicit statuses', () => {
    expect(CAMPAIGN_FIELD_DEFINITIONS).toHaveLength(87);
    expect(new Set(CAMPAIGN_FIELD_DEFINITIONS.map((field) => field.key)).size).toBe(87);
    expect(new Set(CAMPAIGN_FIELD_DEFINITIONS.map((field) => field.status))).toEqual(
      new Set(['ACTIVE_V2', 'COMPATIBILITY', 'INACTIVE', 'DEPRECATED']),
    );
  });

  it('accepts HTTPS inline images and rejects uploads, data URLs and unsafe links', () => {
    expect(validateCampaignRichText({
      schemaVersion: 1,
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.com/image.png', alt: 'Ảnh' } }],
    })).toEqual([]);
    expect(validateCampaignRichText({
      schemaVersion: 1,
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'data:image/png;base64,abc' } },
        { type: 'link', attrs: { href: 'javascript:alert(1)' }, content: [{ type: 'text', text: 'x' }] },
      ],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('chỉ chấp nhận URL HTTPS'),
    ]));
  });
});
