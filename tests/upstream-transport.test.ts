import { afterEach, describe, expect, it, vi } from 'vitest';
import { callJson, UpstreamError } from '../src/server/upstream/http.js';
import { toErrorResponse } from '../src/server/endpoint-json.js';

/**
 * Tier0 review 2026-10-30 H2: a transport failure used to produce
 * `upstream <internal base URL> unreachable: <cause>`, and that message was
 * forwarded verbatim to the browser. The client body must stay generic while
 * the internal URL and cause remain in the server log only.
 */
describe('upstream transport failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hides the internal base URL from the 503 body and logs it server-side', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:8181');
    });
    const thrown = await callJson('http://internal.zeus.example:8181', 'tok', '/api/v1/decisions').then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(UpstreamError);
    expect((thrown as UpstreamError).message).toBe('upstream unavailable');

    const res = toErrorResponse(thrown);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
    expect(body.error).toEqual({ code: 'UPSTREAM_UNAVAILABLE', message: 'upstream unavailable', retryable: true });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('internal.zeus.example');
    expect(raw).not.toContain('ECONNREFUSED');

    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls.map((args) => args.map(String).join(' ')).join(' ');
    expect(logged).toContain('internal.zeus.example');
    expect(logged).toContain('ECONNREFUSED');
  });
});

/**
 * P2-1 regression: callJson accepted an AbortSignal but nobody passed one, so
 * a half-hung upstream (connection open, never answers) held SSR pages and
 * the notify poller for minutes with zero log lines. There is now a default
 * 10s budget; a caller-provided signal still wins. Real AbortSignal timers —
 * no fake clocks.
 */
describe('upstream default timeout (P2-1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('attaches a default timeout signal when the caller passes nothing', async () => {
    let seenSignal: unknown;
    vi.stubGlobal('fetch', async (_url: unknown, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return new Response('{}', { status: 200 });
    });
    await callJson('http://127.0.0.1:1', 'tok', '/x');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect((seenSignal as AbortSignal).aborted).toBe(false);
  });

  it('a half-hung upstream times out into 503 UPSTREAM_UNAVAILABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        // Mirrors undici: the request hangs until the signal aborts it.
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation timed out.', 'TimeoutError')),
          );
        }),
    );
    const started = Date.now();
    const thrown = await callJson('http://127.0.0.1:1', 'tok', '/hang', { timeoutMs: 25 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(UpstreamError);
    expect((thrown as UpstreamError).status).toBe(503);
    expect((thrown as UpstreamError).code).toBe('UPSTREAM_UNAVAILABLE');
    // Fired on the 25ms budget, not the 10s default.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('an explicit caller signal wins over the timeout budget', async () => {
    let seenSignal: unknown;
    vi.stubGlobal('fetch', async (_url: unknown, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return new Response('{}', { status: 200 });
    });
    const controller = new AbortController();
    await callJson('http://127.0.0.1:1', 'tok', '/x', { signal: controller.signal, timeoutMs: 5 });
    expect(seenSignal).toBe(controller.signal);
  });
});
