import { describe, expect, it } from 'vitest';
import { allFilterOptionsSelected, toggleAllSetFilterOptions } from './column-filter-selection';

describe('filter master checkbox', () => {
  const scope = ['Ảnh', 'Video'];
  const empty = { type: 'set' as const, values: [], includeBlank: false };

  it('never checks an empty search scope even with hidden values selected', () => {
    expect(allFilterOptionsSelected([], scope, false, true)).toBe(false);
    expect(allFilterOptionsSelected([], [], true, false)).toBe(false);
    expect(allFilterOptionsSelected([], [], true, true)).toBe(true);
  });

  it('recomputes from children when an individual choice is removed then restored', () => {
    const selected = [...scope];
    expect(allFilterOptionsSelected(scope, selected, false, false)).toBe(true);
    selected.pop();
    expect(allFilterOptionsSelected(scope, selected, false, false)).toBe(false);
    expect(selected).toEqual(['Ảnh']);
    selected.push('Video');
    expect(allFilterOptionsSelected(scope, selected, false, false)).toBe(true);
  });

  it('requires all months and the unknown date when it is available', () => {
    const months = ['2026-10', '2020-02'];
    expect(allFilterOptionsSelected(months, ['2026-10'], true, true)).toBe(false);
    expect(allFilterOptionsSelected(months, months, true, false)).toBe(false);
    expect(allFilterOptionsSelected(months, months, true, true)).toBe(true);
  });

  it('is unchecked for empty or partial selection and checks itself when every item is selected', () => {
    expect(allFilterOptionsSelected([], [], false, false)).toBe(false);
    expect(allFilterOptionsSelected(scope, [], true, false)).toBe(false);
    expect(allFilterOptionsSelected(scope, ['Ảnh'], true, false)).toBe(false);
    expect(allFilterOptionsSelected(scope, scope, true, false)).toBe(false);
    expect(allFilterOptionsSelected(scope, scope, true, true)).toBe(true);
  });

  it('selects all from a partial selection and clears even hidden and blank choices', () => {
    const partial = { ...empty, values: ['Ảnh'], includeBlank: false };
    const full = toggleAllSetFilterOptions(partial, scope, true, true);
    expect(full).toEqual({ type: 'set', values: scope, includeBlank: true });
    const afterOneIsRemoved = { ...full, values: ['Ảnh'] };
    expect(allFilterOptionsSelected(scope, afterOneIsRemoved.values, true, afterOneIsRemoved.includeBlank)).toBe(false);
    expect(toggleAllSetFilterOptions(afterOneIsRemoved, scope, true, true)).toEqual(full);
    expect(toggleAllSetFilterOptions(full, scope, true, true)).toEqual(empty);
  });

  it('uses the search scope while retaining or replacing off-screen values as requested', () => {
    const existing = { ...empty, values: ['Ảnh'], includeBlank: true };
    const additive = toggleAllSetFilterOptions(existing, ['Video'], false, true);
    expect(additive).toEqual({ type: 'set', values: scope, includeBlank: true });
    expect(allFilterOptionsSelected(['Video'], additive.values, false, additive.includeBlank)).toBe(true);
    expect(toggleAllSetFilterOptions(additive, ['Video'], false, true)).toEqual(empty);
    expect(toggleAllSetFilterOptions(existing, ['Video'], false, false)).toEqual({ type: 'set', values: ['Video'], includeBlank: false });
  });
});
