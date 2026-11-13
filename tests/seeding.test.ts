import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/domain/errors';
import {
  allocateGroups,
  groupLabel,
  minimumGroupSize,
  rankParticipants,
} from '../src/domain/seeding';
import { makeParticipants } from './fixtures';

describe('rankParticipants', () => {
  it('is deterministic for a random draw', () => {
    const participants = makeParticipants(8);
    const first = rankParticipants(participants, 'random', 4242);
    const second = rankParticipants(participants, 'random', 4242);

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.map((entry) => entry.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(participants.map((entry) => entry.id)).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
      'e7',
      'e8',
    ]);
  });

  it('uses a manual order exactly as given', () => {
    const participants = makeParticipants(4);
    const ranked = rankParticipants(participants, 'manual', 0, ['e3', 'e1', 'e4', 'e2']);

    expect(ranked.map((entry) => entry.id)).toEqual(['e3', 'e1', 'e4', 'e2']);
    expect(ranked.map((entry) => entry.seed)).toEqual([1, 2, 3, 4]);
  });

  it('rejects an incomplete or duplicate manual order', () => {
    const participants = makeParticipants(4);

    expect(() => rankParticipants(participants, 'manual', 0, ['e1', 'e2', 'e3'])).toThrow(
      EngineError,
    );
    expect(() => rankParticipants(participants, 'manual', 0, ['e1', 'e2', 'e3', 'e3'])).toThrow(
      EngineError,
    );
    expect(() =>
      rankParticipants(participants, 'manual', 0, ['e1', 'e2', 'e3', 'ghost']),
    ).toThrow(EngineError);
  });

  it('keeps the given order for snake seeding', () => {
    const participants = makeParticipants(5);
    const ranked = rankParticipants(participants, 'snake', 99, ['e5', 'e4', 'e3', 'e2', 'e1']);

    expect(ranked.map((entry) => entry.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
  });
});

describe('allocateGroups', () => {
  it('spreads seeds with a serpentine pattern and balanced sizes', () => {
    const ranked = rankParticipants(makeParticipants(7), 'manual', 0, [
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
      'e7',
    ]);
    const groups = allocateGroups(ranked, 3);

    expect(groups.map((group) => group.groupId)).toEqual(['A', 'B', 'C']);
    expect(groups.map((group) => group.participants.map((entry) => entry.seed))).toEqual([
      [1, 6, 7],
      [2, 5],
      [3, 4],
    ]);
  });

  it('places the top seeds in different groups', () => {
    const ranked = rankParticipants(makeParticipants(8), 'manual', 0, [
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
      'e7',
      'e8',
    ]);
    const groups = allocateGroups(ranked, 4);

    expect(groups.map((group) => group.participants[0]?.seed)).toEqual([1, 2, 3, 4]);
  });

  it('rejects impossible group counts', () => {
    const ranked = rankParticipants(makeParticipants(3), 'manual', 0, ['e1', 'e2', 'e3']);

    expect(() => allocateGroups(ranked, 0)).toThrow(EngineError);
    expect(() => allocateGroups(ranked, 4)).toThrow(EngineError);
  });
});

describe('group helpers', () => {
  it('labels groups alphabetically and then with a suffix', () => {
    expect(groupLabel(0)).toBe('A');
    expect(groupLabel(25)).toBe('Z');
    expect(groupLabel(26)).toBe('A1');
    expect(minimumGroupSize(7, 3)).toBe(2);
  });
});
