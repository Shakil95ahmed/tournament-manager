import { db } from './db';
import { ValidationError } from './errors';
import { META_KEYS } from './meta';
import { validateTournamentBundle } from '../domain/validation';
import type {
  AppMeta,
  KnockoutSize,
  Match,
  MatchSource,
  MatchStage,
  MatchStatus,
  Participant,
  Player,
  ScoreMode,
  SeedingMethod,
  Sport,
  TiebreakerId,
  Tournament,
  TournamentBundle,
  TournamentFormat,
  TournamentStatus,
  Discipline,
} from '../domain/types';

export const BACKUP_APP = 'tournament-manager';
export const BACKUP_FORMAT_VERSION = 2;
/** Older files are still readable; missing source fields become null. */
export const OLDEST_BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  formatVersion: number;
  exportedAt: number;
  tournaments: Tournament[];
  players: Player[];
  participants: Participant[];
  matches: Match[];
}

export type BackupValidation =
  | { ok: true; backup: BackupFile }
  | { ok: false; errors: string[] };

const SPORTS: Sport[] = ['badminton', 'pickleball'];
const DISCIPLINES: Discipline[] = ['singles', 'doubles'];
const FORMATS: TournamentFormat[] = [
  'single-elimination',
  'round-robin',
  'groups-knockout',
];
const STATUSES: TournamentStatus[] = ['draft', 'active', 'completed'];
const SEEDING_METHODS: SeedingMethod[] = ['random', 'manual', 'snake'];
const SCORE_MODES: ScoreMode[] = ['best-of-3', 'single-game', 'winner-only'];
const STAGES: MatchStage[] = ['group', 'league', 'knockout'];
const MATCH_STATUSES: MatchStatus[] = ['pending', 'ready', 'completed', 'bye'];
const TIEBREAKERS: TiebreakerId[] = [
  'points',
  'wins',
  'gameDifference',
  'pointDifference',
  'headToHead',
  'seed',
];
const KNOCKOUT_SIZES: KnockoutSize[] = [2, 4, 8, 16, 32, 64];

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

const isNullableText = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Row parsers                                                         */
/* ------------------------------------------------------------------ */

function parseSettings(value: unknown, issues: string[], path: string): boolean {
  if (!isRecord(value)) {
    issues.push(`${path} is not an object.`);
    return false;
  }
  const before = issues.length;

  if (!isEnum(value.sport, SPORTS)) issues.push(`${path}.sport is invalid.`);
  if (!isEnum(value.discipline, DISCIPLINES)) issues.push(`${path}.discipline is invalid.`);
  if (!isEnum(value.format, FORMATS)) issues.push(`${path}.format is invalid.`);
  // Drafts may be saved before the first entry is added.
  if (!isInteger(value.participantCount) || value.participantCount < 0) {
    issues.push(`${path}.participantCount must be a whole number of zero or more.`);
  }
  if (!isInteger(value.groupCount) || value.groupCount < 0) {
    issues.push(`${path}.groupCount is invalid.`);
  }
  if (!isInteger(value.qualifiersPerGroup) || value.qualifiersPerGroup < 0) {
    issues.push(`${path}.qualifiersPerGroup is invalid.`);
  }
  if (!isInteger(value.knockoutSize) || !KNOCKOUT_SIZES.includes(value.knockoutSize as KnockoutSize)) {
    issues.push(`${path}.knockoutSize must be 2, 4, 8, 16, 32 or 64.`);
  }
  if (!isEnum(value.seedingMethod, SEEDING_METHODS)) {
    issues.push(`${path}.seedingMethod is invalid.`);
  }
  if (!isRecord(value.scoring)) {
    issues.push(`${path}.scoring is invalid.`);
  } else {
    if (!isEnum(value.scoring.mode, SCORE_MODES)) issues.push(`${path}.scoring.mode is invalid.`);
    if (!isNumber(value.scoring.targetPoints) || value.scoring.targetPoints <= 0) {
      issues.push(`${path}.scoring.targetPoints must be a positive number.`);
    }
  }
  if (!isRecord(value.points)) {
    issues.push(`${path}.points is invalid.`);
  } else {
    if (!isNumber(value.points.win) || value.points.win < 0) {
      issues.push(`${path}.points.win must be zero or more.`);
    }
    if (!isNumber(value.points.loss) || value.points.loss < 0) {
      issues.push(`${path}.points.loss must be zero or more.`);
    }
  }
  if (!Array.isArray(value.tiebreakers)) {
    issues.push(`${path}.tiebreakers must be a list.`);
  } else {
    for (const rule of value.tiebreakers) {
      if (!isEnum(rule, TIEBREAKERS)) {
        issues.push(`${path}.tiebreakers contains an unknown rule.`);
        break;
      }
    }
  }
  return issues.length === before;
}

