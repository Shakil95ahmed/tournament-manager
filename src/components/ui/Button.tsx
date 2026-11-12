import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  const parts = ['btn', `btn--${variant}`, size === 'md' ? '' : `btn--${size}`];
  if (extra) parts.push(extra);
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={classes(variant, size, className)} {...rest} />;
}

type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> &
  StyleProps & {
    to: string;
    children: ReactNode;
  };

/** Navigation link styled as a button. Uses a real href so it works with keyboard and middle-click. */
export function LinkButton({
  to,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a href={`#${to}`} className={classes(variant, size, className)} {...rest}>
      {children}
    </a>
  );
}
