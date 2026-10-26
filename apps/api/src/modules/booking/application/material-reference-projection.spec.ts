import { describe, expect, it } from 'vitest';
import { projectMaterialReferences } from './material-reference-projection';

describe('Booking Material read projection', () => {
  it('removes inaccessible links from rows, nested effective snapshots and before/after history without changing stored data', () => {
    const secret = { materialId: 'private', materialUrl: 'https://example.test/secret', materialName: 'Private title', quantity: '20' };
    const data = { booking: { ...secret, workflow: { effective: secret } }, history: [{ data: { before: secret, after: secret } }] };
    const projected = projectMaterialReferences(data, new Set<string>());
    expect(JSON.stringify(projected)).not.toContain('secret');
    expect(JSON.stringify(projected)).not.toContain('private');
    expect(projected.booking.quantity).toBe('20');
    expect(data.booking.materialUrl).toBe('https://example.test/secret');
  });
  it('keeps authorized references and independent Booking URLs', () => {
    const rows = [{ materialId: 'visible', materialUrl: 'https://example.test/shared' }, { materialId: null, materialUrl: 'https://example.test/booking' }];
    expect(projectMaterialReferences(rows, new Set(['visible']))).toEqual(rows);
  });
});
