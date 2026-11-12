import { db } from './db';
import { DuplicateNameError, NotFoundError, ValidationError } from './errors';
import { guarded } from './services';
import { newId, normalizeName, participantKey } from '../domain/keys';
import { groupLabels, playerCount, previewGroupKeys } from '../domain/setup';
import type { Participant, Player, Tournament } from '../domain/types';

export interface NewEntryInput {
  playerNames: string[];
  teamName?: string | null;
  groupId?: string | null;
  active?: boolean;
}

export interface EntryPatch {
  playerNames?: string[];
  teamName?: string | null;
  groupId?: string | null;
  active?: boolean;
}

const MAX_ACTIVE = 64;

async function requireDraft(tournamentId: string): Promise<Tournament> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament) throw new NotFoundError('That tournament no longer exists.');
  if (tournament.status !== 'draft') {
    throw new ValidationError([
      'Entries can only be changed before the draw is generated. Clear the draw first.',
    ]);
  }
  return tournament;
}

function normalizeEntryNames(playerNames: string[], discipline: Tournament['settings']['discipline']): string[] {
  const expected = playerCount(discipline);
  const names = playerNames.map((name) => name.trim());

  if (names.length !== expected) {
    throw new ValidationError([`A ${discipline} entry needs ${expected} player name(s).`]);
  }
  if (names.some((name) => name.length === 0)) {
    throw new ValidationError(['Every player name is required.']);
  }
  if (new Set(names.map(normalizeName)).size !== names.length) {
    throw new ValidationError(['A player cannot appear twice in the same entry.']);
  }
  return names;
}

