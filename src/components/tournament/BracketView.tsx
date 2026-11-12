import type { CSSProperties } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { bracketRounds } from '../../domain/bracketLayout';
import {
  formatScore,
  matchSideLabel,
  matchStatusLabel,
  matchStatusTone,
} from '../../domain/display';
import type { Match, Participant, Player } from '../../domain/types';
import { canRecordResult, type FixtureState } from './fixtureState';

interface BracketViewProps {
  matches: Match[];
  players: Player[];
  participants: Participant[];
  state: FixtureState;
}

function badgeClass(status: Match['status']): string {
  const tone = matchStatusTone(status);
  return tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
}

function BracketMatch({
  match,
  players,
  participants,
  state,
}: {
  match: Match;
  players: Player[];
  participants: Participant[];
  state: FixtureState;
}) {
  const aLabel = matchSideLabel(match, 'a', participants, players);
  const bLabel = matchSideLabel(match, 'b', participants, players);
  const score = formatScore(match.games);
  const editable = canRecordResult(match);
  const completed = match.status === 'completed';

  return (
    <article
      className="bracket-card"
      aria-label={`${match.roundLabel}: ${aLabel} versus ${bLabel}`}
    >
      <div className="bracket-card__teams">
        <div
          className={
            match.winnerId !== null && match.winnerId === match.aId
              ? 'bracket-card__side bracket-card__side--winner'
              : 'bracket-card__side'
          }
        >
          <span
            className={aLabel === 'Bye' ? 'bracket-card__name bracket-card__name--bye' : 'bracket-card__name'}
            title={aLabel}
          >
            {aLabel}
          </span>
          {match.winnerId !== null && match.winnerId === match.aId ? (
            <>
              <Icon name="check" size={14} className="bracket-card__check" />
              <span className="sr-only">Winner</span>
            </>
          ) : null}
        </div>
        <div
          className={
            match.winnerId !== null && match.winnerId === match.bId
              ? 'bracket-card__side bracket-card__side--winner'
              : 'bracket-card__side'
          }
        >
          <span
            className={bLabel === 'Bye' ? 'bracket-card__name bracket-card__name--bye' : 'bracket-card__name'}
            title={bLabel}
          >
            {bLabel}
          </span>
          {match.winnerId !== null && match.winnerId === match.bId ? (
            <>
              <Icon name="check" size={14} className="bracket-card__check" />
              <span className="sr-only">Winner</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="bracket-card__footer">
        <span className={badgeClass(match.status)}>{matchStatusLabel(match.status)}</span>
        {score ? (
          <span className="bracket-card__score" title={score}>
            {score}
          </span>
        ) : null}
        {editable ? (
          <Button
            variant={completed ? 'ghost' : 'secondary'}
            className="bracket-card__action"
            onClick={() => state.onEdit(match.id)}
            disabled={state.busy}
            title={completed ? 'Edit this result' : 'Record this result'}
          >
            <Icon name={completed ? 'edit' : 'plus'} size={14} />
            {completed ? 'Edit' : 'Record'}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The bracket is laid out as a grid of first-round rows. A match in round N
 * spans 2^N rows, so it sits exactly between its two feeders. Pseudo-elements
 * draw the connector lines in the gaps between columns.
 */
export function BracketView({ matches, players, participants, state }: BracketViewProps) {
  const rounds = bracketRounds(matches);
  if (rounds.length === 0) return null;

  const baseRows = rounds[0]!.matches.length;

  return (
    <div
      className="bracket-scroll"
      role="region"
      aria-label="Knockout bracket. Scroll sideways to see every round."
      tabIndex={0}
    >
      <div
        className="bracket"
        style={{
          gridTemplateColumns: `repeat(${rounds.length}, minmax(220px, 1fr))`,
          gridTemplateRows: `auto repeat(${baseRows}, var(--bracket-unit))`,
        }}
      >
        {rounds.map((round) => (
          <div
            className="bracket-round-label"
            key={`label-${round.round}`}
            style={{ gridColumn: round.round - rounds[0]!.round + 1, gridRow: 1 }}
          >
            {round.label}
          </div>
        ))}

        {rounds.flatMap((round, roundIndex) =>
          round.matches.map((match) => {
            const column = round.round - rounds[0]!.round + 1;
            const rowStart = 2 + match.slot * round.span;
            const style = {
              gridColumn: column,
              gridRow: `${rowStart} / span ${round.span}`,
              '--span': round.span,
            } as CSSProperties;

            return (
              <div
                className="bracket-slot"
                key={match.id}
                style={style}
                data-next={match.nextMatchId ? 'true' : undefined}
                data-incoming={roundIndex > 0 ? 'true' : undefined}
                data-parity={match.slot % 2 === 0 ? 'top' : 'bottom'}
                data-ready={match.status === 'ready' ? 'true' : undefined}
                data-advanced={match.winnerId !== null ? 'true' : undefined}
              >
                <BracketMatch
                  match={match}
                  players={players}
                  participants={participants}
                  state={state}
                />
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
