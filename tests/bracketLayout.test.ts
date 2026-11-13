import { describe, expect, it } from 'vitest';
import { bracketRounds } from '../src/domain/bracketLayout';
import { buildElimination } from '../src/domain/elimination';
import { makeParticipants } from './fixtures';
import type { Match } from '../src/domain/types';

function bracket(count: number): Match[] {
  return buildElimination({
    tournamentId: 't1',
    participants: makeParticipants(count),
    now: 100,
  }).matches;
}

describe('bracketRounds', () => {
  it('groups matches into one column per round with doubling spans', () => {
    const rounds = bracketRounds(bracket(8));

    expect(rounds.map((round) => round.round)).toEqual([0, 1, 2]);
    expect(rounds.map((round) => round.label)).toEqual([
      'Quarter-final',
      'Semi-final',
      'Final',
    ]);
    expect(rounds.map((round) => round.matches.length)).toEqual([4, 2, 1]);
    expect(rounds.map((round) => round.span)).toEqual([1, 2, 4]);
  });

  it('sorts each round by slot even when the input is shuffled', () => {
    const matches = bracket(8);
    const shuffled = [...matches].reverse();
    const rounds = bracketRounds(shuffled);

    for (const round of rounds) {
      const slots = round.matches.map((match) => match.slot);
      expect(slots).toEqual([...slots].sort((a, b) => a - b));
    }
  });

  it('ignores matches that are not in the knockout stage', () => {
    const matches = bracket(4);
    const league = {
      ...matches[0]!,
      id: 'league-1',
      stage: 'league' as const,
      round: 9,
      roundLabel: 'League round 9',
    };
    const rounds = bracketRounds([...matches, league]);

    expect(rounds.flatMap((round) => round.matches).some((match) => match.id === 'league-1')).toBe(
      false,
    );
    expect(rounds.map((round) => round.round)).toEqual([0, 1]);
  });

  it('keeps bye matches in the first round so the bracket stays aligned', () => {
    const rounds = bracketRounds(bracket(5));

    expect(rounds[0]!.matches).toHaveLength(4);
    expect(rounds[0]!.matches.some((match) => match.status === 'bye')).toBe(true);
    expect(rounds.map((round) => round.span)).toEqual([1, 2, 4]);
  });

  it('treats the first present round as the base when earlier rounds are absent', () => {
    const matches = bracket(4).map((match) => ({
      ...match,
      round: match.round + 2,
      roundLabel: match.round === 0 ? 'Semi-final' : 'Final',
    }));
    const rounds = bracketRounds(matches);

    expect(rounds.map((round) => round.round)).toEqual([2, 3]);
    expect(rounds.map((round) => round.span)).toEqual([1, 2]);
  });

  it('handles a single final and an empty bracket', () => {
    const final = bracketRounds(bracket(2));
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ label: 'Final', span: 1 });
    expect(final[0]!.matches).toHaveLength(1);

    expect(bracketRounds([])).toEqual([]);
  });
});
