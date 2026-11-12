import { useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { ResultEditor } from './ResultEditor';
import { BracketView } from './BracketView';
import { canRecordResult, type FixtureState } from './fixtureState';
import {
  formatScore,
  matchSideLabel,
  matchStatusLabel,
  matchStatusTone,
  plural,
} from '../../domain/display';
import { compareMatches } from '../../domain/matches';
import { downstreamResultsCount } from '../../domain/results';
import { clearMatchResult, recordMatchResult, undoMatchResult } from '../../db/results';
import type { Match, Participant, Player, Tournament } from '../../domain/types';

interface FixturesPanelProps {
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  matches: Match[];
}

function badgeClass(status: Match['status']): string {
  const tone = matchStatusTone(status);
  return tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
}

function MatchEditor({
  match,
  tournament,
  players,
  participants,
  allMatches,
  state,
}: {
  match: Match;
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  allMatches: Match[];
  state: FixtureState;
}) {
  return (
    <ResultEditor
      match={match}
      players={players}
      participants={participants}
      scoring={tournament.settings.scoring}
      busy={state.busy}
      error={state.error}
      downstreamResults={downstreamResultsCount(allMatches, match.id)}
      onSave={(value) => state.onSave(match.id, value)}
      onUndo={() => state.onUndo(match.id)}
      onClear={() => state.onClear(match.id)}
      onCancel={state.onCancel}
    />
  );
}

function Fixture({
  match,
  tournament,
  players,
  participants,
  allMatches,
  state,
}: {
  match: Match;
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  allMatches: Match[];
  state: FixtureState;
}) {
  const aLabel = matchSideLabel(match, 'a', participants, players);
  const bLabel = matchSideLabel(match, 'b', participants, players);
  const score = formatScore(match.games);
  const winnerLabel =
    match.winnerId === null
      ? null
      : match.winnerId === match.aId
        ? aLabel
        : bLabel;
  const editable = canRecordResult(match);
  const editing = state.editingId === match.id;

  return (
    <div className={editing ? 'fixture fixture--editing' : 'fixture'}>
      <div className="fixture__meta">
        <span>{match.roundLabel}</span>
        <span className={badgeClass(match.status)}>{matchStatusLabel(match.status)}</span>
        {match.court ? <span>{match.court}</span> : null}
      </div>
      <div className="fixture__teams">
        <div
          className={
            match.winnerId !== null && match.winnerId === match.aId
              ? 'fixture__side fixture__side--winner'
              : 'fixture__side'
          }
        >
          <span className={aLabel === 'Bye' ? 'fixture__name--bye' : undefined}>
            {aLabel}
          </span>
          {match.winnerId !== null && match.winnerId === match.aId ? (
            <>
              <span aria-hidden="true">✓</span>
              <span className="sr-only">Winner</span>
            </>
          ) : null}
        </div>
        <div
          className={
            match.winnerId !== null && match.winnerId === match.bId
              ? 'fixture__side fixture__side--winner'
              : 'fixture__side'
          }
        >
          <span className={bLabel === 'Bye' ? 'fixture__name--bye' : undefined}>
            {bLabel}
          </span>
          {match.winnerId !== null && match.winnerId === match.bId ? (
            <>
              <span aria-hidden="true">✓</span>
              <span className="sr-only">Winner</span>
            </>
          ) : null}
        </div>
      </div>

      {score || winnerLabel || editable ? (
        <div className="fixture__footer">
          {score ? <span className="fixture__score">{score}</span> : null}
          {score ? null : winnerLabel ? <span>Winner: {winnerLabel}</span> : null}
          {editable ? (
            <Button
              size="sm"
              variant={match.status === 'completed' ? 'ghost' : 'secondary'}
              onClick={() => state.onEdit(match.id)}
              disabled={state.busy && !editing}
            >
              <Icon name={match.status === 'completed' ? 'edit' : 'plus'} size={15} />
              {match.status === 'completed' ? 'Edit result' : 'Record result'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <MatchEditor
          match={match}
          tournament={tournament}
          players={players}
          participants={participants}
          allMatches={allMatches}
          state={state}
        />
      ) : null}
    </div>
  );
}

function MatchList({
  matches,
  tournament,
  players,
  participants,
  allMatches,
  state,
}: {
  matches: Match[];
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  allMatches: Match[];
  state: FixtureState;
}) {
  return (
    <div className="fixture-list">
      {matches
        .slice()
        .sort(compareMatches)
        .map((match) => (
          <Fixture
            key={match.id}
            match={match}
            tournament={tournament}
            players={players}
            participants={participants}
            allMatches={allMatches}
            state={state}
          />
        ))}
    </div>
  );
}

function RoundList({
  title,
  matches,
  tournament,
  players,
  participants,
  allMatches,
  state,
}: {
  title: string;
  matches: Match[];
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  allMatches: Match[];
  state: FixtureState;
}) {
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <div className="field__label">{title}</div>
      <MatchList
        matches={matches}
        tournament={tournament}
        players={players}
        participants={participants}
        allMatches={allMatches}
        state={state}
      />
    </div>
  );
}

function groupByRound(matches: Match[]): Map<string, Match[]> {
  const rounds = new Map<string, Match[]>();
  for (const match of matches.slice().sort(compareMatches)) {
    const list = rounds.get(match.roundLabel) ?? [];
    list.push(match);
    rounds.set(match.roundLabel, list);
  }
  return rounds;
}

export function FixturesPanel({
  tournament,
  players,
  participants,
  matches,
}: FixturesPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (matches.length === 0) {
    return (
      <div className="stack">
        <div>
          <h2 className="section-title">Fixtures</h2>
          <p className="page-sub">
            {tournament.status === 'draft'
              ? 'Generate the draw when the setup is ready.'
              : 'No fixtures have been generated for this tournament.'}
          </p>
        </div>
        <div className="card">
          <EmptyState title="No fixtures yet" icon="bracket">
            {tournament.status === 'draft'
              ? 'Generate the draw to build the match list.'
              : 'Fixtures appear here once the draw is generated.'}
          </EmptyState>
        </div>
      </div>
    );
  }

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditingId(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'That result could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };

  const state: FixtureState = {
    editingId,
    busy,
    error,
    onEdit: (matchId) => {
      setError(null);
      setEditingId(matchId);
    },
    onSave: (matchId, value) =>
      void runAction(() => recordMatchResult(tournament.id, matchId, value)),
    onUndo: (matchId) => void runAction(() => undoMatchResult(tournament.id, matchId)),
    onClear: (matchId) => void runAction(() => clearMatchResult(tournament.id, matchId)),
    onCancel: () => {
      setError(null);
      setEditingId(null);
    },
  };

  const groupMatches = matches.filter((match) => match.stage === 'group');
  const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
  const leagueMatches = matches.filter((match) => match.stage === 'league');
  const editingMatch =
    editingId === null ? null : (matches.find((match) => match.id === editingId) ?? null);
  const bracketDialog =
    editingMatch?.stage === 'knockout' ? (
      <Dialog label="Match result" onClose={state.onCancel}>
        <MatchEditor
          match={editingMatch}
          tournament={tournament}
          players={players}
          participants={participants}
          allMatches={matches}
          state={state}
        />
      </Dialog>
    ) : null;

  if (tournament.settings.format === 'round-robin') {
    return (
      <div className="stack">
        <div>
          <h2 className="section-title">Fixtures</h2>
          <p className="page-sub">
            {plural(leagueMatches.length, 'match', 'matches')} · every pair meets once.
          </p>
        </div>
        {Array.from(groupByRound(leagueMatches)).map(([roundLabel, roundMatches]) => (
          <div className="card card__body" key={roundLabel}>
            <RoundList
              title={roundLabel}
              matches={roundMatches}
              tournament={tournament}
              players={players}
              participants={participants}
              allMatches={matches}
              state={state}
            />
          </div>
        ))}
      </div>
    );
  }

  if (tournament.settings.format === 'single-elimination') {
    return (
      <div className="stack">
        <div>
          <h2 className="section-title">Bracket</h2>
          <p className="page-sub">
            {plural(knockoutMatches.length, 'match', 'matches')} · swipe or scroll sideways to
            follow every round.
          </p>
        </div>
        <div className="card card__body bracket-panel">
          <BracketView
            matches={knockoutMatches}
            players={players}
            participants={participants}
            state={state}
          />
        </div>
        {bracketDialog}
      </div>
    );
  }

  const groupIds = [
    ...new Set(groupMatches.map((match) => match.groupId ?? '')),
  ].sort();

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Fixtures</h2>
        <p className="page-sub">
          Group stage first, then the knockout bracket. Qualifiers fill in automatically.
        </p>
      </div>

      {groupIds.map((groupId) => {
        const roundMap = groupByRound(
          groupMatches.filter((match) => (match.groupId ?? '') === groupId),
        );
        return (
          <div className="card card__body" key={groupId}>
            <div className="section-head" style={{ marginTop: 0 }}>
              <h3 className="section-title">Group {groupId}</h3>
              <span className="badge">
                {plural(
                  groupMatches.filter((match) => (match.groupId ?? '') === groupId).length,
                  'match',
                  'matches',
                )}
              </span>
            </div>
            <div className="stack">
              {Array.from(roundMap).map(([roundLabel, roundMatches]) => (
                <RoundList
                  key={roundLabel}
                  title={roundLabel}
                  matches={roundMatches}
                  tournament={tournament}
                  players={players}
                  participants={participants}
                  allMatches={matches}
                  state={state}
                />
              ))}
            </div>
          </div>
        );
      })}

      {knockoutMatches.length > 0 ? (
        <div className="card card__body bracket-panel">
          <div className="section-head" style={{ marginTop: 0 }}>
            <h3 className="section-title">Knockout bracket</h3>
            <span className="badge">
              {plural(knockoutMatches.length, 'match', 'matches')}
            </span>
          </div>
          <BracketView
            matches={knockoutMatches}
            players={players}
            participants={participants}
            state={state}
          />
        </div>
      ) : null}
      {bracketDialog}
    </div>
  );
}
