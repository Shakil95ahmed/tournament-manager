import { normalizeName } from '../src/domain/keys';
import type {
  Match,
  Participant,
  Player,
  Tournament,
  TournamentBundle,
} from '../src/domain/types';

export function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 't1',
    name: 'Spring League',
    leagueName: 'City Badminton',
    status: 'draft',
    settings: {
      sport: 'badminton',
      discipline: 'singles',
      format: 'round-robin',
      participantCount: 4,
      groupCount: 1,
      qualifiersPerGroup: 2,
      knockoutSize: 4,
      seedingMethod: 'random',
      scoring: { mode: 'best-of-3', targetPoints: 21 },
      points: { win: 2, loss: 1 },
      tiebreakers: [
        'points',
        'wins',
        'gameDifference',
        'pointDifference',
        'headToHead',
        'seed',
      ],
    },
    rngSeed: 12345,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    completedAt: null,
    lastSavedAt: 1,
    ...overrides,
  };
}

export function makeParticipants(count: number): Participant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    tournamentId: 't1',
    playerIds: [`p${index + 1}`],
    nameKey: `player ${index + 1}`,
    teamName: null,
    seed: index + 1,
    groupId: null,
    active: true,
    createdAt: 1,
  }));
}

export function makeBundle(
  names: string[] = ['Alice', 'Bob', 'Cara', 'Dan'],
  overrides: Partial<Tournament> = {},
): TournamentBundle {
  const tournament = makeTournament(overrides);
  tournament.settings = { ...tournament.settings, participantCount: names.length };

  const players: Player[] = names.map((name, index) => ({
    id: `p${index + 1}`,
    tournamentId: tournament.id,
    name,
    nameKey: normalizeName(name),
    createdAt: 1,
  }));

  const participants: Participant[] = players.map((player, index) => ({
    id: `e${index + 1}`,
    tournamentId: tournament.id,
    playerIds: [player.id],
    nameKey: player.nameKey,
    teamName: null,
    seed: index + 1,
    groupId: null,
    active: true,
    createdAt: 1,
  }));

  const matches: Match[] = [];

  if (participants.length >= 2) {
    const first = participants[0]!;
    const second = participants[1]!;
    matches.push({
      id: 'm1',
      tournamentId: tournament.id,
      stage: 'league',
      groupId: null,
      round: 0,
      roundLabel: 'Round 1',
      slot: 0,
      order: 0,
      aId: first.id,
      bId: second.id,
      aSource: null,
      bSource: null,
      aLabel: first.nameKey,
      bLabel: second.nameKey,
      status: 'ready',
      winnerId: null,
      games: [],
      court: null,
      nextMatchId: null,
      nextSlot: null,
      history: [],
      updatedAt: 1,
    });
  }

  return { tournament, players, participants, matches };
}
