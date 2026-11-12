import { useState } from 'react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { EntryEditor } from '../entries/EntryEditor';
import { addEntry, removeEntry, updateEntry } from '../../db/entries';
import { participantLabel, participantPlayerNames } from '../../domain/display';
import { createDraftEntry, entryFromParticipant, playerCount, groupLabels } from '../../domain/setup';
import type { DraftEntry } from '../../domain/setup';
import type { Participant, Player, Tournament } from '../../domain/types';

interface ParticipantsPanelProps {
  tournament: Tournament;
  players: Player[];
  participants: Participant[];
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The entry could not be saved.';
}

export function ParticipantsPanel({
  tournament,
  players,
  participants,
}: ParticipantsPanelProps) {
  const editable = tournament.status === 'draft';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ordered = participants
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const options = groupLabels(tournament.settings.groupCount);
  const showGroups = tournament.settings.format === 'groups-knockout';

  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setDraft(createDraftEntry(tournament.settings.discipline));
    setError(null);
  };

  const startEdit = (participant: Participant) => {
    setAdding(false);
    setEditingId(participant.id);
    setDraft(entryFromParticipant(participant, players));
    setError(null);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setDraft(null);
    setError(null);
  };

  const patchDraft = (patch: Partial<DraftEntry>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);

    try {
      if (editingId) {
        await updateEntry(tournament.id, editingId, {
          playerNames: draft.playerNames,
          teamName: draft.teamName,
          groupId: draft.groupId,
          active: draft.active,
        });
      } else {
        await addEntry(tournament.id, {
          playerNames: draft.playerNames,
          teamName: draft.teamName,
          groupId: draft.groupId,
          active: draft.active,
        });
      }
      cancel();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (participant: Participant) => {
    const label = participantLabel(participant, players);
    const confirmed = window.confirm(
      `Remove "${label}" from this tournament?`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      await removeEntry(tournament.id, participant.id);
    } catch (removeError) {
      setError(messageFor(removeError));
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 className="section-title">Participants</h2>
          <p className="page-sub">
            {editable
              ? 'Add players or teams, then edit a row whenever something changes.'
              : 'The participant list is locked because the draw has been generated.'}
          </p>
        </div>
        {editable && !adding && !editingId ? (
          <Button variant="secondary" onClick={startAdd}>
            <Icon name="plus" size={16} />
            Add entry
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

      {adding || (editingId && draft) ? (
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <EntryEditor
            entry={draft!}
            discipline={tournament.settings.discipline}
            index={editingId ? ordered.findIndex((participant) => participant.id === editingId) : ordered.length}
            total={ordered.length + 1}
            heading={editingId ? 'Edit entry' : 'New entry'}
            groupOptions={showGroups ? options : undefined}
            showActive
            onChange={patchDraft}
          />
          <div className="toolbar">
            <Button variant="primary" onClick={save} disabled={busy}>
              <Icon name="check" size={16} />
              {busy ? 'Saving…' : 'Save entry'}
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No entries yet"
            icon="users"
            actions={
              editable ? (
                <Button variant="primary" onClick={startAdd}>
                  <Icon name="plus" size={18} />
                  Add the first entry
                </Button>
              ) : null
            }
          >
            {playerCount(tournament.settings.discipline) === 2
              ? 'Add a team of two players to start the draw.'
              : 'Add a player to start the draw.'}
          </EmptyState>
        </div>
      ) : (
        <div className="card card__body">
          <div className="list">
            {ordered.map((participant) => {
              const label = participantLabel(participant, players);
              const playerNames = participantPlayerNames(participant, players);
              return (
                <div className="list__row" key={participant.id}>
                  <div className="list__main">
                    <div className="list__title">
                      <span>{label}</span>
                      {participant.seed !== null ? (
                        <span className="badge">Seed {participant.seed}</span>
                      ) : null}
                      {participant.groupId ? (
                        <span className="badge badge--accent">Group {participant.groupId}</span>
                      ) : null}
                      {!participant.active ? (
                        <span className="badge badge--warn">Not playing</span>
                      ) : null}
                    </div>
                    {participant.teamName || playerCount(tournament.settings.discipline) === 2 ? (
                      <div className="list__meta">
                        {participant.teamName
                          ? playerNames.join(' & ')
                          : 'Doubles entry'}
                      </div>
                    ) : null}
                  </div>
                  {editable ? (
                    <div className="list__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => startEdit(participant)}
                        aria-label={`Edit ${label}`}
                        title="Edit entry"
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => remove(participant)}
                        aria-label={`Remove ${label}`}
                        title="Remove entry"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
