import { nextPowerOfTwo } from './elimination';
import { EngineError } from './errors';
import { newId, normalizeName, participantKey } from './keys';
import { allocateGroups, groupLabel, rankParticipants } from './seeding';
import type {
  Discipline,
  Participant,
  Player,
  SeedingMethod,
  TournamentBundle,
  TournamentSettings,
} from './types';

/**
 * One row in the setup wizard (or the draft editor). It is deliberately a plain
 * shape: the database rows are only built when the organizer saves.
 */
export interface DraftEntry {
  /** Stable React key; never stored. */
  key: string;
  /** Existing participant id when editing a draft, otherwise null. */
  id: string | null;
  playerNames: string[];
  teamName: string;
  groupId: string | null;
  active: boolean;
}

export interface GroupPreview {
  groupId: string;
  keys: string[];
}

export function playerCount(discipline: Discipline): number {
  return discipline === 'singles' ? 1 : 2;
}

export function createDraftEntry(discipline: Discipline): DraftEntry {
  return {
    key: newId(),
    id: null,
    playerNames: Array.from({ length: playerCount(discipline) }, () => ''),
    teamName: '',
    groupId: null,
    active: true,
  };
}

export function resizeEntryNames(entry: DraftEntry, discipline: Discipline): DraftEntry {
  const length = playerCount(discipline);
  return {
    ...entry,
    playerNames: Array.from({ length }, (_, index) => entry.playerNames[index] ?? ''),
  };
}

export function isEntryComplete(entry: DraftEntry, discipline: Discipline): boolean {
  if (entry.playerNames.length !== playerCount(discipline)) return false;
  return entry.playerNames.every((name) => name.trim().length > 0);
}

export function entryLabel(entry: DraftEntry): string {
  const team = entry.teamName.trim();
  if (team) return team;
  const names = entry.playerNames.map((name) => name.trim()).filter(Boolean);
  return names.length > 0 ? names.join(' & ') : 'New entry';
}

export function entryKey(entry: DraftEntry): string | null {
  const names = entry.playerNames.map((name) => name.trim());
  if (names.some((name) => !name)) return null;
  return participantKey(names);
}

export function entryFromParticipant(
  participant: Participant,
  players: readonly Player[] | Map<string, string>,
): DraftEntry {
  const namesById =
    players instanceof Map
      ? players
      : new Map(players.map((player) => [player.id, player.name]));

  return {
    key: participant.id,
    id: participant.id,
    playerNames: participant.playerIds.map((id) => namesById.get(id) ?? ''),
    teamName: participant.teamName ?? '',
    groupId: participant.groupId,
    active: participant.active,
  };
}

/** Recreates the wizard's editable rows from a stored draft. */
export function entriesFromBundle(bundle: TournamentBundle): DraftEntry[] {
  return bundle.participants
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((participant) => entryFromParticipant(participant, bundle.players));
}

/* ------------------------------------------------------------------ */
/* Entry checks                                                        */
/* ------------------------------------------------------------------ */

/**
 * Duplicate checks run over every completed row, including inactive ones,
 * because every row becomes a player in the database.
 */
export function duplicateEntryIssues(entries: DraftEntry[], discipline: Discipline): string[] {
  const issues: string[] = [];
  const complete = entries.filter((entry) => isEntryComplete(entry, discipline));
  const lineups = new Map<string, string>();
  const players = new Map<string, string>();

  for (const entry of complete) {
    const label = entryLabel(entry);
    const names = entry.playerNames.map((name) => name.trim());
    const keys = names.map(normalizeName);

    if (new Set(keys).size !== keys.length) {
      issues.push(`${label}: a player cannot appear twice in the same entry.`);
      continue;
    }

    const key = participantKey(names);
    const existingLineup = lineups.get(key);
    if (existingLineup) {
      issues.push(`${label} is already entered as "${existingLineup}".`);
    } else {
      lineups.set(key, label);
    }

    for (let index = 0; index < keys.length; index += 1) {
      const playerKey = keys[index]!;
      const existingPlayer = players.get(playerKey);
      if (existingPlayer) {
        issues.push(`${names[index]} already appears in "${existingPlayer}".`);
      } else {
        players.set(playerKey, label);
      }
    }
  }

  return issues;
}

