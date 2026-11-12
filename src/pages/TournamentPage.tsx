import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { FixturesPanel } from '../components/tournament/FixturesPanel';
import { GroupsPanel } from '../components/tournament/GroupsPanel';
import { ParticipantsPanel } from '../components/tournament/ParticipantsPanel';
import { SetupSummary } from '../components/tournament/SetupSummary';
import { StandingsPanel } from '../components/tournament/StandingsPanel';
import { generateTournamentDraw } from '../db/draw';
import { getTournamentBundle } from '../db/services';
import { requestPersistentStorage } from '../db/storage';
import {
  formatDateTime,
  participantLabel,
  plural,
  statusLabel,
  statusTone,
} from '../domain/display';
import { findChampion } from '../domain/results';

interface TournamentPageProps {
  id: string;
}

function badgeClass(tone: 'neutral' | 'accent' | 'success'): string {
  return tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
}

export function TournamentPage({ id }: TournamentPageProps) {
  const bundle = useLiveQuery(() => getTournamentBundle(id), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (bundle === undefined) {
    return (
      <div className="page">
        <div className="card card--pad">
          <p className="muted">Loading tournament…</p>
        </div>
      </div>
    );
  }

  if (bundle === null) {
    return (
      <div className="page">
        <div style={{ marginBottom: 'var(--s4)' }}>
          <LinkButton to="/" variant="ghost">
            <Icon name="arrowLeft" size={16} />
            Back to tournaments
          </LinkButton>
        </div>
        <div className="card">
          <EmptyState
            title="Tournament not found"
            icon="warning"
            titleLevel={1}
            actions={<LinkButton to="/">Back to dashboard</LinkButton>}
          >
            This tournament may have been deleted, or the link belongs to another device.
          </EmptyState>
        </div>
      </div>
    );
  }

  const { tournament, players, participants, matches } = bundle;
  const active = participants.filter((participant) => participant.active);
  const isDraft = tournament.status === 'draft';
  const canGenerate = isDraft && active.length >= 2;

  const championId = findChampion({
    matches,
    participants: active,
    settings: {
      format: tournament.settings.format,
      points: tournament.settings.points,
      tiebreakers: tournament.settings.tiebreakers,
    },
  });
  const champion =
    championId === null
      ? null
      : (participants.find((participant) => participant.id === championId) ?? null);

  const generate = async () => {
    const confirmed = window.confirm(
      'Generate the draw now? The participant list and group assignments will be locked.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    setWarnings([]);

    try {
      const result = await generateTournamentDraw(tournament.id);
      await requestPersistentStorage().catch(() => undefined);
      setMessage(`Draw generated with ${plural(result.matchCount, 'match', 'matches')}.`);
      setWarnings(result.warnings);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : 'The draw could not be generated.',
      );
    } finally {
      setBusy(false);
    }
  };

  const setupSummary = (
    <SetupSummary tournament={tournament} participants={participants} matches={matches} />
  );

  const entryPanels = (
    <>
      <ParticipantsPanel
        tournament={tournament}
        players={players}
        participants={participants}
      />
      {tournament.settings.format === 'groups-knockout' ? (
        <GroupsPanel
          tournament={tournament}
          players={players}
          participants={participants}
        />
      ) : null}
    </>
  );

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--s4)' }}>
        <LinkButton to="/" variant="ghost">
          <Icon name="arrowLeft" size={16} />
          Back to tournaments
        </LinkButton>
      </div>

      <header className="page-head">
        <div>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <h1 className="page-title">{tournament.name}</h1>
            <span className={badgeClass(statusTone(tournament.status))}>
              {statusLabel(tournament.status)}
            </span>
          </div>
          <p className="page-sub">{tournament.leagueName}</p>
        </div>
        <div className="toolbar">
          {isDraft ? (
            <Button
              variant="primary"
              onClick={generate}
              disabled={busy || !canGenerate}
              title={
                canGenerate
                  ? 'Create every fixture from the current setup'
                  : 'Add at least two active entries first'
              }
            >
              <Icon name="play" size={16} />
              {busy ? 'Generating…' : 'Generate draw'}
            </Button>
          ) : (
            <span className="badge badge--accent">
              {plural(active.length, 'entry', 'entries')}
            </span>
          )}
        </div>
      </header>

      {error ? (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 'var(--s3)' }}>
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">The draw could not be generated</div>
            {error}
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="notice notice--info" style={{ marginBottom: 'var(--s3)' }}>
          <span className="notice__icon">
            <Icon name="check" size={18} />
          </span>
          <div className="notice__body">{message}</div>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="notice notice--warn" style={{ marginBottom: 'var(--s3)' }}>
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">Worth knowing</div>
            <ul className="notice__list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {champion ? (
        <div className="champion-banner" role="status">
          <div className="champion-banner__icon">
            <Icon name="trophy" size={28} />
          </div>
          <div className="champion-banner__body">
            <div className="champion-banner__eyebrow">Tournament champion</div>
            <div className="champion-banner__name">{participantLabel(champion, players)}</div>
            <div className="champion-banner__meta">
              {tournament.completedAt
                ? `Completed ${formatDateTime(tournament.completedAt)}`
                : 'All matches are complete.'}
            </div>
          </div>
        </div>
      ) : null}

      {isDraft ? (
        <>
          <div className="notice notice--info" style={{ marginBottom: 'var(--s3)' }}>
            <span className="notice__icon">
              <Icon name="info" size={18} />
            </span>
            <div className="notice__body">
              <div className="notice__title">This is a draft</div>
              Edit the entries and groups below, then generate the draw. Changes are saved as you
              go.
            </div>
          </div>

          <div className="card card--pad">{setupSummary}</div>

          <div className="section-head">
            <h2 className="section-title">Manage</h2>
          </div>

          <div className="stack" style={{ gap: 'var(--s5)' }}>
            {entryPanels}

            <FixturesPanel
              tournament={tournament}
              players={players}
              participants={participants}
              matches={matches}
            />
          </div>
        </>
      ) : (
        <>
          <StandingsPanel
            tournament={tournament}
            players={players}
            participants={participants}
            matches={matches}
          />

          <FixturesPanel
            tournament={tournament}
            players={players}
            participants={participants}
            matches={matches}
          />

          <details className="card card--pad setup-details">
            <summary className="setup-details__summary">Tournament setup and entries</summary>
            <div className="setup-details__body stack" style={{ gap: 'var(--s5)' }}>
              {setupSummary}
              {entryPanels}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
