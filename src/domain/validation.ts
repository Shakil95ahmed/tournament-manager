import type {
  Match,
  MatchSource,
  Participant,
  Player,
  TournamentBundle,
} from './types';

/**
 * Checks the internal consistency of one tournament bundle before it is saved
 * or restored. Returns human-readable problems; an empty list means valid.
 */
export function validateTournamentBundle(bundle: TournamentBundle): string[] {
  const issues: string[] = [];
  const { tournament, players, participants, matches } = bundle;
  const tournamentId = tournament.id;

  if (!tournament.id) issues.push('Tournament id is missing.');
  if (!tournament.name.trim()) issues.push('Tournament name is missing.');
  if (!tournament.leagueName.trim()) issues.push('League name is missing.');

  const playerIds = new Set<string>();
  const playerKeys = new Set<string>();

  for (const player of players) {
    if (!player.id) {
      issues.push('A player is missing its id.');
      continue;
    }
    if (playerIds.has(player.id)) issues.push(`Duplicate player id "${player.id}".`);
    playerIds.add(player.id);

    if (player.tournamentId !== tournamentId) {
      issues.push(`Player "${player.name}" belongs to a different tournament.`);
    }
    if (!player.name.trim()) issues.push('A player has an empty name.');
    if (!player.nameKey.trim()) issues.push(`Player "${player.name}" has no duplicate-check key.`);
    if (playerKeys.has(player.nameKey)) {
      issues.push(`Player "${player.name}" appears more than once in this tournament.`);
    }
    playerKeys.add(player.nameKey);
  }

  const participantIds = new Set<string>();
  const participantKeys = new Set<string>();

  for (const participant of participants) {
    if (!participant.id) {
      issues.push('A participant is missing its id.');
      continue;
    }
    if (participantIds.has(participant.id)) {
      issues.push(`Duplicate participant id "${participant.id}".`);
    }
    participantIds.add(participant.id);

    if (participant.tournamentId !== tournamentId) {
      issues.push('A participant belongs to a different tournament.');
    }
    if (participantKeys.has(participant.nameKey)) {
      issues.push('The same player or team is entered more than once.');
    }
    participantKeys.add(participant.nameKey);

    const expectedPlayers = tournament.settings.discipline === 'singles' ? 1 : 2;
    if (participant.playerIds.length !== expectedPlayers) {
      issues.push(
        `A ${tournament.settings.discipline} entry must have ${expectedPlayers} player(s).`,
      );
    }
    for (const playerId of participant.playerIds) {
      if (!playerIds.has(playerId)) {
        issues.push('A participant references a player who is not in this tournament.');
      }
    }
    if (participant.seed !== null && (!Number.isInteger(participant.seed) || participant.seed < 1)) {
      issues.push('A seed must be a positive whole number.');
    }
  }

  const matchIds = new Set<string>();
  const matchById = new Map<string, Match>();
  const slots = new Set<string>();

  for (const match of matches) {
    if (!match.id) {
      issues.push('A match is missing its id.');
      continue;
    }
    if (matchIds.has(match.id)) issues.push(`Duplicate match id "${match.id}".`);
    matchIds.add(match.id);
    matchById.set(match.id, match);
  }

  const groupIds = new Set(
    participants
      .map((participant) => participant.groupId)
      .filter((groupId): groupId is string => groupId !== null),
  );

  for (const match of matches) {
    if (!match.id) continue;

    if (match.tournamentId !== tournamentId) {
      issues.push('A match belongs to a different tournament.');
    }
    if (!Number.isInteger(match.round) || match.round < 0) {
      issues.push('A match has an invalid round number.');
    }
    if (!Number.isInteger(match.slot) || match.slot < 0) {
      issues.push('A match has an invalid slot number.');
    }

    const slotKey = [match.stage, match.groupId ?? '-', match.round, match.slot].join('|');
    if (slots.has(slotKey)) {
      issues.push('Two matches occupy the same position in the draw.');
    }
    slots.add(slotKey);

    for (const side of [match.aId, match.bId]) {
      if (side !== null && !participantIds.has(side)) {
        issues.push('A match references a participant who is not in this tournament.');
      }
    }
    if (match.aId !== null && match.aId === match.bId) {
      issues.push('A match cannot have the same participant on both sides.');
    }
    if (match.winnerId !== null && match.winnerId !== match.aId && match.winnerId !== match.bId) {
      issues.push('A match winner is not one of its participants.');
    }
    if (match.status === 'completed' && match.winnerId === null) {
      issues.push('A completed match must have a winner.');
    }
    if (match.status === 'bye' && match.winnerId === null) {
      issues.push('A bye must advance one participant.');
    }
    if (match.status === 'pending' && match.winnerId !== null) {
      issues.push('A pending match cannot already have a winner.');
    }
    for (const game of match.games) {
      if (!Number.isInteger(game.a) || !Number.isInteger(game.b) || game.a < 0 || game.b < 0) {
        issues.push('Game scores must be whole numbers of zero or more.');
      }
      if (game.a === game.b) issues.push('A game cannot end in a tie.');
    }
    if (match.games.length > 0 && match.winnerId !== null) {
      let aGames = 0;
      let bGames = 0;
      for (const game of match.games) {
        if (game.a > game.b) aGames += 1;
        else if (game.b > game.a) bGames += 1;
      }
      const winnerGames = match.winnerId === match.aId ? aGames : bGames;
      const loserGames = match.winnerId === match.aId ? bGames : aGames;
      if (winnerGames <= loserGames) {
        issues.push('The game scores do not match the recorded winner.');
      }
    }
    if (match.nextMatchId === match.id) {
      issues.push('A match cannot feed into itself.');
    }
    if (match.nextMatchId !== null && !matchIds.has(match.nextMatchId)) {
      issues.push('A match feeds into a match that does not exist.');
    }
    if (
      (match.nextMatchId === null && match.nextSlot !== null) ||
      (match.nextMatchId !== null && match.nextSlot === null)
    ) {
      issues.push('A knockout link needs both a target match and a target slot.');
    }

    validateSource(match.aSource, 'a', match, matchById, groupIds, issues);
    validateSource(match.bSource, 'b', match, matchById, groupIds, issues);
  }

  issues.push(...detectProgressionCycle(matches));

  return issues;
}

