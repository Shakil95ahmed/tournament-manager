import type { ResultEditorValue } from './ResultEditor';
import type { Match } from '../../domain/types';

/** Shared result-editing state, used by fixture lists and the bracket view. */
export interface FixtureState {
  editingId: string | null;
  busy: boolean;
  error: string | null;
  onEdit: (matchId: string) => void;
  onSave: (matchId: string, value: ResultEditorValue) => void;
  onUndo: (matchId: string) => void;
  onClear: (matchId: string) => void;
  onCancel: () => void;
}

export function canRecordResult(match: Match): boolean {
  return (
    match.status !== 'bye' &&
    match.aId !== null &&
    match.bId !== null &&
    match.status !== 'pending'
  );
}
