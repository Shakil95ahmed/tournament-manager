import { EngineError } from './errors';
import { createRng, shuffle } from './rng';
import type { Participant, SeedingMethod } from './types';

export interface Group {
  groupId: string;
  participants: Participant[];
}

/**
 * Puts participants in seed order and stamps seed numbers 1..n.
 * - random: seeded shuffle (reproducible from the stored seed)
 * - manual: the organizer's explicit order
 * - snake: the organizer's ranking, distributed serpentine across groups
 */
export function rankParticipants(
  participants: Participant[],
  method: SeedingMethod,
  rngSeed: number,
  manualOrder?: string[],
): Participant[] {
  let ordered: Participant[];

  if (method === 'random') {
    ordered = shuffle(participants, createRng(rngSeed));
  } else if (manualOrder) {
    const byId = new Map(participants.map((participant) => [participant.id, participant]));
    const missing = manualOrder.filter((id) => !byId.has(id));
    const unique = new Set(manualOrder);

    if (manualOrder.length !== participants.length || unique.size !== participants.length) {
      throw new EngineError(['The seeding order must list every participant exactly once.']);
    }
    if (missing.length > 0) {
      throw new EngineError(['The seeding order contains a participant who is not entered.']);
    }

    ordered = manualOrder.map((id) => byId.get(id)!);
  } else {
    // Snake keeps the current order; the serpentine step happens in allocateGroups.
    ordered = participants.slice();
  }

  return ordered.map((participant, index) => ({ ...participant, seed: index + 1 }));
}

export function groupLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return `${String.fromCharCode(65 + (index % 26))}${Math.floor(index / 26)}`;
}

/**
 * Distributes seeded entries into balanced groups with a serpentine pattern:
 * 1,2,3 / 3,2,1 / 1,2,3 ... so the strongest entries are spread apart.
 * Group sizes never differ by more than one.
 */
export function allocateGroups(ranked: Participant[], groupCount: number): Group[] {
  if (groupCount < 1) {
    throw new EngineError(['A grouped tournament needs at least one group.']);
  }
  if (groupCount > ranked.length) {
    throw new EngineError(['There cannot be more groups than participants.']);
  }

  const groups: Participant[][] = Array.from({ length: groupCount }, () => []);

  ranked.forEach((participant, index) => {
    const row = Math.floor(index / groupCount);
    const position = index % groupCount;
    const target = row % 2 === 0 ? position : groupCount - 1 - position;
    groups[target]!.push(participant);
  });

  return groups.map((participants, index) => ({
    groupId: groupLabel(index),
    participants,
  }));
}

export function minimumGroupSize(participantCount: number, groupCount: number): number {
  return Math.floor(participantCount / groupCount);
}
