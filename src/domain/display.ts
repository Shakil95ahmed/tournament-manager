import { DISCIPLINE_LABELS, FORMAT_LABELS, SPORT_LABELS } from './presets';
import type {
  Match,
  MatchStatus,
  Participant,
  Player,
  Tournament,
  TournamentSettings,
} from './types';

export function playerNameMap(players: readonly Player[]): Map<string, string> {
  return new Map(players.map((player) => [player.id, player.name]));
}

export function participantLabel(
  participant: Participant,
  players: readonly Player[] | Map<string, string>,
): string {
  if (participant.teamName) return participant.teamName;

  const names = participantPlayerNames(participant, players);
  return names.length > 0 ? names.join(' & ') : 'Unnamed entry';
}

export function participantPlayerNames(
  participant: Participant,
  players: readonly Player[] | Map<string, string>,
): string[] {
  const namesById = players instanceof Map ? players : playerNameMap(players);
  return participant.playerIds
    .map((id) => namesById.get(id))
    .filter((name): name is string => Boolean(name));
}

export function matchSideLabel(
  match: Match,
  side: 'a' | 'b',
  participants: readonly Participant[],
  players: readonly Player[] | Map<string, string>,
): string {
  const id = side === 'a' ? match.aId : match.bId;
  if (id) {
    const participant = participants.find((entry) => entry.id === id);
    return participant ? participantLabel(participant, players) : 'Unknown entry';
  }

  const label = side === 'a' ? match.aLabel : match.bLabel;
  if (label === 'BYE') return 'Bye';
  return label || 'To be decided';
}

export function formatScore(games: Match['games']): string {
  return games.map((game) => `${game.a}–${game.b}`).join(', ');
}

export function matchStatusLabel(status: MatchStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'ready':
      return 'Ready';
    case 'completed':
      return 'Played';
    case 'bye':
      return 'Bye';
  }
}

export function matchStatusTone(status: MatchStatus): 'neutral' | 'accent' | 'success' | 'warn' {
  switch (status) {
    case 'ready':
      return 'accent';
    case 'completed':
      return 'success';
    case 'bye':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function statusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'active':
      return 'In progress';
    case 'completed':
      return 'Completed';
  }
}

export function statusTone(status: Tournament['status']): 'neutral' | 'accent' | 'success' {
  switch (status) {
    case 'active':
      return 'accent';
    case 'completed':
      return 'success';
    default:
      return 'neutral';
  }
}

export function tournamentFormatLine(settings: TournamentSettings): string {
  return `${SPORT_LABELS[settings.sport]} · ${DISCIPLINE_LABELS[settings.discipline]} · ${FORMAT_LABELS[settings.format]}`;
}

export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Not saved yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
