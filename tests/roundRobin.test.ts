import { describe, expect, it } from 'vitest';
import { buildRoundRobinMatches, roundRobinRounds } from '../src/domain/roundRobin';
import { makeParticipants } from './fixtures';

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

describe('roundRobinRounds', () => {
  it('builds every pairing once for an even count', () => {
    const rounds = roundRobinRounds(['a', 'b', 'c', 'd']);

    expect(rounds).toHaveLength(3);
    const pairs = rounds.flatMap((round) => round.pairs);
    expect(pairs).toHaveLength(6);
    expect(new Set(pairs.map(([a, b]) => pairKey(a, b))).size).toBe(6);
  });

  it('gives one entry a rest each round for an odd count', () => {
    const rounds = roundRobinRounds(['a', 'b', 'c', 'd', 'e']);

    expect(rounds).toHaveLength(5);
    expect(rounds.every((round) => round.pairs.length === 2)).toBe(true);

    const pairs = rounds.flatMap((round) => round.pairs);
    expect(pairs).toHaveLength(10);
    expect(new Set(pairs.map(([a, b]) => pairKey(a, b))).size).toBe(10);
  });

  it('handles the smallest possible league', () => {
    expect(roundRobinRounds(['a', 'b'])).toEqual([{ round: 0, pairs: [['a', 'b']] }]);
    expect(roundRobinRounds(['a'])).toEqual([]);
  });
});

describe('buildRoundRobinMatches', () => {
  it('creates one stored, ready match per pairing', () => {
    const participants = makeParticipants(4);
    const matches = buildRoundRobinMatches({
      tournamentId: 't1',
      participants,
      stage: 'league',
      groupId: null,
      orderBase: 0,
      now: 10,
    });

    expect(matches).toHaveLength(6);
    expect(matches.every((match) => match.status === 'ready')).toBe(true);
    expect(matches.every((match) => match.stage === 'league')).toBe(true);
    expect(new Set(matches.map((match) => match.id)).size).toBe(6);
    expect(matches.every((match) => match.aId !== null && match.bId !== null)).toBe(true);
    expect(matches.map((match) => match.order)).toEqual([0, 1, 100, 101, 200, 201]);
  });

  it('keeps group matches apart by group id', () => {
    const participants = makeParticipants(2);
    const matches = buildRoundRobinMatches({
      tournamentId: 't1',
      participants,
      stage: 'group',
      groupId: 'A',
      orderBase: 1000,
      now: 10,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ stage: 'group', groupId: 'A', order: 1000 });
  });
});
