import { EngineError } from './errors';
import { syncBracketState } from './elimination';
import { cloneMatches, indexMatches } from './matches';
import { computeStandings } from './standings';
import type {
  GameScore,
  Match,
  Participant,
  PointsSettings,
  ResultSnapshot,
  ScoreMode,
  ScoreSettings,
  TiebreakerId,
  TournamentFormat,
} from './types';

export const MAX_HISTORY = 10;

export interface RecordResultInput {
  matchId: string;
  winnerId: string;
  games?: readonly GameScore[];
  court?: string | null;
  now: number;
  /** When present, the score count is checked against the tournament's format. */
  scoring?: ScoreSettings;
}

/** How many game scores a scoring mode can hold at most. Winner-only uses none. */
export function maxGamesForMode(mode: ScoreMode): number {
  switch (mode) {
    case 'best-of-3':
      return 3;
    case 'single-game':
      return 1;
    case 'winner-only':
      return 0;
  }
}


/**
 * Records a result, keeps the previous state for undo, and invalidates only the
 * downstream matches whose participants can actually change. Correcting the
 * score without changing the winner leaves the next round untouched.
 */
export function recordResult(matches: readonly Match[], input: RecordResultInput): Match[] {
  const next = cloneMatches(matches);
  const match = findMatch(next, input.matchId);

  if (match.status === 'bye') {
    throw new EngineError(['A bye advances automatically; there is no result to record.']);
  }
  if (match.aId === null || match.bId === null) {
    throw new EngineError(['Both sides must be known before a result can be recorded.']);
  }
  if (input.winnerId !== match.aId && input.winnerId !== match.bId) {
    throw new EngineError(['The winner must be one of the two participants in this match.']);
  }

  if (input.scoring) validateScoreCount(input.scoring.mode, input.games ?? []);

  const games = normalizeGames(input.games ?? [], match, input.winnerId);
  const court = normalizeCourt(input.court);
  const previousWinner = match.winnerId;

  pushHistory(match, {
    winnerId: previousWinner,
    games: match.games,
    court: match.court,
    at: match.updatedAt,
  });

  match.winnerId = input.winnerId;
  match.games = games;
  match.court = court;
  match.status = 'completed';
  match.updatedAt = input.now;

  if (previousWinner !== input.winnerId) {
    resetDownstream(next, match, input.now);
  }

  syncBracketState(next, input.now);
  return next;
}

/**
 * Steps back one result. History is stored with the match, so undo works after
 * the app is closed and reopened.
 */
export function undoResult(matches: readonly Match[], matchId: string, now: number): Match[] {
  const next = cloneMatches(matches);
  const match = findMatch(next, matchId);

  if (match.status === 'bye') {
    throw new EngineError(['A bye has no result to undo.']);
  }

  if (match.history.length === 0) {
    if (match.winnerId === null && match.games.length === 0) {
      throw new EngineError(['There is no result to undo for this match.']);
    }

    const hadWinner = match.winnerId;
    clearFields(match, now);
    if (hadWinner !== null) resetDownstream(next, match, now);
    syncBracketState(next, now);
    return next;
  }

  const snapshot = match.history.pop()!;
  const previousWinner = match.winnerId;

  match.winnerId = snapshot.winnerId;
  match.games = snapshot.games.map((game) => ({ ...game }));
  match.court = snapshot.court;
  match.status =
    snapshot.winnerId !== null ? 'completed' : match.aId && match.bId ? 'ready' : 'pending';
  match.updatedAt = now;

  if (previousWinner !== snapshot.winnerId) {
    resetDownstream(next, match, now);
  }

  syncBracketState(next, now);
  return next;
}

/**
 * Removes a result without stepping back through history first. The removed
 * state is itself pushed to history, so an accidental clear can be undone.
 */
export function clearResult(matches: readonly Match[], matchId: string, now: number): Match[] {
  const next = cloneMatches(matches);
  const match = findMatch(next, matchId);

  if (match.status === 'bye') {
    throw new EngineError(['A bye has no result to clear.']);
  }
  if (match.winnerId === null && match.games.length === 0 && match.court === null) {
    return next;
  }

  pushHistory(match, {
    winnerId: match.winnerId,
    games: match.games,
    court: match.court,
    at: match.updatedAt,
  });

  const hadWinner = match.winnerId;
  clearFields(match, now);
  if (hadWinner !== null) resetDownstream(next, match, now);
  syncBracketState(next, now);
  return next;
}

/**
 * Counts the matches further down the bracket that already hold a result.
 * Changing the winner of `matchId` clears those matches, so the UI uses this
 * count to warn before throwing away downstream work.
 */
export function downstreamResultsCount(matches: readonly Match[], matchId: string): number {
  const byId = indexMatches(matches);
  const source = byId.get(matchId);
  if (!source) return 0;

  const seen = new Set<string>();
  const queue: string[] = source.nextMatchId !== null ? [source.nextMatchId] : [];
  let count = 0;

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const match = byId.get(id);
    if (!match) continue;

    if (match.winnerId !== null || match.games.length > 0 || match.court !== null) {
      count += 1;
    }
    if (match.nextMatchId !== null) queue.push(match.nextMatchId);
  }

  return count;
}

