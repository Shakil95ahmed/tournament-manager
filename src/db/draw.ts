import { NotFoundError, ValidationError } from './errors';
import { getTournamentBundle, guarded, replaceTournamentBundle } from './services';
import { generateDraw } from '../domain/generate';
import {
  groupAssignmentIssues,
  groupConfigIssues,
  groupLabels,
  previewGroupKeys,
  type DraftEntry,
} from '../domain/setup';
import type { Participant } from '../domain/types';

export interface GenerateDrawResult {
  warnings: string[];
  matchCount: number;
}

/**
 * Turns a saved draft into fixtures. Groups that were never assigned are
 * balanced first, then the whole bundle is replaced in one transaction.
 */
export async function generateTournamentDraw(
  tournamentId: string,
): Promise<GenerateDrawResult> {
  return guarded(async () => {
    const bundle = await getTournamentBundle(tournamentId);
    if (!bundle) throw new NotFoundError('That tournament no longer exists.');
    if (bundle.tournament.status !== 'draft') {
      throw new ValidationError(['This draw has already been generated.']);
    }

    const { tournament } = bundle;
    const active = bundle.participants
      .filter((participant) => participant.active)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

    if (active.length < 2) {
      throw new ValidationError(['Add at least two active entries before generating the draw.']);
    }

    let participants: Participant[] = bundle.participants;
    let manualGroups: Array<{ groupId: string; participantIds: string[] }> | undefined;

    if (tournament.settings.format === 'groups-knockout') {
      const issues = groupConfigIssues(
        active.length,
        tournament.settings.groupCount,
        tournament.settings.qualifiersPerGroup,
      );
      if (issues.length > 0) throw new ValidationError(issues);

      const labels = groupLabels(tournament.settings.groupCount);
      const needsBalance = active.some(
        (participant) =>
          participant.groupId === null || !labels.includes(participant.groupId),
      );

      if (needsBalance) {
        const preview = previewGroupKeys(
          active.map((participant) => participant.id),
          tournament.settings.seedingMethod,
          tournament.rngSeed,
          tournament.settings.groupCount,
        );
        const assignments = new Map<string, string>();
        for (const group of preview) {
          for (const id of group.keys) assignments.set(id, group.groupId);
        }

        participants = participants.map((participant) => ({
          ...participant,
          groupId: participant.active ? (assignments.get(participant.id) ?? null) : null,
        }));
      }

      const rows: DraftEntry[] = participants.map((participant) => ({
        key: participant.id,
        id: participant.id,
        playerNames: [],
        teamName: participant.teamName ?? '',
        groupId: participant.groupId,
        active: participant.active,
      }));

      const assignmentIssues = groupAssignmentIssues(
        rows,
        tournament.settings.groupCount,
        tournament.settings.qualifiersPerGroup,
      );
      if (assignmentIssues.length > 0) throw new ValidationError(assignmentIssues);

      const activeAfter = participants
        .filter((participant) => participant.active)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

      manualGroups = labels.map((groupId) => ({
        groupId,
        participantIds: activeAfter
          .filter((participant) => participant.groupId === groupId)
          .map((participant) => participant.id),
      }));
    }

    const activeParticipants = participants
      .filter((participant) => participant.active)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

    const plan = generateDraw({
      tournament,
      participants,
      manualOrder: activeParticipants.map((participant) => participant.id),
      manualGroups,
      now: Date.now(),
    });

    await replaceTournamentBundle({
      tournament: plan.tournament,
      players: bundle.players,
      participants: plan.participants,
      matches: plan.matches,
    });

    return { warnings: plan.warnings, matchCount: plan.matches.length };
  });
}
