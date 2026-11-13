import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/domain/errors';
import {
  avoidSameGroupFirstRound,
  buildGroupKnockout,
  buildGroupStage,
  fillKnockoutFromGroups,
  qualifierEntries,
} from '../src/domain/groupsKnockout';
import type { BracketSlot } from '../src/domain/elimination';
import type { Group } from '../src/domain/seeding';
import type { Match, Participant, TiebreakerId } from '../src/domain/types';

const settings = {
  points: { win: 2, loss: 1 },
  tiebreakers: [
    'points',
    'wins',
    'gameDifference',
    'pointDifference',
    'seed',
  ] as TiebreakerId[],
};

function group(id: string, participants: Participant[]): Group {
  return {
    groupId: id,
    participants: participants.map((participant) => ({ ...participant, groupId: id })),
  };
}

function complete(match: Match, winnerId: string): Match {
  return {
    ...match,
    status: 'completed',
    winnerId,
    games: [],
  };
}

function firstRound(matches: Match[]): Match[] {
  return matches
    .filter((match) => match.round === 0)
    .sort((a, b) => a.slot - b.slot);
}

function groupsOfTwo(participants: Participant[]): Group[] {
  return [
    group('A', [participants[0]!, participants[1]!]),
    group('B', [participants[2]!, participants[3]!]),
  ];
}

describe('qualifierEntries', () => {
  it('orders every winner before every runner-up', () => {
    expect(qualifierEntries(['A', 'B', 'C'], 2)).toEqual([
      { groupId: 'A', placement: 1, label: 'A 1st' },
      { groupId: 'B', placement: 1, label: 'B 1st' },
      { groupId: 'C', placement: 1, label: 'C 1st' },
      { groupId: 'A', placement: 2, label: 'A 2nd' },
      { groupId: 'B', placement: 2, label: 'B 2nd' },
      { groupId: 'C', placement: 2, label: 'C 2nd' },
    ]);
  });
});

describe('buildGroupStage', () => {
  it('stamps group ids and builds one round robin per group', () => {
    const participants = Array.from({ length: 6 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));
    const groups = [
      group('A', participants.slice(0, 3)),
      group('B', participants.slice(3, 6)),
    ];

    const stage = buildGroupStage({
      tournamentId: 't1',
      groups,
      orderBase: 0,
      now: 10,
    });

    expect(stage.groups.map((entry) => entry.groupId)).toEqual(['A', 'B']);
    expect(stage.groups.flatMap((entry) => entry.participants).every((entry) => entry.groupId)).toBe(
      true,
    );
    expect(stage.matches).toHaveLength(6);
    expect(stage.matches.filter((match) => match.groupId === 'A')).toHaveLength(3);
    expect(stage.matches.every((match) => match.stage === 'group')).toBe(true);
  });

  it('rejects duplicate or empty group names', () => {
    const participants = Array.from({ length: 4 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));

    expect(() =>
      buildGroupStage({
        tournamentId: 't1',
        groups: [group('A', participants.slice(0, 2)), group('A', participants.slice(2))],
        now: 1,
      }),
    ).toThrow(EngineError);
    expect(() =>
      buildGroupStage({
        tournamentId: 't1',
        groups: [group(' ', participants)],
        now: 1,
      }),
    ).toThrow(EngineError);
  });
});

