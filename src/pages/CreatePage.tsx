import { useEffect, useMemo, useRef, useState } from 'react';
import { EntryEditor } from '../components/entries/EntryEditor';
import { TiebreakerEditor } from '../components/create/TiebreakerEditor';
import { Button, LinkButton } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { createTournament } from '../db/createTournament';
import { requestPersistentStorage } from '../db/storage';
import { entryLabel, groupSizes, resizeEntryNames } from '../domain/setup';
import {
  applyAutoGroups,
  createDraftEntry,
  drawEntryIssues,
  duplicateEntryIssues,
  groupAssignmentIssues,
  groupConfigIssues,
  groupLabels,
  reviewSetup,
  type DraftEntry,
} from '../domain/setup';
import {
  DEFAULT_TIEBREAKERS,
  DISCIPLINE_LABELS,
  FORMAT_LABELS,
  SEEDING_LABELS,
  SPORT_LABELS,
  SPORT_PRESETS,
  TIEBREAKER_LABELS,
} from '../domain/presets';
import { randomSeed } from '../domain/rng';
import type {
  Discipline,
  PointsSettings,
  ScoreMode,
  ScoreSettings,
  SeedingMethod,
  Sport,
  TiebreakerId,
  TournamentFormat,
} from '../domain/types';
import { navigate } from '../router';

const STEPS = [
  { title: 'Basics', detail: 'Name, league, sport, singles or doubles' },
  { title: 'Format', detail: 'Elimination, round robin or groups + knockout' },
  { title: 'Participants', detail: 'Players, doubles teams and seeds' },
  { title: 'Groups & seeds', detail: 'Group sizes, qualifiers and seeding method' },
  { title: 'Review', detail: 'Check everything, then generate fixtures' },
];

const SCORE_MODE_LABELS: Record<ScoreMode, { title: string; text: string }> = {
  'best-of-3': { title: 'Best of three', text: 'First to two games wins the match.' },
  'single-game': { title: 'Single game', text: 'One game decides the match.' },
  'winner-only': { title: 'Winner only', text: 'Record who won without game scores.' },
};

const SEEDING_OPTIONS: Array<{ id: SeedingMethod; title: string; text: string }> = [
  { id: 'random', title: 'Random', text: 'Shuffle with a stored seed so the draw can be repeated.' },
  { id: 'manual', title: 'Manual', text: 'Use the entry order exactly as you arranged it.' },
  { id: 'snake', title: 'Snake', text: 'Use the entry order, then snake across groups.' },
];

interface WizardState {
  name: string;
  leagueName: string;
  sport: Sport;
  discipline: Discipline;
  format: TournamentFormat;
  scoring: ScoreSettings;
  points: PointsSettings;
  tiebreakers: TiebreakerId[];
  seedingMethod: SeedingMethod;
  groupCount: number;
  qualifiersPerGroup: number;
  entries: DraftEntry[];
  rngSeed: number;
}

function initialState(): WizardState {
  const preset = SPORT_PRESETS.badminton;
  return {
    name: '',
    leagueName: '',
    sport: 'badminton',
    discipline: 'singles',
    format: 'single-elimination',
    scoring: { ...preset.scoring },
    points: { ...preset.points },
    tiebreakers: [...DEFAULT_TIEBREAKERS],
    seedingMethod: 'random',
    groupCount: 2,
    qualifiersPerGroup: 2,
    entries: [createDraftEntry('singles')],
    rngSeed: randomSeed(),
  };
}

function activeEntries(entries: DraftEntry[]): DraftEntry[] {
  return entries.filter((entry) => entry.active);
}

function groupsAreSet(state: WizardState): boolean {
  const labels = groupLabels(state.groupCount);
  const active = activeEntries(state.entries);
  return (
    active.length > 0 &&
    active.every((entry) => entry.groupId !== null && labels.includes(entry.groupId))
  );
}

