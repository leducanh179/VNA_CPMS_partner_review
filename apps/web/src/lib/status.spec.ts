import { describe, expect, it } from 'vitest';
import { deriveHealthTone } from './status';

describe('deriveHealthTone', () => {
  it('distinguishes connected and disconnected states', () => {
    expect(deriveHealthTone(true)).toBe('positive');
    expect(deriveHealthTone(false)).toBe('warning');
  });
});
