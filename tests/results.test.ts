import { describe, expect, it } from 'vitest';
import { buildElimination } from '../src/domain/elimination';
import { EngineError } from '../src/domain/errors';
import { buildRoundRobinMatches } from '../src/domain/roundRobin';
import {
  MAX_HISTORY,
  clearResult,
  downstreamResultsCount,
  findChampion,
  maxGamesForMode,
  recordResult,
  undoResult,
} from '../src/domain/results';
import type { Match, TournamentFormat } from '../src/domain/types';
import { makeParticipants } from './fixtures';

function bracket(count = 4): Match[] {
  return buildElimination({
    tournamentId: 't1',
    participants: makeParticipants(count),
    now: 1,
  }).matches;
}

function matchAt(matches: Match[], round: number, slot: number): Match {
  const match = matches.find((entry) => entry.round === round && entry.slot === slot);
  if (!match) throw new Error(`No match at round ${round} slot ${slot}`);
  return match;
}

function champion(matches: Match[], format: TournamentFormat = 'single-elimination') {
  return findChampion({
    matches,
    participants: makeParticipants(4),
    settings: {
      format,
      points: { win: 2, loss: 1 },
      tiebreakers: ['points', 'wins', 'gameDifference', 'pointDifference', 'seed'],
    },
  });
}

describe('recordResult', () => {
  it('records a winner, scores and court, then advances the winner', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);
    const result = recordResult(matches, {
      matchId: semi.id,
      winnerId: 'e1',
      games: [
        { a: 21, b: 10 },
        { a: 21, b: 15 },
      ],
      court: ' Court 2 ',
      now: 5,
    });

    const played = result.find((match) => match.id === semi.id)!;
    expect(played).toMatchObject({
      status: 'completed',
      winnerId: 'e1',
      court: 'Court 2',
    });
    expect(played.games).toEqual([
      { a: 21, b: 10 },
      { a: 21, b: 15 },
    ]);
    expect(played.history).toHaveLength(1);
    expect(played.history[0]?.winnerId).toBeNull();

    const final = result.find((match) => match.round === 1)!;
    expect(final.aId).toBe('e1');
    expect(final.status).toBe('pending');
  });

  it('makes the final ready once both semi-finals are played', () => {
    let matches = bracket();
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e1',
      now: 2,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 1).id,
      winnerId: 'e3',
      now: 3,
    });

    const final = matches.find((match) => match.round === 1)!;
    expect(final).toMatchObject({ aId: 'e1', bId: 'e3', status: 'ready' });
  });

  it('identifies a champion after the final', () => {
    let matches = bracket();
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e1',
      now: 2,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 1).id,
      winnerId: 'e3',
      now: 3,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 1, 0).id,
      winnerId: 'e3',
      now: 4,
    });

    expect(champion(matches)).toBe('e3');
  });

  it('rejects a winner who is not in the match and tied games', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);

    expect(() =>
      recordResult(matches, { matchId: semi.id, winnerId: 'e2', now: 1 }),
    ).toThrow(EngineError);
    expect(() =>
      recordResult(matches, {
        matchId: semi.id,
        winnerId: 'e1',
        games: [{ a: 21, b: 21 }],
        now: 1,
      }),
    ).toThrow(EngineError);
    expect(() =>
      recordResult(matches, {
        matchId: semi.id,
        winnerId: 'e1',
        games: [{ a: 10, b: 21 }],
        now: 1,
      }),
    ).toThrow(EngineError);
  });

  it('refuses to record a bye', () => {
    const matches = bracket(3);
    const bye = matches.find((match) => match.status === 'bye')!;

    expect(() =>
      recordResult(matches, { matchId: bye.id, winnerId: 'e1', now: 1 }),
    ).toThrow(EngineError);
  });

  it('leaves the next round alone when only the score is corrected', () => {
    let matches = bracket();
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e1',
      games: [{ a: 21, b: 10 }],
      now: 2,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 1).id,
      winnerId: 'e3',
      now: 3,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 1, 0).id,
      winnerId: 'e1',
      games: [{ a: 21, b: 10 }],
      now: 4,
    });
    const corrected = recordResult(matches, {
      matchId: matchAt(matches, 1, 0).id,
      winnerId: 'e1',
      games: [{ a: 21, b: 5 }],
      now: 5,
    });

    expect(corrected.find((match) => match.round === 1)).toMatchObject({
      status: 'completed',
      winnerId: 'e1',
    });
    expect(corrected.find((match) => match.round === 1)?.history).toHaveLength(2);
  });

  it('resets the downstream result when a winner is corrected', () => {
    let matches = bracket();
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e1',
      now: 2,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 1).id,
      winnerId: 'e3',
      now: 3,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 1, 0).id,
      winnerId: 'e1',
      now: 4,
    });

    const corrected = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e4',
      now: 5,
    });

    const final = corrected.find((match) => match.round === 1)!;
    expect(final).toMatchObject({ aId: 'e4', bId: 'e3', status: 'ready', winnerId: null });
    expect(final.history).toHaveLength(0);
    expect(champion(corrected)).toBeNull();
  });
});

