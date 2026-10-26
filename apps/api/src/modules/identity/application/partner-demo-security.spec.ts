import { describe, expect, it } from 'vitest';
import { partnerDemoRequestAllowed } from './partner-demo-security';

describe('partner demo HTTP backstop', () => {
  it('allows reads and private form/grid input, while blocking business, cloud and security mutations', () => {
    const id = '10000000-0000-4000-8000-000000000099';
    for (const module of ['campaign', 'contract', 'material']) {
      expect(partnerDemoRequestAllowed('PUT', `/api/${module}-form-drafts/${id}`)).toBe(true);
      expect(partnerDemoRequestAllowed('DELETE', `/api/${module}-form-drafts/${id}`)).toBe(true);
    }
    expect(partnerDemoRequestAllowed('PUT', '/api/grid-drafts/cpms.booking.partner-form.v1')).toBe(true);
    expect(partnerDemoRequestAllowed('POST', '/api/auth/logout')).toBe(true);
    for (const route of ['/api/campaigns', '/api/contracts', '/api/bookings/batch-save', '/api/materials/batch-save', '/api/access/commands', '/api/auth/accounts/partner-demos', '/api/google/connect']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(partnerDemoRequestAllowed(method, route), `${method} ${route}`).toBe(false);
    }
    expect(partnerDemoRequestAllowed('GET', '/api/directory/people')).toBe(false);
    expect(partnerDemoRequestAllowed('POST', `/api/campaign-form-drafts/${id}`)).toBe(false);
    expect(partnerDemoRequestAllowed('PUT', '/api/grid-drafts/../contracts')).toBe(false);
  });
});
