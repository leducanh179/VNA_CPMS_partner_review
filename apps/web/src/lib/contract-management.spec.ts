import { describe, expect, it } from 'vitest';
import type { SupplyContractView } from '@cpms/domain';
import { contractEditableKeys, contractHeaderChanged } from './contract-management';

describe('Contract header and item editing boundary', () => {
  const fields = Object.fromEntries(contractEditableKeys.map(key => [key, key === 'marketScope' ? 'UNSPECIFIED' : '']));
  const contract = { supplierId: null, marketCodes: [], ...fields, marketScope: 'UNSPECIFIED' } as unknown as SupplyContractView;

  it('allows item editing when legacy optional party and market fields are untouched', () => {
    expect(contractHeaderChanged(contract, fields, [], '')).toBe(false);
  });

  it('keeps item changes separate from an unsaved header or market edit', () => {
    expect(contractHeaderChanged(contract, { ...fields, serviceRecipient: 'VNA' }, [], '')).toBe(true);
    expect(contractHeaderChanged(contract, { ...fields, marketScope: 'SELECTED' }, ['VN'], '')).toBe(true);
    expect(contractHeaderChanged(contract, fields, [], 'supplier-id')).toBe(true);
  });
});
