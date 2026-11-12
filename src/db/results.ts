import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { guarded } from './services';
import { fillKnockoutFromGroups } from '../domain/groupsKnockout';
import {
  clearResult,
  findChampion,
  recordResult,
  undoResult,
} from '../domain/results';
import type { GameScore, Match, Participant, Tournament } from '../domain/types';

export interface MatchResultInput {
  winnerId: string;
  games: readonly GameScore[];
  court: string | null;
}

export interface MatchResultOutcome {
  /** True when the tournament has a champion after this change. */
  completed: boolean;
  championId: string | null;
}

type ResultChange = (
  matches: Match[],
  tournament: Tournament,
  participants: Participant[],
  now: number,
) => Match[];

/**
 * All three result actions share the same transaction: apply the engine change,
 * refill group qualifiers when needed, recompute the champion, then save every
 * match and the tournament status together.
 */
async function applyResultChange(
  tournamentId: string,
  change: ResultChange,
): Promise<MatchResultOutcome> {
  return guarded(() =>
    db.transaction(
      'rw',
      [db.tournaments, db.matches, db.participants],
      async () => {
        const tournament = await db.tournaments.get(tournamentId);
        if (!tournament) throw new NotFoundError('That tournament no longer exists.');
        if (tournament.status === 'draft') {
          throw new ValidationError([
            'Generate the draw before recording results for this tournament.',
          ]);
        }

        const [participants, matches] = await Promise.all([
          db.participants.where('tournamentId').equals(tournamentId).toArray(),
          db.matches.where('tournamentId').equals(tournamentId).toArray(),
        ]);

        const now = Date.now();
        let next = change(matches, tournament, participants, now);

        if (tournament.settings.format === 'groups-knockout') {
          next = fillKnockoutFromGroups({
            matches: next,
            participants,
            settings: {
              points: tournament.settings.points,
              tiebreakers: tournament.settings.tiebreakers,
            },
            now,
          }).matches;
        }

        const championId = findChampion({
          matches: next,
          participants,
          settings: {
            format: tournament.settings.format,
            points: tournament.settings.points,
            tiebreakers: tournament.settings.tiebreakers,
          },
        });
        const completed = championId !== null;

        await db.matches.bulkPut(next);
        await db.tournaments.update(tournamentId, {
          status: completed ? 'completed' : 'active',
          completedAt: completed ? (tournament.completedAt ?? now) : null,
          updatedAt: now,
          lastSavedAt: now,
        });

        return { completed, championId };
      },
    ),
  );
}

export async function recordMatchResult(
  tournamentId: string,
  matchId: string,
  input: MatchResultInput,
): Promise<MatchResultOutcome> {
  return applyResultChange(tournamentId, (matches, tournament, _participants, now) =>
    recordResult(matches, {
      matchId,
      winnerId: input.winnerId,
      games: input.games,
      court: input.court,
      now,
      scoring: tournament.settings.scoring,
    }),
  );
}

export async function undoMatchResult(
  tournamentId: string,
  matchId: string,
): Promise<MatchResultOutcome> {
  return applyResultChange(tournamentId, (matches, _tournament, _participants, now) =>
    undoResult(matches, matchId, now),
  );
}

export async function clearMatchResult(
  tournamentId: string,
  matchId: string,
): Promise<MatchResultOutcome> {
  return applyResultChange(tournamentId, (matches, _tournament, _participants, now) =>
    clearResult(matches, matchId, now),
  );
}
