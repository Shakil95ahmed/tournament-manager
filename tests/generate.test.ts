import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/domain/errors';
import { generateDraw, reviewKnockoutSize } from '../src/domain/generate';
import type { Tournament, TournamentFormat } from '../src/domain/types';
import { makeParticipants, makeTournament } from './fixtures';

function tournament(format: TournamentFormat, overrides: Partial<Tournament> = {}): Tournament {
  const base = makeTournament(overrides);
  return {
    ...base,
    settings: {
      ...base.settings,
      format,
      participantCount: 4,
      ...overrides.settings,
    },
  };
}

describe('round robin generation', () => {
  it('creates every pairing once and seeds the entries', () => {
    const participants = makeParticipants(4);
    const plan = generateDraw({
      tournament: tournament('round-robin'),
      participants,
      now: 50,
    });

    expect(plan.matches).toHaveLength(6);
    expect(plan.matches.every((match) => match.stage === 'league')).toBe(true);
    expect(plan.matches.every((match) => match.groupId === null)).toBe(true);
    expect(plan.participants.map((participant) => participant.seed).sort()).toEqual([1, 2, 3, 4]);
    expect(plan.tournament.status).toBe('active');
    expect(plan.tournament.startedAt).toBe(50);
    expect(plan.tournament.settings.knockoutSize).toBe(2);
  });

  it('warns when fewer entries are active than planned', () => {
    const plan = generateDraw({
      tournament: tournament('round-robin'),
      participants: makeParticipants(3),
      now: 1,
    });

    expect(plan.warnings.join(' ')).toContain('planned 4');
  });
});

describe('single elimination generation', () => {
  it('builds the next bracket size and reports byes', () => {
    const plan = generateDraw({
      tournament: tournament('single-elimination'),
      participants: makeParticipants(5),
      now: 2,
    });

    expect(plan.tournament.settings.knockoutSize).toBe(8);
    expect(plan.matches).toHaveLength(7);
    expect(plan.matches.filter((match) => match.status === 'bye')).toHaveLength(3);
    expect(plan.warnings.join(' ')).toContain('3 first-round byes');
  });

  it('refuses more than 64 entries', () => {
    expect(() =>
      generateDraw({
        tournament: tournament('single-elimination'),
        participants: makeParticipants(65),
        now: 1,
      }),
    ).toThrow(EngineError);
  });

  it('is reproducible from the stored random seed', () => {
    const input = {
      tournament: tournament('single-elimination'),
      participants: makeParticipants(9),
      now: 1,
    };
    const first = generateDraw(input);
    const second = generateDraw(input);

    expect(first.matches.map((match) => match.id)).toEqual(second.matches.map((match) => match.id));
    expect(first.participants.map((participant) => participant.id)).toEqual(
      second.participants.map((participant) => participant.id),
    );
  });
});

describe('groups + knockout generation', () => {
  it('builds both stages with the computed bracket size', () => {
    const plan = generateDraw({
      tournament: tournament('groups-knockout', {
        settings: {
          ...makeTournament().settings,
          format: 'groups-knockout',
          participantCount: 6,
          groupCount: 2,
          qualifiersPerGroup: 2,
        },
      }),
      participants: makeParticipants(6),
      now: 3,
    });

    expect(plan.tournament.settings.groupCount).toBe(2);
    expect(plan.tournament.settings.knockoutSize).toBe(4);
    expect(plan.matches.filter((match) => match.stage === 'group')).toHaveLength(6);
    expect(plan.matches.filter((match) => match.stage === 'knockout')).toHaveLength(3);
    expect(plan.participants.every((participant) => participant.groupId !== null)).toBe(true);
  });

  it('warns about byes in the knockout stage', () => {
    const plan = generateDraw({
      tournament: tournament('groups-knockout', {
        settings: {
          ...makeTournament().settings,
          format: 'groups-knockout',
          participantCount: 9,
          groupCount: 3,
          qualifiersPerGroup: 2,
        },
      }),
      participants: makeParticipants(9),
      now: 3,
    });

    expect(plan.tournament.settings.knockoutSize).toBe(8);
    expect(plan.warnings.join(' ')).toContain('2 first-round byes');
  });

  it('honours manual group adjustments before the draw is generated', () => {
    const base = tournament('groups-knockout', {
      settings: {
        ...makeTournament().settings,
        format: 'groups-knockout',
        participantCount: 4,
        groupCount: 2,
        qualifiersPerGroup: 2,
        seedingMethod: 'manual',
      },
    });
    const participants = makeParticipants(4);
    const plan = generateDraw({
      tournament: base,
      participants,
      manualOrder: ['e1', 'e2', 'e3', 'e4'],
      manualGroups: [
        { groupId: 'A', participantIds: ['e2', 'e1'] },
        { groupId: 'B', participantIds: ['e4', 'e3'] },
      ],
      now: 4,
    });

    const groupA = plan.participants
      .filter((participant) => participant.groupId === 'A')
      .map((participant) => participant.id);
    const groupB = plan.participants
      .filter((participant) => participant.groupId === 'B')
      .map((participant) => participant.id);

    expect(groupA.sort()).toEqual(['e1', 'e2']);
    expect(groupB.sort()).toEqual(['e3', 'e4']);
    expect(plan.matches.filter((match) => match.stage === 'group')).toHaveLength(2);
  });

  it('rejects incomplete manual groups and manual seeding without an order', () => {
    const participants = makeParticipants(4);

    expect(() =>
      generateDraw({
        tournament: tournament('groups-knockout'),
        participants,
        manualGroups: [{ groupId: 'A', participantIds: ['e1'] }],
        now: 1,
      }),
    ).toThrow(EngineError);

    expect(() =>
      generateDraw({
        tournament: tournament('groups-knockout', {
          settings: {
            ...makeTournament().settings,
            format: 'groups-knockout',
            groupCount: 2,
            qualifiersPerGroup: 2,
            seedingMethod: 'manual',
          },
        }),
        participants,
        now: 1,
      }),
    ).toThrow(EngineError);
  });

  it('rejects more qualifiers than a group can fill', () => {
    expect(() =>
      generateDraw({
        tournament: tournament('groups-knockout', {
          settings: {
            ...makeTournament().settings,
            format: 'groups-knockout',
            participantCount: 4,
            groupCount: 2,
            qualifiersPerGroup: 3,
          },
        }),
        participants: makeParticipants(4),
        now: 1,
      }),
    ).toThrow(EngineError);
  });
});

describe('reviewKnockoutSize', () => {
  it('rounds up to a supported bracket size', () => {
    expect(reviewKnockoutSize(2)).toBe(2);
    expect(reviewKnockoutSize(5)).toBe(8);
    expect(reviewKnockoutSize(64)).toBe(64);
    expect(() => reviewKnockoutSize(65)).toThrow(EngineError);
  });
});
