import { EngineError } from './errors';
import { createMatch, indexMatches, isByeSide } from './matches';
import type { Match, MatchSource, Participant } from './types';

export const MIN_BRACKET = 2;
export const MAX_BRACKET = 64;

export function isPowerOfTwo(value: number): boolean {
  return value >= 2 && Number.isInteger(Math.log2(value));
}

export function nextPowerOfTwo(value: number): number {
  let size = MIN_BRACKET;
  while (size < value) size *= 2;
  return Math.min(size, MAX_BRACKET);
}

/**
 * Standard bracket seed order. Adjacent pairs are first-round matches, and the
 * top two seeds can only meet in the final.
 * 8 places -> 1, 8, 4, 5, 2, 7, 3, 6
 */
export function seedOrder(size: number): number[] {
  if (!isPowerOfTwo(size)) {
    throw new EngineError(['A bracket size must be a power of two.']);
  }
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) next.push(seed, sum - seed);
    order = next;
  }
  return order;
}

export function roundLabel(teamsRemaining: number): string {
  if (teamsRemaining >= 8) {
    if (teamsRemaining === 8) return 'Quarter-final';
    return `Round of ${teamsRemaining}`;
  }
  if (teamsRemaining === 4) return 'Semi-final';
  return 'Final';
}

export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * One place in a bracket. Elimination brackets fill every place at generation
 * time; groups + knockout leaves qualifier places to be filled later.
 */
export type BracketSlot =
  | { kind: 'participant'; participant: Participant }
  | { kind: 'qualifier'; source: MatchSource; label: string }
  | { kind: 'bye' };

interface BracketInput {
  tournamentId: string;
  /** Length must be a power of two, already in bracket position order. */
  slots: BracketSlot[];
  orderBase: number;
  now: number;
}

export interface BracketResult {
  matches: Match[];
  size: number;
}

export function buildBracket(input: BracketInput): BracketResult {
  const size = input.slots.length;
  if (!isPowerOfTwo(size)) {
    throw new EngineError(['A knockout bracket needs 2, 4, 8, 16, 32 or 64 places.']);
  }

  const roundCount = Math.log2(size);
  const rounds: Match[][] = [];

  for (let round = 0; round < roundCount; round += 1) {
    const count = size / 2 ** (round + 1);
    const list: Match[] = [];
    for (let slot = 0; slot < count; slot += 1) {
      list.push(
        createMatch({
          tournamentId: input.tournamentId,
          stage: 'knockout',
          groupId: null,
          round,
          roundLabel: roundLabel(size / 2 ** round),
          slot,
          order: input.orderBase + round * 1000 + slot,
          now: input.now,
        }),
      );
    }
    rounds.push(list);
  }

  // Link each match to the one its winner feeds into.
  for (let round = 0; round < roundCount - 1; round += 1) {
    const current = rounds[round]!;
    const next = rounds[round + 1]!;

    current.forEach((feeder, index) => {
      const target = next[Math.floor(index / 2)]!;
      feeder.nextMatchId = target.id;
      feeder.nextSlot = index % 2 === 0 ? 'a' : 'b';

      const source: MatchSource = { kind: 'winner', matchId: feeder.id };
      const label = `Winner of ${feeder.roundLabel} ${feeder.slot + 1}`;

      if (index % 2 === 0) {
        target.aSource = source;
        target.aLabel = label;
      } else {
        target.bSource = source;
        target.bLabel = label;
      }
    });
  }

  const first = rounds[0]!;
  input.slots.forEach((slot, index) => {
    const match = first[Math.floor(index / 2)]!;
    const side = index % 2 === 0 ? 'a' : 'b';
    setSide(match, side, slot);
  });

  for (const match of first) settleOpeningMatch(match);

  return { matches: rounds.flat(), size };
}

function setSide(match: Match, side: 'a' | 'b', slot: BracketSlot): void {
  const id = slot.kind === 'participant' ? slot.participant.id : null;
  const source =
    slot.kind === 'qualifier'
      ? slot.source
      : slot.kind === 'participant'
        ? null
        : null;
  const label = slot.kind === 'qualifier' ? slot.label : slot.kind === 'bye' ? 'BYE' : '';

  if (side === 'a') {
    match.aId = id;
    match.aSource = source;
    match.aLabel = label;
  } else {
    match.bId = id;
    match.bSource = source;
    match.bLabel = label;
  }
}

