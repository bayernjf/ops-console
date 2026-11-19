import { callJson, UpstreamError } from './http.js';

/** Tier0 org M3 F3.3 axes exposed by model-hub's /admin/costs/org. */
export type OrgCostDimension = 'position' | 'department' | 'task';

export interface OrgCostRow {
  key: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

export interface OrgCostTotals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

export interface OrgCostWindow {
  from?: string;
  to?: string;
}

export interface OrgCostResponse {
  group_by: OrgCostDimension;
  window: OrgCostWindow | null;
  rows: OrgCostRow[];
  totals: OrgCostTotals;
}

/** model-hub issues a 12h HMAC session cookie; refresh well before it expires. */
const SESSION_TTL_MS = 11 * 60 * 60 * 1000;

/**
 * Read-only client for model-hub's admin cost API (Tier0 org M3).
 *
 * model-hub's admin surface is cookie-authenticated, not bearer-authenticated.
 * The console therefore signs in with the configured owner account and keeps
 * the signed session in this process only. One 401 invalidates the cached
 * cookie and retries once with a fresh login; every other failure is passed
 * through unchanged so the page can fail closed.
 */
export class ModelHubUpstream {
  private cookie: string | null = null;
  private cookieExpiresAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private async login(): Promise<string> {
    if (this.password.length === 0) {
      throw new UpstreamError(
        503,
        'MODEL_HUB_NOT_CONFIGURED',
        'model-hub admin credentials are not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(new URL('/api/admin/session', this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (thrown) {
      const cause = thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown);
      console.error(`[ops-console] model-hub login unreachable: ${cause}`);
      throw new UpstreamError(503, 'UPSTREAM_UNAVAILABLE', 'upstream unavailable');
    }

    if (!response.ok) {
      throw new UpstreamError(
        response.status,
        'MODEL_HUB_AUTH_FAILED',
        `model-hub admin login failed (${response.status})`,
      );
    }

    const setCookie = response.headers.get('set-cookie') ?? '';
    const session = setCookie.match(/hub_session=([^;]+)/)?.[1];
    if (!session) {
      throw new UpstreamError(
        502,
        'MODEL_HUB_AUTH_FAILED',
        'model-hub admin login returned no session cookie',
      );
    }

    this.cookie = `hub_session=${session}`;
    this.cookieExpiresAt = Date.now() + SESSION_TTL_MS;
    return this.cookie;
  }

  private async cookieOrLogin(): Promise<string> {
    if (this.cookie && Date.now() < this.cookieExpiresAt) return this.cookie;
    return this.login();
  }

  async getOrgCosts(
    dimension: OrgCostDimension,
    window: OrgCostWindow = {},
  ): Promise<OrgCostResponse> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cookie = await this.cookieOrLogin();
      try {
        return await callJson<OrgCostResponse>(this.baseUrl, '', '/api/admin/costs/org', {
          query: {
            group_by: dimension,
            ...(window.from ? { from: window.from } : {}),
            ...(window.to ? { to: window.to } : {}),
          },
          headers: { Cookie: cookie, Authorization: '' },
        });
      } catch (thrown) {
        // An expired/rotated session is the only retryable case: drop the
        // cached cookie and re-login once. Everything else propagates.
        if (
          thrown instanceof UpstreamError &&
          thrown.status === 401 &&
          attempt === 0
        ) {
          this.cookie = null;
          this.cookieExpiresAt = 0;
          continue;
        }
        throw thrown;
      }
    }
    throw new UpstreamError(503, 'UPSTREAM_UNAVAILABLE', 'upstream unavailable');
  }
}
