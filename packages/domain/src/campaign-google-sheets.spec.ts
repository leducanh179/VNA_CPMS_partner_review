import { describe, expect, it } from 'vitest';
import { parseGoogleSpreadsheetUrl } from './campaign-google-sheets';

describe('parseGoogleSpreadsheetUrl', () => {
  it('accepts an exact Google Sheets URL and safely reads gid', () => {
    expect(parseGoogleSpreadsheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=123')).toEqual({
      spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      gid: 123,
      canonicalUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=123',
    });
  });

  it.each([
    'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    'https://docs.google.com.evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    'https://example.com/?url=https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
  ])('rejects an unsafe or unrelated URL: %s', (value) => {
    expect(parseGoogleSpreadsheetUrl(value)).toBeNull();
  });
});
