import { describe, expect, it } from 'vitest';
import { contractEditPath, contractNewPath, matchRoute } from './router';

describe('Contract form routes', () => {
  it('opens new paid and owned forms as pages and keeps draft context in the URL', () => {
    expect(matchRoute('/contracts/new')).toEqual({ name: 'contract-new', owned: false });
    expect(matchRoute('/contracts/owned/new')).toEqual({ name: 'contract-new', owned: true });
    expect(contractNewPath({ draftId: 'draft-1' })).toBe('/contracts/new?draft=draft-1');
    expect(contractNewPath({ owned: true, activityCode: 'OWNED/WEB', draftId: 'draft-2' })).toBe('/contracts/owned/new?activity=OWNED%2FWEB&draft=draft-2');
  });

  it('opens existing records and returned requests on the edit page without matching detail', () => {
    const path = contractEditPath('contract-1');
    expect(path).toBe('/contracts/contract-1/edit');
    expect(matchRoute(path)).toEqual({ name: 'contract-edit', id: 'contract-1' });
    expect(contractEditPath('contract-1', 'request-2')).toBe('/contracts/contract-1/edit?request=request-2');
    expect(matchRoute('/contracts/contract-1')).toEqual({ name: 'contract-detail', id: 'contract-1' });
  });
});