export interface ChampionInput {
  matches: readonly Match[];
  participants: readonly Participant[];
  settings: {
    format: TournamentFormat;
    points: PointsSettings;
    tiebreakers: TiebreakerId[];
  };
}

/**
 * Returns the champion's participant id, or null while the tournament is still
 * running. Round robin uses the final standings; every other format uses the
 * last knockout round.
 */
export function findChampion(input: ChampionInput): string | null {
  if (input.settings.format === 'round-robin') {
    const league = input.matches.filter((match) => match.stage === 'league');
    if (league.length === 0 || league.some((match) => match.status !== 'completed')) {
      return null;
    }

    const standings = computeStandings({
      participants: input.participants.slice(),
      matches: league.slice(),
      points: input.settings.points,
      tiebreakers: input.settings.tiebreakers,
    });
    return standings[0]?.participantId ?? null;
  }

  const knockout = input.matches.filter((match) => match.stage === 'knockout');
  if (knockout.length === 0) return null;

  const maxRound = knockout.reduce((highest, match) => Math.max(highest, match.round), -1);
  const final = knockout
    .filter((match) => match.round === maxRound)
    .sort((a, b) => a.slot - b.slot)
    .find((match) => match.nextMatchId === null);

  if (!final || final.status !== 'completed' || final.winnerId === null) return null;
  return final.winnerId;
}

function findMatch(matches: Match[], matchId: string): Match {
  const match = indexMatches(matches).get(matchId);
  if (!match) throw new EngineError(['That match no longer exists.']);
  return match;
}

/**
 * Winner-only events must not carry scores; single-game events hold one game;
 * best-of-three holds at most three. Scores remain optional in every mode.
 */
function validateScoreCount(mode: ScoreMode, games: readonly GameScore[]): void {
  const limit = maxGamesForMode(mode);
  if (mode === 'winner-only' && games.length > 0) {
    throw new EngineError([
      'This tournament records the winner only, so game scores cannot be saved.',
    ]);
  }
  if (games.length > limit) {
    throw new EngineError([
      mode === 'single-game'
        ? 'A single-game match can only have one game score.'
        : `A best-of-three match can hold at most ${limit} game scores.`,
    ]);
  }
}

function normalizeGames(
  games: readonly GameScore[],
  match: Match,
  winnerId: string,
): GameScore[] {
  const normalized: GameScore[] = [];
  let aWins = 0;
  let bWins = 0;

  for (const game of games) {
    if (
      !Number.isInteger(game.a) ||
      !Number.isInteger(game.b) ||
      game.a < 0 ||
      game.b < 0
    ) {
      throw new EngineError(['Game scores must be whole numbers of zero or more.']);
    }
    if (game.a === game.b) {
      throw new EngineError(['A game cannot end in a tie.']);
    }

    normalized.push({ a: game.a, b: game.b });
    if (game.a > game.b) aWins += 1;
    else bWins += 1;
  }

  if (normalized.length > 0) {
    const winnerWon = winnerId === match.aId ? aWins > bWins : bWins > aWins;
    if (!winnerWon) {
      throw new EngineError(['The game scores do not match the selected winner.']);
    }
  }

  return normalized;
}

function normalizeCourt(court: string | null | undefined): string | null {
  if (court === null || court === undefined) return null;
  const trimmed = court.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushHistory(
  match: Match,
  snapshot: { winnerId: string | null; games: GameScore[]; court: string | null; at: number },
): void {
  const entry: ResultSnapshot = {
    winnerId: snapshot.winnerId,
    games: snapshot.games.map((game) => ({ ...game })),
    court: snapshot.court,
    at: snapshot.at,
  };
  match.history.push(entry);
  if (match.history.length > MAX_HISTORY) {
    match.history.splice(0, match.history.length - MAX_HISTORY);
  }
}

function clearFields(match: Match, now: number): void {
  match.winnerId = null;
  match.games = [];
  match.court = null;
  match.status = match.aId !== null && match.bId !== null ? 'ready' : 'pending';
  match.updatedAt = now;
}

/**
 * Clears every descendant of a changed match and removes the participant that
 * the old winner pushed forward. `syncBracketState` then rebuilds the remaining
 * known sides from the other, untouched branches.
 */
function resetDownstream(matches: Match[], source: Match, now: number): void {
  const byId = indexMatches(matches);
  const queue: string[] = [];
  const seen = new Set<string>();

  if (source.nextMatchId !== null) queue.push(source.nextMatchId);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const match = byId.get(id);
    if (!match) continue;

    match.winnerId = null;
    match.games = [];
    match.court = null;
    match.history = [];
    match.status = 'pending';
    match.updatedAt = now;

    if (match.aSource?.kind === 'winner') match.aId = null;
    if (match.bSource?.kind === 'winner') match.bId = null;

    if (match.nextMatchId !== null) queue.push(match.nextMatchId);
  }
}
