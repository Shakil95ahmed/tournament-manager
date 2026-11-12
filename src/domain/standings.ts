import type { Match, Participant, PointsSettings, TiebreakerId } from './types';

export interface StandingRow {
  participantId: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  points: number;
  gameWins: number;
  gameLosses: number;
  gameDifference: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
}

interface SortableRow extends StandingRow {
  seed: number | null;
  nameKey: string;
}

export interface StandingsInput {
  participants: Participant[];
  matches: Match[];
  points: PointsSettings;
  tiebreakers: TiebreakerId[];
}

/**
 * Standings are always derived from recorded results — never stored — so a
 * corrected result can never leave a stale table behind.
 */
export function computeStandings(input: StandingsInput): StandingRow[] {
  const rows = new Map<string, SortableRow>();

  for (const participant of input.participants) {
    rows.set(participant.id, {
      participantId: participant.id,
      rank: 0,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      gameWins: 0,
      gameLosses: 0,
      gameDifference: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifference: 0,
      seed: participant.seed,
      nameKey: participant.nameKey,
    });
  }

  for (const match of input.matches) {
    if (match.stage === 'knockout') continue;
    if (match.status !== 'completed' || match.winnerId === null) continue;
    if (match.aId === null || match.bId === null) continue;

    const a = rows.get(match.aId);
    const b = rows.get(match.bId);
    if (!a || !b) continue;
    if (match.winnerId !== a.participantId && match.winnerId !== b.participantId) continue;

    const winner = match.winnerId === a.participantId ? a : b;
    const loser = winner === a ? b : a;

    winner.wins += 1;
    loser.losses += 1;
    winner.played += 1;
    loser.played += 1;
    winner.points += input.points.win;
    loser.points += input.points.loss;

    let aGames = 0;
    let bGames = 0;

    for (const game of match.games) {
      a.pointsFor += game.a;
      a.pointsAgainst += game.b;
      b.pointsFor += game.b;
      b.pointsAgainst += game.a;

      if (game.a > game.b) aGames += 1;
      else if (game.b > game.a) bGames += 1;
    }

    a.gameWins += aGames;
    a.gameLosses += bGames;
    b.gameWins += bGames;
    b.gameLosses += aGames;
  }

  for (const row of rows.values()) {
    row.gameDifference = row.gameWins - row.gameLosses;
    row.pointDifference = row.pointsFor - row.pointsAgainst;
  }

  const ranked = rankRows([...rows.values()], input.tiebreakers, input.matches);
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function computeGroupStandings(input: {
  participants: Participant[];
  matches: Match[];
  settings: { points: PointsSettings; tiebreakers: TiebreakerId[] };
}): Map<string, StandingRow[]> {
  const groupIds = [
    ...new Set(
      input.participants
        .map((participant) => participant.groupId)
        .filter((groupId): groupId is string => groupId !== null),
    ),
  ].sort();

  const standings = new Map<string, StandingRow[]>();

  for (const groupId of groupIds) {
    standings.set(
      groupId,
      computeStandings({
        participants: input.participants.filter(
          (participant) => participant.groupId === groupId,
        ),
        matches: input.matches.filter((match) => match.groupId === groupId),
        points: input.settings.points,
        tiebreakers: input.settings.tiebreakers,
      }),
    );
  }

  return standings;
}

function rankRows(
  rows: SortableRow[],
  tiebreakers: TiebreakerId[],
  matches: Match[],
): SortableRow[] {
  let buckets: SortableRow[][] = [rows];

  for (const rule of tiebreakers) {
    buckets = buckets.flatMap((bucket) => refine(bucket, rule, matches));
  }

  return buckets.flatMap((bucket) => bucket.slice().sort(fallbackCompare));
}

function refine(
  bucket: SortableRow[],
  rule: TiebreakerId,
  matches: Match[],
): SortableRow[][] {
  if (bucket.length < 2) return [bucket];

  if (rule === 'headToHead') {
    // Only meaningful for a two-way tie; groups of three fall through.
    if (bucket.length !== 2) return [bucket];
    const outcome = headToHead(bucket[0]!, bucket[1]!, matches);
    if (outcome === 0) return [bucket];
    return outcome > 0 ? [[bucket[0]!], [bucket[1]!]] : [[bucket[1]!], [bucket[0]!]];
  }

  if (rule === 'seed') {
    return splitBy(bucket, (row) => row.seed ?? Number.MAX_SAFE_INTEGER, 'asc');
  }

  return splitBy(bucket, (row) => standingValue(row, rule), 'desc');
}

function standingValue(row: SortableRow, rule: TiebreakerId): number {
  switch (rule) {
    case 'points':
      return row.points;
    case 'wins':
      return row.wins;
    case 'gameDifference':
      return row.gameDifference;
    case 'pointDifference':
      return row.pointDifference;
    default:
      return 0;
  }
}

function splitBy(
  bucket: SortableRow[],
  keyOf: (row: SortableRow) => number,
  direction: 'asc' | 'desc',
): SortableRow[][] {
  const groups = new Map<number, SortableRow[]>();

  for (const row of bucket) {
    const key = keyOf(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort((a, b) => (direction === 'asc' ? a[0] - b[0] : b[0] - a[0]))
    .map(([, list]) => list);
}

function headToHead(a: SortableRow, b: SortableRow, matches: Match[]): number {
  let aWins = 0;
  let bWins = 0;

  for (const match of matches) {
    if (match.stage === 'knockout') continue;
    if (match.status !== 'completed' || match.winnerId === null) continue;

    const between =
      (match.aId === a.participantId && match.bId === b.participantId) ||
      (match.aId === b.participantId && match.bId === a.participantId);
    if (!between) continue;

    if (match.winnerId === a.participantId) aWins += 1;
    else if (match.winnerId === b.participantId) bWins += 1;
  }

  if (aWins === bWins) return 0;
  return aWins > bWins ? 1 : -1;
}

/** Guarantees a deterministic order even when every configured rule ties. */
function fallbackCompare(a: SortableRow, b: SortableRow): number {
  const seedA = a.seed ?? Number.MAX_SAFE_INTEGER;
  const seedB = b.seed ?? Number.MAX_SAFE_INTEGER;
  if (seedA !== seedB) return seedA - seedB;
  if (a.nameKey !== b.nameKey) return a.nameKey.localeCompare(b.nameKey);
  return a.participantId.localeCompare(b.participantId);
}
