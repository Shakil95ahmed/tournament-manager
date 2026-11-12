export type Sport = 'badminton' | 'pickleball';
export type Discipline = 'singles' | 'doubles';
export type TournamentFormat = 'single-elimination' | 'round-robin' | 'groups-knockout';
export type TournamentStatus = 'draft' | 'active' | 'completed';
export type SeedingMethod = 'random' | 'manual' | 'snake';
export type MatchStage = 'group' | 'league' | 'knockout';
export type MatchStatus = 'pending' | 'ready' | 'completed' | 'bye';
export type ScoreMode = 'best-of-3' | 'single-game' | 'winner-only';
export type KnockoutSize = 2 | 4 | 8 | 16 | 32 | 64;

export type TiebreakerId =
  | 'points'
  | 'wins'
  | 'gameDifference'
  | 'pointDifference'
  | 'headToHead'
  | 'seed';

export interface ScoreSettings {
  mode: ScoreMode;
  /** Target points per game, e.g. 21 for badminton or 11 for pickleball. */
  targetPoints: number;
}

export interface PointsSettings {
  win: number;
  loss: number;
}

export interface TournamentSettings {
  sport: Sport;
  discipline: Discipline;
  format: TournamentFormat;
  /** How many entries the organizer planned to enter. */
  participantCount: number;
  /** Only used by the groups + knockout format. */
  groupCount: number;
  /** Qualifiers per group that advance to the knockout stage. */
  qualifiersPerGroup: number;
  /** Computed at review time and stored so the bracket is reproducible. */
  knockoutSize: KnockoutSize;
  seedingMethod: SeedingMethod;
  scoring: ScoreSettings;
  points: PointsSettings;
  /** Ordered list: the first rule that separates two entries wins. */
  tiebreakers: TiebreakerId[];
}

export interface Tournament {
  id: string;
  name: string;
  leagueName: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  /** Seed for the random draw, so a draw can be reproduced. */
  rngSeed: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastSavedAt: number;
}

export interface Player {
  id: string;
  tournamentId: string;
  name: string;
  /** Lowercase, accent-folded, whitespace-collapsed name used for duplicate checks. */
  nameKey: string;
  createdAt: number;
}

/**
 * One entry in the draw. Singles entries have one player, doubles teams two.
 * The entry is what fixtures point at, never a player directly.
 */
export interface Participant {
  id: string;
  tournamentId: string;
  playerIds: string[];
  /** Uniqueness key derived from the players, so a team cannot be entered twice. */
  nameKey: string;
  teamName: string | null;
  seed: number | null;
  groupId: string | null;
  active: boolean;
  createdAt: number;
}

export interface GameScore {
  a: number;
  b: number;
}

export interface ResultSnapshot {
  winnerId: string | null;
  games: GameScore[];
  court: string | null;
  at: number;
}

/**
 * Where one side of a knockout match comes from. Elimination first rounds are
 * filled at generation time, so their sources are null. Group qualifiers are
 * filled automatically once every group match is complete.
 */
export type MatchSource =
  | { kind: 'group'; groupId: string; placement: number }
  | { kind: 'winner'; matchId: string };

export interface Match {
  id: string;
  tournamentId: string;
  stage: MatchStage;
  groupId: string | null;
  round: number;
  roundLabel: string;
  /** Structural position inside its round; unique for a tournament + stage + group. */
  slot: number;
  /** Presentation order. */
  order: number;
  aId: string | null;
  bId: string | null;
  aSource: MatchSource | null;
  bSource: MatchSource | null;
  /** Placeholder text shown before the participants are known. */
  aLabel: string;
  bLabel: string;
  status: MatchStatus;
  winnerId: string | null;
  games: GameScore[];
  court: string | null;
  nextMatchId: string | null;
  nextSlot: 'a' | 'b' | null;
  /** Previous results, newest last, so undo survives a refresh. */
  history: ResultSnapshot[];
  updatedAt: number;
}

export interface AppMeta {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** A single tournament and everything that belongs to it. */
export interface TournamentBundle {
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  matches: Match[];
}