function resolveGroupId(tournament: Tournament, groupId: string | null | undefined): string | null {
  if (groupId === null || groupId === undefined) return null;
  if (tournament.settings.format !== 'groups-knockout') {
    throw new ValidationError(['Groups are only used by the groups + knockout format.']);
  }
  if (!groupLabels(tournament.settings.groupCount).includes(groupId)) {
    throw new ValidationError([`Group "${groupId}" is not part of this setup.`]);
  }
  return groupId;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nextCreatedAt(participants: Participant[], now: number): number {
  let highest = now - 1;
  for (const participant of participants) {
    if (participant.createdAt > highest) highest = participant.createdAt;
  }
  return highest + 1;
}

async function touchTournament(
  tournament: Tournament,
  participantCount: number,
  timestamp: number,
): Promise<void> {
  await db.tournaments.update(tournament.id, {
    settings: { ...tournament.settings, participantCount },
    updatedAt: timestamp,
    lastSavedAt: timestamp,
  });
}

export async function addEntry(tournamentId: string, input: NewEntryInput): Promise<Participant> {
  return guarded(() =>
    db.transaction('rw', [db.tournaments, db.players, db.participants], async () => {
      const tournament = await requireDraft(tournamentId);
      const names = normalizeEntryNames(input.playerNames, tournament.settings.discipline);
      const nameKey = participantKey(names);

      const participants = await db.participants
        .where('tournamentId')
        .equals(tournamentId)
        .toArray();
      if (participants.some((participant) => participant.nameKey === nameKey)) {
        throw new DuplicateNameError('participant', names.join(' & '));
      }

      const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
      const takenNames = new Set(players.map((player) => player.nameKey));
      for (const name of names) {
        if (takenNames.has(normalizeName(name))) {
          throw new DuplicateNameError('player', name);
        }
      }

      const active = input.active ?? true;
      const activeCount = participants.filter((participant) => participant.active).length;
      if (active && activeCount >= MAX_ACTIVE) {
        throw new ValidationError([`A draw can hold at most ${MAX_ACTIVE} active entries.`]);
      }

      const groupId = resolveGroupId(tournament, input.groupId);
      const timestamp = Date.now();
      const createdAt = nextCreatedAt(participants, timestamp);

      const newPlayers: Player[] = names.map((name, index) => ({
        id: newId(),
        tournamentId,
        name,
        nameKey: normalizeName(name),
        createdAt: createdAt + index,
      }));

      const participant: Participant = {
        id: newId(),
        tournamentId,
        playerIds: newPlayers.map((player) => player.id),
        nameKey,
        teamName: trimOrNull(input.teamName),
        seed: participants.length + 1,
        groupId,
        active,
        createdAt,
      };

      await db.players.bulkAdd(newPlayers);
      await db.participants.add(participant);
      await touchTournament(
        tournament,
        activeCount + (active ? 1 : 0),
        timestamp,
      );

      return participant;
    }),
  );
}

export async function updateEntry(
  tournamentId: string,
  participantId: string,
  patch: EntryPatch,
): Promise<Participant> {
  return guarded(() =>
    db.transaction('rw', [db.tournaments, db.players, db.participants], async () => {
      const tournament = await requireDraft(tournamentId);
      const participant = await db.participants.get(participantId);
      if (!participant || participant.tournamentId !== tournamentId) {
        throw new NotFoundError('That entry no longer exists.');
      }

      const participants = await db.participants
        .where('tournamentId')
        .equals(tournamentId)
        .toArray();
      const others = participants.filter((entry) => entry.id !== participantId);

      const currentPlayers = (
        await db.players.bulkGet(participant.playerIds)
      ).filter((player): player is Player => Boolean(player));

      const names =
        patch.playerNames !== undefined
          ? normalizeEntryNames(patch.playerNames, tournament.settings.discipline)
          : currentPlayers.map((player) => player.name);

      if (names.length === 0) {
        throw new ValidationError(['Every player name is required.']);
      }

      const nameKey = participantKey(names);
      if (others.some((entry) => entry.nameKey === nameKey)) {
        throw new DuplicateNameError('participant', names.join(' & '));
      }

      const oldIds = new Set(participant.playerIds);
      const otherPlayers = await db.players.where('tournamentId').equals(tournamentId).toArray();
      const takenNames = new Set(
        otherPlayers
          .filter((player) => !oldIds.has(player.id))
          .map((player) => player.nameKey),
      );
      for (const name of names) {
        if (takenNames.has(normalizeName(name))) {
          throw new DuplicateNameError('player', name);
        }
      }

      const active = patch.active ?? participant.active;
      const activeOthers = others.filter((entry) => entry.active).length;
      if (active && !participant.active && activeOthers >= MAX_ACTIVE) {
        throw new ValidationError([`A draw can hold at most ${MAX_ACTIVE} active entries.`]);
      }

      const groupId =
        patch.groupId !== undefined
          ? resolveGroupId(tournament, patch.groupId)
          : participant.groupId;

      const timestamp = Date.now();
      let playerIds = participant.playerIds;

      if (patch.playerNames !== undefined) {
        const byName = new Map(currentPlayers.map((player) => [player.nameKey, player]));
        const nextPlayers: Player[] = [];
        const nextIds: string[] = [];

        names.forEach((name, index) => {
          const key = normalizeName(name);
          const reused = byName.get(key);
          if (reused) {
            nextIds.push(reused.id);
            return;
          }

          const created: Player = {
            id: newId(),
            tournamentId,
            name,
            nameKey: key,
            createdAt: timestamp + index,
          };
          nextPlayers.push(created);
          nextIds.push(created.id);
        });

        const keep = new Set(nextIds);
        const removeIds = participant.playerIds.filter((id) => !keep.has(id));
        if (removeIds.length > 0) await db.players.bulkDelete(removeIds);
        if (nextPlayers.length > 0) await db.players.bulkAdd(nextPlayers);
        playerIds = nextIds;
      }

      const updated: Participant = {
        ...participant,
        playerIds,
        nameKey,
        groupId,
        active,
        teamName:
          patch.teamName !== undefined
            ? trimOrNull(patch.teamName)
            : participant.teamName,
      };

      await db.participants.put(updated);
      await touchTournament(tournament, activeOthers + (active ? 1 : 0), timestamp);

      return updated;
    }),
  );
}

export async function removeEntry(tournamentId: string, participantId: string): Promise<void> {
  await guarded(() =>
    db.transaction('rw', [db.tournaments, db.players, db.participants], async () => {
      const tournament = await requireDraft(tournamentId);
      const participant = await db.participants.get(participantId);
      if (!participant || participant.tournamentId !== tournamentId) {
        throw new NotFoundError('That entry no longer exists.');
      }

      const participants = await db.participants
        .where('tournamentId')
        .equals(tournamentId)
        .toArray();
      const remaining = participants.filter((entry) => entry.id !== participantId);
      const stillUsed = new Set(remaining.flatMap((entry) => entry.playerIds));
      const removable = participant.playerIds.filter((id) => !stillUsed.has(id));

      await db.participants.delete(participantId);
      if (removable.length > 0) await db.players.bulkDelete(removable);

      await touchTournament(
        tournament,
        remaining.filter((entry) => entry.active).length,
        Date.now(),
      );
    }),
  );
}

export async function setEntryGroup(
  tournamentId: string,
  participantId: string,
  groupId: string | null,
): Promise<void> {
  await guarded(() =>
    db.transaction('rw', [db.tournaments, db.participants], async () => {
      const tournament = await requireDraft(tournamentId);
      const participant = await db.participants.get(participantId);
      if (!participant || participant.tournamentId !== tournamentId) {
        throw new NotFoundError('That entry no longer exists.');
      }

      const nextGroup = resolveGroupId(tournament, groupId);
      const timestamp = Date.now();
      await db.participants.update(participantId, { groupId: nextGroup });

      const participants = await db.participants
        .where('tournamentId')
        .equals(tournamentId)
        .toArray();
      await touchTournament(
        tournament,
        participants.filter((entry) => entry.active).length,
        timestamp,
      );
    }),
  );
}

/**
 * Rebalances every active entry into the configured groups using the same
 * seeded split the draw will use. Inactive entries lose their group.
 */
export async function autoAssignGroups(tournamentId: string): Promise<Map<string, string>> {
  return guarded(() =>
    db.transaction('rw', [db.tournaments, db.participants], async () => {
      const tournament = await requireDraft(tournamentId);
      if (tournament.settings.format !== 'groups-knockout') {
        throw new ValidationError(['Groups are only used by the groups + knockout format.']);
      }

      const participants = (
        await db.participants.where('tournamentId').equals(tournamentId).toArray()
      ).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const active = participants.filter((participant) => participant.active);

      if (active.length === 0) {
        throw new ValidationError(['Add at least one active entry before building groups.']);
      }
      if (tournament.settings.groupCount < 1 || tournament.settings.groupCount > active.length) {
        throw new ValidationError([
          'The number of groups must be between one and the number of active entries.',
        ]);
      }

      const preview = previewGroupKeys(
        active.map((participant) => participant.id),
        tournament.settings.seedingMethod,
        tournament.rngSeed,
        tournament.settings.groupCount,
      );
      const assignments = new Map<string, string>();
      for (const group of preview) {
        for (const key of group.keys) assignments.set(key, group.groupId);
      }

      const timestamp = Date.now();
      for (const participant of participants) {
        const groupId = participant.active ? (assignments.get(participant.id) ?? null) : null;
        if (participant.groupId !== groupId) {
          await db.participants.update(participant.id, { groupId });
        }
      }
      await touchTournament(tournament, active.length, timestamp);
      return assignments;
    }),
  );
}
