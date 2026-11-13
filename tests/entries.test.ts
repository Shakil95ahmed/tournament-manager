import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables } from '../src/db/db';
import { createTournament, type CreateTournamentInput } from '../src/db/createTournament';
import { generateTournamentDraw } from '../src/db/draw';
import {
  addEntry,
  autoAssignGroups,
  removeEntry,
  setEntryGroup,
  updateEntry,
} from '../src/db/entries';
import { DuplicateNameError, ValidationError } from '../src/db/errors';
import { getTournamentBundle } from '../src/db/services';
import type { DraftEntry } from '../src/domain/setup';
import type { Discipline, TournamentFormat } from '../src/domain/types';

beforeEach(async () => {
  await clearAllTables();
});

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

function input(overrides: Partial<CreateTournamentInput> = {}): CreateTournamentInput {
  return {
    name: 'Saturday Cup',
    leagueName: 'Riverside Club',
    sport: 'badminton',
    discipline: 'singles',
    format: 'round-robin',
    seedingMethod: 'random',
    groupCount: 2,
    qualifiersPerGroup: 2,
    scoring: { mode: 'best-of-3', targetPoints: 21 },
    points: { win: 2, loss: 1 },
    tiebreakers: ['points', 'wins', 'gameDifference', 'pointDifference'],
    entries: [],
    generate: false,
    rngSeed: 12345,
    now: 1000,
    ...overrides,
  };
}

async function draft(
  entries: DraftEntry[],
  discipline: Discipline = 'singles',
  format: TournamentFormat = 'round-robin',
  overrides: Partial<CreateTournamentInput> = {},
): Promise<string> {
  const result = await createTournament(
    input({ entries, discipline, format, generate: false, ...overrides }),
  );
  return result.id;
}