function stepIssues(index: number, state: WizardState): string[] {
  if (index === 0) {
    const issues: string[] = [];
    if (!state.name.trim()) issues.push('Give the tournament a name.');
    if (!state.leagueName.trim()) issues.push('Give the league or club a name.');
    return issues;
  }

  if (index === 1) {
    const issues: string[] = [];
    if (state.scoring.mode !== 'winner-only' && state.scoring.targetPoints <= 0) {
      issues.push('Target points must be greater than zero.');
    }
    if (state.points.win < 0 || state.points.loss < 0) {
      issues.push('Match points cannot be negative.');
    }
    return issues;
  }

  const activeCount = activeEntries(state.entries).length;

  if (index === 2) {
    return drawEntryIssues(state.entries, state.discipline);
  }

  if (index === 3) {
    if (state.format !== 'groups-knockout') return [];
    return [
      ...groupConfigIssues(activeCount, state.groupCount, state.qualifiersPerGroup),
      ...groupAssignmentIssues(state.entries, state.groupCount, state.qualifiersPerGroup),
    ];
  }

  const issues = drawEntryIssues(state.entries, state.discipline);
  if (state.format === 'groups-knockout') {
    issues.push(
      ...groupConfigIssues(activeCount, state.groupCount, state.qualifiersPerGroup),
      ...groupAssignmentIssues(state.entries, state.groupCount, state.qualifiersPerGroup),
    );
  }
  return issues;
}

function errorMessage(error: unknown): string[] {
  if (error instanceof Error && error.message) return [error.message];
  return ['Something went wrong while saving. Try again.'];
}

