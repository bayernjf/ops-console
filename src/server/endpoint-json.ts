import { ConsoleError } from './errors.js';
import { UpstreamError } from './upstream/http.js';

/** Shared JSON response helper for /api endpoints. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Map a thrown error from a service module to the HTTP contract:
 *  - ConsoleError           -> unified { error: { code, message } } envelope
 *  - UpstreamError          -> upstream status forwarded with its verbatim body
 *                             (transport failures are 503 UPSTREAM_UNAVAILABLE)
 *  - anything else         -> 500 INTERNAL_ERROR, never leaks internals
 */
export function toErrorResponse(thrown: unknown): Response {
  if (thrown instanceof ConsoleError) {
    return jsonResponse(thrown.status, {
      error: { code: thrown.code, message: thrown.message },
    });
  }
  if (thrown instanceof UpstreamError) {
    if (thrown.body !== undefined) {
      return new Response(JSON.stringify(thrown.body), {
        status: thrown.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return jsonResponse(thrown.status, {
      error: { code: thrown.code, message: thrown.message, retryable: thrown.status >= 500 },
    });
  }
  console.error('[ops-console] endpoint failed', thrown);
  return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'console internal error' } });
}
