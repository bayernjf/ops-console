import type { ServerContext } from './context.js';
import type { TraceListFilter, TraceQueryResult } from './upstream/types.js';

/**
 * Trace query pass-through (Tier0 M2 W2-5, TracePort v1 §5 / D-5). The console
 * holds no business rules: filters are trimmed and forwarded verbatim to zeus
 * GET /api/v1/traces; validation (ISO timestamps, cost bounds, limit cap) and
 * payload redaction are owned by zeus. No local storage, no caching — on any
 * upstream failure the caller sees the failure (fail-closed, 503 passthrough).
 */
export interface TraceListQuery {
  agent?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  minCostMicros?: string | undefined;
  maxCostMicros?: string | undefined;
  traceId?: string | undefined;
  limit?: string | undefined;
}

function orUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listTraces(
  ctx: ServerContext,
  query: TraceListQuery = {},
): Promise<TraceQueryResult> {
  const agent = orUndefined(query.agent);
  const from = orUndefined(query.from);
  const to = orUndefined(query.to);
  const minCostMicros = orUndefined(query.minCostMicros);
  const maxCostMicros = orUndefined(query.maxCostMicros);
  const traceId = orUndefined(query.traceId);
  const limit = orUndefined(query.limit);
  // Conditional spreads keep exactOptionalPropertyTypes happy: absent filters
  // are omitted, never set to explicit undefined.
  const filter: TraceListFilter = {
    ...(agent ? { agent } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(minCostMicros ? { minCostMicros } : {}),
    ...(maxCostMicros ? { maxCostMicros } : {}),
    ...(traceId ? { traceId } : {}),
    ...(limit ? { limit } : {}),
  };
  return ctx.zeus.getTraces(filter);
}
