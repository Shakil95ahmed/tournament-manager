import { Icon } from '../ui/Icon';
import { TIEBREAKER_LABELS } from '../../domain/presets';
import type { TiebreakerId } from '../../domain/types';

const ALL_RULES: TiebreakerId[] = [
  'points',
  'wins',
  'gameDifference',
  'pointDifference',
  'headToHead',
  'seed',
];

interface TiebreakerEditorProps {
  value: TiebreakerId[];
  onChange: (next: TiebreakerId[]) => void;
}

export function TiebreakerEditor({ value, onChange }: TiebreakerEditorProps) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(next);
  };

  const missing = ALL_RULES.filter((rule) => !value.includes(rule));

  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      {value.length === 0 ? (
        <p className="field__hint">
          No tie-breakers selected. Seed order will still separate identical records.
        </p>
      ) : (
        <div className="rule-list">
          {value.map((rule, index) => (
            <div className="rule-row" key={rule}>
              <span className="seed-row__num">{index + 1}</span>
              <span className="rule-row__name">{TIEBREAKER_LABELS[rule]}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${TIEBREAKER_LABELS[rule]} up`}
              >
                <Icon name="arrowUp" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => move(index, 1)}
                disabled={index === value.length - 1}
                aria-label={`Move ${TIEBREAKER_LABELS[rule]} down`}
              >
                <Icon name="arrowDown" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => onChange(value.filter((item) => item !== rule))}
                aria-label={`Remove ${TIEBREAKER_LABELS[rule]}`}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {missing.length > 0 ? (
        <div className="toolbar">
          {missing.map((rule) => (
            <button
              key={rule}
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => onChange([...value, rule])}
            >
              <Icon name="plus" size={14} />
              {TIEBREAKER_LABELS[rule]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
