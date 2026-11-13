import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { TournamentDatabase, clearAllTables } from '../src/db/db';
import { DuplicateNameError, NotFoundError, ValidationError } from '../src/db/errors';
import {
  addPlayer,
  deleteTournament,
  getTournamentBundle,
  listTournaments,
  renamePlayer,
  saveTournamentBundle,
} from '../src/db/services';
import { makeBundle } from './fixtures';

beforeEach(async () => {
  await clearAllTables();
});

describe('saveTournamentBundle', () => {
  it('writes the tournament with all of its rows', async () => {
    const bundle = makeBundle();

    await saveTournamentBundle(bundle);

    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored).not.toBeNull();
    expect(stored?.tournament.name).toBe('Spring League');
    expect(stored?.players).toHaveLength(4);
    expect(stored?.participants).toHaveLength(4);
    expect(stored?.matches).toHaveLength(1);
  });

  it('stamps both updatedAt and lastSavedAt', async () => {
    const bundle = makeBundle();
    await saveTournamentBundle(bundle);

    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored?.tournament.lastSavedAt).toBeGreaterThan(1);
    expect(stored?.tournament.updatedAt).toBe(stored?.tournament.lastSavedAt);
  });

  it('rejects an inconsistent bundle before writing anything', async () => {
    const bundle = makeBundle();
    bundle.participants[0]!.playerIds = ['missing-player'];

    await expect(saveTournamentBundle(bundle)).rejects.toBeInstanceOf(ValidationError);
    expect(await listTournaments()).toHaveLength(0);
    expect(await getTournamentBundle(bundle.tournament.id)).toBeNull();
  });

  it('rolls back the whole transaction when the database rejects a row', async () => {
    const bundle = makeBundle(['Alice', 'Bob']);
    await saveTournamentBundle(bundle);

    // A second save for the same tournament re-adds Alice under a new id. The
    // bundle is internally valid, but the unique index rejects it mid-write.
    const conflicting = makeBundle(['Bob', 'Alice'], {
      id: bundle.tournament.id,
      createdAt: bundle.tournament.createdAt,
    });
    conflicting.players[1]!.id = 'p-new';
    conflicting.participants[1]!.playerIds = ['p-new'];

    await expect(saveTournamentBundle(conflicting)).rejects.toBeInstanceOf(DuplicateNameError);

    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored?.players.map((player) => player.id).sort()).toEqual(['p1', 'p2']);
    expect(stored?.tournament.name).toBe('Spring League');
  });
});

describe('addPlayer', () => {
  it('adds a player and touches the tournament save time', async () => {
    const bundle = makeBundle(['Alice']);
    await saveTournamentBundle(bundle);

    const player = await addPlayer(bundle.tournament.id, '  Nadia  ');

    expect(player.name).toBe('Nadia');
    expect(player.nameKey).toBe('nadia');
    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored?.players).toHaveLength(2);
    expect(stored?.tournament.lastSavedAt).toBeGreaterThan(1);
  });

  it('rejects duplicates regardless of case, spacing and accents', async () => {
    const bundle = makeBundle(['Léa Dupont']);
    await saveTournamentBundle(bundle);

    await expect(addPlayer(bundle.tournament.id, '  lea   dupont ')).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
    expect((await getTournamentBundle(bundle.tournament.id))?.players).toHaveLength(1);
  });

  it('allows the same name in two different tournaments', async () => {
    const first = makeBundle(['Sam']);
    const second = makeBundle(['Sam'], { id: 't2', name: 'Autumn Cup' });
    second.players[0]!.id = 'p2';
    second.participants[0]!.playerIds = ['p2'];
    second.matches = [];

    await saveTournamentBundle(first);
    await saveTournamentBundle(second);
    await expect(addPlayer(first.tournament.id, 'Sam')).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(addPlayer(second.tournament.id, 'Alex')).resolves.toMatchObject({ name: 'Alex' });
  });

  it('refuses an empty name', async () => {
    const bundle = makeBundle(['Alice']);
    await saveTournamentBundle(bundle);
    await expect(addPlayer(bundle.tournament.id, '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails when the tournament does not exist', async () => {
    await expect(addPlayer('missing', 'Alice')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('renamePlayer', () => {
  it('renames the player and refreshes the participant key', async () => {
    const bundle = makeBundle(['Alice', 'Bob']);
    await saveTournamentBundle(bundle);

    await renamePlayer('p1', 'Alicia');

    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored?.players.find((player) => player.id === 'p1')?.name).toBe('Alicia');
    expect(stored?.participants.find((entry) => entry.id === 'e1')?.nameKey).toBe('alicia');
  });

  it('refuses to rename onto an existing player', async () => {
    const bundle = makeBundle(['Alice', 'Bob']);
    await saveTournamentBundle(bundle);

    await expect(renamePlayer('p1', 'bob')).rejects.toBeInstanceOf(DuplicateNameError);
    const stored = await getTournamentBundle(bundle.tournament.id);
    expect(stored?.players.find((player) => player.id === 'p1')?.name).toBe('Alice');
  });
});

describe('deleteTournament', () => {
  it('removes the tournament and every dependent row', async () => {
    const bundle = makeBundle();
    await saveTournamentBundle(bundle);

    await deleteTournament(bundle.tournament.id);

    expect(await listTournaments()).toHaveLength(0);
    expect(await getTournamentBundle(bundle.tournament.id)).toBeNull();
  });

  it('reports a missing tournament instead of failing silently', async () => {
    await expect(deleteTournament('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('database upgrade', () => {
  it('adds null knockout sources and empty history to old matches', async () => {
    const name = `migration-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      tournaments: 'id, status, updatedAt, createdAt',
      players: 'id, tournamentId, &[tournamentId+nameKey]',
      participants: 'id, tournamentId, &[tournamentId+nameKey], [tournamentId+groupId]',
      matches:
        'id, tournamentId, [tournamentId+stage], [tournamentId+round], [tournamentId+group], nextMatchId',
      meta: 'key',
    });
    await old.open();
    await old.table('matches').put({
      id: 'm-old',
      tournamentId: 't1',
      stage: 'league',
      groupId: null,
      round: 0,
      roundLabel: 'Round 1',
      slot: 0,
      order: 0,
      aId: 'e1',
      bId: 'e2',
      aLabel: '',
      bLabel: '',
      status: 'ready',
      winnerId: null,
      games: [],
      court: null,
      nextMatchId: null,
      nextSlot: null,
      updatedAt: 1,
    });
    old.close();

    const upgraded = new TournamentDatabase(name);
    await upgraded.open();
    const match = await upgraded.matches.get('m-old');

    expect(match?.aSource).toBeNull();
    expect(match?.bSource).toBeNull();
    expect(match?.history).toEqual([]);

    upgraded.close();
    await Dexie.delete(name);
  });
});

describe('listTournaments', () => {
  it('returns the newest tournament first', async () => {
    const older = makeBundle(['Alice'], { id: 'old', name: 'Old', createdAt: 100 });
    const newer = makeBundle(['Bella'], { id: 'new', name: 'New', createdAt: 200 });
    newer.players[0]!.id = 'p2';
    newer.participants[0]!.playerIds = ['p2'];
    newer.matches = [];

    await saveTournamentBundle(older);
    await saveTournamentBundle(newer);

    const tournaments = await listTournaments();
    expect(tournaments.map((tournament) => tournament.id)).toEqual(['new', 'old']);
  });
});
