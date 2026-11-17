import { useState } from 'react';
import { navigate } from '../../router';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

const NOTICE_KEY = 'tournament-manager.browser-data-notice.v1';

function hasSeenNotice(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === 'seen';
  } catch {
    return false;
  }
}

function rememberNotice(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, 'seen');
  } catch {
    // Private modes can block storage; showing the note again is harmless.
  }
}

/**
 * First-visit warning: tournaments are stored in this browser only, so a
 * "clear browsing data" action wipes them as well. Dismissing remembers the
 * choice in localStorage, which is separate from the tournament database.
 */
export function StorageNotice() {
  const [open, setOpen] = useState(() => !hasSeenNotice());

  if (!open) return null;

  const dismiss = () => {
    rememberNotice();
    setOpen(false);
  };

  return (
    <Dialog label="Browser data warning" onClose={dismiss}>
      <div className="stack">
        <div>
          <div className="field__label">Before you start</div>
          <h2 className="section-title">Your tournaments live in this browser</h2>
        </div>

        <p className="page-sub">
          Everything you create is saved on this device. There is no account and no server copy.
        </p>

        <div className="notice notice--warn" role="alert">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            Clearing your browser data — cookies and site data, storage, or a full history wipe —
            deletes your tournaments, entries and results too. Private browsing clears them when
            the window closes.
          </div>
        </div>

        <p className="page-sub">
          Export a backup from Data &amp; backups before you clear anything.
        </p>

        <div className="data-actions">
          <Button variant="primary" data-autofocus onClick={dismiss}>
            Got it
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              dismiss();
              navigate('/data');
            }}
          >
            Open data &amp; backups
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
