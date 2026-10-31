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
