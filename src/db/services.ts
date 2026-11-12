import { db } from './db';
import {
  DuplicateNameError,
  NotFoundError,
  ValidationError,
  translateError,
} from './errors';
import { META_KEYS } from './meta';
import { newId, normalizeName, participantKey } from '../domain/keys';
import { validateTournamentBundle } from '../domain/validation';
import type { AppMeta, Player, Tournament, TournamentBundle } from '../domain/types';

const now = () => Date.now();

/**
 * Runs a storage operation and converts Dexie wrappers back into our own error
 * types, so every screen can rely on DuplicateNameError / NotFoundError etc.
 */
export async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateError(error);
  }
}

export async function listTournaments(): Promise<Tournament[]> {
  return db.tournaments.orderBy('createdAt').reverse().toArray();
}

export async function getTournament(id: string): Promise<Tournament | undefined> {
  return db.tournaments.get(id);
}

export async function getTournamentBundle(id: string): Promise<TournamentBundle | null> {
  return db.transaction(
    'r',
    [db.tournaments, db.players, db.participants, db.matches],
    async () => {
      const tournament = await db.tournaments.get(id);
      if (!tournament) return null;

      const [players, participants, matches] = await Promise.all([
        db.players.where('tournamentId').equals(id).toArray(),
        db.participants.where('tournamentId').equals(id).toArray(),
        db.matches.where('tournamentId').equals(id).toArray(),
      ]);

      return { tournament, players, participants, matches };
    },
  );
}

/**
 * Writes a complete tournament in one transaction: either every row lands or
 * nothing does, so a half-generated draw can never be left on the device.
 */
export async function saveTournamentBundle(bundle: TournamentBundle): Promise<void> {
  const issues = validateTournamentBundle(bundle);
  if (issues.length > 0) throw new ValidationError(issues);

  const timestamp = now();
  const tournament: Tournament = {
    ...bundle.tournament,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
  };

  await guarded(() =>
    db.transaction(
      'rw',
      [db.tournaments, db.players, db.participants, db.matches],
      async () => {
        await db.tournaments.put(tournament);
        await db.players.bulkPut(bundle.players);
        await db.participants.bulkPut(bundle.participants);
        await db.matches.bulkPut(bundle.matches);
      },
    ),
  );
}

/** Replaces the draw for an existing tournament, used when regenerating. */
export async function replaceTournamentBundle(bundle: TournamentBundle): Promise<void> {
  const issues = validateTournamentBundle(bundle);
  if (issues.length > 0) throw new ValidationError(issues);

  const timestamp = now();
  const tournament: Tournament = {
    ...bundle.tournament,
    updatedAt: timestamp,
    lastSavedAt: timestamp,
  };

  await guarded(() =>
    db.transaction(
      'rw',
      [db.tournaments, db.players, db.participants, db.matches],
      async () => {
        await db.matches.where('tournamentId').equals(tournament.id).delete();
        await db.participants.where('tournamentId').equals(tournament.id).delete();
        await db.players.where('tournamentId').equals(tournament.id).delete();
        await db.tournaments.put(tournament);
        await db.players.bulkPut(bundle.players);
        await db.participants.bulkPut(bundle.participants);
        await db.matches.bulkPut(bundle.matches);
      },
    ),
  );
}

export async function deleteTournament(id: string): Promise<void> {
  await guarded(() =>
    db.transaction(
      'rw',
      [db.tournaments, db.players, db.participants, db.matches],
      async () => {
        const tournament = await db.tournaments.get(id);
        if (!tournament) throw new NotFoundError('That tournament no longer exists.');

        await db.matches.where('tournamentId').equals(id).delete();
        await db.participants.where('tournamentId').equals(id).delete();
        await db.players.where('tournamentId').equals(id).delete();
        await db.tournaments.delete(id);
      },
    ),
  );
}

export type TournamentPatch = Partial<
  Pick<Tournament, 'name' | 'leagueName' | 'status' | 'settings' | 'startedAt' | 'completedAt'>
>;

export async function updateTournament(id: string, patch: TournamentPatch): Promise<void> {
  await guarded(() =>
    db.transaction('rw', db.tournaments, async () => {
      const tournament = await db.tournaments.get(id);
      if (!tournament) throw new NotFoundError('That tournament no longer exists.');

      const timestamp = now();
      await db.tournaments.update(id, {
        ...patch,
        updatedAt: timestamp,
        lastSavedAt: timestamp,
      });
    }),
  );
}

export async function addPlayer(tournamentId: string, name: string): Promise<Player> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError(['Player name cannot be empty.']);

  const nameKey = normalizeName(trimmed);

  return guarded(() =>
    db.transaction('rw', [db.tournaments, db.players], async () => {
      const tournament = await db.tournaments.get(tournamentId);
      if (!tournament) throw new NotFoundError('That tournament no longer exists.');

      const existing = await db.players
        .where('[tournamentId+nameKey]')
        .equals([tournamentId, nameKey])
        .first();
      if (existing) throw new DuplicateNameError('player', trimmed);

      const timestamp = now();
      const player: Player = {
        id: newId(),
        tournamentId,
        name: trimmed,
        nameKey,
        createdAt: timestamp,
      };

      await db.players.add(player);
      await db.tournaments.update(tournamentId, {
        updatedAt: timestamp,
        lastSavedAt: timestamp,
      });

      return player;
    }),
  );
}

/**
 * Renames a player and refreshes the derived keys of their team(s), so
 * duplicate detection keeps working after a correction.
 */
export async function renamePlayer(playerId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError(['Player name cannot be empty.']);

  const nameKey = normalizeName(trimmed);

  await guarded(() =>
    db.transaction(
      'rw',
      [db.tournaments, db.players, db.participants],
      async () => {
        const player = await db.players.get(playerId);
        if (!player) throw new NotFoundError('That player no longer exists.');

        const clash = await db.players
          .where('[tournamentId+nameKey]')
          .equals([player.tournamentId, nameKey])
          .first();
        if (clash && clash.id !== playerId) {
          throw new DuplicateNameError('player', trimmed);
        }

        const timestamp = now();
        await db.players.update(playerId, { name: trimmed, nameKey });

        const [players, participants] = await Promise.all([
          db.players.where('tournamentId').equals(player.tournamentId).toArray(),
          db.participants.where('tournamentId').equals(player.tournamentId).toArray(),
        ]);

        const namesById = new Map(players.map((entry) => [entry.id, entry.name]));
        const rekeys = new Map<string, string>();

        for (const participant of participants) {
          if (!participant.playerIds.includes(playerId)) continue;
          const names = participant.playerIds.map((id) => namesById.get(id) ?? '');
          const nextKey = participantKey(names);
          if (nextKey !== participant.nameKey) rekeys.set(participant.id, nextKey);
        }

        for (const [participantId, nextKey] of rekeys) {
          const takeover = participants.find(
            (other) => other.id !== participantId && other.nameKey === nextKey,
          );
          if (takeover) throw new DuplicateNameError('participant', trimmed);
        }

        for (const [participantId, nextKey] of rekeys) {
          await db.participants.update(participantId, { nameKey: nextKey });
        }

        await db.tournaments.update(player.tournamentId, {
          updatedAt: timestamp,
          lastSavedAt: timestamp,
        });
      },
    ),
  );
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const entry: AppMeta = { key, value, updatedAt: now() };
  await db.meta.put(entry);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const entry = await db.meta.get(key);
  return entry?.value as T | undefined;
}

export { META_KEYS };
