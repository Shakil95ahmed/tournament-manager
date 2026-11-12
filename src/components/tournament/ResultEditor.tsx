import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { matchSideLabel } from '../../domain/display';
import { maxGamesForMode } from '../../domain/results';
import type {
  GameScore,
  Match,
  Participant,
  Player,
  ScoreSettings,
} from '../../domain/types';

export interface ResultEditorValue {
  winnerId: string;
  games: GameScore[];
  court: string | null;
}

interface ResultEditorProps {
  match: Match;
  players: Player[];
  participants: Participant[];
  scoring: ScoreSettings;
  busy: boolean;
  error: string | null;
  /** Later bracket matches that already hold a result and would be cleared. */
  downstreamResults: number;
  onSave: (value: ResultEditorValue) => void;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
}

interface GameDraft {
  a: string;
  b: string;
}

function initialGames(match: Match, limit: number): GameDraft[] {
  return Array.from({ length: limit }, (_, index) => {
    const game = match.games[index];
    return {
      a: game ? String(game.a) : '',
      b: game ? String(game.b) : '',
    };
  });
}

function parseGames(drafts: GameDraft[]): { games: GameScore[]; issues: string[] } {
  const games: GameScore[] = [];
  const issues: string[] = [];

  drafts.forEach((draft, index) => {
    const a = draft.a.trim();
    const b = draft.b.trim();
    if (!a && !b) return;

    if (!a || !b) {
      issues.push(`Game ${index + 1}: enter both scores, or leave the whole game blank.`);
      return;
    }

    const aScore = Number(a);
    const bScore = Number(b);
    if (!Number.isInteger(aScore) || !Number.isInteger(bScore) || aScore < 0 || bScore < 0) {
      issues.push(`Game ${index + 1}: scores must be whole numbers of zero or more.`);
      return;
    }
    if (aScore === bScore) {
      issues.push(`Game ${index + 1}: a game cannot end in a tie.`);
      return;
    }

    games.push({ a: aScore, b: bScore });
  });

  return { games, issues };
}

