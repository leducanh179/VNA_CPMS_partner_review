import { describe, expect, it } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS, ROLE_CODES } from './roles';

describe('role catalog', () => {
  it('declares the complete bootstrap catalog', () => {
    expect(ROLE_CODES).toHaveLength(15);
    expect(ROLE_CODES).toContain('GUEST');
    expect(ROLE_CODES).toContain('ADMIN');
  });

  it('keeps Guest restricted while Admin has every permission', () => {
    expect(ROLE_PERMISSIONS.GUEST).toEqual(['campaign.public.read', 'material.public.read']);
    expect(hasPermission(['GUEST'], 'system.manage')).toBe(false);
    expect(hasPermission(['ADMIN'], 'system.manage')).toBe(true);
  });
});
