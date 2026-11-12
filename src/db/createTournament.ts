import { ValidationError } from './errors';
import { saveTournamentBundle } from './services';
import { generateDraw, reviewKnockoutSize } from '../domain/generate';
import { newId } from '../domain/keys';
import { defaultSettings } from '../domain/presets';
import { randomSeed } from '../domain/rng';
import {
  applyAutoGroups,
  buildEntryRows,
  drawEntryIssues,
  duplicateEntryIssues,
  groupAssignmentIssues,
  groupConfigIssues,
  groupLabels,
  isEntryComplete,
  type DraftEntry,
} from '../domain/setup';
import type {
  Discipline,
  PointsSettings,
  ScoreSettings,
  SeedingMethod,
  Sport,
  TiebreakerId,
  Tournament,
  TournamentBundle,
  TournamentFormat,
  TournamentSettings,
} from '../domain/types';

export interface CreateTournamentInput {
  name: string;
  leagueName: string;
  sport: Sport;
  discipline: Discipline;
  format: TournamentFormat;
  seedingMethod: SeedingMethod;
  groupCount: number;
  qualifiersPerGroup: number;
  scoring: ScoreSettings;
  points: PointsSettings;
  tiebreakers: TiebreakerId[];
  entries: DraftEntry[];
  generate: boolean;
  rngSeed?: number;
  now?: number;
}

export interface CreateTournamentResult {
  id: string;
  status: Tournament['status'];
  warnings: string[];
}

function knockoutSizeFor(
  format: TournamentFormat,
  activeCount: number,
  groupCount: number,
  qualifiersPerGroup: number,
): TournamentSettings['knockoutSize'] {
  if (format === 'single-elimination') {
    return activeCount >= 2 ? reviewKnockoutSize(activeCount) : 2;
  }
  if (format === 'groups-knockout') {
    const qualifiers = groupCount * qualifiersPerGroup;
    return qualifiers >= 2 && qualifiers <= 64 ? reviewKnockoutSize(qualifiers) : 2;
  }
  return 2;
}

/**
 * Builds and saves a tournament in one transaction. Saving a draft skips
 * incomplete rows; generating a draw requires a complete, valid setup.
 */
export async function createTournament(
  input: CreateTournamentInput,
): Promise<CreateTournamentResult> {
  const name = input.name.trim();
  const leagueName = input.leagueName.trim();

  if (!name) throw new ValidationError(['Give the tournament a name.']);
  if (!leagueName) throw new ValidationError(['Give the league or club a name.']);

  const completeEntries = input.entries.filter((entry) =>
    isEntryComplete(entry, input.discipline),
  );
  const warnings: string[] = [];

  if (input.generate) {
    const issues = drawEntryIssues(input.entries, input.discipline);
    if (input.format === 'groups-knockout') {
      issues.push(
        ...groupConfigIssues(
          input.entries.filter((entry) => entry.active).length,
          input.groupCount,
          input.qualifiersPerGroup,
        ),
      );
    }
    if (issues.length > 0) throw new ValidationError(issues);
  } else {
    const issues = duplicateEntryIssues(completeEntries, input.discipline);
    const activeCount = completeEntries.filter((entry) => entry.active).length;
    if (activeCount > 64) {
      issues.push('A draw can hold at most 64 active entries.');
    }
    if (issues.length > 0) throw new ValidationError(issues);

    const skipped = input.entries.length - completeEntries.length;
    if (skipped > 0) {
      warnings.push(
        `${skipped} incomplete ${skipped === 1 ? 'entry was' : 'entries were'} not saved.`,
      );
    }
  }

  const now = input.now ?? Date.now();
  const rngSeed = input.rngSeed ?? randomSeed();

  const labels = groupLabels(input.groupCount);
  const activeEntries = completeEntries.filter((entry) => entry.active);
  const groupsAlreadySet =
    activeEntries.length > 0 &&
    activeEntries.every(
      (entry) => entry.groupId !== null && labels.includes(entry.groupId),
    );

  const entries: DraftEntry[] =
    input.format === 'groups-knockout' && !groupsAlreadySet
      ? applyAutoGroups(completeEntries, input.seedingMethod, rngSeed, input.groupCount)
      : completeEntries.map((entry) => ({
          ...entry,
          groupId: input.format === 'groups-knockout' ? entry.groupId : null,
        }));

  const active = entries.filter((entry) => entry.active);

  if (input.generate && input.format === 'groups-knockout') {
    const issues = groupAssignmentIssues(entries, input.groupCount, input.qualifiersPerGroup);
    if (issues.length > 0) throw new ValidationError(issues);
  }

  const settings: TournamentSettings = defaultSettings({
    sport: input.sport,
    discipline: input.discipline,
    format: input.format,
    participantCount: active.length,
    groupCount: input.groupCount,
    qualifiersPerGroup: input.qualifiersPerGroup,
    seedingMethod: input.seedingMethod,
  });
  settings.scoring = { ...input.scoring };
  settings.points = { ...input.points };
  settings.tiebreakers = [...input.tiebreakers];
  settings.knockoutSize = knockoutSizeFor(
    input.format,
    active.length,
    input.groupCount,
    input.qualifiersPerGroup,
  );

  const tournament: Tournament = {
    id: newId(),
    name,
    leagueName,
    status: 'draft',
    settings,
    rngSeed,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    lastSavedAt: now,
  };

  const built = buildEntryRows(tournament.id, entries, input.discipline, now);
  let bundle: TournamentBundle = {
    tournament,
    players: built.players,
    participants: built.participants,
    matches: [],
  };

  if (input.generate) {
    const manualOrder = built.participants
      .filter((participant) => participant.active)
      .map((participant) => participant.id);
    const manualGroups =
      input.format === 'groups-knockout'
        ? groupLabels(input.groupCount).map((groupId) => ({
            groupId,
            participantIds: built.participants
              .filter((participant) => participant.active && participant.groupId === groupId)
              .map((participant) => participant.id),
          }))
        : undefined;

    const plan = generateDraw({
      tournament,
      participants: built.participants,
      manualOrder,
      manualGroups,
      now,
    });

    warnings.push(...plan.warnings);
    bundle = {
      tournament: plan.tournament,
      players: built.players,
      participants: plan.participants,
      matches: plan.matches,
    };
  }

  await saveTournamentBundle(bundle);

  return {
    id: tournament.id,
    status: bundle.tournament.status,
    warnings,
  };
}
