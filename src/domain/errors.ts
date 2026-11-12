export class EngineError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? 'The draw cannot be generated.');
    this.name = 'EngineError';
    this.issues = issues;
  }
}
