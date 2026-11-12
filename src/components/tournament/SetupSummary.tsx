import {
  SCORE_MODE_LABELS,
  SEEDING_LABELS,
  TIEBREAKER_LABELS,
} from '../../domain/presets';
import { formatDateTime, plural, tournamentFormatLine } from '../../domain/display';
import type { Match, Participant, Tournament } from '../../domain/types';

interface SetupSummaryProps {
  tournament: Tournament;
  participants: Participant[];
  matches: Match[];
}

export function SetupSummary({ tournament, participants, matches }: SetupSummaryProps) {
  const active = participants.filter((participant) => participant.active);
  const settings = tournament.settings;

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <div className="summary-grid">
        <SummaryItem label="Format" value={tournamentFormatLine(settings)} />
        <SummaryItem
          label="Entries"
          value={`${active.length} active${participants.length !== active.length ? ` · ${participants.length} total` : ''}`}
        />
        {settings.format === 'groups-knockout' ? (
          <SummaryItem
            label="Groups"
            value={`${settings.groupCount} groups · top ${settings.qualifiersPerGroup} advance`}
          />
        ) : null}
        <SummaryItem label="Seeding" value={SEEDING_LABELS[settings.seedingMethod]} />
        <SummaryItem
          label="Scoring"
          value={
            settings.scoring.mode === 'winner-only'
              ? 'Winner only'
              : `${SCORE_MODE_LABELS[settings.scoring.mode]} to ${settings.scoring.targetPoints}`
          }
        />
        <SummaryItem
          label="Match points"
          value={`Win ${settings.points.win} · Loss ${settings.points.loss}`}
        />
        {settings.format !== 'round-robin' && active.length >= 2 ? (
          <SummaryItem label="Bracket size" value={`${settings.knockoutSize} places`} />
        ) : null}
        <SummaryItem label="Fixtures" value={plural(matches.length, 'match', 'matches')} />
        <SummaryItem label="Created" value={formatDateTime(tournament.createdAt)} />
        {tournament.startedAt ? (
          <SummaryItem label="Started" value={formatDateTime(tournament.startedAt)} />
        ) : null}
        <SummaryItem label="Last saved" value={formatDateTime(tournament.lastSavedAt)} />
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Tie-breakers
        </div>
        {settings.tiebreakers.length === 0 ? (
          <p className="field__hint">None selected. Seed order is the final fallback.</p>
        ) : (
          <div className="tag-list">
            {settings.tiebreakers.map((rule, index) => (
              <span className="tag" key={rule}>
                {index + 1}. {TIEBREAKER_LABELS[rule]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <div className="summary-item__label">{label}</div>
      <div className="summary-item__value">{value}</div>
    </div>
  );
}
