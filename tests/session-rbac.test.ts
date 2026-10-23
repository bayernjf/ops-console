import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  parseSessionCookie,
  verifySessionToken,
} from '../src/server/session.js';
import { canApprove, canChangeThresholds } from '../src/server/rbac.js';

const SECRET = 'unit-test-secret';

describe('HMAC signed session cookie', () => {
  it('issues and verifies a round trip', () => {
    const token = createSessionToken({ username: 'owner', role: 'owner' }, SECRET);
    const payload = verifySessionToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.username).toBe('owner');
    expect(payload?.role).toBe('owner');
  });

  it('rejects a tampered signature', () => {
    const token = createSessionToken({ username: 'owner', role: 'owner' }, SECRET);
    const [body, sig] = token.split('.');
    const forged = `${body}.${sig}x`;
    expect(verifySessionToken(forged, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken({ username: 'operator', role: 'operator' }, SECRET);
    expect(verifySessionToken(token, 'other-secret')).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = createSessionToken({ username: 'owner', role: 'owner' }, SECRET, now);
    expect(verifySessionToken(token, SECRET, now + 1000)).not.toBeNull();
    expect(verifySessionToken(token, SECRET, now + 1000 * 60 * 60 * 12 + 1)).toBeNull();
  });

  it('parses the cookie value out of a Cookie header', () => {
    expect(parseSessionCookie(`other=1; ops_session=ABC.DEF; Path=/`)).toBe('ABC.DEF');
    expect(parseSessionCookie(null)).toBeNull();
    expect(parseSessionCookie('other=1')).toBeNull();
  });
});

describe('minimal RBAC matrix', () => {
  it('owner approves every grade', () => {
    for (const grade of ['D1', 'D2', 'D3'] as const) {
      expect(canApprove('owner', grade)).toBe(true);
    }
  });

  it('operator approves D1/D2 but never D3', () => {
    expect(canApprove('operator', 'D1')).toBe(true);
    expect(canApprove('operator', 'D2')).toBe(true);
    expect(canApprove('operator', 'D3')).toBe(false);
  });

  it('only owner can change thresholds', () => {
    expect(canChangeThresholds('owner')).toBe(true);
    expect(canChangeThresholds('operator')).toBe(false);
  });
});
