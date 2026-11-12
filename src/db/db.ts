import Dexie, { type Table } from 'dexie';
import type { AppMeta, Match, Participant, Player, Tournament } from '../domain/types';

export const DATABASE_NAME = 'tournament-manager';
export const DATABASE_VERSION = 2;

const STORES = {
  tournaments: 'id, status, updatedAt, createdAt',
  players: 'id, tournamentId, &[tournamentId+nameKey]',
  participants: 'id, tournamentId, &[tournamentId+nameKey], [tournamentId+groupId]',
  matches:
    'id, tournamentId, [tournamentId+stage], [tournamentId+round], [tournamentId+group], nextMatchId',
  meta: 'key',
} as const;

/**
 * All tournament data lives here, inside the browser's IndexedDB.
 * Indices are the only thing declared in `stores`; the rows themselves are
 * plain objects matching the interfaces in domain/types.ts.
 */
export class TournamentDatabase extends Dexie {
  tournaments!: Table<Tournament, string>;
  players!: Table<Player, string>;
  participants!: Table<Participant, string>;
  matches!: Table<Match, string>;
  meta!: Table<AppMeta, string>;

  constructor(name: string = DATABASE_NAME) {
    super(name);

    this.version(1).stores(STORES);

    // Version 2 adds knockout source metadata. Existing rows get explicit nulls
    // so a side without a source is still recognised as a bye.
    this.version(DATABASE_VERSION)
      .stores(STORES)
      .upgrade((transaction) =>
        transaction
          .table('matches')
          .toCollection()
          .modify((match: Record<string, unknown>) => {
            if (!('aSource' in match)) match.aSource = null;
            if (!('bSource' in match)) match.bSource = null;
            if (!Array.isArray(match.history)) match.history = [];
          }),
      );
  }
}

export const db = new TournamentDatabase();

/** Opens the database early so a blocked/denied storage can be reported once. */
export async function openDatabase(): Promise<void> {
  if (!db.isOpen()) {
    await db.open();
  }
}

export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tournaments, db.players, db.participants, db.matches, db.meta],
    async () => {
      await Promise.all([
        db.matches.clear(),
        db.participants.clear(),
        db.players.clear(),
        db.tournaments.clear(),
        db.meta.clear(),
      ]);
    },
  );
}
