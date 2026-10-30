// Sliding-window brute-force guard for the login endpoint.
//
// Only FAILED attempts consume the budget, so a correct login is never
// throttled and one operator's mistype cannot lock out another peer. The key
// is the server-observed peer address; the right-most X-Forwarded-For hop is
// only a fallback for adapters that cannot see the socket, because a
// client-supplied leading hop must not be able to pick its own bucket.

export interface LoginThrottleOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export class LoginThrottle {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: LoginThrottleOptions = {}) {
    this.limit = options.limit ?? 10;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  /** How many more failures this key may record inside the window. */
  remaining(key: string): number {
    return Math.max(0, this.limit - this.recent(key).length);
  }

  recordFailure(key: string): void {
    const recent = this.recent(key);
    recent.push(this.now());
    this.hits.set(key, recent);
  }

  private recent(key: string): number[] {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent;
  }
}

/** Process-wide instance; the console is single-process by design. */
export const loginThrottle = new LoginThrottle();

/**
 * Bucket key for one login attempt. Prefers the address the server observed;
 * falls back to the proxy-appended hop, then to a shared 'unknown' bucket.
 */
export function loginKey(
  clientAddress: string | undefined,
  forwardedFor: string | null,
): string {
  if (clientAddress !== undefined && clientAddress !== '') return clientAddress;
  if (forwardedFor !== null && forwardedFor !== '') {
    const hops = forwardedFor
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop !== '');
    const peer = hops[hops.length - 1];
    if (peer !== undefined) return peer;
  }
  return 'unknown';
}
