import type { IconProps } from '@tabler/icons-react';
import { iconRegistry } from './icon-registry';
import type { CpmsIconName } from './icon-registry';

export interface CpmsIconProps extends Omit<IconProps, 'name' | 'size' | 'stroke'> {
  name: CpmsIconName;
  size?: IconProps['size'];
  stroke?: IconProps['stroke'];
}

export function CpmsIcon({
  name,
  size = 18,
  stroke = 1.7,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-hidden': ariaHidden,
  focusable,
  role,
  title,
  ...props
}: CpmsIconProps) {
  const IconComponent = iconRegistry[name];
  const hasAccessibleName = Boolean(ariaLabel || ariaLabelledBy || title);
  const resolvedAriaHidden = ariaHidden ?? (hasAccessibleName ? undefined : true);
  const resolvedRole = role ?? (hasAccessibleName ? 'img' : undefined);

  return (
    <IconComponent
      {...props}
      size={size}
      stroke={stroke}
      focusable={focusable ?? false}
      {...(title === undefined ? {} : { title })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      {...(ariaLabelledBy === undefined ? {} : { 'aria-labelledby': ariaLabelledBy })}
      {...(resolvedAriaHidden === undefined ? {} : { 'aria-hidden': resolvedAriaHidden })}
      {...(resolvedRole === undefined ? {} : { role: resolvedRole })}
    />
  );
}
