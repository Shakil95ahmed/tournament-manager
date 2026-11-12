import { useEffect, useState } from 'react';
import { APP_VERSION } from '../../config';
import {
  PERSISTENCE_HINTS,
  PERSISTENCE_LABELS,
  getPersistenceState,
  type PersistenceState,
} from '../../db/storage';
import { Icon } from '../ui/Icon';

export function AppFooter() {
  const [state, setState] = useState<PersistenceState | null>(null);

  useEffect(() => {
    let active = true;
    getPersistenceState().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <span>Tournament Manager v{APP_VERSION}</span>
        <a
          className="app-footer__link"
          href="#/data"
          title={state ? `${PERSISTENCE_HINTS[state]} Open data and backups.` : 'Open data and backups'}
        >
          <Icon name="database" size={14} />
          {state ? (
            <span>{PERSISTENCE_LABELS[state]}</span>
          ) : (
            <span>Storage: checking…</span>
          )}
        </a>
      </div>
    </footer>
  );
}
