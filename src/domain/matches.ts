import type { Match, MatchStage } from './types';

export function createMatch(base: {
  tournamentId: string;
  stage: MatchStage;
  groupId: string | null;
  round: number;
  roundLabel: string;
  slot: number;
  order: number;
  now: number;
}): Match {
  return {
    id: `m-${base.tournamentId}-${base.stage}-${base.groupId ?? 'x'}-${base.round}-${base.slot}-${base.order}`,
    tournamentId: base.tournamentId,
    stage: base.stage,
    groupId: base.groupId,
    round: base.round,
    roundLabel: base.roundLabel,
    slot: base.slot,
    order: base.order,
    aId: null,
    bId: null,
    aSource: null,
    bSource: null,
    aLabel: '',
    bLabel: '',
    status: 'pending',
    winnerId: null,
    games: [],
    court: null,
    nextMatchId: null,
    nextSlot: null,
    history: [],
    updatedAt: base.now,
  };
}

export function cloneMatches(matches: readonly Match[]): Match[] {
  return matches.map((match) => ({
    ...match,
    games: match.games.map((game) => ({ ...game })),
    history: match.history.map((snapshot) => ({
      ...snapshot,
      games: snapshot.games.map((game) => ({ ...game })),
    })),
    aSource: match.aSource ? { ...match.aSource } : null,
    bSource: match.bSource ? { ...match.bSource } : null,
  }));
}

export function indexMatches(matches: readonly Match[]): Map<string, Match> {
  return new Map(matches.map((match) => [match.id, match]));
}

/** A side is a bye when no participant and no source can ever fill it. */
export function isByeSide(match: Match, side: 'a' | 'b'): boolean {
  return side === 'a'
    ? match.aId === null && (match.aSource ?? null) === null
    : match.bId === null && (match.bSource ?? null) === null;
}

export function compareMatches(a: Match, b: Match): number {
  return a.order - b.order;
}
