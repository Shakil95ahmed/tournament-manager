export type PersistenceState = 'persistent' | 'best-effort' | 'unsupported';

export const PERSISTENCE_LABELS: Record<PersistenceState, string> = {
  persistent: 'Storage: protected',
  'best-effort': 'Storage: may be cleared',
  unsupported: 'Storage: unavailable',
};

export const PERSISTENCE_HINTS: Record<PersistenceState, string> = {
  persistent: 'The browser will keep this site’s data until you clear it.',
  'best-effort':
    'The data is saved, but the browser may clear it if space runs low. Export backups.',
  unsupported: 'This browser cannot protect local data. Export backups regularly.',
};

function storageApi(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.storage ?? null;
}

/**
 * `persistent` means the browser will not clear this site's data to reclaim
 * space. `best-effort` is still saved locally, but the browser may evict it
 * under pressure, so the app prompts for backups.
 */
export async function getPersistenceState(): Promise<PersistenceState> {
  const api = storageApi();
  if (!api || typeof api.persisted !== 'function') return 'unsupported';
  try {
    return (await api.persisted()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser to protect this site's storage. Must be called from a user
 * gesture on some browsers, so it is triggered when a tournament is saved.
 */
export async function requestPersistentStorage(): Promise<PersistenceState> {
  const api = storageApi();
  if (!api || typeof api.persist !== 'function') return 'unsupported';

  try {
    if (await api.persisted()) return 'persistent';
    return (await api.persist()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function getStorageUsage(): Promise<StorageUsage | null> {
  const api = storageApi();
  if (!api || typeof api.estimate !== 'function') return null;

  try {
    const estimate = await api.estimate();
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') {
      return null;
    }
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0] ?? 'KB';

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}
