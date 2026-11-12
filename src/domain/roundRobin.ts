import { createMatch } from './matches';
import type { Match, Participant } from './types';

export interface RoundRobinRound {
  round: number;
  pairs: Array<[string, string]>;
}

/**
 * Circle method. One entry stays fixed while the others rotate, which produces
 * every pairing exactly once: n(n-1)/2 matches, or n-1 rounds for n entries.
 * An odd count is padded with a phantom slot, so one entry rests each round.
 */
export function roundRobinRounds(ids: readonly string[]): RoundRobinRound[] {
  if (ids.length < 2) return [];

  const slots: Array<string | null> = ids.slice();
  if (slots.length % 2 === 1) slots.push(null);

  const size = slots.length;
  const rounds: RoundRobinRound[] = [];
  const rotating = slots.slice(1);

  for (let round = 0; round < size - 1; round += 1) {
    const row: Array<string | null> = [slots[0] ?? null, ...rotating];
    const pairs: Array<[string, string]> = [];

    for (let index = 0; index < size / 2; index += 1) {
      const a = row[index] ?? null;
      const b = row[size - 1 - index] ?? null;
      if (a !== null && b !== null) pairs.push([a, b]);
    }

    rounds.push({ round, pairs });

    const last = rotating.pop();
    if (last !== undefined) rotating.unshift(last);
  }

  return rounds;
}

/** Turns the pairings into stored matches, one row per fixture. */
export function buildRoundRobinMatches(params: {
  tournamentId: string;
  participants: Participant[];
  stage: 'league' | 'group';
  groupId: string | null;
  orderBase: number;
  now: number;
}): Match[] {
  const rounds = roundRobinRounds(params.participants.map((participant) => participant.id));
  const matches: Match[] = [];

  for (const round of rounds) {
    round.pairs.forEach(([aId, bId], index) => {
      const match = createMatch({
        tournamentId: params.tournamentId,
        stage: params.stage,
        groupId: params.groupId,
        round: round.round,
        roundLabel: `Round ${round.round + 1}`,
        slot: index,
        order: params.orderBase + round.round * 100 + index,
        now: params.now,
      });
      match.aId = aId;
      match.bId = bId;
      match.status = 'ready';
      matches.push(match);
    });
  }

  return matches;
}