export function ResultEditor({
  match,
  players,
  participants,
  scoring,
  busy,
  error,
  downstreamResults,
  onSave,
  onUndo,
  onClear,
  onCancel,
}: ResultEditorProps) {
  const limit = maxGamesForMode(scoring.mode);
  const [winnerId, setWinnerId] = useState<string | null>(match.winnerId);
  const [games, setGames] = useState<GameDraft[]>(() => initialGames(match, limit));
  const [court, setCourt] = useState(match.court ?? '');
  const [issues, setIssues] = useState<string[]>([]);

  const aLabel = matchSideLabel(match, 'a', participants, players);
  const bLabel = matchSideLabel(match, 'b', participants, players);
  const hasResult = match.status === 'completed' || match.history.length > 0;
  const downstreamLabel = `${downstreamResults} later ${
    downstreamResults === 1 ? 'result' : 'results'
  }`;

  /** Warn before an edit that clears results further down the bracket. */
  const confirmDownstream = (message: string, changesWinner: boolean): boolean => {
    if (!changesWinner || downstreamResults === 0) return true;
    return window.confirm(message);
  };

  const setGame = (index: number, side: 'a' | 'b', value: string) => {
    setGames((current) =>
      current.map((game, position) =>
        position === index ? { ...game, [side]: value } : game,
      ),
    );
  };

  const save = () => {
    const found: string[] = [];
    if (!winnerId) found.push('Choose the winning side.');

    const parsed = parseGames(games);
    found.push(...parsed.issues);

    if (winnerId && parsed.games.length > 0) {
      const winnerWins =
        winnerId === match.aId
          ? parsed.games.filter((game) => game.a > game.b).length
          : parsed.games.filter((game) => game.b > game.a).length;
      const loserWins = parsed.games.length - winnerWins;
      if (winnerWins <= loserWins) {
        found.push('The game scores must show the selected winner winning more games.');
      }
    }

    if (found.length > 0) {
      setIssues(found);
      return;
    }

    setIssues([]);
    if (
      !confirmDownstream(
        `Changing the winner will clear ${downstreamLabel} in the bracket. Save anyway?`,
        winnerId !== match.winnerId,
      )
    ) {
      return;
    }
    onSave({
      winnerId: winnerId!,
      games: parsed.games,
      court: court.trim() || null,
    });
  };

  const undo = () => {
    const previous = match.history[match.history.length - 1];
    const changesWinner =
      match.history.length > 0
        ? previous?.winnerId !== match.winnerId
        : match.winnerId !== null;
    if (
      !confirmDownstream(
        `Undoing this change will clear ${downstreamLabel} in the bracket. Continue?`,
        changesWinner,
      )
    ) {
      return;
    }
    onUndo();
  };

  const clear = () => {
    if (
      !confirmDownstream(
        `Clearing this result will also clear ${downstreamLabel} in the bracket. Continue?`,
        match.winnerId !== null,
      )
    ) {
      return;
    }
    onClear();
  };

  return (
    <div className="result-editor">
      <div className="result-editor__head">
        <div className="result-editor__heading">
          <div className="field__label">
            {match.status === 'completed' ? 'Correct result' : 'Record result'}
          </div>
          <div className="result-editor__match">
            {aLabel} <span className="muted">vs</span> {bLabel}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onCancel}
          aria-label="Close result editor"
          title="Close"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Winner
        </div>
        <div className="choice-grid">
          {(
            [
              ['a', match.aId, aLabel],
              ['b', match.bId, bLabel],
            ] as const
          ).map(([, id, label]) =>
            id ? (
              <button
                key={id}
                type="button"
                className="choice"
                data-selected={winnerId === id}
                aria-pressed={winnerId === id}
                onClick={() => setWinnerId(id)}
              >
                <span className="choice__title">{label}</span>
                <span className="choice__text">
                  {winnerId === id ? 'Selected winner' : 'Set as winner'}
                </span>
              </button>
            ) : null,
          )}
        </div>
      </div>

      {limit === 0 ? (
        <p className="field__hint">
          This event records the winner only, so game scores are not used.
        </p>
      ) : (
        <div>
          <div className="field__label">Game scores</div>
          <p className="field__hint" style={{ marginBottom: 'var(--s2)' }}>
            Optional. Leave a game blank when it was not played.
            {limit === 3 ? ' Best of three can hold up to three games.' : ''} Target{' '}
            {scoring.targetPoints} points.
          </p>
          <div className="score-grid">
            <span className="score-grid__label" />
            <span className="score-grid__head">A</span>
            <span className="score-grid__head">B</span>
            {games.map((game, index) => (
              <div className="score-grid__row" key={index}>
                <span className="score-grid__label">Game {index + 1}</span>
                <input
                  className="input score-grid__input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={game.a}
                  onChange={(event) => setGame(index, 'a', event.target.value)}
                  aria-label={`Game ${index + 1}, ${aLabel} score`}
                />
                <input
                  className="input score-grid__input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={game.b}
                  onChange={(event) => setGame(index, 'b', event.target.value)}
                  aria-label={`Game ${index + 1}, ${bLabel} score`}
                />
              </div>
            ))}
          </div>
          <p className="field__hint" style={{ marginTop: 'var(--s2)' }}>
            A = {aLabel} · B = {bLabel}
          </p>
        </div>
      )}

      <label className="field">
        <span className="field__label">Court (optional)</span>
        <input
          className="input"
          value={court}
          onChange={(event) => setCourt(event.target.value)}
          placeholder="e.g. Court 2"
          autoComplete="off"
        />
      </label>

      {issues.length > 0 || error ? (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <ul className="notice__list" style={{ margin: 0 }}>
              {[...issues, ...(error ? [error] : [])].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="result-editor__actions">
        <Button variant="primary" onClick={save} disabled={busy}>
          <Icon name="check" size={16} />
          {busy
            ? 'Saving…'
            : match.status === 'completed'
              ? 'Save correction'
              : 'Save result'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {hasResult ? (
          <Button variant="secondary" onClick={undo} disabled={busy}>
            <Icon name="refresh" size={15} />
            Undo last change
          </Button>
        ) : null}
        {match.status === 'completed' ? (
          <Button variant="danger" onClick={clear} disabled={busy}>
            <Icon name="trash" size={15} />
            Clear result
          </Button>
        ) : null}
      </div>
    </div>
  );
}
