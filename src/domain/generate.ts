import { EngineError } from './errors';
import {
  MAX_BRACKET,
  buildElimination,
  nextPowerOfTwo,
} from './elimination';
import {
  buildGroupKnockout,
  buildGroupStage,
} from './groupsKnockout';
import { buildRoundRobinMatches } from './roundRobin';
import { allocateGroups, groupLabel, rankParticipants, type Group } from './seeding';
import type {
  KnockoutSize,
  Match,
  Participant,
  Tournament,
  TournamentSettings,
} from './types';

export interface ManualGroup {
  groupId: string;
  participantIds: string[];
}

export interface GenerateInput {
  tournament: Tournament;
  /** Every participant, active or not. Only active entries enter the draw. */
  participants: Participant[];
  /** Required for manual seeding; optional for snake seeding. */
  manualOrder?: string[];
  /** Optional pre-start group adjustments for the groups + knockout format. */
  manualGroups?: ManualGroup[];
  now: number;
}

export interface DrawPlan {
  tournament: Tournament;
  participants: Participant[];
  matches: Match[];
  warnings: string[];
}

/**
 * The single entry point that turns a reviewed setup into fixtures. It ranks
 * and seeds entries, allocates groups, builds every match once and reports
 * anything the organizer should know before saving.
 */
export function generateDraw(input: GenerateInput): DrawPlan {
  const active = input.participants.filter((participant) => participant.active);
  if (active.length < 2) {
    throw new EngineError(['A tournament needs at least two active participants.']);
  }
  if (active.length > MAX_BRACKET) {
    throw new EngineError([`A draw can hold at most ${MAX_BRACKET} participants.`]);
  }
  assertUniqueParticipantIds(input.participants);

  const settings: TournamentSettings = { ...input.tournament.settings };
  const warnings: string[] = [];

  if (settings.seedingMethod === 'manual' && !input.manualOrder) {
    throw new EngineError(['Manual seeding needs an explicit participant order.']);
  }

  const ranked = rankParticipants(
    active,
    settings.seedingMethod,
    input.tournament.rngSeed,
    input.manualOrder,
  );

  if (input.manualGroups && settings.format !== 'groups-knockout') {
    throw new EngineError(['Manual groups are only used by the groups + knockout format.']);
  }

  let matches: Match[] = [];
  let drawParticipants: Participant[] = [];

  switch (settings.format) {
    case 'round-robin': {
      settings.knockoutSize = 2;
      settings.groupCount = 0;
      settings.qualifiersPerGroup = 0;
      drawParticipants = ranked.map((participant) => ({ ...participant, groupId: null }));
      matches = buildRoundRobinMatches({
        tournamentId: input.tournament.id,
        participants: drawParticipants,
        stage: 'league',
        groupId: null,
        orderBase: 0,
        now: input.now,
      });
      break;
    }

    case 'single-elimination': {
      const bracket = buildElimination({
        tournamentId: input.tournament.id,
        participants: ranked,
        orderBase: 0,
        now: input.now,
      });
      settings.knockoutSize = toKnockoutSize(bracket.size);
      settings.groupCount = 0;
      settings.qualifiersPerGroup = 0;
      drawParticipants = ranked.map((participant) => ({ ...participant, groupId: null }));
      matches = bracket.matches;

      const byes = bracket.size - ranked.length;
      if (byes > 0) warnings.push(byeWarning(byes));
      break;
    }

    case 'groups-knockout': {
      const groups = input.manualGroups
        ? groupsFromManual(ranked, input.manualGroups)
        : allocateGroups(ranked, settings.groupCount);

      const groupCount = groups.length;
      if (groupCount < 1) {
        throw new EngineError(['Groups + knockout needs at least one group.']);
      }
      if (settings.qualifiersPerGroup < 1) {
        throw new EngineError(['At least one participant must advance from each group.']);
      }

      const stage = buildGroupStage({
        tournamentId: input.tournament.id,
        groups,
        now: input.now,
      });

      const knockout = buildGroupKnockout({
        tournamentId: input.tournament.id,
        groups: stage.groups,
        qualifiersPerGroup: settings.qualifiersPerGroup,
        now: input.now,
      });

      settings.groupCount = groupCount;
      settings.knockoutSize = toKnockoutSize(knockout.size);
      drawParticipants = stage.groups.flatMap((group) => group.participants);
      matches = [...stage.matches, ...knockout.matches];

      warnings.push(...groupWarnings(stage.groups, settings.qualifiersPerGroup));
      const qualifiers = groupCount * settings.qualifiersPerGroup;
      const byes = knockout.size - qualifiers;
      if (byes > 0) warnings.push(byeWarning(byes));
      break;
    }

    default:
      throw new EngineError(['That tournament format is not supported.']);
  }

  if (settings.participantCount > 0 && settings.participantCount !== active.length) {
    warnings.push(
      `You planned ${settings.participantCount} entries, but ${active.length} are active.`,
    );
  }

  const updatedActive = new Map(
    drawParticipants.map((participant) => [participant.id, participant]),
  );
  const allParticipants = input.participants.map((participant) => {
    const updated = updatedActive.get(participant.id);
    if (updated) return updated;
    return { ...participant, groupId: null };
  });

  const tournament: Tournament = {
    ...input.tournament,
    settings,
    status: input.tournament.status === 'draft' ? 'active' : input.tournament.status,
    startedAt: input.tournament.startedAt ?? input.now,
    updatedAt: input.now,
  };

  return { tournament, participants: allParticipants, matches, warnings };
}

