import { describe, expect, it } from 'vitest';
import { POST } from '../src/pages/api/auth/login.js';

type Ctx = Parameters<typeof POST>[0];

function ctxFor(
  clientAddress: string | undefined,
  password: string,
  forwardedFor?: string,
): Ctx {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (forwardedFor !== undefined) headers.set('x-forwarded-for', forwardedFor);
  return {
    request: new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'owner', password }),
    }),
    cookies: { set: () => {} },
    clientAddress,
  } as unknown as Ctx;
}

const WRONG = 'definitely-wrong';
const RIGHT = 'vitest-owner-password';

describe('POST /api/auth/login brute-force guard', () => {
  it('answers 401 for a wrong password', async () => {
    const res = await POST(ctxFor('203.0.113.10', WRONG));
    expect(res.status).toBe(401);
  });

  it('answers 200 for the right password and does not consume the budget', async () => {
    for (let i = 0; i < 9; i += 1) {
      await POST(ctxFor('203.0.113.20', WRONG));
    }
    const ok = await POST(ctxFor('203.0.113.20', RIGHT));
    expect(ok.status).toBe(200);
  });

  it('locks a peer out after ten failures, even with correct credentials', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(ctxFor('203.0.113.30', WRONG));
      expect(res.status).toBe(401);
    }
    const locked = await POST(ctxFor('203.0.113.30', RIGHT));
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { error: { code: string; retryable: boolean } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
  });

  it('does not let a rotating spoofed X-Forwarded-For buy a fresh bucket', async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(ctxFor('203.0.113.40', WRONG, `198.51.100.${i}, 203.0.113.40`));
    }
    const locked = await POST(ctxFor('203.0.113.40', RIGHT, '198.51.100.99, 203.0.113.40'));
    expect(locked.status).toBe(429);
  });

  it('keeps other peers usable while one is locked out', async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(ctxFor('203.0.113.50', WRONG));
    }
    expect((await POST(ctxFor('203.0.113.50', RIGHT))).status).toBe(429);
    expect((await POST(ctxFor('203.0.113.51', RIGHT))).status).toBe(200);
  });
});