describe('score limits', () => {
  it('maps each scoring mode to its maximum game count', () => {
    expect(maxGamesForMode('winner-only')).toBe(0);
    expect(maxGamesForMode('single-game')).toBe(1);
    expect(maxGamesForMode('best-of-3')).toBe(3);
  });

  it('accepts up to three games in best of three', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);

    const result = recordResult(matches, {
      matchId: semi.id,
      winnerId: semi.aId!,
      games: [
        { a: 21, b: 10 },
        { a: 15, b: 21 },
        { a: 21, b: 18 },
      ],
      now: 1,
      scoring: { mode: 'best-of-3', targetPoints: 21 },
    });

    expect(result.find((match) => match.id === semi.id)?.games).toHaveLength(3);
  });

  it('rejects a fourth game in best of three', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);

    expect(() =>
      recordResult(matches, {
        matchId: semi.id,
        winnerId: semi.aId!,
        games: [
          { a: 21, b: 10 },
          { a: 10, b: 21 },
          { a: 21, b: 10 },
          { a: 21, b: 10 },
        ],
        now: 1,
        scoring: { mode: 'best-of-3', targetPoints: 21 },
      }),
    ).toThrow(EngineError);
  });

  it('allows only one game in single-game mode', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);

    const result = recordResult(matches, {
      matchId: semi.id,
      winnerId: semi.aId!,
      games: [{ a: 11, b: 7 }],
      now: 1,
      scoring: { mode: 'single-game', targetPoints: 11 },
    });
    expect(result.find((match) => match.id === semi.id)?.games).toHaveLength(1);

    expect(() =>
      recordResult(matches, {
        matchId: semi.id,
        winnerId: semi.aId!,
        games: [
          { a: 11, b: 7 },
          { a: 11, b: 9 },
        ],
        now: 1,
        scoring: { mode: 'single-game', targetPoints: 11 },
      }),
    ).toThrow(EngineError);
  });

  it('rejects any game scores in winner-only mode', () => {
    const matches = bracket();
    const semi = matchAt(matches, 0, 0);

    expect(() =>
      recordResult(matches, {
        matchId: semi.id,
        winnerId: semi.aId!,
        games: [{ a: 21, b: 10 }],
        now: 1,
        scoring: { mode: 'winner-only', targetPoints: 21 },
      }),
    ).toThrow(EngineError);

    const result = recordResult(matches, {
      matchId: semi.id,
      winnerId: semi.aId!,
      now: 1,
      scoring: { mode: 'winner-only', targetPoints: 21 },
    });
    expect(result.find((match) => match.id === semi.id)?.games).toEqual([]);
  });
});

describe('findChampion for round robin', () => {
  it('waits for every match, then returns the leader', () => {
    const participants = makeParticipants(3);
    const matches = buildRoundRobinMatches({
      tournamentId: 't1',
      participants,
      stage: 'league',
      groupId: null,
      orderBase: 0,
      now: 1,
    });
    const completed = matches.map((match) => ({
      ...match,
      status: 'completed' as const,
      winnerId: match.aId === 'e1' || match.bId === 'e1' ? 'e1' : match.aId,
    }));

    expect(
      findChampion({
        matches: matches.slice(0, 1),
        participants,
        settings: {
          format: 'round-robin',
          points: { win: 2, loss: 1 },
          tiebreakers: ['points', 'seed'],
        },
      }),
    ).toBeNull();

    expect(
      findChampion({
        matches: completed,
        participants,
        settings: {
          format: 'round-robin',
          points: { win: 2, loss: 1 },
          tiebreakers: ['points', 'seed'],
        },
      }),
    ).toBe('e1');
  });
});