function parseTournament(value: unknown, issues: string[], path: string): Tournament | null {
  if (!isRecord(value)) {
    issues.push(`${path} is not a tournament object.`);
    return null;
  }
  const before = issues.length;

  if (!isNonEmptyText(value.id)) issues.push(`${path}.id is missing.`);
  if (!isNonEmptyText(value.name)) issues.push(`${path}.name is missing.`);
  if (!isText(value.leagueName)) issues.push(`${path}.leagueName is invalid.`);
  if (!isEnum(value.status, STATUSES)) issues.push(`${path}.status is invalid.`);
  parseSettings(value.settings, issues, `${path}.settings`);
  if (!isNumber(value.rngSeed)) issues.push(`${path}.rngSeed is invalid.`);
  if (!isNumber(value.createdAt)) issues.push(`${path}.createdAt is invalid.`);
  if (!isNumber(value.updatedAt)) issues.push(`${path}.updatedAt is invalid.`);
  if (!isNumber(value.lastSavedAt)) issues.push(`${path}.lastSavedAt is invalid.`);
  if (!isNullableNumber(value.startedAt)) issues.push(`${path}.startedAt is invalid.`);
  if (!isNullableNumber(value.completedAt)) issues.push(`${path}.completedAt is invalid.`);

  return issues.length === before ? (value as unknown as Tournament) : null;
}

function parsePlayer(value: unknown, issues: string[], path: string): Player | null {
  if (!isRecord(value)) {
    issues.push(`${path} is not a player object.`);
    return null;
  }
  const before = issues.length;

  if (!isNonEmptyText(value.id)) issues.push(`${path}.id is missing.`);
  if (!isNonEmptyText(value.tournamentId)) issues.push(`${path}.tournamentId is missing.`);
  if (!isNonEmptyText(value.name)) issues.push(`${path}.name is missing.`);
  if (!isNonEmptyText(value.nameKey)) issues.push(`${path}.nameKey is missing.`);
  if (!isNumber(value.createdAt)) issues.push(`${path}.createdAt is invalid.`);

  return issues.length === before ? (value as unknown as Player) : null;
}

function parseParticipant(
  value: unknown,
  issues: string[],
  path: string,
): Participant | null {
  if (!isRecord(value)) {
    issues.push(`${path} is not a participant object.`);
    return null;
  }
  const before = issues.length;

  if (!isNonEmptyText(value.id)) issues.push(`${path}.id is missing.`);
  if (!isNonEmptyText(value.tournamentId)) issues.push(`${path}.tournamentId is missing.`);
  if (!Array.isArray(value.playerIds) || value.playerIds.length === 0) {
    issues.push(`${path}.playerIds must be a non-empty list.`);
  } else if (!value.playerIds.every(isNonEmptyText)) {
    issues.push(`${path}.playerIds contains an invalid id.`);
  }
  if (!isNonEmptyText(value.nameKey)) issues.push(`${path}.nameKey is missing.`);
  if (!isNullableText(value.teamName)) issues.push(`${path}.teamName is invalid.`);
  if (value.seed !== null && (!isInteger(value.seed) || value.seed < 1)) {
    issues.push(`${path}.seed must be null or a positive whole number.`);
  }
  if (!isNullableText(value.groupId)) issues.push(`${path}.groupId is invalid.`);
  if (typeof value.active !== 'boolean') issues.push(`${path}.active must be true or false.`);
  if (!isNumber(value.createdAt)) issues.push(`${path}.createdAt is invalid.`);

  return issues.length === before ? (value as unknown as Participant) : null;
}

