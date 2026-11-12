import { newId } from '../domain/keys';
import { db } from './db';
import { META_KEYS } from './meta';

export type ActivityKind = 'export' | 'import';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  at: number;
  tournaments: number;
  entries: number;
  matches: number;
  fileName: string | null;
}

/** Keep the list short; this is a convenience history, not an audit log. */
export const ACTIVITY_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseEntry(value: unknown): ActivityEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (value.kind !== 'export' && value.kind !== 'import') return null;
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
  if (!isCount(value.tournaments) || !isCount(value.entries) || !isCount(value.matches)) {
    return null;
  }
  if (value.fileName !== null && typeof value.fileName !== 'string') return null;

  return {
    id: value.id,
    kind: value.kind,
    at: value.at,
    tournaments: value.tournaments,
    entries: value.entries,
    matches: value.matches,
    fileName: value.fileName,
  };
}

/** Defensive read of the stored value: unknown or damaged rows are ignored. */
export function parseActivity(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(parseEntry)
    .filter((entry): entry is ActivityEntry => entry !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, ACTIVITY_LIMIT);
}

/** Newest first, capped at ACTIVITY_LIMIT. Kept pure so it is easy to test. */
export function appendActivity(
  entries: readonly ActivityEntry[],
  entry: ActivityEntry,
  limit: number = ACTIVITY_LIMIT,
): ActivityEntry[] {
  return [entry, ...entries].slice(0, limit);
}

export async function readActivity(): Promise<ActivityEntry[]> {
  const row = await db.meta.get(META_KEYS.activity);
  return parseActivity(row?.value);
}

export async function logActivity(
  input: Omit<ActivityEntry, 'id'> & { id?: string },
): Promise<ActivityEntry> {
  const entry: ActivityEntry = {
    ...input,
    id: input.id ?? newId(),
  };

  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(META_KEYS.activity);
    const next = appendActivity(parseActivity(row?.value), entry);
    await db.meta.put({
      key: META_KEYS.activity,
      value: next,
      updatedAt: Date.now(),
    });
  });

  return entry;
}

export async function clearActivity(): Promise<void> {
  await db.meta.delete(META_KEYS.activity);
}
