import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  title: string;
  icon?: IconName;
  children?: ReactNode;
  actions?: ReactNode;
  titleLevel?: 1 | 2 | 3;
}

export function EmptyState({
  title,
  icon = 'trophy',
  children,
  actions,
  titleLevel = 3,
}: EmptyStateProps) {
  const Heading = `h${titleLevel}` as 'h1' | 'h2' | 'h3';

  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <Heading className="empty__title">{title}</Heading>
      {children ? <p className="empty__text">{children}</p> : null}
      {actions ? <div className="empty__actions">{actions}</div> : null}
    </div>
  );
}