describe('buildGroupKnockout', () => {
  it('builds a four-place bracket from two groups', () => {
    const participants = Array.from({ length: 4 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));
    const result = buildGroupKnockout({
      tournamentId: 't1',
      groups: groupsOfTwo(participants),
      qualifiersPerGroup: 2,
      now: 10,
    });

    expect(result.size).toBe(4);
    expect(result.matches).toHaveLength(3);
    expect(firstRound(result.matches)).toHaveLength(2);
    expect(result.matches.every((match) => match.aId === null && match.bId === null)).toBe(true);
  });

  it('never pairs two qualifiers from the same group in round one', () => {
    const participants = Array.from({ length: 9 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));
    const groups = [
      group('A', participants.slice(0, 3)),
      group('B', participants.slice(3, 6)),
      group('C', participants.slice(6, 9)),
    ];
    const result = buildGroupKnockout({
      tournamentId: 't1',
      groups,
      qualifiersPerGroup: 2,
      now: 10,
    });

    expect(result.size).toBe(8);
    for (const match of firstRound(result.matches)) {
      const groupA = match.aSource?.kind === 'group' ? match.aSource.groupId : null;
      const groupB = match.bSource?.kind === 'group' ? match.bSource.groupId : null;
      if (groupA && groupB) expect(groupA).not.toBe(groupB);
    }
  });

  it('gives every group exactly the requested number of qualifier places', () => {
    const participants = Array.from({ length: 9 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));
    const groups = [
      group('A', participants.slice(0, 3)),
      group('B', participants.slice(3, 6)),
      group('C', participants.slice(6, 9)),
    ];

    const result = buildGroupKnockout({
      tournamentId: 't1',
      groups,
      qualifiersPerGroup: 2,
      now: 10,
    });

    for (const groupId of ['A', 'B', 'C']) {
      const count = result.matches.filter((match) => {
        const sides = [match.aSource, match.bSource];
        return sides.some(
          (source) => source?.kind === 'group' && source.groupId === groupId,
        );
      }).length;
      expect(count).toBe(2);
    }
  });

  it('avoids same-group first-round pairings for every practical shape', () => {
    for (let groupCount = 2; groupCount <= 16; groupCount += 1) {
      for (let qualifiersPerGroup = 1; qualifiersPerGroup <= 4; qualifiersPerGroup += 1) {
        const total = groupCount * qualifiersPerGroup;
        if (total > 64) continue;

        const participants = Array.from({ length: total }, (_, index) => ({
          id: `e${index + 1}`,
          tournamentId: 't1',
          playerIds: [`p${index + 1}`],
          nameKey: `player ${index + 1}`,
          teamName: null,
          seed: index + 1,
          groupId: null,
          active: true,
          createdAt: 1,
        }));
        const groups = Array.from({ length: groupCount }, (_, groupIndex) => ({
          groupId: String.fromCharCode(65 + groupIndex),
          participants: participants.slice(
            groupIndex * qualifiersPerGroup,
            (groupIndex + 1) * qualifiersPerGroup,
          ),
        }));

        const result = buildGroupKnockout({
          tournamentId: 't1',
          groups,
          qualifiersPerGroup,
          now: 1,
        });

        for (const match of firstRound(result.matches)) {
          const groupA = match.aSource?.kind === 'group' ? match.aSource.groupId : null;
          const groupB = match.bSource?.kind === 'group' ? match.bSource.groupId : null;
          if (groupA && groupB) expect(groupA).not.toBe(groupB);
        }
      }
    }
  });

  it('refuses more qualifiers than a group can supply', () => {
    const participants = Array.from({ length: 4 }, (_, index) => ({
      id: `e${index + 1}`,
      tournamentId: 't1',
      playerIds: [`p${index + 1}`],
      nameKey: `player ${index + 1}`,
      teamName: null,
      seed: index + 1,
      groupId: null,
      active: true,
      createdAt: 1,
    }));

    expect(() =>
      buildGroupKnockout({
        tournamentId: 't1',
        groups: groupsOfTwo(participants),
        qualifiersPerGroup: 3,
        now: 1,
      }),
    ).toThrow(EngineError);
  });
});

describe('avoidSameGroupFirstRound', () => {
  it('swaps qualifier places without moving a bye', () => {
    const slots: BracketSlot[] = [
      { kind: 'qualifier', source: { kind: 'group', groupId: 'A', placement: 1 }, label: 'A 1st' },
      { kind: 'bye' },
      { kind: 'qualifier', source: { kind: 'group', groupId: 'A', placement: 2 }, label: 'A 2nd' },
      { kind: 'qualifier', source: { kind: 'group', groupId: 'B', placement: 2 }, label: 'B 2nd' },
      { kind: 'qualifier', source: { kind: 'group', groupId: 'B', placement: 1 }, label: 'B 1st' },
      { kind: 'bye' },
      { kind: 'qualifier', source: { kind: 'group', groupId: 'C', placement: 1 }, label: 'C 1st' },
      { kind: 'qualifier', source: { kind: 'group', groupId: 'C', placement: 2 }, label: 'C 2nd' },
    ];

    avoidSameGroupFirstRound(slots);

    expect(slots[1]).toEqual({ kind: 'bye' });
    expect(slots[5]).toEqual({ kind: 'bye' });
    for (let index = 0; index < slots.length; index += 2) {
      const a = slots[index];
      const b = slots[index + 1];
      if (a?.kind === 'qualifier' && b?.kind === 'qualifier') {
        expect(a.source.kind === 'group' ? a.source.groupId : null).not.toBe(
          b.source.kind === 'group' ? b.source.groupId : null,
        );
      }
    }
  });
});