describe('undoResult', () => {
  it('steps back through recorded results and clears when history is empty', () => {
    let matches = bracket();
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 0).id,
      winnerId: 'e1',
      now: 1,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 0, 1).id,
      winnerId: 'e3',
      now: 2,
    });
    matches = recordResult(matches, {
      matchId: matchAt(matches, 1, 0).id,
      winnerId: 'e1',
      now: 3,
    });

    const finalId = matchAt(matches, 1, 0).id;
    const corrected = recordResult(matches, {
      matchId: finalId,
      winnerId: 'e3',
      now: 4,
    });
    const once = undoResult(corrected, finalId, 5);
    expect(once.find((match) => match.id === finalId)).toMatchObject({
      status: 'completed',
      winnerId: 'e1',
    });

    const twice = undoResult(once, finalId, 6);
    expect(twice.find((match) => match.id === finalId)).toMatchObject({
      status: 'ready',
      winnerId: null,
    });
    expect(champion(twice)).toBeNull();
  });

  it('reports when there is nothing to undo', () => {
    const matches = bracket();

    expect(() => undoResult(matches, matchAt(matches, 0, 0).id, 1)).toThrow(EngineError);
  });

  it('caps stored history', () => {
    let matches = bracket();
    const matchId = matchAt(matches, 0, 0).id;

    for (let index = 0; index < MAX_HISTORY + 3; index += 1) {
      matches = recordResult(matches, {
        matchId,
        winnerId: index % 2 === 0 ? 'e1' : 'e4',
        now: index + 1,
      });
    }

    expect(matches.find((match) => match.id === matchId)?.history.length).toBe(MAX_HISTORY);
  });
});

describe('clearResult', () => {
  it('clears a result and can be undone', () => {
    let matches = bracket();
    const semiId = matchAt(matches, 0, 0).id;
    matches = recordResult(matches, {
      matchId: semiId,
      winnerId: 'e1',
      now: 2,
    });

    const cleared = clearResult(matches, semiId, 3);
    expect(cleared.find((match) => match.id === semiId)).toMatchObject({
      status: 'ready',
      winnerId: null,
      games: [],
    });

    const undone = undoResult(cleared, semiId, 4);
    expect(undone.find((match) => match.id === semiId)).toMatchObject({
      status: 'completed',
      winnerId: 'e1',
    });
  });

  it('does nothing when the match has no result', () => {
    const matches = bracket();
    const cleared = clearResult(matches, matchAt(matches, 0, 0).id, 2);

    expect(cleared.find((match) => match.round === 0)).toMatchObject({
      status: 'ready',
      winnerId: null,
    });
  });
});

describe('downstreamResultsCount', () => {
  it('counts only later matches that already hold a result', () => {
    let matches = bracket();
    const semiId = matchAt(matches, 0, 0).id;
    const otherSemiId = matchAt(matches, 0, 1).id;
    const finalId = matchAt(matches, 1, 0).id;

    expect(downstreamResultsCount(matches, semiId)).toBe(0);

    matches = recordResult(matches, { matchId: semiId, winnerId: 'e1', now: 1 });
    expect(downstreamResultsCount(matches, semiId)).toBe(0);

    matches = recordResult(matches, { matchId: otherSemiId, winnerId: 'e3', now: 2 });
    matches = recordResult(matches, { matchId: finalId, winnerId: 'e1', now: 3 });

    expect(downstreamResultsCount(matches, semiId)).toBe(1);
    expect(downstreamResultsCount(matches, otherSemiId)).toBe(1);
    expect(downstreamResultsCount(matches, finalId)).toBe(0);
  });

  it('follows the whole chain in a larger bracket', () => {
    let matches = bracket(8);
    const firstRoundId = matchAt(matches, 0, 0).id;

    const firstRoundWinners = ['e1', 'e4', 'e2', 'e3'];
    firstRoundWinners.forEach((winnerId, slot) => {
      matches = recordResult(matches, {
        matchId: matchAt(matches, 0, slot).id,
        winnerId,
        now: slot + 1,
      });
    });

    matches = recordResult(matches, { matchId: matchAt(matches, 1, 0).id, winnerId: 'e1', now: 10 });
    matches = recordResult(matches, { matchId: matchAt(matches, 1, 1).id, winnerId: 'e2', now: 11 });
    matches = recordResult(matches, { matchId: matchAt(matches, 2, 0).id, winnerId: 'e1', now: 12 });

    expect(downstreamResultsCount(matches, firstRoundId)).toBe(2);
  });

  it('returns zero for a match that does not exist', () => {
    expect(downstreamResultsCount(bracket(), 'missing')).toBe(0);
  });
});
