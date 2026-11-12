import type { Match } from './types';

export interface BracketRound {
  round: number;
  label: string;
  matches: Match[];
  /** How many first-round rows this round spans in the visual bracket. */
  span: number;
}

/**
 * Groups knockout matches into visual columns. The first round is one row tall,
 * the next round spans two rows, then four, and so on. That structure is what
 * lets the CSS place each match halfway between its two feeders.
 */
export function bracketRounds(matches: readonly Match[]): BracketRound[] {
  const byRound = new Map<number, Match[]>();

  for (const match of matches) {
    if (match.stage !== 'knockout') continue;
    const list = byRound.get(match.round) ?? [];
    list.push(match);
    byRound.set(match.round, list);
  }

  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);
  const firstRound = roundNumbers[0] ?? 0;

  return roundNumbers.map((round) => {
    const list = (byRound.get(round) ?? []).slice().sort((a, b) => a.slot - b.slot);
    return {
      round,
      label: list[0]?.roundLabel ?? `Round ${round + 1}`,
      matches: list,
      span: 2 ** (round - firstRound),
    };
  });
}
