import type { ChangeEvent } from 'react';
import { Icon } from '../ui/Icon';
import { playerCount, type DraftEntry } from '../../domain/setup';
import type { Discipline } from '../../domain/types';

interface EntryEditorProps {
  entry: DraftEntry;
  discipline: Discipline;
  index: number;
  total: number;
  heading?: string;
  groupOptions?: string[];
  showActive?: boolean;
  showSeed?: boolean;
  onChange: (patch: Partial<DraftEntry>) => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function EntryEditor({
  entry,
  discipline,
  index,
  total,
  heading,
  groupOptions,
  showActive = false,
  showSeed = false,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: EntryEditorProps) {
  const names = Array.from({ length: playerCount(discipline) }, (_, position) => position);

  const changeName = (position: number, value: string) => {
    const next = entry.playerNames.slice();
    next[position] = value;
    onChange({ playerNames: next });
  };

  const changeGroup = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange({ groupId: event.target.value || null });
  };

  return (
    <div className="entry-editor">
      <div className="entry-editor__head">
        <span className="entry-editor__title">{heading ?? `Entry ${index + 1}`}</span>
        {showSeed ? <span className="entry-editor__seed">Seed {index + 1}</span> : null}
        <div className="toolbar">
          {onMoveUp ? (
            <button
              type="button"
              className="icon-btn"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label={`Move ${heading ?? `entry ${index + 1}`} up`}
              title="Move up"
            >
              <Icon name="arrowUp" size={16} />
            </button>
          ) : null}
          {onMoveDown ? (
            <button
              type="button"
              className="icon-btn"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label={`Move ${heading ?? `entry ${index + 1}`} down`}
              title="Move down"
            >
              <Icon name="arrowDown" size={16} />
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={onRemove}
              aria-label={`Remove ${heading ?? `entry ${index + 1}`}`}
              title="Remove"
            >
              <Icon name="trash" size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="entry-editor__names">
        {names.map((position) => (
          <label className="field" key={position}>
            <span className="field__label">
              {discipline === 'singles' ? 'Player' : `Player ${position + 1}`}
            </span>
            <input
              className="input"
              value={entry.playerNames[position] ?? ''}
              onChange={(event) => changeName(position, event.target.value)}
              placeholder={position === 0 ? 'Full name' : 'Partner name'}
              autoComplete="off"
            />
          </label>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Team name (optional)</span>
          <input
            className="input"
            value={entry.teamName}
            onChange={(event) => onChange({ teamName: event.target.value })}
            placeholder={discipline === 'doubles' ? 'e.g. Shuttle Stars' : 'e.g. Club nickname'}
            autoComplete="off"
          />
          <span className="field__hint">Shown instead of the player names when filled in.</span>
        </label>

        {groupOptions && groupOptions.length > 0 ? (
          <label className="field">
            <span className="field__label">Group</span>
            <select className="select" value={entry.groupId ?? ''} onChange={changeGroup}>
              <option value="">Not assigned</option>
              {groupOptions.map((groupId) => (
                <option key={groupId} value={groupId}>
                  Group {groupId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {showActive ? (
        <label className="check">
          <input
            type="checkbox"
            checked={entry.active}
            onChange={(event) => onChange({ active: event.target.checked })}
          />
          Playing in this draw
        </label>
      ) : null}
    </div>
  );
}