function settleOpeningMatch(match: Match): void {
  if (match.aId !== null && match.bId !== null) {
    match.status = 'ready';
    return;
  }
  if (match.aId !== null && isByeSide(match, 'b')) {
    match.status = 'bye';
    match.winnerId = match.aId;
    return;
  }
  if (match.bId !== null && isByeSide(match, 'a')) {
    match.status = 'bye';
    match.winnerId = match.bId;
    return;
  }
  match.status = 'pending';
}

/** Writes a winner into the next match without touching recorded results. */
function feedNext(byId: Map<string, Match>, match: Match, at: number): void {
  if (match.winnerId === null || match.nextMatchId === null || match.nextSlot === null) return;
  const next = byId.get(match.nextMatchId);
  if (!next) return;

  if (match.nextSlot === 'a') next.aId = match.winnerId;
  else next.bId = match.winnerId;

  // Never downgrade a match that already has a recorded result. Re-feeding the
  // same winner must be idempotent.
  if (next.status !== 'completed' && next.aId !== null && next.bId !== null) {
    next.status = 'ready';
  }
  next.updatedAt = at;
}

/**
 * Recomputes every knockout row from its current sides, then passes winners
 * forward from round to round. This is the single source of truth for bracket
 * progression: generation, bye resolution, qualifier filling and result
 * correction all end by calling it.
 *
 * A match with one participant and one empty (bye) side auto-advances. A match
 * with two known participants is ready. A match still waiting on a source stays
 * pending. Completed results are never overwritten.
 */
export function syncBracketState(matches: Match[], at: number): Match[] {
  const byId = indexMatches(matches);
  const knockout = matches.filter((match) => match.stage === 'knockout');
  const maxRound = knockout.reduce((highest, match) => Math.max(highest, match.round), -1);

  for (let round = 0; round <= maxRound; round += 1) {
    const roundMatches = knockout
      .filter((match) => match.round === round)
      .sort((a, b) => a.slot - b.slot);

    for (const match of roundMatches) {
      if (match.status !== 'completed') {
        const aBye = isByeSide(match, 'a');
        const bBye = isByeSide(match, 'b');

        if (match.aId !== null && match.bId !== null) {
          match.status = 'ready';
          match.winnerId = null;
        } else if (match.aId !== null && bBye) {
          match.status = 'bye';
          match.winnerId = match.aId;
        } else if (match.bId !== null && aBye) {
          match.status = 'bye';
          match.winnerId = match.bId;
        } else {
          match.status = 'pending';
          match.winnerId = null;
        }
      }

      if (match.winnerId !== null && match.nextMatchId !== null) {
        feedNext(byId, match, at);
      }
    }
  }

  return matches;
}

/**
 * Auto-advances every bye and any other already-known winner. Runs at
 * generation time (elimination) and again once group qualifiers are known
 * (groups + knockout).
 */
export function resolveByes(matches: Match[], at: number): Match[] {
  return syncBracketState(matches, at);
}

export function buildElimination(params: {
  tournamentId: string;
  participants: Participant[];
  orderBase?: number;
  now: number;
}): BracketResult {
  if (params.participants.length < 2) {
    throw new EngineError(['Single elimination needs at least two participants.']);
  }

  const size = nextPowerOfTwo(params.participants.length);
  if (params.participants.length > size) {
    throw new EngineError([`A bracket can hold at most ${size} participants.`]);
  }

  const order = seedOrder(size);
  const slots: BracketSlot[] = order.map((seed) => {
    const participant = params.participants[seed - 1];
    return participant ? { kind: 'participant', participant } : { kind: 'bye' };
  });

  const bracket = buildBracket({
    tournamentId: params.tournamentId,
    slots,
    orderBase: params.orderBase ?? 0,
    now: params.now,
  });

  return { matches: resolveByes(bracket.matches, params.now), size: bracket.size };
}
