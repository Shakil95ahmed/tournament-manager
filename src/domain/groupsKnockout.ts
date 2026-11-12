import { EngineError } from './errors';
import {
  MAX_BRACKET,
  buildBracket,
  nextPowerOfTwo,
  ordinal,
  resolveByes,
  seedOrder,
  type BracketSlot,
} from './elimination';
import { cloneMatches } from './matches';
import { buildRoundRobinMatches } from './roundRobin';
import { computeGroupStandings } from './standings';
import type { Group } from './seeding';
import type {
  Match,
  Participant,
  PointsSettings,
  TiebreakerId,
  TournamentSettings,
} from './types';

export const KNOCKOUT_ORDER_BASE = 100000;
export const GROUP_ORDER_BASE = 0;

export interface GroupStageResult {
  groups: Group[];
  matches: Match[];
}

/**
 * Stamps every participant with its group and turns each group into a
 * complete round robin. Groups are ordered, so group A always appears first.
 */
export function buildGroupStage(params: {
  tournamentId: string;
  groups: Group[];
  orderBase?: number;
  now: number;
}): GroupStageResult {
  const seen = new Set<string>();
  const groups = params.groups.map((group) => {
    if (!group.groupId.trim()) {
      throw new EngineError(['Every group needs a name.']);
    }
    if (seen.has(group.groupId)) {
      throw new EngineError([`Group "${group.groupId}" appears twice.`]);
    }
    seen.add(group.groupId);

    return {
      groupId: group.groupId,
      participants: group.participants.map((participant) => ({
        ...participant,
        groupId: group.groupId,
      })),
    };
  });

  const base = params.orderBase ?? GROUP_ORDER_BASE;
  const matches: Match[] = [];

  groups.forEach((group, index) => {
    matches.push(
      ...buildRoundRobinMatches({
        tournamentId: params.tournamentId,
        participants: group.participants,
        stage: 'group',
        groupId: group.groupId,
        orderBase: base + index * 1000,
        now: params.now,
      }),
    );
  });

  return { groups, matches };
}

export interface QualifierEntry {
  groupId: string;
  placement: number;
  /** Human label such as "A 1st". */
  label: string;
}

/**
 * Qualifiers are ordered placement-major: every group winner first, then every
 * runner-up, and so on. That maps naturally onto standard bracket seed order.
 */
export function qualifierEntries(
  groupIds: readonly string[],
  qualifiersPerGroup: number,
): QualifierEntry[] {
  const entries: QualifierEntry[] = [];
  for (let placement = 1; placement <= qualifiersPerGroup; placement += 1) {
    for (const groupId of groupIds) {
      entries.push({
        groupId,
        placement,
        label: `${groupId} ${ordinal(placement)}`,
      });
    }
  }
  return entries;
}

export interface GroupKnockoutResult {
  matches: Match[];
  size: number;
}

/**
 * Builds the knockout skeleton for a groups + knockout tournament. Qualifier
 * places carry a source, so the bracket can be drawn and shown before any
 * group match has been played.
 */
export function buildGroupKnockout(params: {
  tournamentId: string;
  groups: Group[];
  qualifiersPerGroup: number;
  orderBase?: number;
  now: number;
}): GroupKnockoutResult {
  const groupIds = params.groups.map((group) => group.groupId);
  if (groupIds.length === 0) {
    throw new EngineError(['Groups + knockout needs at least one group.']);
  }
  if (params.qualifiersPerGroup < 1) {
    throw new EngineError(['At least one participant must advance from each group.']);
  }

  for (const group of params.groups) {
    if (group.participants.length < params.qualifiersPerGroup) {
      throw new EngineError([
        `Group "${group.groupId}" has ${group.participants.length} entries but ${params.qualifiersPerGroup} must advance.`,
      ]);
    }
  }

  const total = groupIds.length * params.qualifiersPerGroup;
  if (total < 2) {
    throw new EngineError(['The knockout stage needs at least two qualifiers.']);
  }
  if (total > MAX_BRACKET) {
    throw new EngineError([`A knockout stage can hold at most ${MAX_BRACKET} qualifiers.`]);
  }

  const size = nextPowerOfTwo(total);
  const entries = qualifierEntries(groupIds, params.qualifiersPerGroup);
  const order = seedOrder(size);

  const slots: BracketSlot[] = order.map((seed) => {
    const entry = entries[seed - 1];
    if (!entry) return { kind: 'bye' };
    return {
      kind: 'qualifier',
      source: { kind: 'group', groupId: entry.groupId, placement: entry.placement },
      label: entry.label,
    };
  });

  avoidSameGroupFirstRound(slots);

  const bracket = buildBracket({
    tournamentId: params.tournamentId,
    slots,
    orderBase: params.orderBase ?? KNOCKOUT_ORDER_BASE,
    now: params.now,
  });

  return { matches: resolveByes(bracket.matches, params.now), size: bracket.size };
}

function qualifierGroup(slot: BracketSlot): string | null {
  return slot.kind === 'qualifier' && slot.source.kind === 'group'
    ? slot.source.groupId
    : null;
}

function sameGroupPair(slots: readonly BracketSlot[], start: number): boolean {
  const a = slots[start];
  const b = slots[start + 1];
  if (!a || !b) return false;
  const groupA = qualifierGroup(a);
  const groupB = qualifierGroup(b);
  return groupA !== null && groupA === groupB;
}