describe('draft entry services', () => {
  it('adds, edits and removes an entry together with its players', async () => {
    const id = await draft([]);

    const alice = await addEntry(id, { playerNames: ['Alice'] });
    await addEntry(id, { playerNames: ['Bob'] });

    let bundle = await getTournamentBundle(id);
    expect(bundle?.players).toHaveLength(2);
    expect(bundle?.participants).toHaveLength(2);
    expect(bundle?.tournament.settings.participantCount).toBe(2);

    await updateEntry(id, alice.id, { playerNames: ['Alicia'], teamName: 'A Team' });

    bundle = await getTournamentBundle(id);
    const updated = bundle?.participants.find((participant) => participant.id === alice.id);
    expect(updated?.teamName).toBe('A Team');
    expect(updated?.nameKey).toBe('alicia');
    expect(bundle?.players.map((player) => player.name).sort()).toEqual(['Alicia', 'Bob']);

    await removeEntry(id, alice.id);

    bundle = await getTournamentBundle(id);
    expect(bundle?.participants).toHaveLength(1);
    expect(bundle?.players.map((player) => player.name)).toEqual(['Bob']);
    expect(bundle?.tournament.settings.participantCount).toBe(1);
  });

  it('blocks the same player from entering twice', async () => {
    const id = await draft([], 'doubles');

    await addEntry(id, { playerNames: ['Alice', 'Bob'] });

    await expect(
      addEntry(id, { playerNames: ['Alice', 'Cara'] }),
    ).rejects.toBeInstanceOf(DuplicateNameError);

    const bundle = await getTournamentBundle(id);
    expect(bundle?.participants).toHaveLength(1);
  });

  it('refuses an empty player name', async () => {
    const id = await draft([]);
    await expect(addEntry(id, { playerNames: ['   '] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses changes after the draw is generated', async () => {
    const result = await createTournament(
      input({
        entries: [entry('a', ['Alice']), entry('b', ['Bob'])],
        generate: true,
      }),
    );

    await expect(
      addEntry(result.id, { playerNames: ['Cara'] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves entries between groups and rebalances them', async () => {
    const id = await draft(
      [
        entry('a', ['Alice']),
        entry('b', ['Bob']),
        entry('c', ['Cara']),
        entry('d', ['Dan']),
      ],
      'singles',
      'groups-knockout',
    );

    let bundle = await getTournamentBundle(id);
    const first = bundle?.participants.find((participant) => participant.groupId === 'A');
    expect(first).toBeDefined();

    await setEntryGroup(id, first!.id, 'B');
    bundle = await getTournamentBundle(id);
    expect(bundle?.participants.find((participant) => participant.id === first!.id)?.groupId).toBe(
      'B',
    );

    await autoAssignGroups(id);
    bundle = await getTournamentBundle(id);
    const sizes = ['A', 'B'].map(
      (groupId) => bundle?.participants.filter((participant) => participant.groupId === groupId).length,
    );
    expect(sizes).toEqual([2, 2]);

    await expect(setEntryGroup(id, first!.id, 'Z')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('createTournament', () => {
  it('saves a draft and ignores unfinished rows', async () => {
    const result = await createTournament(
      input({
        entries: [entry('a', ['Alice']), entry('b', [''])],
        generate: false,
      }),
    );

    const bundle = await getTournamentBundle(result.id);
    expect(bundle?.tournament.status).toBe('draft');
    expect(bundle?.participants).toHaveLength(1);
    expect(bundle?.matches).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('incomplete'))).toBe(true);
  });

  it('allows an empty draft to be saved', async () => {
    const result = await createTournament(input({ entries: [], generate: false }));
    const bundle = await getTournamentBundle(result.id);
    expect(bundle?.tournament.status).toBe('draft');
    expect(bundle?.tournament.settings.participantCount).toBe(0);
    expect(bundle?.participants).toHaveLength(0);
  });

  it('generates a round-robin draw and starts the tournament', async () => {
    const result = await createTournament(
      input({
        entries: [entry('a', ['Alice']), entry('b', ['Bob']), entry('c', ['Cara'])],
        generate: true,
      }),
    );

    const bundle = await getTournamentBundle(result.id);
    expect(bundle?.tournament.status).toBe('active');
    expect(bundle?.tournament.startedAt).not.toBeNull();
    expect(bundle?.matches).toHaveLength(3);
    expect(bundle?.matches.every((match) => match.stage === 'league')).toBe(true);
  });

  it('generates groups and a knockout skeleton', async () => {
    const names = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Finn'];
    const result = await createTournament(
      input({
        format: 'groups-knockout',
        groupCount: 2,
        qualifiersPerGroup: 2,
        entries: names.map((name, index) => entry(String(index), [name])),
        generate: true,
      }),
    );

    const bundle = await getTournamentBundle(result.id);
    expect(bundle?.tournament.status).toBe('active');
    expect(bundle?.matches.filter((match) => match.stage === 'group')).toHaveLength(6);
    expect(bundle?.matches.filter((match) => match.stage === 'knockout')).toHaveLength(3);

    const firstKnockout = bundle?.matches.filter(
      (match) => match.stage === 'knockout' && match.round === 0,
    );
    expect(firstKnockout).toHaveLength(2);
    expect(
      firstKnockout?.every(
        (match) =>
          (match.aSource?.kind === 'group' || match.aId !== null) &&
          (match.bSource?.kind === 'group' || match.bId !== null),
      ),
    ).toBe(true);
  });

  it('rejects a draw with too few entries', async () => {
    await expect(
      createTournament(input({ entries: [entry('a', ['Alice'])], generate: true })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('generateTournamentDraw', () => {
  it('turns a saved groups draft into fixtures', async () => {
    const id = await draft(
      [
        entry('a', ['Alice']),
        entry('b', ['Bob']),
        entry('c', ['Cara']),
        entry('d', ['Dan']),
      ],
      'singles',
      'groups-knockout',
    );

    const result = await generateTournamentDraw(id);
    const bundle = await getTournamentBundle(id);

    expect(bundle?.tournament.status).toBe('active');
    expect(bundle?.matches).toHaveLength(5);
    expect(result.matchCount).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('refuses to generate the same draft twice', async () => {
    const id = await draft([entry('a', ['Alice']), entry('b', ['Bob'])]);
    await generateTournamentDraw(id);
    await expect(generateTournamentDraw(id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('uses byes for an odd elimination draw', async () => {
    const id = await draft(
      [
        entry('a', ['Alice']),
        entry('b', ['Bob']),
        entry('c', ['Cara']),
        entry('d', ['Dan']),
        entry('e', ['Eve']),
      ],
      'singles',
      'single-elimination',
    );

    const result = await generateTournamentDraw(id);
    const bundle = await getTournamentBundle(id);

    expect(bundle?.matches).toHaveLength(7);
    expect(result.warnings.some((warning) => warning.includes('bye'))).toBe(true);
    expect(
      bundle?.matches.filter((match) => match.status === 'bye').length,
    ).toBe(3);
  });
});