function parseGames(value: unknown, issues: string[], path: string): boolean {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be a list of games.`);
    return false;
  }
  for (const game of value) {
    if (
      !isRecord(game) ||
      !isInteger(game.a) ||
      !isInteger(game.b) ||
      game.a < 0 ||
      game.b < 0
    ) {
      issues.push(`${path} contains an invalid game score.`);
      return false;
    }
  }
  return true;
}

function parseSnapshot(value: unknown, issues: string[], path: string): boolean {
  if (!isRecord(value)) {
    issues.push(`${path} is not a result snapshot.`);
    return false;
  }
  let ok = true;
  if (!isNullableText(value.winnerId)) {
    issues.push(`${path}.winnerId is invalid.`);
    ok = false;
  }
  if (!parseGames(value.games, issues, `${path}.games`)) ok = false;
  if (!isNullableText(value.court)) {
    issues.push(`${path}.court is invalid.`);
    ok = false;
  }
  if (!isNumber(value.at)) {
    issues.push(`${path}.at is invalid.`);
    ok = false;
  }
  return ok;
}

function parseSource(value: unknown, issues: string[], path: string): boolean {
  if (value === null) return true;
  if (!isRecord(value)) {
    issues.push(`${path} must be null or a source object.`);
    return false;
  }

  const before = issues.length;

  if (value.kind === 'group') {
    if (!isNonEmptyText(value.groupId)) issues.push(`${path}.groupId is missing.`);
    if (!isInteger(value.placement) || value.placement < 1) {
      issues.push(`${path}.placement must be a positive whole number.`);
    }
  } else if (value.kind === 'winner') {
    if (!isNonEmptyText(value.matchId)) issues.push(`${path}.matchId is missing.`);
  } else {
    issues.push(`${path}.kind must be "group" or "winner".`);
  }

  return issues.length === before;
}

function parseMatch(value: unknown, issues: string[], path: string): Match | null {
  if (!isRecord(value)) {
    issues.push(`${path} is not a match object.`);
    return null;
  }
  const before = issues.length;

  if (!isNonEmptyText(value.id)) issues.push(`${path}.id is missing.`);
  if (!isNonEmptyText(value.tournamentId)) issues.push(`${path}.tournamentId is missing.`);
  if (!isEnum(value.stage, STAGES)) issues.push(`${path}.stage is invalid.`);
  if (!isNullableText(value.groupId)) issues.push(`${path}.groupId is invalid.`);
  if (!isInteger(value.round) || value.round < 0) issues.push(`${path}.round is invalid.`);
  if (!isNonEmptyText(value.roundLabel)) issues.push(`${path}.roundLabel is missing.`);
  if (!isInteger(value.slot) || value.slot < 0) issues.push(`${path}.slot is invalid.`);
  if (!isInteger(value.order) || value.order < 0) issues.push(`${path}.order is invalid.`);
  if (!isNullableText(value.aId)) issues.push(`${path}.aId is invalid.`);
  if (!isNullableText(value.bId)) issues.push(`${path}.bId is invalid.`);
  parseSource(value.aSource ?? null, issues, `${path}.aSource`);
  parseSource(value.bSource ?? null, issues, `${path}.bSource`);
  if (!isText(value.aLabel)) issues.push(`${path}.aLabel is invalid.`);
  if (!isText(value.bLabel)) issues.push(`${path}.bLabel is invalid.`);
  if (!isEnum(value.status, MATCH_STATUSES)) issues.push(`${path}.status is invalid.`);
  if (!isNullableText(value.winnerId)) issues.push(`${path}.winnerId is invalid.`);
  parseGames(value.games, issues, `${path}.games`);
  if (!isNullableText(value.court)) issues.push(`${path}.court is invalid.`);
  if (!isNullableText(value.nextMatchId)) issues.push(`${path}.nextMatchId is invalid.`);
  if (value.nextSlot !== null && value.nextSlot !== 'a' && value.nextSlot !== 'b') {
    issues.push(`${path}.nextSlot is invalid.`);
  }
  if (!Array.isArray(value.history)) {
    issues.push(`${path}.history must be a list.`);
  } else {
    value.history.forEach((snapshot, index) => {
      parseSnapshot(snapshot, issues, `${path}.history[${index}]`);
    });
  }
  if (!isNumber(value.updatedAt)) issues.push(`${path}.updatedAt is invalid.`);

  if (issues.length !== before) return null;

  return {
    ...(value as unknown as Match),
    aSource: (value.aSource ?? null) as MatchSource | null,
    bSource: (value.bSource ?? null) as MatchSource | null,
  };
}

/* ------------------------------------------------------------------ */
/* Backup validation                                                   */
/* ------------------------------------------------------------------ */

export function validateBackup(input: unknown): BackupValidation {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['This file is not a Tournament Manager backup.'] };
  }
  if (input.app !== BACKUP_APP) {
    return { ok: false, errors: ['This is not a Tournament Manager backup file.'] };
  }
  if (!isInteger(input.formatVersion)) {
    return { ok: false, errors: ['The backup does not declare a valid format version.'] };
  }
  if (input.formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This backup was created by a newer version of the app (format ${input.formatVersion}), but this version only reads format ${BACKUP_FORMAT_VERSION}. Reload the app to update.`,
      ],
    };
  }
  if (input.formatVersion < OLDEST_BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: ['The backup format version is not supported.'] };
  }
  if (!isNumber(input.exportedAt)) {
    return { ok: false, errors: ['The backup has no export timestamp.'] };
  }

  for (const key of ['tournaments', 'players', 'participants', 'matches'] as const) {
    if (!Array.isArray(input[key])) {
      return { ok: false, errors: [`The backup is missing its ${key} list.`] };
    }
  }

  const tournaments: Tournament[] = [];
  const players: Player[] = [];
  const participants: Participant[] = [];
  const matches: Match[] = [];

  (input.tournaments as unknown[]).forEach((row, index) => {
    const parsed = parseTournament(row, errors, `tournaments[${index}]`);
    if (parsed) tournaments.push(parsed);
  });
  (input.players as unknown[]).forEach((row, index) => {
    const parsed = parsePlayer(row, errors, `players[${index}]`);
    if (parsed) players.push(parsed);
  });
  (input.participants as unknown[]).forEach((row, index) => {
    const parsed = parseParticipant(row, errors, `participants[${index}]`);
    if (parsed) participants.push(parsed);
  });
  (input.matches as unknown[]).forEach((row, index) => {
    const parsed = parseMatch(row, errors, `matches[${index}]`);
    if (parsed) matches.push(parsed);
  });

  if (errors.length > 0) return { ok: false, errors };

  const tournamentIds = new Set<string>();
  const tournamentNames = new Map<string, string>();

  for (const tournament of tournaments) {
    if (tournamentIds.has(tournament.id)) {
      errors.push(`Two tournaments share the id "${tournament.id}".`);
    }
    tournamentIds.add(tournament.id);
    tournamentNames.set(tournament.id, tournament.name);
  }

  const playerIds = new Set<string>();
  for (const player of players) {
    if (playerIds.has(player.id)) errors.push(`Two players share the id "${player.id}".`);
    playerIds.add(player.id);
    if (!tournamentIds.has(player.tournamentId)) {
      errors.push(`Player "${player.name}" belongs to a tournament that is not in the backup.`);
    }
  }

  const participantIds = new Set<string>();
  for (const participant of participants) {
    if (participantIds.has(participant.id)) {
      errors.push(`Two participants share the id "${participant.id}".`);
    }
    participantIds.add(participant.id);
    if (!tournamentIds.has(participant.tournamentId)) {
      errors.push('A participant belongs to a tournament that is not in the backup.');
    }
  }

  const matchIds = new Set<string>();
  for (const match of matches) {
    if (matchIds.has(match.id)) errors.push(`Two matches share the id "${match.id}".`);
    matchIds.add(match.id);
    if (!tournamentIds.has(match.tournamentId)) {
      errors.push('A match belongs to a tournament that is not in the backup.');
    }
  }

  for (const tournament of tournaments) {
    const bundle: TournamentBundle = {
      tournament,
      players: players.filter((player) => player.tournamentId === tournament.id),
      participants: participants.filter(
        (participant) => participant.tournamentId === tournament.id,
      ),
      matches: matches.filter((match) => match.tournamentId === tournament.id),
    };

    for (const issue of validateTournamentBundle(bundle)) {
      errors.push(`${tournamentNames.get(tournament.id) ?? 'Tournament'}: ${issue}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      formatVersion: input.formatVersion,
      exportedAt: input.exportedAt,
      tournaments,
      players,
      participants,
      matches,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Export / restore                                                    */
/* ------------------------------------------------------------------ */

export async function createBackup(): Promise<BackupFile> {
  const [tournaments, players, participants, matches] = await db.transaction(
    'r',
    [db.tournaments, db.players, db.participants, db.matches],
    () =>
      Promise.all([
        db.tournaments.toArray(),
        db.players.toArray(),
        db.participants.toArray(),
        db.matches.toArray(),
      ]),
  );

  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    tournaments,
    players,
    participants,
    matches,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackupJson(text: string): BackupValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['That file is not valid JSON.'] };
  }
  return validateBackup(parsed);
}

/**
 * Replaces everything on this device with the contents of a validated backup.
 * Runs in one transaction, so a failure leaves the current data untouched.
 */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  const check = validateBackup(backup);
  if (!check.ok) throw new ValidationError(check.errors);
  const safe = check.backup;
  const timestamp = Date.now();

  await db.transaction(
    'rw',
    [db.tournaments, db.players, db.participants, db.matches, db.meta],
    async () => {
      await Promise.all([
        db.matches.clear(),
        db.participants.clear(),
        db.players.clear(),
        db.tournaments.clear(),
      ]);

      await db.tournaments.bulkPut(safe.tournaments);
      await db.players.bulkPut(safe.players);
      await db.participants.bulkPut(safe.participants);
      await db.matches.bulkPut(safe.matches);

      const entry: AppMeta = {
        key: META_KEYS.lastImportAt,
        value: timestamp,
        updatedAt: timestamp,
      };
      await db.meta.put(entry);
    },
  );
}

export function backupFileName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `tournament-backup-${year}-${month}-${day}.json`;
}
