import { APP_NAME } from '../../config';
import type { Route } from '../../router';
import { Icon } from '../ui/Icon';
import { LinkButton } from '../ui/Button';

interface AppHeaderProps {
  route: Route;
}

export function AppHeader({ route }: AppHeaderProps) {
  const onDashboard = route.name === 'dashboard';
  const onData = route.name === 'data';

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="brand" href="#/">
          <span className="brand__mark">
            <Icon name="bracket" size={17} />
          </span>
          <span>
            <span className="brand__name">{APP_NAME}</span>
            <span className="brand__sub">Badminton &amp; pickleball</span>
          </span>
        </a>

        <div className="spacer" />

        <nav className="nav" aria-label="Main">
          <a className="nav__link" href="#/" aria-current={onDashboard ? 'page' : undefined}>
            Dashboard
          </a>
          <a className="nav__link" href="#/data" aria-current={onData ? 'page' : undefined}>
            Data &amp; backups
          </a>
        </nav>

        {route.name === 'dashboard' || route.name === 'create' || route.name === 'data' ? null : (
          <LinkButton
            to="/create"
            variant="primary"
            className="app-header__cta"
            aria-label="New tournament"
          >
            <Icon name="plus" size={16} />
            <span className="app-header__cta-label">New tournament</span>
          </LinkButton>
        )}
      </div>
    </header>
  );
}
