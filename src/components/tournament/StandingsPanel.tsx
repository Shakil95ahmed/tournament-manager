import { participantLabel } from '../../domain/display';
import { computeGroupStandings, computeStandings, type StandingRow } from '../../domain/standings';
import type { Match, Participant, Player, Tournament } from '../../domain/types';

interface StandingsPanelProps {
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
  matches: Match[];
}

export function StandingsPanel({
  tournament,
  players,
  participants,
  matches,
}: StandingsPanelProps) {
  const settings = tournament.settings;
  const activeParticipants = participants.filter((participant) => participant.active);

  if (settings.format === 'single-elimination') return null;

  const completed =
    matches.length > 0 &&
    matches
      .filter((match) => (settings.format === 'round-robin' ? match.stage === 'league' : true))
      .every((match) => match.status === 'completed' || match.status === 'bye');

  if (settings.format === 'round-robin') {
    const league = matches.filter((match) => match.stage === 'league');
    const rows = computeStandings({
      participants: activeParticipants,
      matches: league,
      points: settings.points,
      tiebreakers: settings.tiebreakers,
    });

    return (
      <div className="stack">
        <div>
          <h2 className="section-title">Standings</h2>
          <p className="page-sub">
            {league.length === 0
              ? 'The table fills in as league results are recorded.'
              : `${league.filter((match) => match.status === 'completed').length} of ${league.length} league matches played.`}
          </p>
        </div>
        <div className="card standings-card">
          <StandingsTable
            rows={rows}
            players={players}
            participants={participants}
            qualifiers={0}
            championId={completed ? (rows[0]?.participantId ?? null) : null}
            label="League standings"
          />
        </div>
      </div>
    );
  }

  const groupStandings = computeGroupStandings({
    participants: activeParticipants,
    matches,
    settings: { points: settings.points, tiebreakers: settings.tiebreakers },
  });

  if (groupStandings.size === 0) return null;

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Standings</h2>
        <p className="page-sub">
          Group tables update automatically. The top {settings.qualifiersPerGroup}{' '}
          {settings.qualifiersPerGroup === 1 ? 'entry advances' : 'entries advance'} from each
          group.
        </p>
      </div>
      <div className="standings-groups">
        {Array.from(groupStandings.entries()).map(([groupId, rows]) => (
          <div className="card standings-card" key={groupId}>
            <div className="section-head" style={{ marginTop: 0 }}>
              <h3 className="section-title">Group {groupId}</h3>
              <span className="badge">
                {settings.qualifiersPerGroup === 1
                  ? 'Top 1 advances'
                  : `Top ${settings.qualifiersPerGroup} advance`}
              </span>
            </div>
            <StandingsTable
              rows={rows}
              players={players}
              participants={participants}
              qualifiers={settings.qualifiersPerGroup}
              championId={null}
              label={`Group ${groupId} standings`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingsTable({
  rows,
  players,
  participants,
  qualifiers,
  championId,
  label,
}: {
  rows: StandingRow[];
  players: Player[];
  participants: Participant[];
  /** Highlight the top N rows as group qualifiers. Zero means no highlighting. */
  qualifiers: number;
  championId: string | null;
  label: string;
}) {
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  return (
    <div
      className="table-wrap"
      role="region"
      aria-label={`${label}. Scroll sideways to see all columns.`}
      tabIndex={0}
    >
      <table className="table standings-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Entry</th>
            <th className="num">P</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">Pts</th>
            <th className="num standings-table__optional">
              Games
            </th>
            <th className="num standings-table__optional">
              +/−
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const participant = participantById.get(row.participantId);
            const label = participant ? participantLabel(participant, players) : 'Unknown entry';
            const isQualifier = qualifiers > 0 && row.rank <= qualifiers;
            const isChampion = championId === row.participantId;
            const rowClass = [
              isQualifier ? 'standings-row--qualified' : '',
              isChampion ? 'standings-row--champion' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr key={row.participantId} className={rowClass || undefined}>
                <td className="num">{row.rank}</td>
                <td>
                  <span className="standings-table__name">
                    {label}
                    {isQualifier ? (
                      <span className="badge badge--accent standings-table__q">Q</span>
                    ) : null}
                    {isChampion ? (
                      <span className="badge badge--success standings-table__q">Champion</span>
                    ) : null}
                  </span>
                </td>
                <td className="num">{row.played}</td>
                <td className="num">{row.wins}</td>
                <td className="num">{row.losses}</td>
                <td className="num">{row.points}</td>
                <td className="num standings-table__optional">
                  {row.gameWins}–{row.gameLosses}
                </td>
                <td className="num standings-table__optional">
                  {row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