function validateSource(
  source: MatchSource | null,
  side: 'a' | 'b',
  match: Match,
  matchById: Map<string, Match>,
  groupIds: Set<string>,
  issues: string[],
): void {
  if (source === null || source === undefined) return;

  if (source.kind === 'group') {
    if (!source.groupId.trim()) {
      issues.push('A knockout qualifier has an empty group name.');
    } else if (!groupIds.has(source.groupId)) {
      issues.push('A knockout qualifier refers to a group with no participants.');
    }
    if (!Number.isInteger(source.placement) || source.placement < 1) {
      issues.push('A knockout qualifier has an invalid placement.');
    }
    if (match.round !== 0) {
      issues.push('A group qualifier can only fill the first knockout round.');
    }
    return;
  }

  if (source.kind === 'winner') {
    const feeder = matchById.get(source.matchId);
    if (!feeder) {
      issues.push('A knockout place refers to a match that does not exist.');
      return;
    }
    if (feeder.nextMatchId !== match.id || feeder.nextSlot !== side) {
      issues.push('A knockout place is not linked to the match that should fill it.');
    }
    return;
  }

  issues.push('A knockout place has an unknown source.');
}

/** Follows nextMatchId links and reports loops, which would hang advancement. */
function detectProgressionCycle(matches: Match[]): string[] {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const safe = new Set<string>();

  for (const start of matches) {
    const path = new Set<string>();
    let current: Match | undefined = start;

    while (current) {
      if (safe.has(current.id)) break;
      if (path.has(current.id)) return ['The knockout bracket contains a loop.'];
      path.add(current.id);
      current =
        current.nextMatchId !== null ? byId.get(current.nextMatchId) : undefined;
    }

    for (const id of path) safe.add(id);
  }

  return [];
}

export function groupParticipants(
  participants: Participant[],
): Map<string, Participant[]> {
  const groups = new Map<string, Participant[]>();
  for (const participant of participants) {
    if (participant.groupId === null) continue;
    const list = groups.get(participant.groupId) ?? [];
    list.push(participant);
    groups.set(participant.groupId, list);
  }
  return groups;
}

export function playerNameMap(players: Player[]): Map<string, string> {
  return new Map(players.map((player) => [player.id, player.name]));
}
