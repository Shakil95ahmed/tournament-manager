import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { autoAssignGroups, setEntryGroup } from '../../db/entries';
import { participantLabel } from '../../domain/display';
import { groupLabels } from '../../domain/setup';
import type { Participant, Player, Tournament } from '../../domain/types';

interface GroupsPanelProps {
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The group change could not be saved.';
}

export function GroupsPanel({ tournament, players, participants }: GroupsPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = tournament.status === 'draft';
  const labels = groupLabels(tournament.settings.groupCount);
  const active = participants
    .filter((participant) => participant.active)
    .sort(
      (a, b) =>
        (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
  const unassigned = active.filter(
    (participant) =>
      participant.groupId === null || !labels.includes(participant.groupId),
  );

  const move = async (participant: Participant, groupId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await setEntryGroup(tournament.id, participant.id, groupId);
    } catch (moveError) {
      setError(messageFor(moveError));
    } finally {
      setBusy(false);
    }
  };

  const balance = async () => {
    setBusy(true);
    setError(null);
    try {
      await autoAssignGroups(tournament.id);
    } catch (balanceError) {
      setError(messageFor(balanceError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 className="section-title">Groups</h2>
          <p className="page-sub">
            {editable
              ? 'Move entries between groups before generating the draw. The top entries in each group advance.'
              : 'Group assignments are locked because the draw has been generated.'}
          </p>
        </div>
        {editable && active.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={balance} disabled={busy}>
            <Icon name="refresh" size={15} />
            Auto-balance
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">{error}</div>
        </div>
      ) : null}

      {active.length === 0 ? (
        <div className="notice notice--warn">
          <span className="notice__icon">
            <Icon name="info" size={18} />
          </span>
          <div className="notice__body">
            Add at least two active entries before creating groups.
          </div>
        </div>
      ) : (
        <div className="group-grid">
          {labels.map((groupId) => {
            const members = active.filter(
              (participant) => participant.groupId === groupId,
            );
            return (
              <div className="group-card" key={groupId}>
                <div className="group-card__head">
                  <span className="group-card__title">Group {groupId}</span>
                  <span className="tag">
                    {members.length} · top {tournament.settings.qualifiersPerGroup}
                  </span>
                </div>
                {members.length === 0 ? (
                  <div className="group-card__empty">No entries assigned.</div>
                ) : (
                  <ul className="group-card__list">
                    {members.map((participant) => (
                      <li className="group-card__item" key={participant.id}>
                        <span className="group-card__name">
                          {participantLabel(participant, players)}
                        </span>
                        {editable ? (
                          <select
                            className="group-card__select"
                            value={participant.groupId ?? ''}
                            aria-label={`Move ${participantLabel(participant, players)} to another group`}
                            disabled={busy}
                            onChange={(event) =>
                              move(participant, event.target.value || null)
                            }
                          >
                            {labels.map((label) => (
                              <option key={label} value={label}>
                                Group {label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {unassigned.length > 0 ? (
            <div className="group-card">
              <div className="group-card__head">
                <span className="group-card__title">Unassigned</span>
                <span className="tag">{unassigned.length}</span>
              </div>
              <ul className="group-card__list">
                {unassigned.map((participant) => (
                  <li className="group-card__item" key={participant.id}>
                    <span className="group-card__name">
                      {participantLabel(participant, players)}
                    </span>
                    {editable ? (
                      <select
                        className="group-card__select"
                        value=""
                        aria-label={`Assign ${participantLabel(participant, players)} to a group`}
                        disabled={busy}
                        onChange={(event) =>
                          move(participant, event.target.value || null)
                        }
                      >
                        <option value="">Choose…</option>
                        {labels.map((label) => (
                          <option key={label} value={label}>
                            Group {label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
