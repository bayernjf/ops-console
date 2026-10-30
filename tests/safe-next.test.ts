import { describe, expect, it } from 'vitest';
import { safeNextOr } from '../src/lib/safe-next.js';

/**
 * OC-3 regression: the login page must never redirect off-origin via the
 * `next` query parameter.
 */
describe('safeNextOr', () => {
  const FALLBACK = '/app/approvals';

  it('accepts same-origin relative paths', () => {
    expect(safeNextOr('/app/approvals', FALLBACK)).toBe('/app/approvals');
    expect(safeNextOr('/app/refunds/', FALLBACK)).toBe('/app/refunds/');
    expect(safeNextOr('/app/settings?tab=notify', FALLBACK)).toBe('/app/settings?tab=notify');
  });

  it('accepts the root path', () => {
    expect(safeNextOr('/', FALLBACK)).toBe('/');
  });

  it('falls back when next is missing or empty', () => {
    expect(safeNextOr(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr('', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects absolute URLs to other origins', () => {
    expect(safeNextOr('https://evil.example/grab', FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr('http://evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects protocol-relative and backslash forms', () => {
    expect(safeNextOr('//evil.example/grab', FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr('/\\evil.example/grab', FALLBACK)).toBe(FALLBACK);
    expect(safeNextOr('/\\\\evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('keeps deep relative-looking paths that start with a slash only when safe', () => {
    // "/..//evil" stays on-origin as a path; only the "//" and "/\" prefixes
    // are scheme-relative traps.
    expect(safeNextOr('/..//app', FALLBACK)).toBe('/..//app');
  });
});