export function CreatePage() {
  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const active = activeEntries(state.entries);
  const completeEntries = state.entries.filter((entry) =>
    entry.playerNames.every((name) => name.trim().length > 0),
  );
  const incompleteCount = state.entries.length - completeEntries.length;
  const hasProgress =
    step > 0 ||
    state.name.trim().length > 0 ||
    state.leagueName.trim().length > 0 ||
    state.entries.some((entry) => entry.playerNames.some((name) => name.trim().length > 0));

  useEffect(() => {
    if (!hasProgress) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasProgress]);

  useEffect(() => {
    if (errors.length === 0) return;
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    errorRef.current?.focus({ preventScroll: true });
  }, [errors]);

  const review = useMemo(
    () =>
      reviewSetup(
        {
          format: state.format,
          participantCount: active.length,
          groupCount: state.groupCount,
          qualifiersPerGroup: state.qualifiersPerGroup,
        },
        state.entries,
      ),
    [state.format, state.groupCount, state.qualifiersPerGroup, state.entries, active.length],
  );

  const update = (patch: Partial<WizardState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  const changeSport = (sport: Sport) => {
    const preset = SPORT_PRESETS[sport];
    update({ sport, scoring: { ...preset.scoring }, points: { ...preset.points } });
  };

  const changeDiscipline = (discipline: Discipline) => {
    setState((current) => ({
      ...current,
      discipline,
      entries: current.entries.map((entry) => resizeEntryNames(entry, discipline)),
    }));
  };

  const changeFormat = (format: TournamentFormat) => {
    setState((current) => {
      if (format === 'groups-knockout') {
        const count = Math.max(
          1,
          Math.min(current.groupCount, Math.max(1, activeEntries(current.entries).length)),
        );
        return {
          ...current,
          format,
          groupCount: count,
          entries: applyAutoGroups(
            current.entries,
            current.seedingMethod,
            current.rngSeed,
            count,
          ),
        };
      }

      return {
        ...current,
        format,
        entries: current.entries.map((entry) => ({ ...entry, groupId: null })),
      };
    });
  };

  const changeGroupCount = (raw: number) => {
    const count = Math.max(1, Math.min(64, Math.floor(raw) || 1));
    setState((current) => ({
      ...current,
      groupCount: count,
      entries:
        activeEntries(current.entries).length >= count
          ? applyAutoGroups(current.entries, current.seedingMethod, current.rngSeed, count)
          : current.entries,
    }));
  };

  const changeSeeding = (method: SeedingMethod) => {
    setState((current) => ({
      ...current,
      seedingMethod: method,
      entries:
        current.format === 'groups-knockout'
          ? applyAutoGroups(current.entries, method, current.rngSeed, current.groupCount)
          : current.entries,
    }));
  };

  const changeEntry = (key: string, patch: Partial<DraftEntry>) => {
    setState((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.key === key ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const addEntry = () => {
    setState((current) => ({
      ...current,
      entries: [...current.entries, createDraftEntry(current.discipline)],
    }));
  };

  const removeEntry = (key: string) => {
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.key !== key),
    }));
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    setState((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.entries.length) return current;
      const entries = current.entries.slice();
      const [entry] = entries.splice(index, 1);
      if (!entry) return current;
      entries.splice(target, 0, entry);
      return { ...current, entries };
    });
  };

  const autoBalance = () => {
    setState((current) => ({
      ...current,
      entries: applyAutoGroups(
        current.entries,
        current.seedingMethod,
        current.rngSeed,
        current.groupCount,
      ),
    }));
  };

  const goNext = () => {
    const issues = stepIssues(step, state);
    if (issues.length > 0) {
      setErrors(issues);
      return;
    }
    setErrors([]);

    if (step === 2 && state.format === 'groups-knockout' && !groupsAreSet(state)) {
      setState((current) => ({
        ...current,
        entries: applyAutoGroups(
          current.entries,
          current.seedingMethod,
          current.rngSeed,
          current.groupCount,
        ),
      }));
    }

    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const goBack = () => {
    setErrors([]);
    setStep((current) => Math.max(0, current - 1));
  };

  const save = async (generate: boolean) => {
    if (
      incompleteCount > 0 &&
      !window.confirm(
        `${incompleteCount} unfinished ${
          incompleteCount === 1 ? 'entry will' : 'entries will'
        } not be saved. Save the rest anyway?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setErrors([]);

    try {
      const result = await createTournament({
        name: state.name,
        leagueName: state.leagueName,
        sport: state.sport,
        discipline: state.discipline,
        format: state.format,
        seedingMethod: state.seedingMethod,
        groupCount: state.groupCount,
        qualifiersPerGroup: state.qualifiersPerGroup,
        scoring: state.scoring,
        points: state.points,
        tiebreakers: state.tiebreakers,
        entries: state.entries,
        generate,
        rngSeed: state.rngSeed,
      });

      await requestPersistentStorage().catch(() => undefined);
      navigate(`/t/${result.id}`);
    } catch (error) {
      setErrors(errorMessage(error));
      setBusy(false);
    }
  };

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
          <h1 className="page-title">New tournament</h1>
          <p className="page-sub">
            Five short steps, a review screen, then the fixtures are generated for you. You can save
            a draft at any point.
          </p>
        </div>
        <span className="badge badge--accent">
          {active.length} {active.length === 1 ? 'entry' : 'entries'}
        </span>
      </header>

      <ol className="steps">
        {STEPS.map((item, index) => (
          <li
            className="steps__item"
            key={item.title}
            data-active={index === step}
            aria-current={index === step ? 'step' : undefined}
          >
            <span className="steps__num">{index + 1}</span>
            {item.title}
          </li>
        ))}
      </ol>

      {errors.length > 0 ? (
        <div className="notice notice--danger" role="alert" ref={errorRef} tabIndex={-1}>
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">
              {errors.length === 1 ? 'One thing to fix' : `${errors.length} things to fix`}
            </div>
            <ul className="notice__list">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="card card--pad" style={{ marginTop: 'var(--s3)' }}>
        {step === 0 ? (
          <BasicsStep state={state} update={update} changeSport={changeSport} changeDiscipline={changeDiscipline} />
        ) : null}
        {step === 1 ? (
          <FormatStep state={state} update={update} changeFormat={changeFormat} />
        ) : null}
        {step === 2 ? (
          <ParticipantsStep
            state={state}
            changeEntry={changeEntry}
            addEntry={addEntry}
            removeEntry={removeEntry}
            moveEntry={moveEntry}
          />
        ) : null}
        {step === 3 ? (
          <GroupsStep
            state={state}
            issues={stepIssues(3, state)}
            update={update}
            changeGroupCount={changeGroupCount}
            changeSeeding={changeSeeding}
            changeEntry={changeEntry}
            moveEntry={moveEntry}
            autoBalance={autoBalance}
          />
        ) : null}
        {step === 4 ? (
          <ReviewStep
            state={state}
            issues={stepIssues(4, state)}
            completeCount={completeEntries.length}
            review={review}
          />
        ) : null}

        <div className="wizard-footer">
          <div className="toolbar">
            {step === 0 ? (
              <LinkButton to="/" variant="ghost">
                Cancel
              </LinkButton>
            ) : (
              <Button variant="ghost" onClick={goBack} disabled={busy}>
                <Icon name="arrowLeft" size={16} />
                Back
              </Button>
            )}
          </div>

          <div className="wizard-footer__actions">
            <Button
              variant="secondary"
              onClick={() => save(false)}
              disabled={busy}
              title="Save what you have and finish the setup later"
            >
              <Icon name="download" size={16} />
              {busy ? 'Saving…' : 'Save draft'}
            </Button>

            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={goNext} disabled={busy}>
                Next
                <Icon name="chevronRight" size={16} />
              </Button>
            ) : (
              <Button variant="primary" onClick={() => save(true)} disabled={busy}>
                <Icon name="play" size={16} />
                {busy ? 'Working…' : 'Create & generate draw'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Basics                                                     */
/* ------------------------------------------------------------------ */

interface BasicsStepProps {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  changeSport: (sport: Sport) => void;
  changeDiscipline: (discipline: Discipline) => void;
}

function BasicsStep({ state, update, changeSport, changeDiscipline }: BasicsStepProps) {
  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Basics</h2>
        <p className="page-sub">This is what players and the dashboard will see.</p>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Tournament name</span>
          <input
            className="input"
            value={state.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="e.g. Saturday Singles Cup"
          />
        </label>
        <label className="field">
          <span className="field__label">League or club</span>
          <input
            className="input"
            value={state.leagueName}
            onChange={(event) => update({ leagueName: event.target.value })}
            placeholder="e.g. Riverside Badminton Club"
          />
        </label>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Sport
        </div>
        <div className="choice-grid">
          {(['badminton', 'pickleball'] as Sport[]).map((sport) => (
            <button
              key={sport}
              type="button"
              className="choice"
              data-selected={state.sport === sport}
              aria-pressed={state.sport === sport}
              onClick={() => changeSport(sport)}
            >
              <span className="choice__title">{SPORT_LABELS[sport]}</span>
              <span className="choice__text">
                {sport === 'badminton'
                  ? 'Best of three to 21 by default.'
                  : 'Best of three to 11 by default.'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Discipline
        </div>
        <div className="choice-grid">
          {(['singles', 'doubles'] as Discipline[]).map((discipline) => (
            <button
              key={discipline}
              type="button"
              className="choice"
              data-selected={state.discipline === discipline}
              aria-pressed={state.discipline === discipline}
              onClick={() => changeDiscipline(discipline)}
            >
              <span className="choice__title">{DISCIPLINE_LABELS[discipline]}</span>
              <span className="choice__text">
                {discipline === 'singles'
                  ? 'One player per entry.'
                  : 'Two players per team.'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Format                                                     */
/* ------------------------------------------------------------------ */

interface FormatStepProps {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  changeFormat: (format: TournamentFormat) => void;
}

function FormatStep({ state, update, changeFormat }: FormatStepProps) {
  const setScoring = (patch: Partial<ScoreSettings>) => {
    update({ scoring: { ...state.scoring, ...patch } });
  };
  const setPoints = (patch: Partial<PointsSettings>) => {
    update({ points: { ...state.points, ...patch } });
  };

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Format</h2>
        <p className="page-sub">Choose how the winner is decided and how results are scored.</p>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Draw format
        </div>
        <div className="choice-grid">
          {(
            [
              ['single-elimination', 'Lose once and you are out. Byes fill odd counts.'],
              ['round-robin', 'Everyone plays everyone. The table decides the winner.'],
              ['groups-knockout', 'Group round robin, then qualifiers enter a knockout bracket.'],
            ] as Array<[TournamentFormat, string]>
          ).map(([format, text]) => (
            <button
              key={format}
              type="button"
              className="choice"
              data-selected={state.format === format}
              aria-pressed={state.format === format}
              onClick={() => {
                if (state.format === format) return;
                changeFormat(format);
              }}
            >
              <span className="choice__title">{FORMAT_LABELS[format]}</span>
              <span className="choice__text">{text}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Match scoring
        </div>
        <div className="choice-grid">
          {(Object.keys(SCORE_MODE_LABELS) as ScoreMode[]).map((mode) => {
            const label = SCORE_MODE_LABELS[mode];
            return (
              <button
                key={mode}
                type="button"
                className="choice"
                data-selected={state.scoring.mode === mode}
                aria-pressed={state.scoring.mode === mode}
                onClick={() => setScoring({ mode })}
              >
                <span className="choice__title">{label.title}</span>
                <span className="choice__text">{label.text}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-grid">
        {state.scoring.mode !== 'winner-only' ? (
          <label className="field">
            <span className="field__label">Target points per game</span>
            <input
              className="input input--short"
              type="number"
              min={1}
              max={99}
              value={state.scoring.targetPoints}
              onChange={(event) =>
                setScoring({ targetPoints: Number(event.target.value) || 0 })
              }
            />
            <span className="field__hint">
              {state.sport === 'badminton' ? '21 is standard for badminton.' : '11 is standard for pickleball.'}
            </span>
          </label>
        ) : null}

        <label className="field">
          <span className="field__label">Points for a win</span>
          <input
            className="input input--short"
            type="number"
            min={0}
            value={state.points.win}
            onChange={(event) => setPoints({ win: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="field">
          <span className="field__label">Points for a loss</span>
          <input
            className="input input--short"
            type="number"
            min={0}
            value={state.points.loss}
            onChange={(event) => setPoints({ loss: Number(event.target.value) || 0 })}
          />
        </label>
      </div>

      <div>
        <div className="field__label">Tie-breakers</div>
        <p className="field__hint" style={{ marginBottom: 'var(--s2)' }}>
          Applied in order. The first rule that separates two entries decides their rank.
        </p>
        <TiebreakerEditor
          value={state.tiebreakers}
          onChange={(tiebreakers) => update({ tiebreakers })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Participants                                               */
/* ------------------------------------------------------------------ */

interface ParticipantsStepProps {
  state: WizardState;
  changeEntry: (key: string, patch: Partial<DraftEntry>) => void;
  addEntry: () => void;
  removeEntry: (key: string) => void;
  moveEntry: (index: number, direction: -1 | 1) => void;
}

function ParticipantsStep({
  state,
  changeEntry,
  addEntry,
  removeEntry,
  moveEntry,
}: ParticipantsStepProps) {
  const activeCount = activeEntries(state.entries).length;
  const issues = duplicateEntryIssues(state.entries, state.discipline);
  const incomplete = state.entries.filter(
    (entry) => !entry.playerNames.every((name) => name.trim().length > 0),
  ).length;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 className="section-title">Participants</h2>
          <p className="page-sub">
            {state.discipline === 'doubles'
              ? 'Each entry is a team of two players. The same player can only enter once.'
              : 'Each entry is one player. The same player can only enter once.'}
          </p>
        </div>
        <Button variant="secondary" onClick={addEntry}>
          <Icon name="plus" size={16} />
          Add entry
        </Button>
      </div>

      <div className="row" style={{ gap: 'var(--s2)' }}>
        <span className="tag">{activeCount} active</span>
        <span className="tag">{state.entries.length} total</span>
        <span className="tag">Minimum 2 to generate</span>
      </div>

      {issues.length > 0 ? (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">Fix these before continuing</div>
            <ul className="notice__list">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {incomplete > 0 ? (
        <div className="notice notice--info">
          <span className="notice__icon">
            <Icon name="info" size={18} />
          </span>
          <div className="notice__body">
            {incomplete} unfinished {incomplete === 1 ? 'entry is' : 'entries are'} ignored when
            you save a draft. Complete the names to keep them.
          </div>
        </div>
      ) : null}

      {state.entries.length === 0 ? (
        <div className="notice notice--warn">
          <span className="notice__icon">
            <Icon name="info" size={18} />
          </span>
          <div className="notice__body">
            No entries yet. Add at least two, or save the draft and come back later.
          </div>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 'var(--s2)' }}>
        {state.entries.map((entry, index) => (
          <EntryEditor
            key={entry.key}
            entry={entry}
            discipline={state.discipline}
            index={index}
            total={state.entries.length}
            showSeed
            onChange={(patch) => changeEntry(entry.key, patch)}
            onRemove={state.entries.length > 0 ? () => removeEntry(entry.key) : undefined}
            onMoveUp={() => moveEntry(index, -1)}
            onMoveDown={() => moveEntry(index, 1)}
          />
        ))}
      </div>

      <Button variant="secondary" onClick={addEntry}>
        <Icon name="plus" size={16} />
        Add another {state.discipline === 'doubles' ? 'team' : 'player'}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Groups & seeds                                             */
/* ------------------------------------------------------------------ */

interface GroupsStepProps {
  state: WizardState;
  issues: string[];
  update: (patch: Partial<WizardState>) => void;
  changeGroupCount: (raw: number) => void;
  changeSeeding: (method: SeedingMethod) => void;
  changeEntry: (key: string, patch: Partial<DraftEntry>) => void;
  moveEntry: (index: number, direction: -1 | 1) => void;
  autoBalance: () => void;
}

function GroupsStep({
  state,
  issues,
  update,
  changeGroupCount,
  changeSeeding,
  changeEntry,
  moveEntry,
  autoBalance,
}: GroupsStepProps) {
  const active = activeEntries(state.entries);
  const labels = groupLabels(state.groupCount);
  const unassigned = active.filter(
    (entry) => entry.groupId === null || !labels.includes(entry.groupId),
  );
  const sizes = groupSizes(state.entries, state.groupCount);

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Groups &amp; seeds</h2>
        <p className="page-sub">
          Seeds come from the order on the previous step. Adjust groups here before anything is
          generated.
        </p>
      </div>

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Seeding method
        </div>
        <div className="choice-grid">
          {SEEDING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="choice"
              data-selected={state.seedingMethod === option.id}
              aria-pressed={state.seedingMethod === option.id}
              onClick={() => changeSeeding(option.id)}
            >
              <span className="choice__title">{option.title}</span>
              <span className="choice__text">{option.text}</span>
            </button>
          ))}
        </div>
      </div>

      {state.format === 'groups-knockout' ? (
        <>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Number of groups</span>
              <input
                className="input input--short"
                type="number"
                min={1}
                max={Math.max(1, active.length)}
                value={state.groupCount}
                onChange={(event) => changeGroupCount(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span className="field__label">Qualifiers per group</span>
              <input
                className="input input--short"
                type="number"
                min={1}
                max={64}
                value={state.qualifiersPerGroup}
                onChange={(event) =>
                  update({ qualifiersPerGroup: Math.max(1, Number(event.target.value) || 1) })
                }
              />
              <span className="field__hint">
                {state.groupCount * state.qualifiersPerGroup} entries enter the knockout stage.
              </span>
            </label>
          </div>

          {issues.length > 0 ? (
            <div className="notice notice--danger" role="alert">
              <span className="notice__icon">
                <Icon name="warning" size={18} />
              </span>
              <div className="notice__body">
                <div className="notice__title">Group setup needs attention</div>
                <ul className="notice__list">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              {sizes.map((group) => (
                <span className="tag" key={group.groupId}>
                  Group {group.groupId}: {group.size}
                </span>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={autoBalance}>
              <Icon name="refresh" size={15} />
              Auto-balance
            </Button>
          </div>

          <div className="group-grid">
            {labels.map((groupId) => {
              const members = active.filter((entry) => entry.groupId === groupId);
              return (
                <div className="group-card" key={groupId}>
                  <div className="group-card__head">
                    <span className="group-card__title">Group {groupId}</span>
                    <span className="tag">{members.length}</span>
                  </div>
                  {members.length === 0 ? (
                    <div className="group-card__empty">No entries yet.</div>
                  ) : (
                    <ul className="group-card__list">
                      {members.map((entry) => (
                        <li className="group-card__item" key={entry.key}>
                          <span className="group-card__name">{entryLabel(entry)}</span>
                          <select
                            className="group-card__select"
                            value={entry.groupId ?? ''}
                            aria-label={`Move ${entryLabel(entry)} to another group`}
                            onChange={(event) =>
                              changeEntry(entry.key, { groupId: event.target.value || null })
                            }
                          >
                            {labels.map((label) => (
                              <option key={label} value={label}>
                                Group {label}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {unassigned.length > 0 ? (
            <div className="notice notice--warn">
              <span className="notice__icon">
                <Icon name="warning" size={18} />
              </span>
              <div className="notice__body">
                <div className="notice__title">{unassigned.length} unassigned</div>
                {unassigned.map((entry) => entryLabel(entry)).join(', ')}. Use Auto-balance or move
                them into a group.
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="notice notice--info">
            <span className="notice__icon">
              <Icon name="info" size={18} />
            </span>
            <div className="notice__body">
              {state.seedingMethod === 'random'
                ? 'The entry order is not used for a random draw. A stored seed makes the shuffle repeatable.'
                : state.seedingMethod === 'manual'
                  ? 'Seed 1 is the strongest entry. The list order is the exact seeding order.'
                  : 'The list order is used, then entries are distributed serpentine across the draw.'}
            </div>
          </div>

          <div className="seed-list">
            {state.entries.map((entry, index) => (
              <div className="seed-row" key={entry.key}>
                <span className="seed-row__num">{index + 1}</span>
                <span className="seed-row__name">{entryLabel(entry)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveEntry(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${entryLabel(entry)} up`}
                >
                  <Icon name="arrowUp" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveEntry(index, 1)}
                  disabled={index === state.entries.length - 1}
                  aria-label={`Move ${entryLabel(entry)} down`}
                >
                  <Icon name="arrowDown" size={15} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 — Review                                                     */
/* ------------------------------------------------------------------ */

interface ReviewStepProps {
  state: WizardState;
  issues: string[];
  completeCount: number;
  review: ReturnType<typeof reviewSetup>;
}

function ReviewStep({ state, issues, completeCount, review }: ReviewStepProps) {
  const labels = groupLabels(state.groupCount);
  const participants = activeEntries(state.entries);

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Review</h2>
        <p className="page-sub">
          Check the setup. Generating the draw locks the participant list and creates every fixture.
        </p>
      </div>

      <div className="summary-grid">
        <SummaryItem label="Tournament" value={state.name.trim() || 'Not named'} />
        <SummaryItem label="League" value={state.leagueName.trim() || 'Not named'} />
        <SummaryItem
          label="Sport & discipline"
          value={`${SPORT_LABELS[state.sport]} · ${DISCIPLINE_LABELS[state.discipline]}`}
        />
        <SummaryItem label="Format" value={FORMAT_LABELS[state.format]} />
        <SummaryItem
          label="Scoring"
          value={
            state.scoring.mode === 'winner-only'
              ? 'Winner only'
              : `${SCORE_MODE_LABELS[state.scoring.mode].title} to ${state.scoring.targetPoints}`
          }
        />
        <SummaryItem
          label="Match points"
          value={`Win ${state.points.win} · Loss ${state.points.loss}`}
        />
        <SummaryItem label="Seeding" value={SEEDING_LABELS[state.seedingMethod]} />
        <SummaryItem
          label="Entries"
          value={`${participants.length} active · ${completeCount} complete`}
        />
        {state.format === 'groups-knockout' ? (
          <SummaryItem
            label="Groups"
            value={`${state.groupCount} groups · top ${state.qualifiersPerGroup} advance`}
          />
        ) : null}
        {review.knockoutSize !== null ? (
          <SummaryItem label="Bracket size" value={`${review.knockoutSize} places`} />
        ) : null}
        {review.matchCount !== null ? (
          <SummaryItem label="Fixtures" value={`${review.matchCount} matches`} />
        ) : null}
      </div>

      {state.format === 'groups-knockout' ? (
        <div>
          <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
            Group assignments
          </div>
          <div className="group-grid">
            {labels.map((groupId) => {
              const members = participants.filter((entry) => entry.groupId === groupId);
              return (
                <div className="group-card" key={groupId}>
                  <div className="group-card__head">
                    <span className="group-card__title">Group {groupId}</span>
                    <span className="tag">{members.length}</span>
                  </div>
                  <ul className="group-card__list">
                    {members.length === 0 ? (
                      <li className="group-card__empty">No entries.</li>
                    ) : (
                      members.map((entry) => (
                        <li className="group-card__item" key={entry.key}>
                          <span className="group-card__name">{entryLabel(entry)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className="field__label" style={{ marginBottom: 'var(--s2)' }}>
          Tie-breakers
        </div>
        {state.tiebreakers.length === 0 ? (
          <p className="field__hint">None selected. Seed order is the final fallback.</p>
        ) : (
          <div className="tag-list">
            {state.tiebreakers.map((rule, index) => (
              <span className="tag" key={rule}>
                {index + 1}. {TIEBREAKER_LABELS[rule]}
              </span>
            ))}
          </div>
        )}
      </div>

      {issues.length > 0 ? (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">The draw cannot be generated yet</div>
            <ul className="notice__list">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="notice notice--info">
          <span className="notice__icon">
            <Icon name="check" size={18} />
          </span>
          <div className="notice__body">
            Everything checks out. Generating the draw will create the fixtures and mark the
            tournament as in progress.
          </div>
        </div>
      )}

      {review.warnings.length > 0 ? (
        <div className="notice notice--warn">
          <span className="notice__icon">
            <Icon name="warning" size={18} />
          </span>
          <div className="notice__body">
            <div className="notice__title">Worth knowing</div>
            <ul className="notice__list">
              {review.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {state.discipline === 'doubles' ? (
        <p className="field__hint">
          Doubles entries use both player names, plus an optional team name for the scoreboard.
        </p>
      ) : null}
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
