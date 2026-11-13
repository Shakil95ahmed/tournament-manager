import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables } from '../src/db/db';
import { createTournament, type CreateTournamentInput } from '../src/db/createTournament';
import { NotFoundError, ValidationError } from '../src/db/errors';
import {
  clearMatchResult,
  recordMatchResult,
  undoMatchResult,
} from '../src/db/results';
import { getTournamentBundle } from '../src/db/services';
import type { DraftEntry } from '../src/domain/setup';
import type { Match, TournamentFormat } from '../src/domain/types';

beforeEach(async () => {
  await clearAllTables();
});

function entries(names: string[]): DraftEntry[] {
  return names.map((name, index) => ({
    key: `draft-${index}`,
    id: null,
    playerNames: [name],
    teamName: '',
    groupId: null,
    active: true,
  }));
}

function input(overrides: Partial<CreateTournamentInput> = {}): CreateTournamentInput {
  return {
    name: 'Saturday Cup',
    leagueName: 'Riverside Club',
    sport: 'badminton',
    discipline: 'singles',
    format: 'single-elimination',
    seedingMethod: 'manual',
    groupCount: 2,
    qualifiersPerGroup: 1,
    scoring: { mode: 'best-of-3', targetPoints: 21 },
    points: { win: 2, loss: 1 },
    tiebreakers: ['points', 'wins', 'gameDifference', 'pointDifference'],
    entries: entries(['Alice', 'Bob', 'Cara', 'Dan']),
    generate: true,
    rngSeed: 12345,
    now: 1000,
    ...overrides,
  };
}

async function create(format: TournamentFormat = 'single-elimination'): Promise<string> {
  const result = await createTournament(input({ format }));
  return result.id;
}

function matchAt(matches: Match[], round: number, slot: number): Match {
  const match = matches.find((entry) => entry.round === round && entry.slot === slot);
  if (!match) throw new Error(`No match at round ${round} slot ${slot}`);
  return match;
}

describe('result services', () => {
  it('records knockout results, then completes the tournament and finds a champion', async () => {
    const id = await create();
    let bundle = await getTournamentBundle(id);
    const firstSemi = matchAt(bundle!.matches, 0, 0);
    const secondSemi = matchAt(bundle!.matches, 0, 1);

    const afterSemi = await recordMatchResult(id, firstSemi.id, {
      winnerId: firstSemi.aId!,
      games: [{ a: 21, b: 10 }],
      court: 'Court 1',
    });
    expect(afterSemi.completed).toBe(false);

    await recordMatchResult(id, secondSemi.id, {
      winnerId: secondSemi.bId!,
      games: [],
      court: null,
    });

    bundle = await getTournamentBundle(id);
    const final = matchAt(bundle!.matches, 1, 0);
    expect(final.status).toBe('ready');
    expect(final.aId).toBe(firstSemi.aId);
    expect(final.bId).toBe(secondSemi.bId);
    expect(bundle?.tournament.status).toBe('active');

    const outcome = await recordMatchResult(id, final.id, {
      winnerId: final.aId!,
      games: [
        { a: 21, b: 15 },
        { a: 21, b: 18 },
      ],
      court: 'Centre',
    });

    expect(outcome).toEqual({ completed: true, championId: final.aId });
    bundle = await getTournamentBundle(id);
    expect(bundle?.tournament.status).toBe('completed');
    expect(bundle?.tournament.completedAt).toBeGreaterThan(0);

    const stored = bundle?.matches.find((match) => match.id === final.id);
    expect(stored).toMatchObject({
      status: 'completed',
      winnerId: final.aId,
      court: 'Centre',
    });
    expect(stored?.games).toHaveLength(2);
  });

  it('undoes a final and reopens the tournament', async () => {
    const id = await create();
    let bundle = await getTournamentBundle(id);
    const semis = bundle!.matches.filter((match) => match.round === 0);

    for (const semi of semis) {
      await recordMatchResult(id, semi.id, {
        winnerId: semi.aId!,
        games: [],
        court: null,
      });
    }

    bundle = await getTournamentBundle(id);
    const final = matchAt(bundle!.matches, 1, 0);
    await recordMatchResult(id, final.id, {
      winnerId: final.aId!,
      games: [],
      court: null,
    });

    const outcome = await undoMatchResult(id, final.id);
    expect(outcome).toEqual({ completed: false, championId: null });

    bundle = await getTournamentBundle(id);
    expect(bundle?.tournament.status).toBe('active');
    expect(bundle?.tournament.completedAt).toBeNull();
    expect(bundle?.matches.find((match) => match.id === final.id)).toMatchObject({
      status: 'ready',
      winnerId: null,
    });
  });

  it('clears a result and leaves the match ready to play again', async () => {
    const id = await create();
    const bundle = await getTournamentBundle(id);
    const semi = matchAt(bundle!.matches, 0, 0);

    await recordMatchResult(id, semi.id, {
      winnerId: semi.aId!,
      games: [{ a: 21, b: 8 }],
      court: null,
    });
    await clearMatchResult(id, semi.id);

    const stored = await getTournamentBundle(id);
    const cleared = stored?.matches.find((match) => match.id === semi.id);
    expect(cleared).toMatchObject({
      status: 'ready',
      winnerId: null,
      games: [],
      court: null,
    });
  });

  it('refills the bracket and resets the final when a group qualifier changes', async () => {
    const id = await create('groups-knockout');
    let bundle = await getTournamentBundle(id);
    expect(bundle?.tournament.settings.knockoutSize).toBe(2);

    const groupMatches = bundle!.matches.filter((match) => match.stage === 'group');
    expect(groupMatches).toHaveLength(2);
    const firstGroupMatch = groupMatches.find((match) => match.groupId === 'A')!;

    for (const match of groupMatches) {
      await recordMatchResult(id, match.id, {
        winnerId: match.aId!,
        games: [],
        court: null,
      });
    }

    bundle = await getTournamentBundle(id);
    let final = bundle!.matches.find((match) => match.stage === 'knockout')!;
    expect(final.status).toBe('ready');
    expect(final.aId).not.toBeNull();
    expect(final.bId).not.toBeNull();

    const originalSides = [final.aId, final.bId];
    const champion = await recordMatchResult(id, final.id, {
      winnerId: final.aId!,
      games: [],
      court: null,
    });
    expect(champion.completed).toBe(true);

    // Flip the winner of one group match. That changes who qualifies, so the
    // knockout result cannot survive.
    const correction = await recordMatchResult(id, firstGroupMatch.id, {
      winnerId: firstGroupMatch.bId!,
      games: [],
      court: null,
    });
    expect(correction.completed).toBe(false);

    bundle = await getTournamentBundle(id);
    final = bundle!.matches.find((match) => match.stage === 'knockout')!;
    expect(final).toMatchObject({ status: 'ready', winnerId: null, games: [] });
    expect(bundle?.tournament.status).toBe('active');
    expect([final.aId, final.bId].sort()).not.toEqual(
      originalSides.slice().sort(),
    );
  });

  it('rejects results while the tournament is still a draft', async () => {
    const result = await createTournament(input({ generate: false, entries: [] }));
    const bundle = await getTournamentBundle(result.id);

    expect(bundle?.matches).toHaveLength(0);
    await expect(
      recordMatchResult(result.id, 'missing', {
        winnerId: 'x',
        games: [],
        court: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails for a tournament that no longer exists', async () => {
    await expect(
      recordMatchResult('missing', 'missing', {
        winnerId: 'x',
        games: [],
        court: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
