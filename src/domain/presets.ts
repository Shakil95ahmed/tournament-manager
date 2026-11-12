import type {
  Discipline,
  PointsSettings,
  ScoreMode,
  ScoreSettings,
  SeedingMethod,
  Sport,
  TiebreakerId,
  TournamentFormat,
  TournamentSettings,
} from './types';

export const DEFAULT_TIEBREAKERS: TiebreakerId[] = [
  'points',
  'wins',
  'gameDifference',
  'pointDifference',
  'headToHead',
  'seed',
];

export const SPORT_PRESETS: Record<Sport, { scoring: ScoreSettings; points: PointsSettings }> = {
  badminton: {
    scoring: { mode: 'best-of-3', targetPoints: 21 },
    points: { win: 2, loss: 1 },
  },
  pickleball: {
    scoring: { mode: 'best-of-3', targetPoints: 11 },
    points: { win: 2, loss: 0 },
  },
};

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  singles: 'Singles',
  doubles: 'Doubles',
};

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  'single-elimination': 'Single elimination',
  'round-robin': 'Round robin',
  'groups-knockout': 'Groups + knockout',
};

export const SPORT_LABELS: Record<Sport, string> = {
  badminton: 'Badminton',
  pickleball: 'Pickleball',
};

export const SCORE_MODE_LABELS: Record<ScoreMode, string> = {
  'best-of-3': 'Best of three',
  'single-game': 'Single game',
  'winner-only': 'Winner only',
};

export const SEEDING_LABELS: Record<SeedingMethod, string> = {
  random: 'Random',
  manual: 'Manual',
  snake: 'Snake',
};

export const TIEBREAKER_LABELS: Record<TiebreakerId, string> = {
  points: 'Match points',
  wins: 'Wins',
  gameDifference: 'Game difference',
  pointDifference: 'Point difference',
  headToHead: 'Head-to-head',
  seed: 'Seed order',
};

interface DefaultSettingsInput {
  sport: Sport;
  discipline: Discipline;
  format: TournamentFormat;
  participantCount: number;
  groupCount?: number;
  qualifiersPerGroup?: number;
  seedingMethod?: TournamentSettings['seedingMethod'];
}

export function defaultSettings(input: DefaultSettingsInput): TournamentSettings {
  const preset = SPORT_PRESETS[input.sport];
  return {
    sport: input.sport,
    discipline: input.discipline,
    format: input.format,
    participantCount: input.participantCount,
    groupCount: input.format === 'groups-knockout' ? (input.groupCount ?? 2) : 0,
    qualifiersPerGroup:
      input.format === 'groups-knockout' ? (input.qualifiersPerGroup ?? 2) : 0,
    knockoutSize: 2,
    seedingMethod: input.seedingMethod ?? 'random',
    scoring: { ...preset.scoring },
    points: { ...preset.points },
    tiebreakers: [...DEFAULT_TIEBREAKERS],
  };
}
