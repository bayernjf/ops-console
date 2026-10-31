import { describe, expect, it, vi } from 'vitest';

/**
 * Route-protection middleware (src/middleware.ts) coverage. The route handlers
 * themselves never run without this gate, so it is exercised directly: Astro's
 * virtual `astro:middleware` module is replaced by an identity defineMiddleware
 * so `onRequest` is the raw handler, and the notify scheduler is stubbed so the
 * module import does not start a real poller.
 *
 * Covered contract:
 *  - unauthenticated page request  -> 302 to /login with encoded next param
 *  - unauthenticated /api request  -> 401 unified envelope (not a redirect)
 *  - public paths (/login, /healthz, /api/auth/login, inbound webhook) pass
 *  - a valid session cookie passes through and populates ctx.locals.session
 *  - tampered / expired cookies are treated as anonymous (fail-closed)
 *  - the SLA scheduler starts once at boot, independent of traffic (H1 fix)
 */
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
}));
vi.mock('../src/server/notify/index.js', () => ({
  startNotifyScheduler: vi.fn(),
}));

// The deliberate boot posture log fires at import time (before any beforeEach
// can attach a spy); silence it so the expected log does not pollute test output.
vi.hoisted(() => {
  console.error = () => {};
});

import { onRequest } from '../src/middleware.js';
import { startNotifyScheduler } from '../src/server/notify/index.js';
import { createSessionToken, parseSessionCookie, SESSION_COOKIE } from '../src/server/session.js';

const SECRET = 'vitest-session-secret';

type MiddlewareCtx = Parameters<typeof onRequest>[0];
/** Astro's MiddlewareNext resolves to a Promise<Response>. */
type NextFn = () => Promise<Response>;

const NEXT_OK = 'next-ok';

function fakeCtx(path: string, cookie?: string): { ctx: MiddlewareCtx; next: NextFn } {
  const url = new URL(`http://127.0.0.1:3022${path}`);
  const headers = new Headers(cookie ? { Cookie: cookie } : {});
  const locals: Record<string, unknown> = {};
  const next: NextFn = () => Promise.resolve(new Response(NEXT_OK, { status: 200 }));
  const ctx = {
    url,
    request: new Request(url, { method: 'GET', headers }),
    locals,
    redirect: (pathname: string, status = 302) =>
      new Response(null, { status, headers: { Location: pathname } }),
  } as unknown as MiddlewareCtx;
  return { ctx, next };
}

/** The handler's declared return includes void; a middleware under test always resolves here. */
async function run(ctx: MiddlewareCtx, next: NextFn): Promise<Response> {
  return (await onRequest(ctx, next)) as Response;
}

function cookieFor(payload: { username: string; role: 'owner' | 'operator' }, secret = SECRET): string {
  return `${SESSION_COOKIE}=${createSessionToken(payload, secret)}`;
}

function nextParamOf(location: string): string {
  return new URL(`http://127.0.0.1:3022${location}`).searchParams.get('next') ?? '';
}

describe('middleware route protection', () => {
  it('redirects an unauthenticated page request to /login with an encoded next param', async () => {
    const { ctx, next } = fakeCtx('/app/approvals');
    const res = await run(ctx, next);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?next=%2Fapp%2Fapprovals');
  });

  it('preserves path and query in the next param of the redirect', async () => {
    const { ctx } = fakeCtx('/app/orders?channel=demo');
    const res = await run(ctx, () => Promise.resolve(new Response(NEXT_OK)));
    const location = res.headers.get('Location') ?? '';
    expect(location.startsWith('/login?next=')).toBe(true);
    expect(nextParamOf(location)).toBe('/app/orders?channel=demo');
  });

  it('answers 401 with the unified envelope for unauthenticated /api requests', async () => {
    const { ctx } = fakeCtx('/api/approvals');
    const res = await run(ctx, () => Promise.resolve(new Response(NEXT_OK)));
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('lets public paths pass through without a session (page and API)', async () => {
    for (const path of ['/login', '/healthz', '/api/auth/login', '/api/inbound/zeus/decision-webhook']) {
      const { ctx, next } = fakeCtx(path);
      const res = await run(ctx, next);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(NEXT_OK);
    }
  });

  it('passes a valid owner session through and populates locals.session', async () => {
    const { ctx, next } = fakeCtx('/app/approvals', cookieFor({ username: 'alice', role: 'owner' }));
    const res = await run(ctx, next);
    expect(await res.text()).toBe(NEXT_OK);
    const session = (ctx.locals as { session: unknown }).session;
    expect(session).toMatchObject({ username: 'alice', role: 'owner' });
    // The cookie header round-trips through the same parser the middleware uses.
    const token = createSessionToken({ username: 'alice', role: 'owner' }, SECRET);
    expect(parseSessionCookie(`${SESSION_COOKIE}=${token}`)).toBe(token);
  });

  it('passes a valid operator session through with the role preserved', async () => {
    const { ctx, next } = fakeCtx('/api/policy', cookieFor({ username: 'bob', role: 'operator' }));
    const res = await run(ctx, next);
    expect(await res.text()).toBe(NEXT_OK);
    expect((ctx.locals as { session: { role: string } }).session.role).toBe('operator');
  });

  it('treats a tampered cookie signature as anonymous and redirects', async () => {
    const token = createSessionToken({ username: 'alice', role: 'owner' }, SECRET);
    const forged = `${token.slice(0, -3)}xyz`;
    const { ctx, next } = fakeCtx('/app/approvals', `${SESSION_COOKIE}=${forged}`);
    const res = await run(ctx, next);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/login?next=');
  });

  it('treats an expired session cookie as anonymous (12h TTL, fail-closed)', async () => {
    const stale = createSessionToken({ username: 'alice', role: 'owner' }, SECRET, Date.now() - 13 * 60 * 60 * 1000);
    const { ctx, next } = fakeCtx('/app/approvals', `${SESSION_COOKIE}=${stale}`);
    const res = await run(ctx, next);
    expect(res.status).toBe(302);
    expect((ctx.locals as { session: unknown }).session).toBeNull();
  });

  it('answers 401 (not a redirect) for an API request with an invalid cookie', async () => {
    const { ctx } = fakeCtx('/api/traces', `${SESSION_COOKIE}=not-a-token`);
    const res = await run(ctx, () => Promise.resolve(new Response(NEXT_OK)));
    expect(res.status).toBe(401);
  });

  it('starts the SLA scheduler once at boot, before any request arrives', () => {
    // Importing the middleware module is the boot event; the scheduler must
    // have been started with a context that carries the resolved config even
    // though no request has been seen (review H1: nobody opens the console).
    expect(vi.mocked(startNotifyScheduler)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(startNotifyScheduler).mock.calls[0]?.[0] as { config?: { sessionSecret?: string } } | undefined;
    expect(arg?.config?.sessionSecret).toBe(SECRET);
  });
});