/** Problems that stop a draw from being generated. */
export function drawEntryIssues(entries: DraftEntry[], discipline: Discipline): string[] {
  const issues = duplicateEntryIssues(entries, discipline);
  const active = entries.filter(
    (entry) => entry.active && isEntryComplete(entry, discipline),
  );

  if (entries.some((entry) => !isEntryComplete(entry, discipline))) {
    issues.push('Complete every player name, or remove the empty entry.');
  }
  if (active.length < 2) {
    issues.push('A tournament needs at least two active entries.');
  }
  if (active.length > 64) {
    issues.push('A draw can hold at most 64 entries.');
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export function groupLabels(groupCount: number): string[] {
  return Array.from({ length: Math.max(0, groupCount) }, (_, index) => groupLabel(index));
}

export function groupConfigIssues(
  activeCount: number,
  groupCount: number,
  qualifiersPerGroup: number,
): string[] {
  const issues: string[] = [];

  if (!Number.isInteger(groupCount) || groupCount < 1) {
    issues.push('Use at least one group.');
  }
  if (groupCount > activeCount) {
    issues.push('There cannot be more groups than active entries.');
  }
  if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
    issues.push('At least one entry must advance from each group.');
    return issues;
  }

  const qualifiers = groupCount * qualifiersPerGroup;
  if (qualifiers < 2) {
    issues.push('The knockout stage needs at least two qualifiers.');
  }
  if (qualifiers > 64) {
    issues.push('The knockout stage can hold at most 64 qualifiers.');
  }
  if (groupCount >= 1 && activeCount >= groupCount) {
    const smallestExpected = Math.floor(activeCount / groupCount);
    if (smallestExpected < qualifiersPerGroup) {
      issues.push(
        `Each group needs at least ${qualifiersPerGroup} entries for that many qualifiers.`,
      );
    }
  }

  return issues;
}

export function groupAssignmentIssues(
  entries: DraftEntry[],
  groupCount: number,
  qualifiersPerGroup: number,
): string[] {
  const issues: string[] = [];
  const labels = groupLabels(groupCount);
  const active = entries.filter((entry) => entry.active);

  for (const entry of active) {
    if (entry.groupId === null || !labels.includes(entry.groupId)) {
      issues.push('Every active entry must be assigned to a group.');
      break;
    }
  }

  for (const label of labels) {
    const size = active.filter((entry) => entry.groupId === label).length;
    if (size === 0) {
      issues.push(`Group ${label} has no entries.`);
    } else if (size < qualifiersPerGroup) {
      issues.push(
        `Group ${label} has ${size} ${size === 1 ? 'entry' : 'entries'} but ${qualifiersPerGroup} must advance.`,
      );
    }
  }

  return issues;
}

const PREVIEW_CREATED_AT = 0;

function previewParticipants(keys: string[]): Participant[] {
  return keys.map((key, index) => ({
    id: key,
    tournamentId: 'preview',
    playerIds: [],
    nameKey: key,
    teamName: null,
    seed: index + 1,
    groupId: null,
    active: true,
    createdAt: PREVIEW_CREATED_AT,
  }));
}

/**
 * Produces exactly the same group split as the engine would for the current
 * seeding settings, without saving anything. The result is used as the manual
 * group list when the draw is eventually generated, so the preview cannot
 * drift from the saved fixtures.
 */
export function previewGroupKeys(
  keys: string[],
  method: SeedingMethod,
  rngSeed: number,
  groupCount: number,
): GroupPreview[] {
  if (groupCount < 1 || keys.length < groupCount) return [];

  const ranked = rankParticipants(previewParticipants(keys), method, rngSeed, keys);
  return allocateGroups(ranked, groupCount).map((group) => ({
    groupId: group.groupId,
    keys: group.participants.map((participant) => participant.id),
  }));
}

export function autoGroupAssignments(
  entries: DraftEntry[],
  method: SeedingMethod,
  rngSeed: number,
  groupCount: number,
): Map<string, string> {
  const active = entries.filter((entry) => entry.active);
  const preview = previewGroupKeys(
    active.map((entry) => entry.key),
    method,
    rngSeed,
    groupCount,
  );
  const assignments = new Map<string, string>();

  for (const group of preview) {
    for (const key of group.keys) assignments.set(key, group.groupId);
  }
  return assignments;
}

export function applyAutoGroups(
  entries: DraftEntry[],
  method: SeedingMethod,
  rngSeed: number,
  groupCount: number,
): DraftEntry[] {
  const assignments = autoGroupAssignments(entries, method, rngSeed, groupCount);
  return entries.map((entry) => ({
    ...entry,
    groupId: entry.active ? (assignments.get(entry.key) ?? null) : null,
  }));
}

export function groupSizes(
  entries: DraftEntry[],
  groupCount: number,
): Array<{ groupId: string; size: number }> {
  const active = entries.filter((entry) => entry.active);
  return groupLabels(groupCount).map((groupId) => ({
    groupId,
    size: active.filter((entry) => entry.groupId === groupId).length,
  }));
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

export interface SetupReview {
  activeCount: number;
  knockoutSize: number | null;
  matchCount: number | null;
  byes: number | null;
  warnings: string[];
}

/**
 * A read-only summary for the review step. It intentionally mirrors the
 * engine's warnings without generating rows.
 */
export function reviewSetup(
  settings: Pick<
    TournamentSettings,
    'format' | 'participantCount' | 'groupCount' | 'qualifiersPerGroup'
  >,
  entries: DraftEntry[],
): SetupReview {
  const active = entries.filter((entry) => entry.active);
  const activeCount = active.length;
  const warnings: string[] = [];

  if (settings.participantCount > 0 && settings.participantCount !== activeCount) {
    warnings.push(
      `You planned ${settings.participantCount} entries, but ${activeCount} are active.`,
    );
  }

  if (settings.format === 'round-robin') {
    return {
      activeCount,
      knockoutSize: null,
      matchCount: activeCount >= 2 ? (activeCount * (activeCount - 1)) / 2 : 0,
      byes: 0,
      warnings,
    };
  }

  if (settings.format === 'single-elimination') {
    if (activeCount < 2) {
      return { activeCount, knockoutSize: null, matchCount: null, byes: null, warnings };
    }
    const size = nextPowerOfTwo(activeCount);
    const byes = size - activeCount;
    if (byes > 0) warnings.push(`${byes} first-round bye${byes === 1 ? '' : 's'} will be used.`);
    return {
      activeCount,
      knockoutSize: size,
      matchCount: size - 1,
      byes,
      warnings,
    };
  }

  const sizes = groupSizes(entries, settings.groupCount);
  if (sizes.length > 0) {
    const counts = sizes.map((group) => group.size);
    const smallest = Math.min(...counts);
    const largest = Math.max(...counts);
    if (largest - smallest > 1) {
      warnings.push(
        `Group sizes are uneven (${sizes.map((group) => `${group.groupId}: ${group.size}`).join(', ')}).`,
      );
    }
    if (settings.groupCount === 1) {
      warnings.push('With one group, qualifiers can meet again in the first knockout round.');
    }
  }

  const qualifiers = settings.groupCount * settings.qualifiersPerGroup;
  if (qualifiers < 2 || qualifiers > 64) {
    return { activeCount, knockoutSize: null, matchCount: null, byes: null, warnings };
  }

  const size = nextPowerOfTwo(qualifiers);
  const byes = size - qualifiers;
  if (byes > 0) warnings.push(`${byes} knockout bye${byes === 1 ? '' : 's'} will be used.`);

  const groupMatchCount = sizes.reduce((total, group) => total + pairCount(group.size), 0);
  return {
    activeCount,
    knockoutSize: size,
    matchCount: groupMatchCount + (size - 1),
    byes,
    warnings,
  };
}

function pairCount(size: number): number {
  return size >= 2 ? (size * (size - 1)) / 2 : 0;
}

/* ------------------------------------------------------------------ */
/* Building rows                                                       */
/* ------------------------------------------------------------------ */

export interface BuiltEntries {
  players: Player[];
  participants: Participant[];
}

/**
 * Converts completed setup rows into player and participant records. The
 * caller must have run the duplicate checks first.
 */
export function buildEntryRows(
  tournamentId: string,
  entries: DraftEntry[],
  discipline: Discipline,
  now: number,
): BuiltEntries {
  const players: Player[] = [];
  const participants: Participant[] = [];
  const playersByName = new Map<string, Player>();

  entries.forEach((entry, index) => {
    if (!isEntryComplete(entry, discipline)) {
      throw new EngineError(['Incomplete entries must be removed before saving.']);
    }

    const names = entry.playerNames.map((name) => name.trim());
    const playerIds = names.map((name) => {
      const nameKey = normalizeName(name);
      const existing = playersByName.get(nameKey);
      if (existing) {
        throw new EngineError([`${name} appears in more than one entry.`]);
      }

      const player: Player = {
        id: newId(),
        tournamentId,
        name,
        nameKey,
        createdAt: now + index,
      };
      playersByName.set(nameKey, player);
      players.push(player);
      return player.id;
    });

    participants.push({
      id: entry.id ?? newId(),
      tournamentId,
      playerIds,
      nameKey: participantKey(names),
      teamName: entry.teamName.trim() || null,
      seed: index + 1,
      groupId: entry.groupId,
      active: entry.active,
      createdAt: now + index,
    });
  });

  return { players, participants };
}