function assertUniqueParticipantIds(participants: Participant[]): void {
  const ids = new Set<string>();
  for (const participant of participants) {
    if (ids.has(participant.id)) {
      throw new EngineError(['The same participant appears twice in the entry list.']);
    }
    ids.add(participant.id);
  }
}

function groupsFromManual(ranked: Participant[], manual: ManualGroup[]): Group[] {
  if (manual.length === 0) {
    throw new EngineError(['Manual groups need at least one group.']);
  }

  const byId = new Map(ranked.map((participant) => [participant.id, participant]));
  const seen = new Set<string>();
  const usedGroups = new Set<string>();

  const groups: Group[] = manual.map((group, index) => {
    const groupId = group.groupId.trim() || groupLabel(index);
    if (usedGroups.has(groupId)) {
      throw new EngineError([`Group "${groupId}" appears twice.`]);
    }
    usedGroups.add(groupId);

    if (group.participantIds.length === 0) {
      throw new EngineError([`Group "${groupId}" has no entries.`]);
    }

    const participants = group.participantIds.map((id) => {
      if (seen.has(id)) {
        throw new EngineError(['A participant is assigned to more than one group.']);
      }
      seen.add(id);

      const participant = byId.get(id);
      if (!participant) {
        throw new EngineError(['A group contains a participant who is not entered.']);
      }
      return participant;
    });

    return {
      groupId,
      participants: participants.slice().sort(compareSeeds),
    };
  });

  if (seen.size !== byId.size) {
    throw new EngineError(['Every active participant must be assigned to a group.']);
  }

  return groups;
}

function compareSeeds(a: Participant, b: Participant): number {
  return (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER);
}

function groupWarnings(groups: Group[], qualifiersPerGroup: number): string[] {
  const warnings: string[] = [];
  const sizes = groups.map((group) => group.participants.length);
  const smallest = Math.min(...sizes);
  const largest = Math.max(...sizes);

  if (largest - smallest > 1) {
    const detail = groups.map((group) => `${group.groupId}: ${group.participants.length}`).join(', ');
    warnings.push(`Group sizes are uneven (${detail}).`);
  }

  for (const group of groups) {
    if (group.participants.length === 1) {
      warnings.push(`Group ${group.groupId} has only one entry.`);
    }
    if (group.participants.length < qualifiersPerGroup) {
      warnings.push(
        `Group ${group.groupId} cannot fill its ${qualifiersPerGroup} qualifier place(s).`,
      );
    }
  }

  if (groups.length === 1) {
    warnings.push('With one group, qualifiers can meet again in the first knockout round.');
  }

  return warnings;
}

function byeWarning(byes: number): string {
  return `${byes} first-round bye${byes === 1 ? '' : 's'} will be used.`;
}

function toKnockoutSize(size: number): KnockoutSize {
  if (
    size === 2 ||
    size === 4 ||
    size === 8 ||
    size === 16 ||
    size === 32 ||
    size === 64
  ) {
    return size;
  }
  throw new EngineError(['A knockout bracket needs 2, 4, 8, 16, 32 or 64 places.']);
}

/** Useful in the review step before calling generateDraw. */
export function reviewKnockoutSize(participantCount: number): KnockoutSize {
  if (participantCount < 2 || participantCount > MAX_BRACKET) {
    throw new EngineError([`A draw needs between 2 and ${MAX_BRACKET} participants.`]);
  }
  return toKnockoutSize(nextPowerOfTwo(participantCount));
}
