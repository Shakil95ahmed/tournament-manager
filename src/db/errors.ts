export type DuplicateEntity = 'player' | 'participant';

export class DuplicateNameError extends Error {
  readonly entity: DuplicateEntity;
  readonly value: string;

  constructor(entity: DuplicateEntity, value: string) {
    super(
      entity === 'player'
        ? `"${value}" is already in this tournament.`
        : 'That player or team is already in this tournament.',
    );
    this.name = 'DuplicateNameError';
    this.entity = entity;
    this.value = value;
  }
}

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? 'The data is not valid.');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'That record could not be found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorName(error: unknown): string {
  if (isRecord(error) && 'name' in error) return String(error.name);
  return '';
}

/**
 * Dexie wraps errors thrown inside a transaction in a DexieError whose `inner`
 * holds the original. Unwrap so callers always see our own error classes.
 */
function unwrap(error: unknown, depth = 0): unknown {
  if (depth > 5) return error;
  if (isRecord(error) && 'inner' in error && error.inner !== error) {
    return unwrap(error.inner, depth + 1);
  }
  return error;
}

function bulkHasConstraintFailure(error: unknown): boolean {
  if (!isRecord(error) || !Array.isArray(error.failures)) return false;
  return error.failures.some((failure) => errorName(failure) === 'ConstraintError');
}

/**
 * Converts any storage failure into a typed, human-readable error. All service
 * writes pass through this so the UI never has to inspect Dexie internals.
 */
export function translateError(error: unknown): Error {
  const raw = unwrap(error);

  if (
    raw instanceof DuplicateNameError ||
    raw instanceof ValidationError ||
    raw instanceof NotFoundError
  ) {
    return raw;
  }

  if (errorName(raw) === 'ConstraintError' || bulkHasConstraintFailure(error)) {
    return new DuplicateNameError('participant', 'duplicate');
  }

  if (raw instanceof Error) return raw;
  return new Error(describeStorageError(raw));
}

/**
 * Turns low-level IndexedDB/Dexie failures into something an organizer can act
 * on. Every write in the app funnels through this.
 */
export function describeStorageError(error: unknown): string {
  const raw = unwrap(error);
  const name = errorName(raw);

  switch (name) {
    case 'QuotaExceededError':
      return 'This browser is out of storage space. Export a backup, then delete an old tournament and try again.';
    case 'ConstraintError':
      return 'That name is already used in this tournament. Choose a different one.';
    case 'VersionError':
      return 'This browser holds data from a newer version of the app. Reload the page to update.';
    case 'InvalidStateError':
    case 'DatabaseClosedError':
      return 'The local database is not available. Close other tabs of this app and reload the page.';
    case 'UnknownError':
      return 'The browser blocked local storage, which often happens in private browsing. Use a normal window to keep your tournaments.';
    default:
      break;
  }

  if (raw instanceof ValidationError) return raw.message;
  if (raw instanceof DuplicateNameError) return raw.message;
  if (raw instanceof NotFoundError) return raw.message;
  if (raw instanceof Error && raw.message) return raw.message;

  return 'Something went wrong while saving to this browser.';
}
