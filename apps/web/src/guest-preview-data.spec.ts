import { describe, expect, it } from 'vitest';
import { guestRoute } from './guest-preview-data';

describe('anonymous Guest route boundary', () => {
  it('opens the four local forms and Campaign information by UUID only', () => {
    for (const path of ['/campaigns/new', '/contracts/new', '/bookings/new', '/materials/new']) expect(guestRoute(path).kind).toBe('form');
    expect(guestRoute('/campaigns/113ad11f-9c8d-4780-b045-91050e621f51')).toEqual({ kind: 'campaign-info', id: '113ad11f-9c8d-4780-b045-91050e621f51' });
    expect(guestRoute('/campaigns/real-campaign-id').kind).toBe('denied');
  });

  it('denies record detail, catalogs, directory, admin and edit routes', () => {
    for (const path of ['/contracts/123', '/bookings/123', '/materials/123/edit', '/campaigns/demo-campaign-01/edit', '/qctt-plans/123', '/catalogs/qctt', '/directory', '/admin/system']) {
      expect(guestRoute(path).kind).toBe('denied');
    }
  });
});
