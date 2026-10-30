import { describe, expect, it } from 'vitest';
import { LoginThrottle, loginKey } from '../src/server/login-throttle.js';

describe('LoginThrottle', () => {
  it('lets ten failures through and blocks the eleventh', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 10; i += 1) {
      expect(t.remaining('1.2.3.4')).toBe(10 - i);
      t.recordFailure('1.2.3.4');
    }
    expect(t.remaining('1.2.3.4')).toBe(0);
  });

  it('keeps buckets per key', () => {
    const t = new LoginThrottle({ limit: 2 });
    t.recordFailure('a');
    t.recordFailure('a');
    expect(t.remaining('a')).toBe(0);
    expect(t.remaining('b')).toBe(2);
  });

  it('releases the budget once the window passes', () => {
    let now = 1_000_000;
    const t = new LoginThrottle({ limit: 1, windowMs: 60_000, now: () => now });
    t.recordFailure('a');
    expect(t.remaining('a')).toBe(0);
    now += 60_000;
    expect(t.remaining('a')).toBe(1);
  });
});

describe('loginKey', () => {
  it('prefers the server-observed address over any forwarded header', () => {
    expect(loginKey('10.0.0.9', '1.1.1.1, 2.2.2.2')).toBe('10.0.0.9');
  });

  it('falls back to the proxy-appended hop, not a caller-supplied leading one', () => {
    expect(loginKey(undefined, '198.51.100.7, 203.0.113.5')).toBe('203.0.113.5');
  });

  it('collapses to a shared bucket when nothing is observable', () => {
    expect(loginKey(undefined, null)).toBe('unknown');
    expect(loginKey('', '  ')).toBe('unknown');
  });
});
