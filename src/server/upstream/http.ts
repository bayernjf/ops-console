import type { UpstreamErrorBody } from './types.js';

/**
 * A failed upstream call. The console never fabricates business results: on
 * transport failure it surfaces 503; on 4xx/5xx it preserves the upstream
 * status and error body so the caller can pass it through.
 */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Total request timeout in ms (default 10s). Ignored when `signal` is
   *  provided — an explicit caller signal always wins. */
  timeoutMs?: number;
}

/** Default upstream budget: a half-hung upstream must surface as 503 within
 *  seconds, not hold SSR pages and the notify poller hostage for minutes
 *  (2026-11-02 review P2-1). */
const DEFAULT_TIMEOUT_MS = 10_000;

export async function callJson<T>(
  baseUrl: string,
  token: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(path, baseUrl);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let response: Response;
  try {
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers:
        options.body !== undefined
          ? { ...headers, 'Content-Type': 'application/json' }
          : headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
    response = await fetch(url, init);
  } catch (thrown) {
    // The internal base URL and the transport cause stay in the server log
    // only (Tier0 review 2026-10-30 H2): the client-facing message is fixed
    // and generic, so the console never discloses where its upstreams live.
    // TimeoutError lands here too — a timed-out upstream is a transport
    // failure and maps to the same 503 UPSTREAM_UNAVAILABLE.
    const cause = thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown);
    console.error(`[ops-console] upstream ${url.toString()} unreachable: ${cause}`);
    throw new UpstreamError(503, 'UPSTREAM_UNAVAILABLE', 'upstream unavailable');
  }
  const text = await response.text();
  const parsed: unknown = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const body = parsed as UpstreamErrorBody | undefined;
    const code = body?.error?.code ?? 'UPSTREAM_ERROR';
    const message = body?.error?.message ?? `upstream ${response.status}`;
    throw new UpstreamError(response.status, code, message, parsed);
  }
  return parsed as T;
}
