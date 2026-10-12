import { describe, expect, it } from 'vitest';
import { CAMPAIGN_DRIVE_UPLOAD_OPTIONS } from './campaign-drive.controller';

describe('CampaignDriveController upload transport', () => {
  it('asks the multipart parser to decode filename parameters as UTF-8', () => {
    expect(CAMPAIGN_DRIVE_UPLOAD_OPTIONS.defParamCharset).toBe('utf8');
    expect(CAMPAIGN_DRIVE_UPLOAD_OPTIONS.limits).toEqual({ files: 1, fileSize: 52_428_800 });
  });
});
