import { describe, expect, it } from 'vitest';
import { buildRoundRobinMatches } from '../src/domain/roundRobin';
import { computeGroupStandings, computeStandings } from '../src/domain/standings';
import type { GameScore, Match } from '../src/domain/types';
import { makeParticipants } from './fixtures';

const participants = makeParticipants(3);

function result(
  id: string,
  aId: string,
  bId: string,
  winnerId: string,
  games: GameScore[] = [],
): Match {
  return {
    id,
    tournamentId: 't1',
    stage: 'league',
    groupId: null,
    round: 0,
    roundLabel: 'Round 1',
    slot: 0,
    order: 0,
    aId,
    bId,
    aSource: null,
    bSource: null,
    aLabel: '',
    bLabel: '',
    status: 'completed',
    winnerId,
    games,
    court: null,
    nextMatchId: null,
    nextSlot: null,
    history: [],
    updatedAt: 1,
  };
}

const matches: Match[] = [
  result('m1', 'e1', 'e2', 'e1', [
    { a: 21, b: 10 },
    { a: 21, b: 15 },
  ]),
  result('m2', 'e3', 'e1', 'e3', [
    { a: 21, b: 19 },
    { a: 15, b: 21 },
    { a: 21, b: 18 },
  ]),
  result('m3', 'e2', 'e3', 'e2', [
    { a: 21, b: 10 },
    { a: 18, b: 21 },
    { a: 21, b: 10 },
  ]),
];

const base = {
  participants,
  matches,
  points: { win: 2, loss: 1 },
  tiebreakers: [
    'points',
    'wins',
    'gameDifference',
    'pointDifference',
    'headToHead',
    'seed',
  ] as const,
};

describe('computeStandings', () => {
  it('counts matches, points, games and points', () => {
    const rows = computeStandings({ ...base, tiebreakers: [...base.tiebreakers] });
    const first = rows.find((row) => row.participantId === 'e1')!;

    expect(first).toMatchObject({
      played: 2,
      wins: 1,
      losses: 1,
      points: 3,
      gameWins: 3,
      gameLosses: 2,
      gameDifference: 1,
      pointsFor: 100,
      pointsAgainst: 82,
      pointDifference: 18,
      rank: 1,
    });
  });

  it('ranks by points, then game difference, then point difference', () => {
    const rows = computeStandings({ ...base, tiebreakers: [...base.tiebreakers] });

    expect(rows.map((row) => row.participantId)).toEqual(['e1', 'e3', 'e2']);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('uses point difference when points, wins and game difference all tie', () => {
    const tied = makeParticipants(3);
    const cycle = [
      result('c1', 'e1', 'e2', 'e1', [
        { a: 21, b: 11 },
        { a: 15, b: 21 },
        { a: 21, b: 15 },
      ]),
      result('c2', 'e2', 'e3', 'e2', [
        { a: 21, b: 16 },
        { a: 16, b: 21 },
        { a: 21, b: 16 },
      ]),
      result('c3', 'e3', 'e1', 'e3', [
        { a: 21, b: 1 },
        { a: 1, b: 21 },
        { a: 21, b: 10 },
      ]),
    ];

    const rows = computeStandings({
      participants: tied,
      matches: cycle,
      points: { win: 2, loss: 1 },
      tiebreakers: [
        'points',
        'wins',
        'gameDifference',
        'pointDifference',
        'seed',
      ],
    });

    expect(rows.map((row) => row.gameDifference)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.participantId)).toEqual(['e3', 'e1', 'e2']);
  });

  it('supports a custom points system and a head-to-head tie-breaker', () => {
    const rows = computeStandings({
      participants: makeParticipants(2),
      matches: [result('m1', 'e1', 'e2', 'e2')],
      points: { win: 1, loss: 1 },
      tiebreakers: ['points', 'headToHead'],
    });

    expect(rows.map((row) => row.participantId)).toEqual(['e2', 'e1']);
    expect(rows.every((row) => row.points === 1)).toBe(true);
  });

  it('falls back to seed and then id when every rule ties', () => {
    const rows = computeStandings({
      participants: makeParticipants(3),
      matches: [],
      points: { win: 2, loss: 1 },
      tiebreakers: ['points', 'wins', 'seed'],
    });

    expect(rows.map((row) => row.participantId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('ignores knockout matches and unplayed matches', () => {
    const knockout = {
      ...result('k1', 'e1', 'e2', 'e1'),
      stage: 'knockout' as const,
    };
    const pending = {
      ...result('m9', 'e2', 'e3', 'e2'),
      status: 'ready' as const,
      winnerId: null,
    };

    const rows = computeStandings({
      participants,
      matches: [knockout, pending],
      points: { win: 2, loss: 1 },
      tiebreakers: ['points', 'seed'],
    });

    expect(rows.every((row) => row.played === 0 && row.points === 0)).toBe(true);
  });
});

describe('computeGroupStandings', () => {
  it('keeps each group table separate', () => {
    const grouped = makeParticipants(4).map((participant, index) => ({
      ...participant,
      groupId: index < 2 ? 'A' : 'B',
    }));
    const groupMatches = [
      { ...result('a1', 'e1', 'e2', 'e1'), stage: 'group' as const, groupId: 'A' },
      { ...result('b1', 'e3', 'e4', 'e4'), stage: 'group' as const, groupId: 'B' },
    ];

    const tables = computeGroupStandings({
      participants: grouped,
      matches: groupMatches,
      settings: { points: { win: 2, loss: 1 }, tiebreakers: ['points', 'seed'] },
    });

    expect([...tables.keys()]).toEqual(['A', 'B']);
    expect(tables.get('A')?.map((row) => row.participantId)).toEqual(['e1', 'e2']);
    expect(tables.get('B')?.map((row) => row.participantId)).toEqual(['e4', 'e3']);
  });
});

describe('generated fixtures feed standings', () => {
  it('accepts a real round-robin draw', () => {
    const draw = buildRoundRobinMatches({
      tournamentId: 't1',
      participants: makeParticipants(4),
      stage: 'league',
      groupId: null,
      orderBase: 0,
      now: 1,
    });

    expect(
      computeStandings({
        participants: makeParticipants(4),
        matches: draw,
        points: { win: 2, loss: 1 },
        tiebreakers: ['points', 'seed'],
      }),
    ).toHaveLength(4);
  });
});