/**
 * Standard seed order keeps group winners apart but can still pair a winner
 * with a runner-up from the same group. Swap qualifier places until no
 * first-round pairing repeats a group. Byes are never moved.
 */
export function avoidSameGroupFirstRound(slots: BracketSlot[]): BracketSlot[] {
  let changed = true;
  let guard = 0;

  while (changed && guard <= slots.length * 2) {
    changed = false;
    guard += 1;

    for (let start = 0; start < slots.length; start += 2) {
      if (!sameGroupPair(slots, start)) continue;

      for (let candidate = 0; candidate < slots.length; candidate += 1) {
        if (candidate === start || candidate === start + 1) continue;
        if (slots[candidate]?.kind !== 'qualifier') continue;

        const otherStart = candidate - (candidate % 2);
        const first = slots[start]!;
        const second = slots[candidate]!;

        slots[start] = second;
        slots[candidate] = first;

        if (!sameGroupPair(slots, start) && !sameGroupPair(slots, otherStart)) {
          changed = true;
          break;
        }

        // Undo an unsuccessful swap and try the next candidate.
        slots[start] = first;
        slots[candidate] = second;
      }

      if (changed) break;
    }
  }

  return slots;
}

export interface FillKnockoutInput {
  matches: readonly Match[];
  participants: readonly Participant[];
  settings: { points: PointsSettings; tiebreakers: TiebreakerId[] };
  now: number;
}

export interface FillKnockoutResult {
  matches: Match[];
  /** True when qualifiers or bracket progress changed. */
  changed: boolean;
  /** False while the group stage still has unfinished matches. */
  complete: boolean;
}

/**
 * Fills knockout qualifier places from the final group standings. Called after
 * every group result. If a correction changes who qualified, the knockout stage
 * is reset so no stale result can survive.
 */
export function fillKnockoutFromGroups(input: FillKnockoutInput): FillKnockoutResult {
  const knockout = cloneMatches(input.matches.filter((match) => match.stage === 'knockout'));
  if (knockout.length === 0) {
    return { matches: input.matches.slice(), changed: false, complete: true };
  }

  const groupMatches = input.matches.filter((match) => match.stage === 'group');
  const complete = groupMatches.every((match) => match.status === 'completed');

  if (!complete) {
    const changed = resetKnockout(knockout, input.now);
    return { matches: mergeKnockout(input.matches, knockout), changed, complete: false };
  }

  const standings = computeGroupStandings({
    participants: input.participants.slice(),
    matches: groupMatches.slice(),
    settings: input.settings,
  });

  const firstRound = knockout
    .filter((match) => match.round === 0)
    .sort((a, b) => a.slot - b.slot);

  const desired = new Map<string, string | null>();
  for (const match of firstRound) {
    desired.set(`${match.id}:a`, resolveSource(match.aSource, standings, match));
    desired.set(`${match.id}:b`, resolveSource(match.bSource, standings, match));
  }

  let changed = false;
  for (const match of firstRound) {
    if ((desired.get(`${match.id}:a`) ?? null) !== match.aId) changed = true;
    if ((desired.get(`${match.id}:b`) ?? null) !== match.bId) changed = true;
  }

  if (!changed) {
    return { matches: input.matches.slice(), changed: false, complete: true };
  }

  resetKnockout(knockout, input.now);

  for (const match of firstRound) {
    match.aId = desired.get(`${match.id}:a`) ?? null;
    match.bId = desired.get(`${match.id}:b`) ?? null;
    match.updatedAt = input.now;
  }

  resolveByes(knockout, input.now);
  return { matches: mergeKnockout(input.matches, knockout), changed: true, complete: true };
}

function resolveSource(
  source: Match['aSource'],
  standings: ReturnType<typeof computeGroupStandings>,
  match: Match,
): string | null {
  if (!source) return null;
  if (source.kind !== 'group') {
    throw new EngineError([
      `Knockout match ${match.roundLabel} ${match.slot + 1} has a non-group first-round source.`,
    ]);
  }

  const rows = standings.get(source.groupId);
  const row = rows?.[source.placement - 1];
  if (!row) {
    throw new EngineError([
      `Group "${source.groupId}" does not have a ${ordinal(source.placement)} place.`,
    ]);
  }
  return row.participantId;
}

function resetKnockout(matches: Match[], now: number): boolean {
  let changed = false;

  for (const match of matches) {
    if (
      match.aId !== null ||
      match.bId !== null ||
      match.winnerId !== null ||
      match.status !== 'pending' ||
      match.games.length > 0 ||
      match.history.length > 0 ||
      match.court !== null
    ) {
      changed = true;
    }

    match.aId = null;
    match.bId = null;
    match.winnerId = null;
    match.games = [];
    match.court = null;
    match.history = [];
    match.status = 'pending';
    match.updatedAt = now;
  }

  return changed;
}

function mergeKnockout(original: readonly Match[], knockout: Match[]): Match[] {
  const byId = new Map(knockout.map((match) => [match.id, match]));
  return original.map((match) => byId.get(match.id) ?? match);
}

/** Convenience for callers that already hold a full bundle's settings. */
export function groupSettings(
  settings: Pick<TournamentSettings, 'points' | 'tiebreakers'>,
): { points: PointsSettings; tiebreakers: TiebreakerId[] } {
  return { points: settings.points, tiebreakers: settings.tiebreakers };
}
