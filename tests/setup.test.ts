import { describe, expect, it } from 'vitest';
import {
  applyAutoGroups,
  autoGroupAssignments,
  buildEntryRows,
  createDraftEntry,
  drawEntryIssues,
  duplicateEntryIssues,
  groupAssignmentIssues,
  groupConfigIssues,
  groupLabels,
  previewGroupKeys,
  reviewSetup,
  type DraftEntry,
} from '../src/domain/setup';
import { participantLabel, participantPlayerNames } from '../src/domain/display';
import type { Participant, Player } from '../src/domain/types';

function entry(key: string, names: string[], overrides: Partial<DraftEntry> = {}): DraftEntry {
  return {
    key,
    id: null,
    playerNames: names,
    teamName: '',
    groupId: null,
    active: true,
    ...overrides,
  };
}

describe('entry validation', () => {
  it('creates the right number of name fields for each discipline', () => {
    expect(createDraftEntry('singles').playerNames).toHaveLength(1);
    expect(createDraftEntry('doubles').playerNames).toHaveLength(2);
  });

  it('rejects duplicate lineups and duplicate players', () => {
    const entries = [
      entry('a', ['Alice', 'Bob']),
      entry('b', ['alice', 'bob']),
      entry('c', ['Alice', 'Cara']),
    ];

    const issues = duplicateEntryIssues(entries, 'doubles');
    expect(issues.some((issue) => issue.includes('already entered'))).toBe(true);
    expect(issues.some((issue) => issue.includes('already appears'))).toBe(true);
  });

  it('ignores accents, case and extra spaces in duplicate checks', () => {
    const issues = duplicateEntryIssues(
      [entry('a', ['Léa  Dupont']), entry('b', ['lea dupont'])],
      'singles',
    );
    expect(issues).toHaveLength(2);
  });

  it('requires complete rows and at least two active entries for a draw', () => {
    const issues = drawEntryIssues(
      [entry('a', ['Alice']), entry('b', [''])],
      'singles',
    );
    expect(issues.some((issue) => issue.includes('Complete every player name'))).toBe(true);
    expect(issues.some((issue) => issue.includes('at least two active entries'))).toBe(true);
  });

  it('allows incomplete rows to be ignored when saving a draft', () => {
    const issues = duplicateEntryIssues(
      [entry('a', ['Alice']), entry('b', [''])],
      'singles',
    );
    expect(issues).toEqual([]);
  });
});

describe('group previews', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('balances the seeded order across groups', () => {
    const groups = previewGroupKeys(keys, 'manual', 1, 3);
    expect(groups.map((group) => group.groupId)).toEqual(groupLabels(3));
    expect(groups.map((group) => group.keys)).toEqual([
      ['a', 'f'],
      ['b', 'e'],
      ['c', 'd'],
    ]);
  });

  it('reproduces a random split from the stored seed', () => {
    const first = previewGroupKeys(keys, 'random', 12345, 3);
    const second = previewGroupKeys(keys, 'random', 12345, 3);
    expect(first).toEqual(second);
    expect(first.flatMap((group) => group.keys).sort()).toEqual(keys.slice().sort());
  });

  it('maps every active entry to a group when auto-balancing', () => {
    const entries = keys.map((key) => entry(key, [key]));
    const assignments = autoGroupAssignments(entries, 'snake', 1, 2);
    expect(assignments.size).toBe(6);
    const applied = applyAutoGroups(entries, 'snake', 1, 2);
    expect(applied.every((row) => row.groupId !== null)).toBe(true);
  });

  it('reports impossible group configurations', () => {
    expect(groupConfigIssues(4, 2, 3).some((issue) => issue.includes('at least 3'))).toBe(true);
    expect(groupConfigIssues(4, 5, 1).some((issue) => issue.includes('more groups'))).toBe(true);
    expect(groupConfigIssues(4, 2, 0).some((issue) => issue.includes('At least one'))).toBe(true);
  });

  it('reports empty groups and unassigned entries', () => {
    const entries = [
      entry('a', ['Alice'], { groupId: 'A' }),
      entry('b', ['Bob'], { groupId: 'A' }),
      entry('c', ['Cara'], { groupId: null }),
    ];
    const issues = groupAssignmentIssues(entries, 2, 2);
    expect(issues.some((issue) => issue.includes('Group B has no entries'))).toBe(true);
    expect(issues.some((issue) => issue.includes('assigned to a group'))).toBe(true);
  });
});

describe('setup review', () => {
  it('counts round-robin matches', () => {
    const review = reviewSetup(
      { format: 'round-robin', participantCount: 4, groupCount: 0, qualifiersPerGroup: 0 },
      ['Alice', 'Bob', 'Cara', 'Dan'].map((name, index) =>
        entry(String(index), [name]),
      ),
    );
    expect(review.matchCount).toBe(6);
    expect(review.knockoutSize).toBeNull();
  });

  it('counts elimination byes', () => {
    const review = reviewSetup(
      {
        format: 'single-elimination',
        participantCount: 5,
        groupCount: 0,
        qualifiersPerGroup: 0,
      },
      ['Alice', 'Bob', 'Cara', 'Dan', 'Eve'].map((name, index) =>
        entry(String(index), [name]),
      ),
    );
    expect(review.knockoutSize).toBe(8);
    expect(review.byes).toBe(3);
    expect(review.matchCount).toBe(7);
  });

  it('counts groups plus knockout fixtures', () => {
    const entries = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn'].map((name, index) =>
      entry(String(index), [name], { groupId: index < 3 ? 'A' : 'B' }),
    );
    const review = reviewSetup(
      {
        format: 'groups-knockout',
        participantCount: 6,
        groupCount: 2,
        qualifiersPerGroup: 2,
      },
      entries,
    );
    expect(review.knockoutSize).toBe(4);
    expect(review.matchCount).toBe(9);
  });
});

describe('buildEntryRows', () => {
  it('creates one player per name and one participant per entry', () => {
    const built = buildEntryRows(
      't1',
      [entry('a', ['Alice', 'Bob']), entry('b', ['Cara', 'Dan'])],
      'doubles',
      100,
    );

    expect(built.players).toHaveLength(4);
    expect(built.participants).toHaveLength(2);
    expect(new Set(built.players.map((player) => player.id)).size).toBe(4);
    expect(built.participants[0]?.playerIds).toHaveLength(2);
    expect(built.participants[0]?.seed).toBe(1);
    expect(built.participants[1]?.seed).toBe(2);
  });
});

describe('participant labels', () => {
  const alice: Player = {
    id: 'p1',
    tournamentId: 't1',
    name: 'Alice',
    nameKey: 'alice',
    createdAt: 1,
  };
  const bob: Player = {
    id: 'p2',
    tournamentId: 't1',
    name: 'Bob',
    nameKey: 'bob',
    createdAt: 2,
  };
  const participant: Participant = {
    id: 'e1',
    tournamentId: 't1',
    playerIds: ['p1', 'p2'],
    nameKey: 'alice|bob',
    teamName: null,
    seed: 1,
    groupId: null,
    active: true,
    createdAt: 1,
  };

  it('keeps the entry player order even when the player table is unordered', () => {
    expect(participantPlayerNames(participant, [bob, alice])).toEqual(['Alice', 'Bob']);
    expect(participantLabel(participant, [bob, alice])).toBe('Alice & Bob');
  });

  it('prefers the team name', () => {
    expect(participantLabel({ ...participant, teamName: 'Aces' }, [alice, bob])).toBe('Aces');
  });
});
