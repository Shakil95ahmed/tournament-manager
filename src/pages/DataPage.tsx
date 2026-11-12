import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, LinkButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Icon } from '../components/ui/Icon';
import {
  backupFileName,
  createBackup,
  parseBackupJson,
  restoreBackup,
  serializeBackup,
  type BackupFile,
} from '../db/backup';
import {
  clearActivity,
  logActivity,
  parseActivity,
  type ActivityEntry,
} from '../db/activity';
import { db } from '../db/db';
import { META_KEYS } from '../db/meta';
import { setMeta } from '../db/services';
import {
  PERSISTENCE_HINTS,
  PERSISTENCE_LABELS,
  formatBytes,
  getPersistenceState,
  getStorageUsage,
  requestPersistentStorage,
  type PersistenceState,
  type StorageUsage,
} from '../db/storage';
import { formatDateTime, plural } from '../domain/display';

type FeedbackTone = 'success' | 'info' | 'warn' | 'danger';

interface Feedback {
  tone: FeedbackTone;
  title: string;
  message?: string;
  issues?: string[];
}

interface PendingImport {
  backup: BackupFile;
  fileName: string;
}

function feedbackIcon(tone: FeedbackTone) {
  if (tone === 'success') return 'check' as const;
  if (tone === 'info') return 'info' as const;
  return 'warning' as const;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function metaNumber(rows: Map<string, unknown>, key: string): number | null {
  const value = rows.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FeedbackNotice({ feedback }: { feedback: Feedback }) {
  return (
    <div
      className={`notice notice--${feedback.tone}`}
      role={feedback.tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="notice__icon">
        <Icon name={feedbackIcon(feedback.tone)} size={18} />
      </span>
      <div className="notice__body">
        <div className="notice__title">{feedback.title}</div>
        {feedback.message ? <div>{feedback.message}</div> : null}
        {feedback.issues && feedback.issues.length > 0 ? (
          <ul className="notice__list">
            {feedback.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="activity-item">
      <span className={`activity-item__icon activity-item__icon--${entry.kind}`}>
        <Icon name={entry.kind === 'export' ? 'download' : 'upload'} size={16} />
      </span>
      <div>
        <div className="activity-item__title">
          {entry.kind === 'export' ? 'Backup downloaded' : 'Backup restored'}
        </div>
        <div className="activity-item__meta">
          {formatDateTime(entry.at)} · {plural(entry.tournaments, 'tournament')} ·{' '}
          {plural(entry.entries, 'entry', 'entries')} · {plural(entry.matches, 'match', 'matches')}
        </div>
        {entry.fileName ? <div className="activity-item__file">{entry.fileName}</div> : null}
      </div>
    </li>
  );
}

export function DataPage() {
  const data = useLiveQuery(async () => {
    const [tournaments, entries, matches, metaRows] = await Promise.all([
      db.tournaments.count(),
      db.participants.count(),
      db.matches.count(),
      db.meta.toArray(),
    ]);
    const meta = new Map(metaRows.map((row) => [row.key, row.value]));

    return {
      tournaments,
      entries,
      matches,
      activity: parseActivity(meta.get(META_KEYS.activity)),
      lastBackupAt: metaNumber(meta, META_KEYS.lastBackupAt),
      lastImportAt: metaNumber(meta, META_KEYS.lastImportAt),
    };
  }, []);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceState | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  const refreshStorage = useCallback(async () => {
    const [nextPersistence, nextUsage] = await Promise.all([
      getPersistenceState(),
      getStorageUsage(),
    ]);
    setPersistence(nextPersistence);
    setUsage(nextUsage);
  }, []);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage]);

  const handleExport = async () => {
    if (!data || data.tournaments === 0) return;
    setBusy('export');
    setFeedback(null);

    try {
      const backup = await createBackup();
      const fileName = backupFileName(new Date(backup.exportedAt));
      downloadTextFile(fileName, serializeBackup(backup));
      await setMeta(META_KEYS.lastBackupAt, backup.exportedAt);
      await logActivity({
        kind: 'export',
        at: backup.exportedAt,
        tournaments: backup.tournaments.length,
        entries: backup.participants.length,
        matches: backup.matches.length,
        fileName,
      });
      await refreshStorage();
      setFeedback({
        tone: 'success',
        title: 'Backup downloaded',
        message: `${plural(backup.tournaments.length, 'tournament')}, ${plural(
          backup.participants.length,
          'entry',
          'entries',
        )} and ${plural(backup.matches.length, 'match', 'matches')} saved to ${fileName}.`,
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Export failed',
        message: errorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    setFeedback(null);
    setImportError(null);
    setPending(null);

    try {
      const text = await file.text();
      const result = parseBackupJson(text);
      if (!result.ok) {
        setFeedback({
          tone: 'danger',
          title: 'That file cannot be restored',
          issues: result.errors.slice(0, 8),
          message:
            result.errors.length > 8
              ? `Showing 8 of ${result.errors.length} problems. Nothing was changed.`
              : 'Nothing was changed.',
        });
        return;
      }
      setPending({ backup: result.backup, fileName: file.name });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'That file could not be read',
        message: errorMessage(error),
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!pending) return;
    setBusy('import');
    setImportError(null);

    try {
      await restoreBackup(pending.backup);
      await logActivity({
        kind: 'import',
        at: Date.now(),
        tournaments: pending.backup.tournaments.length,
        entries: pending.backup.participants.length,
        matches: pending.backup.matches.length,
        fileName: pending.fileName,
      });
      await refreshStorage();
      setPending(null);
      setFeedback({
        tone: 'success',
        title: 'Backup restored',
        message: `${plural(pending.backup.tournaments.length, 'tournament')}, ${plural(
          pending.backup.participants.length,
          'entry',
          'entries',
        )} and ${plural(pending.backup.matches.length, 'match', 'matches')} now replace the data on this device.`,
      });
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const handleProtectStorage = async () => {
    setStorageBusy(true);
    try {
      const next = await requestPersistentStorage();
      setPersistence(next);
      await refreshStorage();
      setFeedback(
        next === 'persistent'
          ? {
              tone: 'success',
              title: 'Storage protected',
              message: 'The browser will keep this site’s data until you clear it.',
            }
          : {
              tone: 'warn',
              title: 'Storage protection was not granted',
              message:
                'The data is still saved, but the browser may clear it when space runs low. Keep exporting backups.',
            },
      );
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Could not ask for storage protection',
        message: errorMessage(error),
      });
    } finally {
      setStorageBusy(false);
    }
  };

  const handleClearHistory = async () => {
    if (
      !window.confirm(
        'Clear the backup history on this device? Your tournaments will not be touched.',
      )
    ) {
      return;
    }

    try {
      await clearActivity();
      setFeedback({ tone: 'info', title: 'Backup history cleared' });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Could not clear the history',
        message: errorMessage(error),
      });
    }
  };

  if (!data) {
    return (
      <div className="page">
        <div className="card card--pad">
          <p className="muted">Loading backup and storage details…</p>
        </div>
      </div>
    );
  }

  const usagePercent =
    usage && usage.quota > 0
      ? Math.min(100, Math.max(0, Math.round((usage.usage / usage.quota) * 100)))
      : null;
  const pendingTournaments = pending?.backup.tournaments ?? [];
  const backupPreview = pendingTournaments.slice(0, 3);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Data &amp; backups</h1>
          <p className="page-sub">
            Export a JSON copy before a big day, restore it on another device, and see how much
            space your tournaments use. Nothing is uploaded anywhere.
          </p>
        </div>
        <LinkButton to="/" variant="secondary">
          <Icon name="arrowLeft" size={17} />
          Dashboard
        </LinkButton>
      </header>

      {feedback ? <FeedbackNotice feedback={feedback} /> : null}

      <div className="stat-grid" style={{ marginTop: 'var(--s4)' }}>
        <Stat label="Tournaments" value={data.tournaments} />
        <Stat label="Entries" value={data.entries} />
        <Stat label="Matches" value={data.matches} />
        <Stat
          label="Storage used"
          value={usage ? formatBytes(usage.usage) : 'Not available'}
        />
      </div>

      <div className="data-grid">
        <section className="card card__body stack" aria-labelledby="export-heading">
          <div className="data-card__head">
            <div>
              <h2 className="section-title" id="export-heading">
                Export a backup
              </h2>
              <p className="page-sub">
                One JSON file holds every tournament, entry, fixture and result on this device.
              </p>
            </div>
            <span className="badge badge--accent">JSON</span>
          </div>

          <div className="notice notice--info">
            <span className="notice__icon">
              <Icon name="info" size={18} />
            </span>
            <div className="notice__body">
              Keep the file somewhere safe. It is the only way to move or recover this data if the
              browser is cleared.
            </div>
          </div>

          <div className="data-actions">
            <Button
              variant="primary"
              onClick={() => void handleExport()}
              disabled={busy !== null || data.tournaments === 0}
            >
              <Icon name="download" size={17} />
              {busy === 'export' ? 'Preparing…' : 'Download backup'}
            </Button>
            {data.tournaments === 0 ? (
              <span className="small muted">Create a tournament first.</span>
            ) : null}
          </div>

          <p className="small muted">
            Last export: {data.lastBackupAt ? formatDateTime(data.lastBackupAt) : 'Never'}
          </p>
        </section>

        <section className="card card__body stack" aria-labelledby="import-heading">
          <div className="data-card__head">
            <div>
              <h2 className="section-title" id="import-heading">
                Restore a backup
              </h2>
              <p className="page-sub">
                Choose a backup file, check what it contains, then confirm the restore.
              </p>
            </div>
            <span className="badge">Replace</span>
          </div>

          <label className="field">
            <span className="field__label">Backup file</span>
            <input
              className="input"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void handleFile(event)}
              disabled={busy !== null}
            />
          </label>

          <div className="notice notice--warn">
            <span className="notice__icon">
              <Icon name="warning" size={18} />
            </span>
            <div className="notice__body">
              Restoring replaces all {plural(data.tournaments, 'tournament')} currently on this
              device. Export first if you might need the current data.
            </div>
          </div>

          <p className="small muted">
            Last restore: {data.lastImportAt ? formatDateTime(data.lastImportAt) : 'Never'}
          </p>
        </section>

        <section className="card card__body stack" aria-labelledby="storage-heading">
          <div className="data-card__head">
            <div>
              <h2 className="section-title" id="storage-heading">
                Storage on this device
              </h2>
              <p className="page-sub">
                This is the browser’s estimate for the whole site, not just the tournament data.
              </p>
            </div>
            <Icon name="database" size={20} />
          </div>

          <div>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <span
                className={
                  persistence === 'persistent'
                    ? 'badge badge--success'
                    : persistence === 'best-effort'
                      ? 'badge badge--warn'
                      : 'badge'
                }
              >
                {persistence ? PERSISTENCE_LABELS[persistence] : 'Storage: checking…'}
              </span>
            </div>
            <p className="small muted" style={{ marginTop: 'var(--s2)' }}>
              {persistence
                ? PERSISTENCE_HINTS[persistence]
                : 'Checking whether this browser will keep the data.'}
            </p>
          </div>

          <div>
            <div
              className="storage-meter"
              role="img"
              aria-label={
                usagePercent === null
                  ? 'Storage usage is not available'
                  : `${usagePercent}% of the browser quota is used`
              }
            >
              <span
                className="storage-meter__fill"
                style={{ width: `${usagePercent === null ? 0 : Math.max(usagePercent, 2)}%` }}
              />
            </div>
            <p className="small muted" style={{ marginTop: 'var(--s1)' }}>
              {usage
                ? `${formatBytes(usage.usage)} used of ${formatBytes(usage.quota)}${
                    usagePercent === null ? '' : ` (${usagePercent}%)`
                  }.`
                : 'Storage usage is not available in this browser.'}
            </p>
          </div>

          {persistence === 'best-effort' ? (
            <div className="data-actions">
              <Button
                variant="secondary"
                onClick={() => void handleProtectStorage()}
                disabled={storageBusy}
              >
                <Icon name="database" size={17} />
                {storageBusy ? 'Asking…' : 'Protect this storage'}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="card card__body stack" aria-labelledby="history-heading">
          <div className="data-card__head">
            <div>
              <h2 className="section-title" id="history-heading">
                Backup history
              </h2>
              <p className="page-sub">
                The 20 most recent exports and restores on this device.
              </p>
            </div>
            {data.activity.length > 0 ? (
              <Button variant="ghost" onClick={() => void handleClearHistory()}>
                Clear history
              </Button>
            ) : (
              <span className="badge">{data.activity.length}</span>
            )}
          </div>

          {data.activity.length === 0 ? (
            <p className="muted small">
              No backups yet. Your first export or restore will appear here.
            </p>
          ) : (
            <ul className="activity-list">
              {data.activity.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {pending ? (
        <Dialog
          label="Confirm backup restore"
          onClose={() => {
            if (busy !== 'import') setPending(null);
          }}
        >
          <div className="stack">
            <div>
              <div className="field__label">Restore backup</div>
              <h2 className="section-title">Replace all data?</h2>
              <p className="page-sub">
                This will remove the {plural(data.tournaments, 'tournament')} currently on this
                device, then load the backup below.
              </p>
            </div>

            <dl className="data-facts">
              <div className="data-fact">
                <dt>File</dt>
                <dd>{pending.fileName}</dd>
              </div>
              <div className="data-fact">
                <dt>Exported</dt>
                <dd>{formatDateTime(pending.backup.exportedAt)}</dd>
              </div>
              <div className="data-fact">
                <dt>Contents</dt>
                <dd>
                  {plural(pending.backup.tournaments.length, 'tournament')} ·{' '}
                  {plural(pending.backup.participants.length, 'entry', 'entries')} ·{' '}
                  {plural(pending.backup.matches.length, 'match', 'matches')}
                </dd>
              </div>
            </dl>

            {backupPreview.length > 0 ? (
              <div>
                <div className="field__label">Tournaments in this backup</div>
                <ul className="data-file-list">
                  {backupPreview.map((tournament) => (
                    <li key={tournament.id}>{tournament.name}</li>
                  ))}
                  {pendingTournaments.length > backupPreview.length ? (
                    <li>and {pendingTournaments.length - backupPreview.length} more</li>
                  ) : null}
                </ul>
              </div>
            ) : (
              <div className="notice notice--warn">
                <span className="notice__icon">
                  <Icon name="warning" size={18} />
                </span>
                <div className="notice__body">
                  This backup contains no tournaments. Restoring it will leave this device empty.
                </div>
              </div>
            )}

            {importError ? (
              <div className="notice notice--danger" role="alert">
                <span className="notice__icon">
                  <Icon name="warning" size={18} />
                </span>
                <div className="notice__body">{importError}</div>
              </div>
            ) : null}

            <div className="data-actions">
              <Button
                variant="danger"
                onClick={() => void handleConfirmImport()}
                disabled={busy !== null}
              >
                <Icon name="upload" size={17} />
                {busy === 'import' ? 'Restoring…' : 'Replace this device’s data'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setPending(null)}
                disabled={busy !== null}
                data-autofocus
              >
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
