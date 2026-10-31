import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context.js';
import { listTraces } from '../../../server/traces-service.js';
import { canViewTraces } from '../../../server/rbac.js';
import { forbidden } from '../../../server/errors.js';
import { jsonResponse, toErrorResponse } from '../../../server/endpoint-json.js';

/**
 * GET /api/traces?agent=&from=&to=&min_cost_micros=&max_cost_micros=&trace_id=&limit=
 * — owner-only read-only pass-through to zeus GET /api/v1/traces (TracePort
 * v1 §5). Filters forward verbatim; zeus 4xx/5xx pass through unchanged and
 * transport failures fail closed as 503.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.session || !canViewTraces(locals.session.role)) {
    return toErrorResponse(forbidden('trace query is owner-only'));
  }
  try {
    const result = await listTraces(getContext(), {
      agent: url.searchParams.get('agent') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      minCostMicros: url.searchParams.get('min_cost_micros') ?? undefined,
      maxCostMicros: url.searchParams.get('max_cost_micros') ?? undefined,
      traceId: url.searchParams.get('trace_id') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    return jsonResponse(200, result);
  } catch (thrown) {
    return toErrorResponse(thrown);
  }
};
