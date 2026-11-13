import { describe, expect, it } from 'vitest';
import {
  PERSISTENCE_HINTS,
  PERSISTENCE_LABELS,
  formatBytes,
  getPersistenceState,
  getStorageUsage,
  requestPersistentStorage,
} from '../src/db/storage';

describe('formatBytes', () => {
  it('shows small values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows kilobytes with one decimal below ten', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('drops the decimal from ten upwards', () => {
    expect(formatBytes(10240)).toBe('10 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
  });

  it('scales to megabytes and gigabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('persistence labels', () => {
  it('has a label and hint for every state', () => {
    expect(Object.keys(PERSISTENCE_LABELS)).toEqual([
      'persistent',
      'best-effort',
      'unsupported',
    ]);
    expect(Object.keys(PERSISTENCE_HINTS)).toEqual([
      'persistent',
      'best-effort',
      'unsupported',
    ]);
    expect(PERSISTENCE_LABELS.persistent).toContain('protected');
    expect(PERSISTENCE_HINTS['best-effort']).toContain('backups');
  });
});

describe('storage APIs without a browser', () => {
  it('degrades cleanly when storage is unavailable', async () => {
    const state = await getPersistenceState();
    expect(['best-effort', 'unsupported', 'persistent']).toContain(state);

    const usage = await getStorageUsage();
    expect(usage === null || typeof usage.usage === 'number').toBe(true);
  });

  it('never throws when asking for protection', async () => {
    await expect(requestPersistentStorage()).resolves.toMatch(
      /^(persistent|best-effort|unsupported)$/,
    );
  });
});
