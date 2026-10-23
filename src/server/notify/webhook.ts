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

export const DEFAULT_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export interface WebhookDelivererOptions {
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
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
