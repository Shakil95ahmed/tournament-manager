import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/router';

describe('parseHash', () => {
  it('treats an empty hash as the dashboard', () => {
    expect(parseHash('')).toEqual({ name: 'dashboard' });
    expect(parseHash('#')).toEqual({ name: 'dashboard' });
    expect(parseHash('#/')).toEqual({ name: 'dashboard' });
  });

  it('parses the create route', () => {
    expect(parseHash('#/create')).toEqual({ name: 'create' });
  });

  it('parses the data route', () => {
    expect(parseHash('#/data')).toEqual({ name: 'data' });
    expect(parseHash('#/data?tab=storage')).toEqual({ name: 'data' });
  });

  it('parses a tournament route', () => {
    expect(parseHash('#/t/abc-123')).toEqual({ name: 'tournament', id: 'abc-123' });
  });

  it('decodes ids and ignores a query string', () => {
    expect(parseHash('#/t/team%20a')).toEqual({ name: 'tournament', id: 'team a' });
    expect(parseHash('#/t/abc?tab=matches')).toEqual({ name: 'tournament', id: 'abc' });
  });

  it('falls back to not found for unknown or incomplete paths', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'notFound', path: '/nope' });
    expect(parseHash('#/t')).toEqual({ name: 'notFound', path: '/t' });
    expect(parseHash('#/t/a/b')).toEqual({ name: 'notFound', path: '/t/a/b' });
    expect(parseHash('#/display/abc')).toEqual({ name: 'notFound', path: '/display/abc' });
  });

  it('keeps a malformed percent escape instead of throwing', () => {
    expect(parseHash('#/t/100%')).toEqual({ name: 'tournament', id: '100%' });
  });
});
