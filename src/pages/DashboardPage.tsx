import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { LinkButton } from '../components/ui/Button';
import { db } from '../db/db';
import { deleteTournament, listTournaments } from '../db/services';
import {
  formatDateTime,
  plural,
  statusLabel,
  statusTone,
  tournamentFormatLine,
} from '../domain/display';
import type { Match, Participant, Tournament } from '../domain/types';

interface StatProps {
  label: string;
  value: number | string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}

function badgeClass(status: Tournament['status']): string {
  const tone = statusTone(status);
  return tone === 'neutral' ? 'badge' : `badge badge--${tone}`;
}

function TournamentCard({
  tournament,
  participants,
  matches,
  onDelete,
}: {
  tournament: Tournament;
  participants: Participant[];
  matches: Match[];
  onDelete: (tournament: Tournament) => void;
}) {
  const activeEntries = participants.filter(
    (participant) =>
      participant.tournamentId === tournament.id && participant.active,
  ).length;
  const tournamentMatches = matches.filter((match) => match.tournamentId === tournament.id);
  const played = tournamentMatches.filter((match) => match.status === 'completed').length;

  return (
    <article className="tournament-card">
      <div className="tournament-card__head">
        <div>
          <h3 className="tournament-card__title">
            <a href={`#/t/${tournament.id}`}>{tournament.name}</a>
          </h3>
          <div className="tournament-card__league">{tournament.leagueName}</div>
        </div>
        <span className={badgeClass(tournament.status)}>{statusLabel(tournament.status)}</span>
      </div>

      <div className="tournament-card__meta">
        <span>{tournamentFormatLine(tournament.settings)}</span>
        <span>{plural(activeEntries, 'entry', 'entries')}</span>
        {tournament.status !== 'draft' ? (
          <span>
            {plural(played, 'result')} of {plural(tournamentMatches.length, 'match', 'matches')}
          </span>
        ) : null}
      </div>

      <div className="tournament-card__foot">
        <span className="small muted">
          <Icon name="calendar" size={13} /> {formatDateTime(tournament.lastSavedAt)}
        </span>
        <div className="toolbar">
          <LinkButton to={`/t/${tournament.id}`} variant="secondary" size="sm">
            Open
          </LinkButton>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={() => onDelete(tournament)}
            aria-label={`Delete ${tournament.name}`}
            title="Delete tournament"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">
          {title} <span className="muted small">({count})</span>
        </h2>
      </div>
      {count === 0 ? <div className="card">{empty}</div> : children}
    </section>
  );
}

export function DashboardPage() {
  const data = useLiveQuery(async () => {
    const [tournaments, participants, matches] = await Promise.all([
      listTournaments(),
      db.participants.toArray(),
      db.matches.toArray(),
    ]);
    return { tournaments, participants, matches };
  }, []);

  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (tournament: Tournament) => {
    const confirmed = window.confirm(
      `Delete "${tournament.name}" and all of its entries, fixtures and results? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await deleteTournament(tournament.id);
      setError(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'The tournament could not be deleted.',
      );
    }
  };

  if (!data) {
    return (
      <div className="page">
        <div className="card card--pad">
          <p className="muted">Loading your tournaments…</p>
        </div>
      </div>
    );
  }

  const { tournaments, participants, matches } = data;
  const active = tournaments.filter((tournament) => tournament.status === 'active');
  const drafts = tournaments.filter((tournament) => tournament.status === 'draft');
  const completed = tournaments.filter((tournament) => tournament.status === 'completed');
  const played = matches.filter((match) => match.status === 'completed').length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-sub">
            Create a draw, record results and let the standings update themselves. Everything is
            saved automatically in this browser.
          </p>
        </div>
        <div className="toolbar">
          <LinkButton to="/data" variant="secondary">
            <Icon name="database" size={17} />
            Data &amp; backups
          </LinkButton>
          <LinkButton to="/create" variant="primary">
            <Icon name="plus" size={18} />
            New tournament
          </LinkButton>
        </div>
      </header>

      {error ? (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 'var(--s3)' }}>
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">Could not delete the tournament</div>
            {error}
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <Stat label="In progress" value={active.length} />
        <Stat label="Drafts" value={drafts.length} />
        <Stat label="Completed" value={completed.length} />
        <Stat label="Matches played" value={played} />
      </div>

      {tournaments.length === 0 ? (
        <div className="card" style={{ marginTop: 'var(--s3)' }}>
          <EmptyState
            title="No tournaments yet"
            icon="trophy"
            titleLevel={2}
            actions={
              <LinkButton to="/create" variant="primary">
                <Icon name="plus" size={18} />
                Create your first tournament
              </LinkButton>
            }
          >
            Set up the draw here, then record results at the side of the court. Your data stays on
            this device.
          </EmptyState>
        </div>
      ) : (
        <>
          <Section
            title="In progress"
            count={active.length}
            empty={
              <EmptyState title="Nothing running right now" icon="play">
                Generate a draft to start recording results.
              </EmptyState>
            }
          >
            <div className="tournament-grid">
              {active.map((tournament) => (
                <TournamentCard
                  key={tournament.id}
                  tournament={tournament}
                  participants={participants}
                  matches={matches}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </Section>

          <Section
            title="Drafts"
            count={drafts.length}
            empty={
              <EmptyState title="No drafts waiting" icon="edit">
                Save a setup as a draft when you need to finish it later.
              </EmptyState>
            }
          >
            <div className="tournament-grid">
              {drafts.map((tournament) => (
                <TournamentCard
                  key={tournament.id}
                  tournament={tournament}
                  participants={participants}
                  matches={matches}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </Section>

          <Section
            title="Completed"
            count={completed.length}
            empty={
              <EmptyState title="Nothing completed yet" icon="bracket">
                Finished tournaments are kept here with their final standings, bracket and champion.
              </EmptyState>
            }
          >
            <div className="tournament-grid">
              {completed.map((tournament) => (
                <TournamentCard
                  key={tournament.id}
                  tournament={tournament}
                  participants={participants}
                  matches={matches}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
