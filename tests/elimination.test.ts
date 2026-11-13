import { describe, expect, it } from 'vitest';
import {
  buildElimination,
  isPowerOfTwo,
  nextPowerOfTwo,
  seedOrder,
} from '../src/domain/elimination';
import { EngineError } from '../src/domain/errors';
import { makeParticipants } from './fixtures';

function build(count: number) {
  return buildElimination({
    tournamentId: 't1',
    participants: makeParticipants(count),
    now: 100,
  });
}

describe('bracket sizing', () => {
  it('detects powers of two and rounds up', () => {
    expect([2, 4, 8, 16, 32, 64].every(isPowerOfTwo)).toBe(true);
    expect([3, 6, 12, 65].some(isPowerOfTwo)).toBe(false);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(64)).toBe(64);
    expect(nextPowerOfTwo(65)).toBe(64);
  });

  it('uses the standard seed order', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(new Set(seedOrder(16)).size).toBe(16);
  });
});

describe('buildElimination', () => {
  it('builds a complete bracket with no byes for eight entries', () => {
    const bracket = build(8);

    expect(bracket.size).toBe(8);
    expect(bracket.matches).toHaveLength(7);
    expect(bracket.matches.filter((match) => match.round === 0)).toHaveLength(4);
    expect(
      bracket.matches.filter((match) => match.round === 0).every((match) => match.status === 'ready'),
    ).toBe(true);
    expect(
      bracket.matches.filter((match) => match.round > 0).every((match) => match.status === 'pending'),
    ).toBe(true);
    expect(bracket.matches.every((match) => match.winnerId === null)).toBe(true);
    expect(new Set(bracket.matches.map((match) => match.id)).size).toBe(7);
  });

  it('advances a first-round bye into the next round', () => {
    const bracket = build(5);
    const semiFinal = bracket.matches
      .filter((match) => match.round === 1)
      .sort((a, b) => a.slot - b.slot);

    expect(bracket.size).toBe(8);
    expect(bracket.matches.filter((match) => match.status === 'bye')).toHaveLength(3);
    expect(semiFinal[0]).toMatchObject({ aId: 'e1', bId: null, status: 'pending' });
    expect(semiFinal[1]).toMatchObject({ aId: 'e2', bId: 'e3', status: 'ready' });
  });

  it('handles a bracket with a single bye', () => {
    const bracket = build(3);
    const final = bracket.matches.find((match) => match.round === 1);

    expect(bracket.size).toBe(4);
    expect(bracket.matches.filter((match) => match.status === 'bye')).toHaveLength(1);
    expect(final).toMatchObject({ aId: 'e1', bId: null, status: 'pending' });
  });

  it('builds a two-entry final directly', () => {
    const bracket = build(2);

    expect(bracket.size).toBe(2);
    expect(bracket.matches).toHaveLength(1);
    expect(bracket.matches[0]).toMatchObject({
      round: 0,
      roundLabel: 'Final',
      aId: 'e1',
      bId: 'e2',
      status: 'ready',
    });
  });

  it('supports the maximum size and refuses more', () => {
    expect(build(64).matches).toHaveLength(63);
    expect(() => build(65)).toThrow(EngineError);
  });

  it('refuses fewer than two entries', () => {
    expect(() =>
      buildElimination({ tournamentId: 't1', participants: [], now: 1 }),
    ).toThrow(EngineError);
  });

  it('produces stable ids so a draw can be regenerated', () => {
    const first = build(8);
    const second = build(8);

    expect(first.matches.map((match) => match.id)).toEqual(
      second.matches.map((match) => match.id),
    );
  });
});
