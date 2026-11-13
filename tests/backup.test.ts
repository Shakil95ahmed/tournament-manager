import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  createBackup,
  parseBackupJson,
  restoreBackup,
  serializeBackup,
  validateBackup,
} from '../src/db/backup';
import { clearAllTables, db } from '../src/db/db';
import { ValidationError } from '../src/db/errors';
import { META_KEYS } from '../src/db/meta';
import { getTournamentBundle, listTournaments, saveTournamentBundle } from '../src/db/services';
import { generateDraw } from '../src/domain/generate';
import { validateTournamentBundle } from '../src/domain/validation';
import { makeBundle } from './fixtures';

beforeEach(async () => {
  await clearAllTables();
});

async function storedBundle(): Promise<ReturnType<typeof makeBundle>> {
  const bundle = makeBundle();
  await saveTournamentBundle(bundle);
  return bundle;
}

describe('export and validate', () => {
  it('exports a backup that validates and survives a JSON round trip', async () => {
    await storedBundle();

    const backup = await createBackup();
    expect(backup.app).toBe(BACKUP_APP);
    expect(backup.tournaments).toHaveLength(1);
    expect(backup.players).toHaveLength(4);
    expect(backup.matches).toHaveLength(1);

    const result = validateBackup(backup);
    expect(result.ok).toBe(true);

    const parsed = parseBackupJson(serializeBackup(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup.tournaments[0]?.name).toBe('Spring League');
    }
  });

  it('rejects files that are not Tournament Manager backups', async () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ app: 'something-else' }).ok).toBe(false);
    expect(parseBackupJson('not json').ok).toBe(false);
  });

  it('refuses a backup from a newer app version', () => {
    const result = validateBackup({
      app: BACKUP_APP,
      formatVersion: 99,
      exportedAt: 1,
      tournaments: [],
      players: [],
      participants: [],
      matches: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('newer');
    }
  });

  it('rejects a backup with missing lists', () => {
    const result = validateBackup({ app: BACKUP_APP, formatVersion: 1, exportedAt: 1 });
    expect(result.ok).toBe(false);
  });

  it('catches a participant pointing at a player who is not in the file', async () => {
    await storedBundle();
    const backup = await createBackup();
    const broken = structuredClone(backup);
    broken.participants[0]!.playerIds = ['ghost'];

    const result = validateBackup(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('player');
    }
  });

  it('catches duplicate players inside a tournament', async () => {
    await storedBundle();
    const backup = await createBackup();
    const broken = structuredClone(backup);
    const copy = structuredClone(broken.players[0]!);
    copy.id = 'p-copy';
    broken.players.push(copy);

    const result = validateBackup(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('more than once');
    }
  });

  it('writes the current backup format version', async () => {
    await storedBundle();
    const backup = await createBackup();

    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(BACKUP_FORMAT_VERSION).toBe(2);
  });

  it('reads an older backup and fills in missing source fields', async () => {
    await storedBundle();
    const backup = await createBackup();
    const legacy = structuredClone(backup) as unknown as {
      formatVersion: number;
      matches: Array<Record<string, unknown>>;
    };
    legacy.formatVersion = 1;
    for (const match of legacy.matches) {
      delete match.aSource;
      delete match.bSource;
    }

    const result = validateBackup(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.matches[0]?.aSource).toBeNull();
      expect(result.backup.matches[0]?.bSource).toBeNull();
    }
  });

  it('rejects an unknown knockout source', async () => {
    await storedBundle();
    const backup = await createBackup();
    const broken = structuredClone(backup);
    (broken.matches[0] as unknown as Record<string, unknown>).aSource = {
      kind: 'nonsense',
    };

    const result = validateBackup(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('group');
    }
  });

  it('accepts a fully generated groups + knockout bundle', () => {
    const base = makeBundle(['A', 'B', 'C', 'D', 'E', 'F'], {
      settings: {
        ...makeBundle().tournament.settings,
        format: 'groups-knockout',
        participantCount: 6,
        groupCount: 2,
        qualifiersPerGroup: 2,
      },
    });
    const plan = generateDraw({
      tournament: base.tournament,
      participants: base.participants,
      now: 10,
    });
    const bundle = {
      tournament: plan.tournament,
      players: base.players,
      participants: plan.participants,
      matches: plan.matches,
    };

    expect(validateTournamentBundle(bundle)).toEqual([]);

    const result = validateBackup({
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: 1,
      tournaments: [bundle.tournament],
      players: bundle.players,
      participants: bundle.participants,
      matches: bundle.matches,
    });
    expect(result.ok).toBe(true);
  });

  it('catches two matches in the same bracket position', async () => {
    await storedBundle();
    const backup = await createBackup();
    const broken = structuredClone(backup);
    const copy = structuredClone(broken.matches[0]!);
    copy.id = 'm-copy';
    broken.matches.push(copy);

    const result = validateBackup(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('same position');
    }
  });
});

describe('restore', () => {
  it('replaces the current data with the backup', async () => {
    const first = await storedBundle();
    const backup = await createBackup();

    const second = makeBundle(['Zoe'], { id: 't2', name: 'Second Cup' });
    second.players[0]!.id = 'p-zoe';
    second.participants[0]!.playerIds = ['p-zoe'];
    second.matches = [];
    await saveTournamentBundle(second);

    expect(await listTournaments()).toHaveLength(2);

    await restoreBackup(backup);

    const tournaments = await listTournaments();
    expect(tournaments).toHaveLength(1);
    expect(tournaments[0]?.id).toBe(first.tournament.id);
    expect(await getTournamentBundle('t2')).toBeNull();
    expect((await db.meta.get(META_KEYS.lastImportAt))?.value).toBeTypeOf('number');
  });

  it('leaves the existing data untouched when the backup is invalid', async () => {
    const first = await storedBundle();
    const backup = await createBackup();
    const broken = structuredClone(backup);
    broken.matches[0]!.winnerId = 'not-a-participant';

    await expect(restoreBackup(broken)).rejects.toBeInstanceOf(ValidationError);
    expect((await listTournaments()).map((tournament) => tournament.id)).toEqual([
      first.tournament.id,
    ]);
  });
});

describe('backupFileName', () => {
  it('uses an ISO-style date', () => {
    expect(backupFileName(new Date(2026, 10, 3))).toBe('tournament-backup-2026-11-03.json');
  });
});
