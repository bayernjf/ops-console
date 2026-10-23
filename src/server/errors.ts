/**
 * Console-internal errors (as opposed to upstream failures, which are
 * UpstreamError from upstream/http.ts and are passed through verbatim).
 *
 * Console-generated error bodies always use the unified envelope
 * `{ error: { code, message } }`; upstream 4xx/5xx keep their own body.
 */
export class ConsoleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConsoleError';
  }
}

export function forbidden(message = 'role not allowed for this action'): ConsoleError {
  return new ConsoleError(403, 'FORBIDDEN', message);
}

export function badRequest(message: string): ConsoleError {
  return new ConsoleError(400, 'VALIDATION_FAILED', message);
}
