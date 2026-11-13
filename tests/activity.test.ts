import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVITY_LIMIT,
  appendActivity,
  clearActivity,
  logActivity,
  parseActivity,
  readActivity,
  type ActivityEntry,
} from '../src/db/activity';
import { clearAllTables, db } from '../src/db/db';
import { META_KEYS } from '../src/db/meta';

beforeEach(async () => {
  await clearAllTables();
});

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'entry-1',
    kind: 'export',
    at: 1_700_000_000_000,
    tournaments: 2,
    entries: 8,
    matches: 14,
    fileName: 'tournaments-2023-11-14.json',
    ...overrides,
  };
}

describe('parseActivity', () => {
  it('returns an empty list for missing or non-array values', () => {
    expect(parseActivity(undefined)).toEqual([]);
    expect(parseActivity(null)).toEqual([]);
    expect(parseActivity({})).toEqual([]);
    expect(parseActivity('nope')).toEqual([]);
  });

  it('drops damaged entries and keeps valid ones newest first', () => {
    const older = entry({ id: 'older', at: 1000 });
    const newer = entry({ id: 'newer', at: 2000 });

    const result = parseActivity([
      older,
      { id: 'bad-kind', kind: 'delete', at: 1 },
      { id: 'bad-count', kind: 'export', at: 1, tournaments: -1, entries: 0, matches: 0 },
      { id: 'no-file', kind: 'export', at: 1, tournaments: 0, entries: 0, matches: 0 },
      newer,
    ]);

    expect(result.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(result[0]).toMatchObject({ kind: 'export', tournaments: 2 });
    expect(result[1]?.fileName).toBe('tournaments-2023-11-14.json');
  });

  it('accepts an import entry with no file name', () => {
    const result = parseActivity([entry({ kind: 'import', fileName: null })]);

    expect(result).toHaveLength(1);
    expect(result[0]?.fileName).toBeNull();
  });

  it('caps a damaged oversized list at the activity limit', () => {
    const many = Array.from({ length: ACTIVITY_LIMIT + 5 }, (_, index) =>
      entry({ id: `entry-${index}`, at: index + 1 }),
    );

    expect(parseActivity(many)).toHaveLength(ACTIVITY_LIMIT);
    expect(parseActivity(many)[0]?.at).toBe(ACTIVITY_LIMIT + 5);
  });
});

describe('appendActivity', () => {
  it('puts the newest entry first', () => {
    const older = entry({ id: 'older' });
    const newer = entry({ id: 'newer' });

    expect(appendActivity([older], newer).map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('drops the oldest entry beyond the limit', () => {
    const existing = Array.from({ length: 3 }, (_, index) => entry({ id: `old-${index}` }));

    const result = appendActivity(existing, entry({ id: 'new' }), 3);

    expect(result.map((item) => item.id)).toEqual(['new', 'old-0', 'old-1']);
  });
});

describe('activity storage', () => {
  it('starts empty', async () => {
    expect(await readActivity()).toEqual([]);
  });

  it('logs entries newest first and updates the stored meta key', async () => {
    await logActivity(entry({ id: 'first', at: 1000 }));
    await logActivity(entry({ id: 'second', kind: 'import', at: 2000, fileName: null }));

    const stored = await db.meta.get(META_KEYS.activity);
    expect(stored).toBeDefined();
    expect(stored?.value).toHaveLength(2);

    const activity = await readActivity();
    expect(activity.map((item) => item.id)).toEqual(['second', 'first']);
    expect(activity[0]).toMatchObject({ kind: 'import', fileName: null });
  });

  it('returns the created entry with a generated id', async () => {
    const created = await logActivity({
      kind: 'export',
      at: 1234,
      tournaments: 1,
      entries: 2,
      matches: 3,
      fileName: 'backup.json',
    });

    expect(created.id).toBeTruthy();
    expect(created).toMatchObject({ kind: 'export', at: 1234, tournaments: 1 });
  });

  it('keeps at most the activity limit', async () => {
    for (let index = 0; index < ACTIVITY_LIMIT + 3; index += 1) {
      await logActivity(entry({ id: `entry-${index}`, at: index + 1 }));
    }

    expect(await readActivity()).toHaveLength(ACTIVITY_LIMIT);
  });

  it('recovers from a damaged stored value instead of throwing', async () => {
    await db.meta.put({ key: META_KEYS.activity, value: 'not a list', updatedAt: 1 });

    expect(await readActivity()).toEqual([]);

    await logActivity(entry({ id: 'fresh' }));
    expect((await readActivity()).map((item) => item.id)).toEqual(['fresh']);
  });

  it('clears only the history, leaving other meta rows alone', async () => {
    await db.meta.put({ key: META_KEYS.lastBackupAt, value: 99, updatedAt: 1 });
    await logActivity(entry());

    await clearActivity();

    expect(await readActivity()).toEqual([]);
    expect((await db.meta.get(META_KEYS.lastBackupAt))?.value).toBe(99);
  });
});