describe('fillKnockoutFromGroups', () => {
  const participants = Array.from({ length: 4 }, (_, index) => ({
    id: `e${index + 1}`,
    tournamentId: 't1',
    playerIds: [`p${index + 1}`],
    nameKey: `player ${index + 1}`,
    teamName: null,
    seed: index + 1,
    groupId: index < 2 ? 'A' : 'B',
    active: true,
    createdAt: 1,
  }));

  function setup() {
    const stage = buildGroupStage({
      tournamentId: 't1',
      groups: [
        { groupId: 'A', participants: participants.slice(0, 2) },
        { groupId: 'B', participants: participants.slice(2, 4) },
      ],
      now: 1,
    });
    const knockout = buildGroupKnockout({
      tournamentId: 't1',
      groups: stage.groups,
      qualifiersPerGroup: 2,
      now: 1,
    });
    return { stage, knockout };
  }

  it('leaves the bracket empty until the group stage is complete', () => {
    const { stage, knockout } = setup();
    const filled = fillKnockoutFromGroups({
      matches: [...stage.matches, ...knockout.matches],
      participants,
      settings,
      now: 2,
    });

    expect(filled.complete).toBe(false);
    expect(filled.matches.filter((match) => match.stage === 'knockout').every((match) => match.aId === null && match.bId === null)).toBe(true);
  });

  it('fills the first round from the final group standings', () => {
    const { stage, knockout } = setup();
    const groupMatches = stage.matches.map((match) =>
      match.groupId === 'A' ? complete(match, 'e1') : complete(match, 'e3'),
    );
    const filled = fillKnockoutFromGroups({
      matches: [...groupMatches, ...knockout.matches],
      participants,
      settings,
      now: 2,
    });

    expect(filled.complete).toBe(true);
    expect(filled.changed).toBe(true);
    const first = firstRound(filled.matches.filter((match) => match.stage === 'knockout'));
    expect(first.map((match) => [match.aId, match.bId])).toEqual([
      ['e1', 'e4'],
      ['e3', 'e2'],
    ]);
    expect(first.every((match) => match.status === 'ready')).toBe(true);
    expect(filled.matches.find((match) => match.round === 1)?.status).toBe('pending');
  });

  it('keeps existing knockout results when qualifiers do not change', () => {
    const { stage, knockout } = setup();
    const groupMatches = stage.matches.map((match) =>
      match.groupId === 'A' ? complete(match, 'e1') : complete(match, 'e3'),
    );
    const firstFill = fillKnockoutFromGroups({
      matches: [...groupMatches, ...knockout.matches],
      participants,
      settings,
      now: 2,
    });
    const semifinal = firstFill.matches.find(
      (match) => match.stage === 'knockout' && match.round === 0,
    )!;
    const played = firstFill.matches.map((match) =>
      match.id === semifinal.id
        ? {
            ...match,
            status: 'completed' as const,
            winnerId: match.aId,
            games: [{ a: 21, b: 10 }],
          }
        : match,
    );

    const secondFill = fillKnockoutFromGroups({
      matches: played,
      participants,
      settings,
      now: 3,
    });

    expect(secondFill.changed).toBe(false);
    expect(
      secondFill.matches.find((match) => match.id === semifinal.id)?.winnerId,
    ).toBe(semifinal.aId);
  });

  it('resets the knockout stage when a corrected group result changes qualifiers', () => {
    const { stage, knockout } = setup();
    const groupMatches = stage.matches.map((match) =>
      match.groupId === 'A' ? complete(match, 'e1') : complete(match, 'e3'),
    );
    const firstFill = fillKnockoutFromGroups({
      matches: [...groupMatches, ...knockout.matches],
      participants,
      settings,
      now: 2,
    });
    const semifinal = firstFill.matches.find(
      (match) => match.stage === 'knockout' && match.round === 0,
    )!;
    const played = firstFill.matches.map((match) =>
      match.id === semifinal.id
        ? {
            ...match,
            status: 'completed' as const,
            winnerId: match.aId,
            games: [{ a: 21, b: 10 }],
          }
        : match,
    );

    const correctedGroup = groupMatches.map((match) =>
      match.groupId === 'A' ? complete(match, 'e2') : match,
    );
    const secondFill = fillKnockoutFromGroups({
      matches: [...correctedGroup, ...played.filter((match) => match.stage === 'knockout')],
      participants,
      settings,
      now: 3,
    });

    expect(secondFill.changed).toBe(true);
    const knockoutNow = secondFill.matches.filter((match) => match.stage === 'knockout');
    expect(knockoutNow.every((match) => match.winnerId === null && match.games.length === 0)).toBe(
      true,
    );
    expect(firstRound(knockoutNow).map((match) => match.aId)).toEqual(['e2', 'e3']);
  });

  it('clears the bracket when the group stage becomes incomplete again', () => {
    const { stage, knockout } = setup();
    const groupMatches = stage.matches.map((match) =>
      match.groupId === 'A' ? complete(match, 'e1') : complete(match, 'e3'),
    );
    const firstFill = fillKnockoutFromGroups({
      matches: [...groupMatches, ...knockout.matches],
      participants,
      settings,
      now: 2,
    });

    const reopened = firstFill.matches.map((match) =>
      match.groupId === 'A' ? { ...match, status: 'ready' as const, winnerId: null } : match,
    );
    const secondFill = fillKnockoutFromGroups({
      matches: reopened,
      participants,
      settings,
      now: 3,
    });

    expect(secondFill.complete).toBe(false);
    expect(secondFill.changed).toBe(true);
    expect(
      secondFill.matches
        .filter((match) => match.stage === 'knockout')
        .every((match) => match.aId === null && match.bId === null),
    ).toBe(true);
  });
});
