import { describe, expect, expectTypeOf, it } from 'vitest';
import { CpmsIcon } from '../index';
import type { CpmsIconName, CpmsIconProps } from '../index';
import { iconRegistry } from './icon-registry';

describe('CpmsIcon', () => {
  it('renders a registered semantic icon with accessible decorative defaults', () => {
    const icon = CpmsIcon({ name: 'campaign' });

    expect(icon.type).toBe(iconRegistry.campaign);
    expect(icon.props.size).toBe(18);
    expect(icon.props.stroke).toBe(1.7);
    expect(icon.props['aria-hidden']).toBe(true);
    expect(icon.props.focusable).toBe(false);
  });

  it('forwards custom size, stroke, className, and accessible naming', () => {
    const icon = CpmsIcon({
      name: 'save',
      size: 24,
      stroke: 2,
      className: 'text-vna-blue',
      'aria-label': 'Lưu',
    });

    expect(icon.type).toBe(iconRegistry.save);
    expect(icon.props.size).toBe(24);
    expect(icon.props.stroke).toBe(2);
    expect(icon.props.className).toBe('text-vna-blue');
    expect(icon.props['aria-label']).toBe('Lưu');
    expect(icon.props.role).toBe('img');
    expect(icon.props['aria-hidden']).toBeUndefined();
  });

  it('derives the public name type from the registry', () => {
    expectTypeOf<CpmsIconProps['name']>().toEqualTypeOf<CpmsIconName>();
    expectTypeOf<'abc-nonsense-icon' extends CpmsIconName ? true : false>().toEqualTypeOf<false>();
  });
});
