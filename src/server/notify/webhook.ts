/**
 * Webhook delivery with bounded exponential backoff.
 *
 * Contract §3.3: on failure retry at 5s / 15s / 45s, then give up and let the
 * poller record a `channel_failure`. Retryable = network error or HTTP 5xx;
 * other 4xx responses are treated as permanent (the payload will never pass).
 *
 * The sleep function is injectable so tests never wait real seconds.
 */
import type { DeliveryOutcome, WebhookPayload } from './types.js';
import {
  DEFAULT_URL_GUARD_TIMEOUT_MS,
  assertWebhookUrlSafe,
  type AddressRecord,
} from '../net/url-guard.js';

export const DEFAULT_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export interface WebhookDelivererOptions {
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** Opt-in for local receivers (dev / tests); default rejects non-public targets. */
  allowPrivateHosts?: boolean;
  /** Injection seam for tests; defaults to DNS lookup of all address records. */
  lookup?: (host: string) => Promise<AddressRecord[]>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST the payload to the webhook URL with at most `backoffMs.length + 1`
 * attempts. Resolves with the outcome (never throws).
 */
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  options: WebhookDelivererOptions = {},
): Promise<DeliveryOutcome> {
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_URL_GUARD_TIMEOUT_MS;

  // Fail closed before any network activity: a private/reserved target is a
  // permanent error (retrying the same address cannot help).
  try {
    await assertWebhookUrlSafe(url, {
      ...(options.allowPrivateHosts !== undefined ? { allowPrivateHosts: options.allowPrivateHosts } : {}),
      ...(options.lookup ? { lookup: options.lookup } : {}),
      timeoutMs,
    });
  } catch (thrown) {
    return { ok: false, attempts: 0, error: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  let attempts = 0;
  let httpStatus: number | undefined;
  let error: string | undefined;

  for (;;) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // A redirect is an SSRF bypass: never follow one.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      httpStatus = response.status;
      if (response.ok) {
        return { ok: true, attempts, httpStatus };
      }
      if (response.status < 500) {
        // 4xx: payload rejected by the channel — retrying won't help.
        error = `webhook rejected with HTTP ${response.status}`;
        return {
          ok: false,
          attempts,
          ...(httpStatus !== undefined ? { httpStatus } : {}),
          error,
        };
      }
      error = `webhook returned HTTP ${response.status}`;
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }

    const wait = backoffMs[attempts - 1];
    if (wait === undefined) {
      return {
        ok: false,
        attempts,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    }
    await sleep(wait);
  }
}
